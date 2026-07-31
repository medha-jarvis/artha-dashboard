"""
Drift Tracker — calculates T+1, T+5, T+20 returns for all active PEAD signals.

Runs daily at 10:45 UTC (4:15 PM IST).
GETs signals from VPS API → yfinance price lookup → PATCH drift back to VPS API.
No Supabase. No external DB dependency.
"""

import os, time, requests
from datetime import date, timedelta
import yfinance as yf

VPS_API = os.environ.get("VPS_API_URL", "http://31.97.227.135/api")
API_KEY = os.environ.get("VPS_API_KEY", "")
HEADERS = {"Content-Type": "application/json", "x-pead-key": API_KEY}


def trading_day_close(ticker_ns: str, signal_date: date, n: int) -> float | None:
    """Closing price on the Nth trading day after signal_date."""
    try:
        end = signal_date + timedelta(days=int(n * 1.6) + 10)
        if end > date.today():
            end = date.today()
        df = yf.download(ticker_ns,
                         start=(signal_date + timedelta(days=1)).isoformat(),
                         end=end.isoformat(),
                         interval="1d", auto_adjust=True, progress=False)
        if df.empty or len(df) < n:
            return None
        return float(df["Close"].squeeze().iloc[n - 1])
    except Exception as e:
        print(f"  [price] T+{n}: {e}")
        return None


def base_close(ticker_ns: str, signal_date: date) -> float | None:
    try:
        df = yf.download(ticker_ns,
                         start=signal_date.isoformat(),
                         end=(signal_date + timedelta(days=1)).isoformat(),
                         interval="1d", auto_adjust=True, progress=False)
        if df.empty:
            return None
        return float(df["Close"].squeeze().iloc[-1])
    except Exception as e:
        print(f"  [base] {ticker_ns}: {e}")
        return None


def ret(base: float | None, target: float | None) -> float | None:
    if base and target and base != 0:
        return round((target - base) / base * 100, 4)
    return None


def main():
    today = date.today()
    print(f"=== Drift Tracker {today} ===")

    try:
        resp = requests.get(f"{VPS_API}/pead/signals", headers=HEADERS, timeout=10)
        signals = [s for s in resp.json() if s.get("status") == "active"]
    except Exception as e:
        print(f"[api] failed to fetch signals: {e}")
        return

    print(f"[api] {len(signals)} active signals")

    for sig in signals:
        sig_id   = sig["id"]
        ticker   = sig["ticker"]
        sig_date = date.fromisoformat(sig["signal_date"])
        ticker_ns = ticker if ticker.endswith(".NS") else ticker + ".NS"

        print(f"\n→ {ticker} ({sig_date})")

        base = base_close(ticker_ns, sig_date)
        time.sleep(0.5)
        if not base:
            print("  no base price")
            continue

        updates = {}
        for n, col in [(1, "t_1_return"), (5, "t_5_return"), (20, "t_20_return")]:
            # Skip already-filled columns
            if sig.get(col) is not None:
                print(f"  T+{n}: already {sig[col]:+.2f}%")
                continue
            # Need enough calendar time
            if (today - sig_date).days < int(n * 1.5):
                print(f"  T+{n}: too early")
                continue
            price = trading_day_close(ticker_ns, sig_date, n)
            time.sleep(1)
            r = ret(base, price)
            if r is not None:
                updates[col] = r
                print(f"  T+{n}: {r:+.2f}%")
            else:
                print(f"  T+{n}: price not available yet")

        if updates:
            try:
                requests.patch(f"{VPS_API}/pead/drift/{sig_id}",
                               json=updates, headers=HEADERS, timeout=10)
                print(f"  ✓ patched: {list(updates.keys())}")
            except Exception as e:
                print(f"  [api] patch failed: {e}")

    # Expire old signals
    try:
        r = requests.patch(f"{VPS_API}/pead/signals/expire", headers=HEADERS, timeout=10)
        print(f"\n[expire] {r.json().get('expired', 0)} signals expired")
    except Exception as e:
        print(f"[expire] failed: {e}")


if __name__ == "__main__":
    main()

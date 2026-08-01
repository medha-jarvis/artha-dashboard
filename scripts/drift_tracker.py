"""
Drift Tracker v2 — updates returns_since_result and daily_return for ALL signals.
Also fills T+1, T+5, T+20 when enough time has elapsed.

Runs: Mon-Fri at 10:45 UTC (4:15 PM IST).
"""

import os, time
from datetime import date, timedelta
import yfinance as yf
from supabase import create_client, Client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


def fetch_price_series(ticker_ns: str, from_date: date) -> dict:
    """
    Returns dict of date_str -> close price for all dates from from_date.
    Also returns prev_close and current_close.
    """
    out = dict(series={}, current=None, prev=None, base=None)
    try:
        # Fetch from result date onwards (need full history for base price too)
        start = from_date - timedelta(days=1)  # one day before to get the base
        df = yf.download(ticker_ns, start=start.isoformat(),
                         interval="1d", auto_adjust=True, progress=False)
        if df.empty:
            return out

        close = df["Close"].squeeze()

        # Base price = close on or after from_date
        # (on the result day itself or first trading day after)
        base_series = close[close.index.date >= from_date]
        if not base_series.empty:
            out["base"] = float(base_series.iloc[0])

        out["current"] = float(close.iloc[-1])
        out["prev"]    = float(close.iloc[-2]) if len(close) >= 2 else None

        # Build series indexed by date string for T+N lookups
        for i, (idx, val) in enumerate(close.items()):
            d = idx.date() if hasattr(idx, 'date') else idx
            if d >= from_date:
                out["series"][i] = float(val)  # 0 = first day on/after result
    except Exception as e:
        print(f"  [price] {ticker_ns}: {e}")
    return out


def main():
    today = date.today()
    print(f"=== Drift Tracker v2 — {today} ===")

    # Fetch ALL signals (active + recent expired) with their existing drift row
    resp = supabase.table("pead_signals") \
        .select("id, ticker, signal_date") \
        .gte("signal_date", (today - timedelta(days=60)).isoformat()) \
        .order("signal_date", desc=True) \
        .execute()

    signals = resp.data or []
    print(f"[db] {len(signals)} signals to update")

    for sig in signals:
        sig_id   = sig["id"]
        ticker   = sig["ticker"]
        sig_date = date.fromisoformat(sig["signal_date"])
        ns       = ticker if ticker.endswith(".NS") else ticker + ".NS"

        print(f"\n→ {ticker} ({sig_date})")

        prices = fetch_price_series(ns, sig_date)
        time.sleep(0.8)

        base    = prices["base"]
        current = prices["current"]
        prev    = prices["prev"]
        series  = prices["series"]

        if base is None or current is None:
            print("  no price data — skipping")
            continue

        updates: dict = {
            "returns_since_result": round((current - base) / base * 100, 4),
            "daily_return":         round((current - prev) / prev * 100, 4) if prev else None,
            "updated_at":           "now()",
        }

        # T+1, T+5, T+20 — fill only when we have enough data
        for n, col in [(1, "t_1_return"), (5, "t_5_return"), (20, "t_20_return")]:
            if n in series:
                target = series[n]
                updates[col] = round((target - base) / base * 100, 4)

        ret_pct = updates["returns_since_result"]
        print(f"  returns_since={ret_pct:+.2f}%  daily={updates['daily_return']}")

        # Upsert drift_performance
        supabase.table("drift_performance").upsert(
            {"signal_id": sig_id, **updates}, on_conflict="signal_id"
        ).execute()

    # Expire signals > 60 days old
    cutoff = (today - timedelta(days=60)).isoformat()
    supabase.table("pead_signals") \
        .update({"trigger_path": "NONE"}) \
        .lt("signal_date", cutoff) \
        .eq("trigger_path", "A") \
        .execute()

    print(f"\n[done] all signals updated")


if __name__ == "__main__":
    main()

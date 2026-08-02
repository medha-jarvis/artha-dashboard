"""
Insider Returns Updater — fills in actual_return_3m/6m/1y for past signals.

Runs monthly (1st of month) via VPS cron.
For each signal > 90 days old without a 3m return, fetch the stock price
at signal_date, +90d, +180d, +365d using Yahoo Finance and store the % change.
"""

import os, time
from datetime import date, timedelta, datetime as dt
import yfinance as yf
from supabase import create_client, Client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]

sb: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
TODAY = date.today()


def get_price_on(ticker_ns: str, hist: object, target_date: date) -> float | None:
    """Find closing price nearest to target_date in yfinance history df."""
    try:
        if hasattr(hist.index, 'tz_localize'):
            idx = hist.index.tz_localize(None) if hist.index.tzinfo else hist.index
        else:
            idx = hist.index
        target = dt.combine(target_date, dt.min.time())
        diffs  = abs(idx - target)
        pos    = int(diffs.argmin())
        if diffs[pos].days > 7:
            return None
        return float(hist["Close"].iloc[pos])
    except Exception:
        return None


def compute_returns_for(ticker: str, signal_date_str: str, base_price_stored: float | None) -> dict:
    """Compute 3m/6m/1y returns for a signal using yfinance."""
    sig_date = date.fromisoformat(signal_date_str)
    end_date = TODAY + timedelta(days=1)
    ns = ticker if ticker.endswith(".NS") else ticker + ".NS"
    out: dict = {}

    try:
        t    = yf.Ticker(ns)
        hist = t.history(
            start=(sig_date - timedelta(days=5)).isoformat(),
            end=end_date.isoformat(),
            interval="1d", auto_adjust=True
        )
        time.sleep(0.4)
        if hist.empty:
            return out

        base = get_price_on(ns, hist, sig_date) or base_price_stored
        if not base:
            return out
        out["base_price"] = round(base, 2)

        def pct(d: date) -> float | None:
            p = get_price_on(ns, hist, d)
            return round((p - base) / base * 100, 2) if p else None

        d3m  = sig_date + timedelta(days=91)
        d6m  = sig_date + timedelta(days=183)
        d1y  = sig_date + timedelta(days=365)

        if TODAY >= d3m:  out["actual_return_3m"] = pct(d3m)
        if TODAY >= d6m:  out["actual_return_6m"] = pct(d6m)
        if TODAY >= d1y:  out["actual_return_1y"] = pct(d1y)
    except Exception as e:
        print(f"  [yf] {ns}: {e}")

    return out


def main():
    print(f"=== Insider Returns Updater — {TODAY} ===")

    # Fetch signals missing 3m return and old enough
    cutoff_3m = (TODAY - timedelta(days=91)).isoformat()
    try:
        resp = sb.table("insider_signals") \
            .select("id,ticker,signal_date,base_price") \
            .is_("actual_return_3m", "null") \
            .lte("signal_date", cutoff_3m) \
            .order("signal_date") \
            .limit(200) \
            .execute()
        signals = resp.data or []
    except Exception as e:
        print(f"[db] fetch failed: {e}")
        return

    print(f"[found] {len(signals)} signals needing return update")

    updated = 0
    for sig in signals:
        sid     = sig["id"]
        ticker  = sig["ticker"]
        sig_date = sig["signal_date"]
        base_stored = sig.get("base_price")

        print(f"  {ticker} | {sig_date}", end="  ")
        rets = compute_returns_for(ticker, sig_date, base_stored)

        if not rets:
            print("no data")
            continue

        # Only update fields that are now computable
        update = {}
        if "base_price" in rets and not base_stored:
            update["base_price"] = rets["base_price"]
        if "actual_return_3m" in rets and rets["actual_return_3m"] is not None:
            update["actual_return_3m"] = rets["actual_return_3m"]
        if "actual_return_6m" in rets and rets["actual_return_6m"] is not None:
            update["actual_return_6m"] = rets["actual_return_6m"]
        if "actual_return_1y" in rets and rets["actual_return_1y"] is not None:
            update["actual_return_1y"] = rets["actual_return_1y"]

        if update:
            try:
                sb.table("insider_signals").update(update).eq("id", sid).execute()
                parts = [f"3m={rets.get('actual_return_3m','?'):.1f}%" if isinstance(rets.get('actual_return_3m'), float) else "",
                         f"6m={rets.get('actual_return_6m','?'):.1f}%" if isinstance(rets.get('actual_return_6m'), float) else "",
                         f"1y={rets.get('actual_return_1y','?'):.1f}%" if isinstance(rets.get('actual_return_1y'), float) else ""]
                print(" | ".join(p for p in parts if p))
                updated += 1
            except Exception as e:
                print(f"db error: {e}")
        else:
            print("nothing to update yet")

    print(f"\n[done] {updated}/{len(signals)} signals updated")


if __name__ == "__main__":
    main()

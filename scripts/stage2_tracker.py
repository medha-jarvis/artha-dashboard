"""
Stage 2 Performance Tracker — updates live returns for all active Stage 2 signals.
Runs daily after market close (after stage2_engine).
"""

import os, time
from datetime import date, timedelta
import yfinance as yf
from supabase import create_client, Client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
sb: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


def fetch_price_series(ticker_ns: str, from_date: date) -> dict:
    out = dict(base=None, current=None, prev=None, series={})
    try:
        start = (from_date - timedelta(days=1)).isoformat()
        df    = yf.download(ticker_ns, start=start, interval="1d",
                            auto_adjust=True, progress=False)
        if df.empty:
            return out

        close = df["Close"].squeeze()
        base_series = close[close.index.date >= from_date]
        if not base_series.empty:
            out["base"] = float(base_series.iloc[0])

        out["current"] = float(close.iloc[-1])
        if len(close) >= 2:
            out["prev"] = float(close.iloc[-2])

        idx = 0
        for d, v in close.items():
            day = d.date() if hasattr(d, "date") else d
            if day >= from_date:
                out["series"][idx] = float(v)
                idx += 1
    except Exception as e:
        print(f"  [price] {ticker_ns}: {e}")
    return out


def main():
    today = date.today()
    print(f"=== Stage 2 Tracker — {today} ===")

    # Fetch all signals from last 90 days
    cutoff = (today - timedelta(days=90)).isoformat()
    resp = sb.table("stage2_signals") \
        .select("id, ticker, signal_date") \
        .gte("signal_date", cutoff) \
        .order("signal_date", desc=True) \
        .execute()

    signals = resp.data or []
    print(f"[db] {len(signals)} signals to update")

    for sig in signals:
        sig_id   = sig["id"]
        ticker   = sig["ticker"]
        sig_date = date.fromisoformat(sig["signal_date"])
        ns       = ticker if ticker.endswith(".NS") else ticker + ".NS"

        print(f"→ {ticker} ({sig_date})", end="  ")

        prices = fetch_price_series(ns, sig_date)
        time.sleep(0.8)

        base    = prices["base"]
        current = prices["current"]
        prev    = prices["prev"]
        series  = prices["series"]

        if not base or not current:
            print("no data")
            continue

        def ret(n: int) -> float | None:
            if n in series and base:
                return round((series[n] - base) / base * 100, 4)
            return None

        updates = {
            "returns_since_breakout": round((current - base) / base * 100, 4),
            "daily_return":           round((current - prev) / prev * 100, 4) if prev else None,
            "t_5_return":             ret(5),
            "t_20_return":            ret(20),
            "t_60_return":            ret(60),
            "updated_at":             "now()",
        }

        r = updates["returns_since_breakout"]
        print(f"ret={r:+.2f}%")

        sb.table("stage2_performance").upsert(
            {"signal_id": sig_id, **updates}, on_conflict="signal_id"
        ).execute()

        # Keep days_in_stage2 fresh — signal_date is the breakout detection date
        days_live = (today - sig_date).days
        sb.table("stage2_signals").update({"days_in_stage2": days_live}).eq("id", sig_id).execute()

    print("[done]")


if __name__ == "__main__":
    main()

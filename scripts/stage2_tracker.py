"""
Stage 2 Performance Tracker — updates live returns for all active Stage 2 signals.
Runs daily after market close (after stage2_engine).
"""

import os, time
from datetime import date, timedelta
import pandas as pd
import yfinance as yf
from supabase import create_client, Client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
sb: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


def _clean_close(df: pd.DataFrame) -> pd.Series:
    """Extract a clean Close price Series regardless of yfinance column format."""
    if isinstance(df.columns, pd.MultiIndex):
        df = df.droplevel(1, axis=1)
    close = df["Close"]
    if isinstance(close, pd.DataFrame):
        close = close.iloc[:, 0]
    elif not isinstance(close, pd.Series):
        close = pd.Series([float(close)], index=df.index)
    return close.dropna()


def fetch_price_series(ticker_ns: str, entry_date: date) -> dict:
    """
    Fetch prices from entry_date to today.
    base    = closing price on or after entry_date (for returns_since_breakout)
    current = latest close (today if available, else most recent)
    prev    = close one session before current (for daily_return)
    series  = {0: entry_close, 1: next_close, ...} indexed from entry
    """
    out = dict(base=None, current=None, prev=None, series={})
    try:
        start = (entry_date - timedelta(days=3)).isoformat()  # buffer for weekends
        df    = yf.download(ticker_ns, start=start, interval="1d",
                            auto_adjust=True, progress=False)
        if df.empty:
            return out

        close = _clean_close(df)
        if close.empty:
            return out

        # base = first close on or after entry_date
        base_mask = close.index.normalize() >= pd.Timestamp(entry_date)
        base_series = close[base_mask]
        if not base_series.empty:
            out["base"] = float(base_series.iloc[0])

        out["current"] = float(close.iloc[-1])
        if len(close) >= 2:
            out["prev"] = float(close.iloc[-2])

        # series: indexed from entry position
        idx = 0
        for ts, v in close.items():
            if ts.normalize() >= pd.Timestamp(entry_date):
                out["series"][idx] = float(v)
                idx += 1
    except Exception as e:
        print(f"  [price] {ticker_ns}: {e}")
    return out


def main():
    today = date.today()
    print(f"=== Stage 2 Tracker — {today} ===")

    # Fetch only today's signals (deduplicated by taking one row per ticker)
    # Returns are computed from entry_date, not signal_date
    cutoff = (today - timedelta(days=90)).isoformat()
    resp = sb.table("stage2_signals") \
        .select("id, ticker, signal_date, entry_date") \
        .gte("signal_date", cutoff) \
        .order("signal_date", desc=True) \
        .execute()

    # Deduplicate: one row per ticker (latest signal_date)
    seen: set[str] = set()
    signals = []
    for row in (resp.data or []):
        if row["ticker"] not in seen:
            seen.add(row["ticker"])
            signals.append(row)
    print(f"[db] {len(signals)} unique tickers to update")

    for sig in signals:
        sig_id     = sig["id"]
        ticker     = sig["ticker"]
        entry_date = date.fromisoformat(sig["entry_date"] or sig["signal_date"])
        ns         = ticker if ticker.endswith(".NS") else ticker + ".NS"

        print(f"→ {ticker} (entry {entry_date})", end="  ")

        prices = fetch_price_series(ns, entry_date)
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

        # Keep days_in_stage2 fresh — measured from entry_date
        days_live = (today - entry_date).days
        sb.table("stage2_signals").update({"days_in_stage2": days_live}).eq("id", sig_id).execute()

    print("[done]")


if __name__ == "__main__":
    main()

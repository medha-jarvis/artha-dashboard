"""
Drift Tracker — calculates T+1, T+5, T+20 returns for all PEAD signals.

Runs daily at 10:45 UTC (4:15 PM IST).
Fetches signals from Supabase, computes returns using yfinance close prices,
and updates drift_performance rows.
"""

import os, time
from datetime import date, timedelta
import pandas as pd
import yfinance as yf
from supabase import create_client, Client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

TRADING_DAYS = {1: "t_1_return", 5: "t_5_return", 20: "t_20_return"}


def get_trading_day_price(ticker_ns: str, signal_date: date, n_trading_days: int) -> float | None:
    """
    Returns the closing price on the Nth trading day after signal_date,
    or None if data isn't available yet.
    """
    try:
        # Fetch a generous window — n_days * 1.6 calendar days covers weekends/holidays
        start = signal_date + timedelta(days=1)
        end   = signal_date + timedelta(days=int(n_trading_days * 1.6) + 10)

        if end > date.today():
            end = date.today()

        df = yf.download(ticker_ns, start=start.isoformat(), end=end.isoformat(),
                         interval="1d", auto_adjust=True, progress=False)
        if df.empty or len(df) < n_trading_days:
            return None

        closes = df["Close"].squeeze()
        return float(closes.iloc[n_trading_days - 1])
    except Exception as e:
        print(f"  [price] {ticker_ns} T+{n_trading_days}: {e}")
        return None


def get_signal_day_close(ticker_ns: str, signal_date: date) -> float | None:
    """Returns the closing price ON the signal_date (base price for return calc)."""
    try:
        next_day = signal_date + timedelta(days=1)
        df = yf.download(ticker_ns, start=signal_date.isoformat(), end=next_day.isoformat(),
                         interval="1d", auto_adjust=True, progress=False)
        if df.empty:
            return None
        return float(df["Close"].squeeze().iloc[-1])
    except Exception as e:
        print(f"  [base price] {ticker_ns}: {e}")
        return None


def pct_return(base: float | None, target: float | None) -> float | None:
    if base is None or target is None or base == 0:
        return None
    return round((target - base) / base * 100, 4)


def main():
    today = date.today()
    print(f"=== Drift Tracker {today} ===")

    # Fetch all active signals
    resp = supabase.table("pead_signals") \
        .select("id, ticker, signal_date") \
        .eq("status", "active") \
        .order("signal_date", desc=True) \
        .execute()

    signals = resp.data or []
    print(f"[db] {len(signals)} active signals to process")

    for sig in signals:
        sig_id   = sig["id"]
        ticker   = sig["ticker"]
        sig_date = date.fromisoformat(sig["signal_date"])
        ticker_ns = ticker + ".NS" if not ticker.endswith(".NS") else ticker

        print(f"\n→ {ticker} (signal: {sig_date})")

        # Fetch existing drift row
        existing = supabase.table("drift_performance") \
            .select("*") \
            .eq("signal_id", sig_id) \
            .execute()
        existing_row = existing.data[0] if existing.data else {}

        # Base price (close on signal day)
        base_price = get_signal_day_close(ticker_ns, sig_date)
        time.sleep(0.5)

        if base_price is None:
            print(f"  No base price — skipping")
            continue

        updates: dict = {}

        for n_days, col in TRADING_DAYS.items():
            # Skip columns already filled
            if existing_row.get(col) is not None:
                print(f"  T+{n_days}: already recorded ({existing_row[col]:+.2f}%), skipping")
                continue

            # Check if enough trading days have elapsed
            min_calendar_days = int(n_days * 1.5)
            if (today - sig_date).days < min_calendar_days:
                print(f"  T+{n_days}: not yet ({(today - sig_date).days} calendar days elapsed, need ~{min_calendar_days})")
                continue

            target_price = get_trading_day_price(ticker_ns, sig_date, n_days)
            time.sleep(1)
            ret = pct_return(base_price, target_price)

            if ret is not None:
                updates[col] = ret
                print(f"  T+{n_days}: {ret:+.2f}%")
            else:
                print(f"  T+{n_days}: price not yet available")

        if not updates:
            continue

        # Upsert drift_performance
        if existing_row:
            supabase.table("drift_performance") \
                .update({**updates, "updated_at": "now()"}) \
                .eq("signal_id", sig_id) \
                .execute()
        else:
            supabase.table("drift_performance") \
                .insert({"signal_id": sig_id, **updates}) \
                .execute()

        print(f"  ✓ Updated: {list(updates.keys())}")

    # Mark signals older than 30 days as expired
    cutoff = (today - timedelta(days=30)).isoformat()
    supabase.table("pead_signals") \
        .update({"status": "expired"}) \
        .eq("status", "active") \
        .lt("signal_date", cutoff) \
        .execute()
    print(f"\n[cleanup] Signals before {cutoff} marked expired")


if __name__ == "__main__":
    main()

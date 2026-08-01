"""
Stage 2 Backfill — seeds last N days of Stage 2 signals.

Downloads full OHLCV history once per ticker, then for each historical date
calculates the exact metrics using only data visible up to that date (no look-ahead).
Scores and inserts with the correct signal_date.

Usage:
    python scripts/backfill_stage2.py --days 7
    python scripts/backfill_stage2.py --from 2026-07-25 --to 2026-08-01
"""

import os, time, argparse
from datetime import date, timedelta, datetime as dt
import pandas as pd
import numpy as np
import yfinance as yf
from supabase import create_client, Client

# Import scoring helpers from stage2_engine
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from stage2_engine import (
    get_nifty500_tickers, compute_stage2_score, tier_from_score,
    upsert_signal, get_pead_high_scorers,
    BENCHMARK, EMA_PERIOD, VOL_SMA, RS_PERIOD, MIN_ADTV,
)

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
sb: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


def analyse_at_date(full_hist: pd.DataFrame, bench_hist: pd.DataFrame,
                    target_date: date, ticker_obj: yf.Ticker) -> dict | None:
    """
    Analyse a ticker's Stage 2 status as of a specific historical date.
    Slices history to target_date — no look-ahead.
    """
    from stage2_engine import get_fundamentals

    # Slice to dates <= target_date
    hist = full_hist[full_hist.index.date <= target_date]
    if hist.empty or len(hist) < EMA_PERIOD + 10:
        return None

    close  = hist["Close"].squeeze()
    volume = hist["Volume"].squeeze()

    # Liquidity filter
    adtv_20 = float((close * volume).rolling(20).mean().iloc[-1])
    if adtv_20 < MIN_ADTV:
        return None

    # 150 EMA
    ema150     = close.ewm(span=EMA_PERIOD, adjust=False).mean()
    last_close = float(close.iloc[-1])
    last_ema150= float(ema150.iloc[-1])

    if last_close <= last_ema150:
        return None

    # Days in Stage 2
    above = (close > ema150).values
    days_in_s2 = 0
    for flag in reversed(above):
        if flag: days_in_s2 += 1
        else:    break

    ema_dist = round((last_close - last_ema150) / last_ema150 * 100, 2)

    # Volume
    vol_sma20 = float(volume.rolling(VOL_SMA).mean().iloc[-2])
    last_vol  = float(volume.iloc[-1])
    vol_mult  = round(last_vol / vol_sma20, 2) if vol_sma20 > 0 else 0

    # RS trend
    rs_trend = "Flat"
    try:
        if bench_hist is not None and not bench_hist.empty:
            bench_slice = bench_hist[bench_hist.index.date <= target_date]
            bench_close = bench_slice["Close"].squeeze().reindex(close.index, method="ffill")
            if len(bench_close.dropna()) >= RS_PERIOD:
                rs_line   = close / bench_close
                rs_slope  = float(np.polyfit(range(RS_PERIOD), rs_line.dropna().iloc[-RS_PERIOD:].values, 1)[0])
                rs_median = float(rs_line.dropna().iloc[-RS_PERIOD:].median())
                thresh    = abs(rs_median) * 0.0005
                if   rs_slope > thresh:  rs_trend = "Positive"
                elif rs_slope < -thresh: rs_trend = "Negative"
    except Exception:
        pass

    fund = get_fundamentals(ticker_obj)

    return {
        "days_in_stage2":      days_in_s2,
        "ema150_distance_pct": ema_dist,
        "volume_multiplier":   vol_mult,
        "rs_trend":            rs_trend,
        "ttm_eps_growth":      fund["ttm_eps_growth"],
        "roce":                fund["roce"],
    }


def trading_days_in_range(start: date, end: date) -> list[date]:
    """Returns weekdays (Mon-Fri) between start and end inclusive."""
    result = []
    d = start
    while d <= end:
        if d.weekday() < 5:  # Mon-Fri
            result.append(d)
        d += timedelta(days=1)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=7)
    parser.add_argument("--from", dest="from_date", type=str)
    parser.add_argument("--to",   dest="to_date",   type=str)
    args = parser.parse_args()

    today = date.today()
    if args.from_date:
        from_date = date.fromisoformat(args.from_date)
        to_date   = date.fromisoformat(args.to_date) if args.to_date else today
    else:
        from_date = today - timedelta(days=args.days)
        to_date   = today

    target_dates = trading_days_in_range(from_date, to_date)
    print(f"=== Stage 2 Backfill — {from_date} to {to_date} ({len(target_dates)} trading days) ===")

    tickers    = get_nifty500_tickers()
    pead_set   = get_pead_high_scorers()

    # Fetch benchmark once
    bench_hist = None
    try:
        bench_hist = yf.Ticker(BENCHMARK).history(period="400d", interval="1d", auto_adjust=True)
        time.sleep(1)
        print(f"[benchmark] fetched {len(bench_hist)} rows")
    except Exception as e:
        print(f"[benchmark] failed: {e}")

    total_inserted = 0

    for i, ticker in enumerate(tickers, 1):
        ns = ticker if ticker.endswith(".NS") else ticker + ".NS"
        print(f"[{i}/{len(tickers)}] {ns}", end="  ")

        try:
            t         = yf.Ticker(ns)
            full_hist = t.history(period="400d", interval="1d", auto_adjust=True)
            time.sleep(1)
        except Exception as e:
            print(f"download failed: {e}")
            continue

        if full_hist.empty:
            print("no data")
            continue

        # Get company info once per ticker
        try:
            info         = t.info
            company_name = info.get("longName") or info.get("shortName")
            sector       = info.get("sector")
        except Exception:
            company_name = sector = None

        per_ticker_inserted = 0
        for target_date in target_dates:
            metrics = analyse_at_date(full_hist, bench_hist, target_date, t)
            if metrics is None:
                continue

            score = compute_stage2_score(
                days_in_s2  = metrics["days_in_stage2"],
                ema_dist    = metrics["ema150_distance_pct"],
                vol_mult    = metrics["volume_multiplier"],
                rs_trend    = metrics["rs_trend"],
                eps_growth  = metrics["ttm_eps_growth"],
                roce        = metrics["roce"],
            )

            if score < 55:
                continue  # Only store ≥55

            tier    = tier_from_score(score)
            is_pead = ticker in pead_set or ns in pead_set
            is_smd  = (
                metrics["ttm_eps_growth"] is not None and metrics["ttm_eps_growth"] < 0 and
                metrics["volume_multiplier"] >= 3.0 and score >= 55
            )

            sig_id = upsert_signal(
                ticker, metrics, score, tier, company_name, sector,
                is_pead, is_smd,
                signal_date_override=target_date.isoformat()
            )
            if sig_id:
                per_ticker_inserted += 1
                total_inserted += 1

        if per_ticker_inserted:
            print(f"✓ {per_ticker_inserted} dates inserted")
        else:
            print("no qualifying dates")

    print(f"\n=== Backfill done — {total_inserted} records across {len(target_dates)} days ===")


if __name__ == "__main__":
    main()

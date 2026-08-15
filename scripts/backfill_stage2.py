"""
Stage 2 Backfill v3.0 — seeds historical Stage 2 signals.

Downloads full OHLCV history once per ticker, then for each date calculates
exact metrics using only data visible up to that date (no look-ahead).

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

import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from stage2_engine import (
    get_universe_tickers,
    compute_stage2_score, tier_from_score,
    upsert_signal, get_pead_high_scorers, get_fundamentals,
    get_stage2_subtype, lifecycle_from_context,
    BENCHMARK, MIN_ADTV, RS_PERIOD, EMA_PERIOD, VOL_SMA,
)

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
sb: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


def analyse_at_date(full_hist: pd.DataFrame, bench_hist: pd.DataFrame,
                    target_date: date, ticker_obj: yf.Ticker) -> dict | None:
    """Analyse a ticker as of a specific historical date (no look-ahead)."""
    hist = full_hist[full_hist.index.date <= target_date].copy()
    if hist.empty or len(hist) < 210:
        return None

    hist = hist.dropna(subset=["Close"])
    if len(hist) < 200:
        return None

    close  = hist["Close"].squeeze()
    volume = hist["Volume"].fillna(0).squeeze()
    high   = hist["High"].squeeze()
    low    = hist["Low"].squeeze()

    adtv_20 = float((close * volume).rolling(20).mean().iloc[-1])
    if adtv_20 < MIN_ADTV or pd.isna(adtv_20):
        return None

    last_close = float(close.iloc[-1])
    if pd.isna(last_close) or last_close <= 0:
        return None

    ema150 = close.ewm(span=EMA_PERIOD, adjust=False).mean()
    sma200 = close.rolling(200).mean()
    sma50  = close.rolling(50).mean()
    sma20  = close.rolling(20).mean()

    last_ema150 = float(ema150.iloc[-1])
    last_sma200 = float(sma200.iloc[-1]) if not pd.isna(sma200.iloc[-1]) else 0.0
    last_sma50  = float(sma50.iloc[-1])  if not pd.isna(sma50.iloc[-1])  else 0.0
    last_sma20  = float(sma20.iloc[-1])  if not pd.isna(sma20.iloc[-1])  else last_close

    if pd.isna(last_ema150) or last_close <= last_ema150:
        return None

    above_50sma         = bool(last_close > last_sma50)  if last_sma50 > 0 else False
    sma50_above_ema150  = bool(last_sma50 > last_ema150) if last_sma50 > 0 else False
    ema150_above_sma200 = bool(last_ema150 > last_sma200) if last_sma200 > 0 else False
    above_200sma        = bool(last_close > last_sma200)  if last_sma200 > 0 else False

    sma200_slope = 0.0
    sma200_clean = sma200.dropna()
    if len(sma200_clean) >= 21:
        s_now = float(sma200_clean.iloc[-1])
        s_20d = float(sma200_clean.iloc[-21])
        sma200_slope = round((s_now - s_20d) / abs(s_20d) * 100, 4) if s_20d != 0 else 0.0

    if not (above_50sma and sma50_above_ema150 and ema150_above_sma200 and sma200_slope > 0):
        return None

    ema150_slope = round(
        (float(ema150.iloc[-1]) - float(ema150.iloc[-21])) / float(ema150.iloc[-21]) * 100
        if len(ema150) >= 21 else 0, 4
    )
    ema_dist      = round((last_close - last_ema150) / last_ema150 * 100, 2)
    base_20d_dist = round((last_close - last_sma20) / last_sma20 * 100, 2)
    subtype       = get_stage2_subtype(last_sma50, last_sma200)

    above_ema150_flags = (close > ema150).values
    days_in_s2 = 0
    for flag in reversed(above_ema150_flags):
        if flag: days_in_s2 += 1
        else: break

    hl_depth_20d  = round((float(high.tail(20).max()) - float(low.tail(20).min())) / last_close * 100, 2)
    vol_5d_avg    = float(volume.tail(5).mean())
    vol_50d_avg   = float(volume.rolling(50).mean().iloc[-1])
    vol_5d_vs_50d = round(vol_5d_avg / vol_50d_avg, 3) if vol_50d_avg > 0 else 1.0
    high_10d      = float(high.tail(10).max())
    pivot_pct     = round((last_close - high_10d) / high_10d * 100, 2)

    rs_63d_score, rs_trend = 0.0, "Flat"
    try:
        if bench_hist is not None and not bench_hist.empty:
            bench_slice = bench_hist[bench_hist.index.date <= target_date]
            bc = bench_slice["Close"].squeeze().reindex(close.index, method="ffill")
            if len(bc.dropna()) >= RS_PERIOD:
                rs_line = close / bc
                rs_vals = rs_line.dropna().iloc[-RS_PERIOD:].values
                if len(rs_vals) >= RS_PERIOD:
                    rs_start = float(rs_vals[0])
                    rs_end   = float(rs_vals[-1])
                    rs_63d_score = round((rs_end - rs_start) / abs(rs_start) * 100, 2) if rs_start != 0 else 0
                    rs_trend = "Positive" if rs_63d_score > 5 else "Negative" if rs_63d_score < -5 else "Flat"
    except Exception:
        pass

    vol_sma20 = float(volume.rolling(VOL_SMA).mean().iloc[-2]) if len(volume) > VOL_SMA else 1.0
    vol_mult  = round(float(volume.iloc[-1]) / vol_sma20, 2) if vol_sma20 > 0 else 0.0

    price_52w_ago = float(close.iloc[-253]) if len(close) >= 253 else float(close.iloc[0])
    rs_52w_raw = round((last_close - price_52w_ago) / price_52w_ago * 100, 2) if price_52w_ago > 0 else 0.0

    fund = get_fundamentals(ticker_obj)

    return {
        "above_50sma":              above_50sma,
        "sma50_above_ema150":       sma50_above_ema150,
        "ema150_above_sma200":      ema150_above_sma200,
        "above_200sma":             above_200sma,
        "sma200_slope":             sma200_slope,
        "stage2_subtype":           subtype,
        "days_in_stage2":           days_in_s2,
        "ema150_distance_pct":      ema_dist,
        "ema150_slope":             ema150_slope,
        "base_20d_distance_pct":    base_20d_dist,
        "hl_depth_20d":             hl_depth_20d,
        "vol_5d_vs_50d_ratio":      vol_5d_vs_50d,
        "pivot_proximity_pct":      pivot_pct,
        "rs_trend":                 rs_trend,
        "rs_63d_score":             rs_63d_score,
        "rs_52w_raw":               rs_52w_raw,
        "vcp_volume_ratio":         None,
        "vcp_adr_ratio":            None,
        "vcp_score":                0,
        "volume_multiplier":        vol_mult,
        "close":                    last_close,
        **fund,
    }


def trading_days_in_range(start: date, end: date) -> list[date]:
    result, d = [], start
    while d <= end:
        if d.weekday() < 5:
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
    print(f"=== Stage 2 Backfill v3.0 — {from_date} to {to_date} ({len(target_dates)} days) ===")

    tickers  = get_universe_tickers()
    pead_set = get_pead_high_scorers()

    bench_hist = None
    try:
        bench_hist = yf.Ticker(BENCHMARK).history(period="400d", interval="1d", auto_adjust=True)
        time.sleep(1)
    except Exception as e:
        print(f"[benchmark] {e}")

    # Collect all qualifying metrics across dates for percentile ranking
    # (simplified: compute percentile per target date using that date's snapshot)
    total_inserted = 0

    for i, ticker in enumerate(tickers, 1):
        ns = ticker if ticker.endswith(".NS") else ticker + ".NS"
        print(f"[{i}/{len(tickers)}] {ns}", end="  ")
        try:
            t         = yf.Ticker(ns)
            full_hist = t.history(period="400d", interval="1d", auto_adjust=True)
            time.sleep(0.8)
        except Exception as e:
            print(f"dl_fail: {e}")
            continue
        if full_hist.empty:
            print("no data")
            continue

        try:
            info         = t.info
            company_name = info.get("longName") or info.get("shortName")
            sector       = info.get("sector")
        except Exception:
            company_name = sector = None

        per_ticker = 0
        for target_date in target_dates:
            metrics = analyse_at_date(full_hist, bench_hist, target_date, t)
            if metrics is None:
                continue

            # rs_52w_percentile: not available in backfill context (no universe-wide rank)
            # Set to None; the daily engine will update it properly on the next run
            metrics["rs_52w_percentile"] = None
            # Backfill uses daily-based metrics; map to Weinstein stage for DB compat
            metrics.setdefault("weinstein_stage", "LATE_STAGE_2")
            score, components = compute_stage2_score(metrics)
            if score < 70:
                continue  # Only store EMERGING and CONFIRMED

            tier    = tier_from_score(score)
            is_pead = ticker in pead_set or ns in pead_set

            lifecycle = lifecycle_from_context(
                score, None, 0,
                above_50sma=metrics.get("above_50sma", True),
                above_150ema=True,
            )

            sig_id = upsert_signal(
                ticker, metrics, score, tier, lifecycle,
                company_name, sector, is_pead,
                None, "NEUTRAL",
                target_date.isoformat(), False, None,
                None,
                signal_date_override=target_date.isoformat(),
            )
            if sig_id:
                per_ticker += 1
                total_inserted += 1

        if per_ticker:
            print(f"✓ {per_ticker} dates")
        else:
            print("no qualifying dates")

    print(f"\n=== Backfill done — {total_inserted} records ===")


if __name__ == "__main__":
    main()

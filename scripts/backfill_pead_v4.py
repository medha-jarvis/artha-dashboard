"""
PEAD Backfill v4 — re-scores ALL existing pead_signals with the v4 MECE rubric.

What it does per record:
  - Fetches Bhavcopy delivery % for the signal's historical date
  - Re-fetches QoQ PAT from yfinance (current quarter pair may have shifted)
  - Re-scores using compute_score_v4
  - Renames any remaining trigger_path 'A' → 'ACT'
  - Updates: pead_score, trigger_path, delivery_pct, qoq_profit_pct, is_hidden_catalyst

Existing yoy/opm/vol/gap/ema values are kept as-is (already stored correctly).

Run once: python3 scripts/backfill_pead_v4.py
"""

import os, time, sys
sys.path.insert(0, os.path.dirname(__file__))

from pead_engine import (
    get_nse_session, get_delivery_pct, get_quarterly_fundamentals,
    compute_score_v4, compute_hidden_catalyst, path_from_score, _clean,
    SUPABASE_URL, SUPABASE_KEY,
)
from supabase import create_client

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


def backfill() -> None:
    print("=== PEAD Backfill v4 ===")

    res = supabase.table("pead_signals").select(
        "id,ticker,signal_date,"
        "yoy_profit_pct,yoy_revenue_pct,opm_expansion_bps,"
        "price_vs_ema200_pct,volume_multiplier,day_gap_pct,ttm_pe,trigger_path"
    ).order("signal_date", desc=True).execute()

    signals = res.data or []
    print(f"[backfill] {len(signals)} signals to re-score\n")

    session = get_nse_session()
    ok = fail = 0

    for i, sig in enumerate(signals, 1):
        ticker   = sig["ticker"]
        sig_id   = sig["id"]
        sig_date = sig["signal_date"]
        print(f"[{i}/{len(signals)}] {ticker} ({sig_date})", end="  ")

        # Bhavcopy delivery (best-effort — old dates may 404)
        delivery_pct = get_delivery_pct(session, ticker, sig_date)

        # Fresh QoQ from yfinance (most recent quarter pair)
        fund = get_quarterly_fundamentals(ticker)
        time.sleep(0.5)

        # Pull stored values; supplement ttm_pe from fresh fund if missing
        yoy_profit   = _clean(sig.get("yoy_profit_pct"))
        yoy_revenue  = _clean(sig.get("yoy_revenue_pct"))
        opm_bps      = _clean(sig.get("opm_expansion_bps"))
        price_vs_ema = _clean(sig.get("price_vs_ema200_pct"))
        vol_mult     = _clean(sig.get("volume_multiplier"))
        intraday_gap = _clean(sig.get("day_gap_pct"))
        ttm_pe       = _clean(sig.get("ttm_pe")) or _clean(fund.get("ttm_pe"))
        qoq_profit   = _clean(fund.get("qoq_profit"))

        score  = compute_score_v4(
            yoy_profit=yoy_profit, yoy_revenue=yoy_revenue, opm_bps=opm_bps,
            qoq_profit=qoq_profit, delivery_pct=delivery_pct,
            vol_mult=vol_mult, intraday_gap=intraday_gap,
            price_vs_ema200=price_vs_ema, ttm_pe=ttm_pe,
        )
        path       = path_from_score(score)
        hidden     = compute_hidden_catalyst(
            yoy_profit, yoy_revenue, vol_mult, delivery_pct, intraday_gap
        )
        market_cap = _clean(fund.get("market_cap"))

        try:
            supabase.table("pead_signals").update({
                "pead_score":         score,
                "trigger_path":       path,
                "qoq_profit_pct":     qoq_profit,
                "delivery_pct":       delivery_pct,
                "is_hidden_catalyst": hidden,
                "market_cap":         market_cap,
            }).eq("id", sig_id).execute()
            print(f"score={score} path={path} del={delivery_pct}% → ✓")
            ok += 1
        except Exception as e:
            print(f"update failed: {e}")
            fail += 1

        time.sleep(0.3)

    print(f"\n[backfill] done — {ok} updated, {fail} failed")


if __name__ == "__main__":
    backfill()

"""
engine.py — Weekly Techno-Funda Sector Matrix (100-pt)

Switched to WEEKLY candles — more stable for long-term investors.
Weekly periods: 10W / 30W / 40W SMA  (≈ daily 50/150/200)

Scoring (unchanged structure, weekly-adjusted periods):
  Trend Alignment        30 pts  (10W/30W/40W SMA stack + slope + 52W proximity)
  RS vs Nifty 50         30 pts  (Mansfield 52W RS + 13W & 26W outperformance)
  Volatility Contraction 25 pts  (4W ATR / 12W ATR ratio + 2-week range tightness)
  Sector Breadth         15 pts  (% stocks above their own 10W SMA)

Stage labels:
  ≥ 80  → "Stage 2A Early Inflection"
  65–79 → "Stage 2B Sustained Trend"
  50–64 → "Stage 1 Consolidation"
  < 50  → "Avoid / Weak"

Stage confirmation (2-week rule):
  A stage change is only committed once the new stage holds for 2 consecutive
  scoring periods.  The `sector_stage_tracker` table persists state across runs.
  This prevents single-day noise from triggering false stage transitions.
"""

import os, datetime
import numpy as np
import pandas as pd
import yfinance as yf
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

SB_URL = os.environ["SUPABASE_URL"]
SB_KEY = os.environ["SUPABASE_SERVICE_KEY"]
supabase: Client = create_client(SB_URL, SB_KEY)

BENCHMARK   = "^NSEI"
FRESH_DAYS  = 14   # "new entry" badge if stage changed within this many days


# ── Moving averages ──────────────────────────────────────────────────────────

def _sma(s: pd.Series, n: int) -> pd.Series:
    return s.rolling(n, min_periods=n).mean()

def _atr(df: pd.DataFrame, n: int) -> pd.Series:
    h, l, c = df["high"], df["low"], df["close"]
    tr = pd.concat([(h - l), (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
    return tr.rolling(n, min_periods=1).mean()

def _mansfield_rs(price: pd.Series, bench: pd.Series, weeks: int = 52) -> float:
    n = min(weeks, len(price), len(bench))
    if n < 13:
        return 0.0
    p_now, p_ago = price.iloc[-1], price.iloc[-n]
    b_now, b_ago = bench.iloc[-1], bench.iloc[-n]
    if p_ago == 0 or b_ago == 0:
        return 0.0
    return ((p_now / p_ago) / (b_now / b_ago) - 1) * 100


# ── Data download ────────────────────────────────────────────────────────────

def _fetch_weekly(symbols: list[str]) -> dict[str, pd.DataFrame]:
    """Download 2 years of weekly OHLCV. Returns {symbol: df}."""
    if not symbols:
        return {}
    raw = yf.download(
        symbols, period="2y", interval="1wk",
        group_by="ticker", auto_adjust=True,
        progress=False, threads=True,
    )
    result = {}
    if len(symbols) == 1:
        sym = symbols[0]
        df  = raw.copy()
        df.columns = [c.lower() for c in df.columns]
        df.dropna(subset=["close"], inplace=True)
        if len(df) >= 20:
            result[sym] = df
    else:
        for sym in symbols:
            try:
                df = raw[sym].copy()
                df.columns = [c.lower() for c in df.columns]
                df.dropna(subset=["close"], inplace=True)
                if len(df) >= 20:
                    result[sym] = df
            except Exception:
                pass
    return result


# ── Per-sector scorer ────────────────────────────────────────────────────────

def _score_sector(
    sector_df: pd.DataFrame,
    bench_close: pd.Series,
    constituent_dfs: list[tuple[str, pd.DataFrame]],
) -> dict:
    close = sector_df["close"]
    pts   = 0

    # ── 1. TREND ALIGNMENT (30 pts) ──────────────────────────────────────────
    sma10 = _sma(close, 10).iloc[-1]
    sma30 = _sma(close, 30).iloc[-1]
    sma40 = _sma(close, 40).iloc[-1]
    price = close.iloc[-1]

    trend_pts = 0
    if not any(np.isnan(v) for v in [sma10, sma30, sma40]):
        met = sum([price > sma10, sma10 > sma30, sma30 > sma40, price > sma40])
        trend_pts = [0, 4, 8, 12, 15][met]
    pts += trend_pts

    # 40W SMA slope over last 8 weeks
    sma40_s = _sma(close, 40)
    slope_pts = 0
    if len(sma40_s.dropna()) >= 8:
        if sma40_s.iloc[-1] > sma40_s.iloc[-8]:
            slope_pts = 10
    pts += slope_pts

    # Within 15% of 52-week (52W) high — slightly more generous on weekly
    high_52w = close.tail(52).max()
    dist_pct = (price - high_52w) / high_52w * 100
    prox_pts = 5 if dist_pct >= -15 else 0
    pts += prox_pts

    # ── 2. RELATIVE STRENGTH vs Nifty 50 (30 pts) ───────────────────────────
    combined = pd.concat(
        [close.rename("sector"), bench_close.rename("bench")], axis=1
    ).dropna()
    rs_val = outperf_13w = outperf_26w = 0.0
    rs_pts = op_pts = 0

    if len(combined) >= 26:
        s, b = combined["sector"], combined["bench"]
        rs_val = _mansfield_rs(s, b, weeks=52)
        if rs_val > 0:
            rs_pts = 15
        pts += rs_pts

        outperf_13w = (s.iloc[-1]/s.iloc[-13] - 1)*100 - (b.iloc[-1]/b.iloc[-13] - 1)*100 if len(combined) >= 13 else 0
        outperf_26w = (s.iloc[-1]/s.iloc[-26] - 1)*100 - (b.iloc[-1]/b.iloc[-26] - 1)*100

        score_op = sum([outperf_13w > 0, outperf_13w > 3, outperf_26w > 0, outperf_26w > 5])
        op_pts   = [0, 4, 8, 12, 15][min(score_op, 4)]
        pts += op_pts

    # ── 3. VOLATILITY CONTRACTION / VCP (25 pts) — weekly ───────────────────
    vcp_pts = tight_pts = 0
    atr_ratio = None

    if "high" in sector_df.columns and "low" in sector_df.columns and len(sector_df) >= 12:
        atr4  = _atr(sector_df, 4).iloc[-1]
        atr12 = _atr(sector_df, 12).iloc[-1]
        if atr12 > 0:
            atr_ratio = atr4 / atr12
            if atr_ratio < 0.70:   vcp_pts = 15
            elif atr_ratio < 0.85: vcp_pts = 8
        pts += vcp_pts

        # Last 2 weekly bars with range < 4% of price each
        last2 = sector_df.tail(2)
        weekly_ranges = (last2["high"] - last2["low"]) / last2["close"] * 100
        if (weekly_ranges < 4).all():
            tight_pts = 10
        elif (weekly_ranges < 6).all():
            tight_pts = 5
        pts += tight_pts

    # ── 4. SECTOR BREADTH (15 pts) ───────────────────────────────────────────
    breadth_pts = 0
    breadth_pct = 0.0
    above_10sma_tickers: list[str] = []

    if constituent_dfs:
        above = 0
        for sym, cdf in constituent_dfs:
            if len(cdf) >= 10:
                s10 = _sma(cdf["close"], 10).iloc[-1]
                cur = cdf["close"].iloc[-1]
                if not np.isnan(s10) and cur > s10:
                    above += 1
                    above_10sma_tickers.append(sym.replace(".NS", "").replace(".BO", ""))
        breadth_pct = (above / len(constituent_dfs)) * 100
        if breadth_pct > 70:   breadth_pts = 15
        elif breadth_pct > 55: breadth_pts = 8
        elif breadth_pct > 40: breadth_pts = 4
    pts += breadth_pts

    pts = min(int(pts), 100)

    if pts >= 80:   stage = "Stage 2A Early Inflection"
    elif pts >= 65: stage = "Stage 2B Sustained Trend"
    elif pts >= 50: stage = "Stage 1 Consolidation"
    else:           stage = "Avoid / Weak"

    return dict(
        score=pts, stage=stage,
        distance_52w_high=round(dist_pct, 2),
        rs_score=round(rs_val, 2),
        atr_ratio=round(atr_ratio, 3) if atr_ratio else None,
        breadth_pct=round(breadth_pct, 1),
        top_constituents=above_10sma_tickers[:3],
        _trend=trend_pts + slope_pts + prox_pts,
        _rs=rs_pts + op_pts,
        _vcp=vcp_pts + tight_pts,
        _breadth=breadth_pts,
    )


# ── Stage confirmation logic ─────────────────────────────────────────────────

def _load_tracker() -> dict[str, dict]:
    """Load sector_stage_tracker → {sector_id: row}."""
    rows = supabase.table("sector_stage_tracker").select("*").execute()
    return {r["sector_id"]: r for r in (rows.data or [])}


def _backfill_entry_date(
    sector_df: pd.DataFrame,
    bench_close: pd.Series,
    constituent_dfs: list[tuple[str, pd.DataFrame]],
    current_stage: str,
    max_weeks: int = 78,   # ~18 months — enough to catch any reasonable stage
) -> datetime.date:
    """
    Walk backward week-by-week through already-downloaded data to find
    the actual date this sector entered its current stage.
    Scores each historical week using the full rubric.
    """
    n        = len(sector_df)
    min_data = 42          # need 40W SMA + a little buffer
    today    = datetime.date.today()

    entry_date = None

    for weeks_ago in range(1, min(max_weeks, n - min_data) + 1):
        i = n - weeks_ago         # index of the "as of" week
        if i < min_data:
            break

        past_sector = sector_df.iloc[:i + 1]
        past_bench  = bench_close.iloc[:i + 1] if len(bench_close) > i else bench_close
        past_consts = [
            (sym, df.iloc[:i + 1])
            for sym, df in constituent_dfs
            if len(df) > i + 1
        ]
        if not past_consts:
            continue

        scored = _score_sector(past_sector, past_bench, past_consts)

        if scored["stage"] == current_stage:
            # This past week also had the same stage — the entry is at least this far back
            idx = past_sector.index[-1]
            entry_date = idx.date() if hasattr(idx, "date") else today
        else:
            # Stage was different here — the run of current_stage started AFTER this week
            break

    # If we went back max_weeks and stage was always the same,
    # use the oldest available week as a floor
    if entry_date is None:
        entry_date = today

    return entry_date


def _confirm_stage(
    sector_id: str,
    raw_stage: str,
    today: datetime.date,
    tracker: dict,
    # passed only on first-run backfill:
    sector_df: pd.DataFrame | None = None,
    bench_close: pd.Series | None = None,
    constituent_dfs: list | None = None,
) -> dict:
    """
    Apply 2-week confirmation rule.
    On first encounter, backfills the real entry date from historical data.
    Returns dict with confirmed_stage, stage_entry_date, prev_stage, is_fresh_entry.
    Updates tracker in-place.
    """
    rec = tracker.get(sector_id)

    if rec is None:
        # First time — backfill the real entry date from weekly history
        if sector_df is not None and bench_close is not None and constituent_dfs is not None:
            print(f"    [backfill] finding entry date for {sector_id[:8]}...", end=" ", flush=True)
            real_entry = _backfill_entry_date(sector_df, bench_close, constituent_dfs, raw_stage)
            print(f"{real_entry}")
        else:
            real_entry = today

        new_rec = dict(
            sector_id=sector_id,
            confirmed_stage=raw_stage,
            stage_entry_date=real_entry.isoformat(),
            pending_stage=None,
            pending_since=None,
        )
        supabase.table("sector_stage_tracker").upsert(new_rec, on_conflict="sector_id").execute()
        tracker[sector_id] = new_rec
        days_in = (today - real_entry).days
        return dict(
            confirmed_stage=raw_stage,
            stage_entry_date=real_entry,
            prev_stage=None,
            is_fresh_entry=days_in <= FRESH_DAYS,
        )

    confirmed = rec["confirmed_stage"]
    entry_date = datetime.date.fromisoformat(rec["stage_entry_date"]) if rec["stage_entry_date"] else today
    pending    = rec.get("pending_stage")
    pend_since = datetime.date.fromisoformat(rec["pending_since"]) if rec.get("pending_since") else None

    if raw_stage == confirmed:
        # Same as confirmed — clear any pending
        if pending:
            supabase.table("sector_stage_tracker").update(
                {"pending_stage": None, "pending_since": None}
            ).eq("sector_id", sector_id).execute()
            rec["pending_stage"] = None
            rec["pending_since"] = None
        return dict(
            confirmed_stage=confirmed,
            stage_entry_date=entry_date,
            prev_stage=None,
            is_fresh_entry=(today - entry_date).days <= FRESH_DAYS,
        )

    # Raw stage differs from confirmed
    if pending == raw_stage and pend_since:
        # Been pending for ≥1 run → confirm it now
        prev_stage   = confirmed
        new_entry    = pend_since   # stage really started on pending_since
        new_rec = dict(
            confirmed_stage=raw_stage,
            stage_entry_date=new_entry.isoformat(),
            pending_stage=None,
            pending_since=None,
        )
        supabase.table("sector_stage_tracker").update(new_rec).eq("sector_id", sector_id).execute()
        rec.update(new_rec)
        return dict(
            confirmed_stage=raw_stage,
            stage_entry_date=new_entry,
            prev_stage=prev_stage,
            is_fresh_entry=(today - new_entry).days <= FRESH_DAYS,
        )
    else:
        # First time seeing this new raw stage — put in pending
        supabase.table("sector_stage_tracker").update(
            {"pending_stage": raw_stage, "pending_since": today.isoformat()}
        ).eq("sector_id", sector_id).execute()
        rec["pending_stage"]  = raw_stage
        rec["pending_since"]  = today.isoformat()
        # Keep showing old confirmed stage for now
        return dict(
            confirmed_stage=confirmed,
            stage_entry_date=entry_date,
            prev_stage=None,
            is_fresh_entry=(today - entry_date).days <= FRESH_DAYS,
        )


# ── Main ─────────────────────────────────────────────────────────────────────

def run_engine() -> list[dict]:
    today = datetime.date.today()

    sectors_res = supabase.table("sector_definitions").select("id,name,slug").eq("is_active", True).execute()
    sectors = sectors_res.data
    if not sectors:
        print("[engine] No active sectors.")
        return []

    all_symbols = [BENCHMARK]
    sector_symbol_map: dict[str, list[str]] = {}
    for s in sectors:
        res  = supabase.table("sector_constituents").select("symbol").eq("sector_id", s["id"]).execute()
        syms = [r["symbol"] for r in res.data]
        sector_symbol_map[s["id"]] = syms
        all_symbols.extend(syms)

    all_symbols = list(set(all_symbols))
    print(f"[engine] Downloading {len(all_symbols)} tickers (weekly candles)...")
    ticker_data = _fetch_weekly(all_symbols)

    bench_df    = ticker_data.get(BENCHMARK)
    bench_close = bench_df["close"] if bench_df is not None else pd.Series(dtype=float)

    tracker = _load_tracker()
    results = []

    for s in sectors:
        symbols = sector_symbol_map[s["id"]]
        avail   = [sym for sym in symbols if sym in ticker_data]

        if not avail:
            print(f"  SKIP {s['name']} — no data")
            continue

        # Equal-weighted sector index via weekly return averaging
        close_frames  = [ticker_data[sym]["close"].rename(sym) for sym in avail]
        combined_c    = pd.concat(close_frames, axis=1).ffill()
        ew_returns    = combined_c.pct_change().mean(axis=1)
        sector_close  = (1 + ew_returns).cumprod() * 100
        sector_close.iloc[0] = 100.0

        high_frames = [ticker_data[sym]["high"].rename(sym) for sym in avail if "high" in ticker_data[sym].columns]
        low_frames  = [ticker_data[sym]["low"].rename(sym)  for sym in avail if "low"  in ticker_data[sym].columns]
        sector_df   = pd.DataFrame({"close": sector_close})
        if high_frames and low_frames:
            sector_df["high"] = pd.concat(high_frames, axis=1).ffill().mean(axis=1)
            sector_df["low"]  = pd.concat(low_frames,  axis=1).ffill().mean(axis=1)

        constituent_dfs = [(sym, ticker_data[sym]) for sym in avail]
        scored = _score_sector(sector_df, bench_close, constituent_dfs)

        # Stage confirmation — pass sector data so first-run can backfill entry date
        stage_info = _confirm_stage(
            s["id"], scored["stage"], today, tracker,
            sector_df=sector_df, bench_close=bench_close, constituent_dfs=constituent_dfs,
        )

        entry_date = stage_info["stage_entry_date"]
        days_in    = (today - entry_date).days if entry_date else 0

        print(
            f"  {s['name']}: {scored['score']}pt | raw={scored['stage'][:10]} "
            f"| confirmed={stage_info['confirmed_stage'][:10]} "
            f"| {days_in}d {'🆕' if stage_info['is_fresh_entry'] else ''}"
            f"  [T:{scored['_trend']} RS:{scored['_rs']} VCP:{scored['_vcp']} B:{scored['_breadth']}]"
        )

        top_json = [{"symbol": t + ".NS", "score": 0, "stage": ""} for t in scored["top_constituents"]]

        row = dict(
            date=today.isoformat(),
            sector_id=s["id"],
            score=scored["score"],
            stage=scored["stage"],
            confirmed_stage=stage_info["confirmed_stage"],
            stage_entry_date=entry_date.isoformat() if entry_date else today.isoformat(),
            days_in_current_stage=days_in,
            prev_stage=stage_info.get("prev_stage"),
            is_fresh_entry=stage_info["is_fresh_entry"],
            distance_52w_high=scored["distance_52w_high"],
            rs_score=scored["rs_score"],
            atr_ratio=scored["atr_ratio"],
            breadth_pct=scored["breadth_pct"],
            top_constituents=top_json,
        )
        results.append({"meta": s, "row": row, "stage_info": stage_info})

    if results:
        supabase.table("daily_sector_scores").upsert(
            [r["row"] for r in results], on_conflict="date,sector_id"
        ).execute()
        print(f"[engine] Saved {len(results)} scores for {today} (weekly candles).")

    return results


if __name__ == "__main__":
    run_engine()

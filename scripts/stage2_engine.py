"""
Stage 2 Intelligence Engine v3.0 — Weinstein + Minervini Revised Rubric
=========================================================================
100-point scoring across 5 dimensions:

  1. Trend Alignment      KNOCKOUT  30 pts — Price > 50SMA > 150EMA > 200SMA AND 200SMA slope > 0
  2. Fundamental Engine   ADDITIVE  20 pts — EPS TTM > 0, Accelerating (Q0 YoY > Q1 YoY), ROCE > 15%
  3. Volatility Contract  ADDITIVE  20 pts — 20d H-L depth ≤5% AND 5d-vol < 50% of 50d-vol-avg
  4. Pivot Proximity      ADDITIVE  15 pts — Within -5% to +2% of 10-day High
  5. Relative Strength    ADDITIVE  15 pts — 52W rank ≥85 AND 63d RS ≥+10%

Score thresholds:
  85-100 → CONFIRMED (A+ Super-Performer)
  70-84  → EMERGING  (Watchlist - Building Base)
  60-69  → WATCHING  (Signals forming, not ready)
  <60    → PASS      (Do Not Trade — not stored)

Stage sub-type (50SMA vs 200SMA gap):
  ≤15%   → EARLY STAGE 2  (just crossed; max upside, lowest macro risk)
  15-30% → MID STAGE 2    (established; 2nd/3rd base; still highly actionable)
  >30%   → LATE STAGE 2   (extended; bases prone to failure; tighten stops)

Lifecycle states (revised thresholds vs v2.1):
  CONFIRMED  : score ≥85, all knockout conditions met
  SUSTAINED  : CONFIRMED for 30+ consecutive days (proven multi-week leader)
  EMERGING   : score 70-84 (watchlist, building base)
  WATCHING   : score 60-69 (close to qualifying, not ready yet)
  WEAKENING  : score dropped >12 pts in 5 days OR price crossed below 50 SMA
  EXITED     : failed knockout OR below 150 EMA (Stage 2 over)

Universe: NSE Nifty 500 + Smallcap 250 + Microcap 250 (~700 unique stocks)
ADTV filter: ₹1Cr minimum (covers ≥₹100Cr market cap range)

Medha modification (turnaround tier, Fundamental):
  EPS < 0 but improving (loss narrowed >30% YoY) AND eps_acceleration_quarters ≥ 1
  AND ROCE > 10% → 5 pts instead of 0. Catches pre-profit growth companies on
  the cusp of profitability before institutional recognition.
"""

import os, time, requests
from datetime import date, timedelta, datetime as dt
import pandas as pd
import numpy as np
import yfinance as yf
from supabase import create_client, Client

# ── Credentials ────────────────────────────────────────────────────────────────
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
TG_TOKEN     = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TG_CHAT_ID   = os.environ.get("TELEGRAM_CHAT_ID", "")

sb: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
TODAY = date.today().isoformat()

# ── Constants ──────────────────────────────────────────────────────────────────
BENCHMARK  = "^CRSLDX"
MIN_ADTV   = 10_000_000   # ₹1 Cr (lowered from ₹5 Cr for smallcap coverage)
RS_PERIOD  = 63
EMA_PERIOD = 150           # kept for backfill compatibility
VOL_SMA    = 20            # kept for backfill compatibility

NSE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept":     "application/json, */*",
    "Referer":    "https://www.nseindia.com/",
}


# ── Universe ───────────────────────────────────────────────────────────────────
def _nse_index_tickers(index_name: str, session: requests.Session) -> list[str]:
    try:
        r = session.get(
            f"https://www.nseindia.com/api/equity-stockIndices?index={requests.utils.quote(index_name)}",
            timeout=20,
        )
        return [
            item["symbol"] for item in r.json().get("data", [])
            if item.get("symbol") and not item["symbol"].startswith("$")
            and item["symbol"].replace("-", "").replace("&", "").replace("_", "").isalnum()
        ]
    except Exception as e:
        print(f"[universe] {index_name} failed: {e}")
        return []


def _nse_equity_csv() -> list[str]:
    """
    Download NSE's full equity list CSV (~2200 EQ-series stocks).
    URL is publicly accessible without session cookies.
    Filters to EQ and BE series only (excludes ETFs, SME, OFS).
    """
    try:
        import io
        r = requests.get(
            "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv",
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=30,
        )
        df = pd.read_csv(io.StringIO(r.text))
        # Column name may vary — find the SYMBOL and SERIES columns
        sym_col    = next((c for c in df.columns if "SYMBOL" in c.upper()), None)
        series_col = next((c for c in df.columns if "SERIES" in c.upper()), None)
        if sym_col is None:
            return []
        if series_col is not None:
            df = df[df[series_col].isin(["EQ", "BE"])]
        symbols = df[sym_col].dropna().str.strip().tolist()
        # Basic sanity filter
        symbols = [s for s in symbols if s and s.isalnum() or (len(s) < 20 and s.replace("-", "").replace("&", "").isalnum())]
        print(f"[universe] NSE CSV: {len(symbols)} EQ+BE series stocks")
        return symbols
    except Exception as e:
        print(f"[universe] NSE CSV failed: {e}")
        return []


def get_universe_tickers() -> list[str]:
    """
    Universe: tries 3 sources in order:
      1. NSE index API (N500 + SC250 + MC250) — ~700 stocks, needs session
      2. NSE equity CSV — ~2200 EQ stocks (full NSE listed, no session needed)
      3. Hardcoded curated Nifty 500 list — 174 stocks (last resort)
    ADTV filter (₹1 Cr) in analyse() handles the >₹100 Cr market cap screening.
    """
    # Try 1: NSE index API
    try:
        session = requests.Session()
        session.headers.update(NSE_HEADERS)
        session.get("https://www.nseindia.com", timeout=15)
        time.sleep(1)
        n500  = _nse_index_tickers("NIFTY 500", session);   time.sleep(0.5)
        sc250 = _nse_index_tickers("NIFTY SMALLCAP 250", session);  time.sleep(0.5)
        mc250 = _nse_index_tickers("NIFTY MICROCAP 250", session)
        all_t = list(set(n500 + sc250 + mc250))
        if len(all_t) > 200:
            print(f"[universe] N500={len(n500)} SC250={len(sc250)} MC250={len(mc250)} → {len(all_t)} unique")
            return all_t
    except Exception as e:
        print(f"[universe] NSE index API failed: {e}")

    # Try 2: NSE equity CSV (full NSE listing, no session needed)
    csv_tickers = _nse_equity_csv()
    if len(csv_tickers) > 500:
        return csv_tickers

    # Try 3: hardcoded fallback
    print("[universe] falling back to hardcoded list")
    return get_nifty500_tickers()


def get_nifty500_tickers() -> list[str]:
    """Fallback: curated Nifty 500 list."""
    try:
        session = requests.Session()
        session.headers.update(NSE_HEADERS)
        session.get("https://www.nseindia.com", timeout=15)
        r = session.get(
            "https://www.nseindia.com/api/equity-stockIndices?index=NIFTY%20500",
            timeout=20,
        )
        tickers = [
            item["symbol"] for item in r.json().get("data", [])
            if item.get("symbol") and not item["symbol"].startswith("$")
            and item["symbol"].replace("-", "").replace("&", "").replace("_", "").isalnum()
        ]
        if len(tickers) > 100:
            print(f"[universe] NSE API: {len(tickers)} N500 tickers")
            return tickers
    except Exception as e:
        print(f"[universe] N500 fallback API failed: {e}, using hardcoded list")
    return [
        "RELIANCE","TCS","HDFCBANK","INFY","ICICIBANK","HINDUNILVR","SBIN","BAJFINANCE",
        "BHARTIARTL","KOTAKBANK","LT","AXISBANK","ASIANPAINT","MARUTI","TITAN",
        "WIPRO","HCLTECH","ONGC","NTPC","POWERGRID","COALINDIA","NESTLEIND","ULTRACEMCO",
        "ADANIPORTS","BAJAJFINSV","GRASIM","DIVISLAB","DRREDDY","CIPLA","SUNPHARMA",
        "TECHM","EICHERMOT","TATAMOTORS","TATASTEEL","JSWSTEEL","HINDALCO","APOLLOHOSP",
        "BRITANNIA","PIDILITIND","HAVELLS","MUTHOOTFIN","BALKRISIND","CROMPTON",
        "KPIL","KEI","POLYCAB","CUMMINSIND","BHEL","SIEMENS","ABB",
        "IRCTC","IRFC","RVNL","ZOMATO","DMART","BAJAJ-AUTO","MOTHERSON","BOSCHLTD",
        "HEROMOTOCO","TVSMOTOR","M&M","ASHOKLEY","TATACOMM","MPHASIS","LTTS","PERSISTENT",
        "COFORGE","OFSS","KFINTECH","CDSL","MCX","BSE","ANGELONE","IIFL",
        "SHRIRAMFIN","BAJAJHLDNG","ICICIGI","HDFCLIFE","SBILIFE",
        "CHOLAFIN","LICHSGFIN","RECLTD","PFC","IREDA","SJVN","NHPC",
        "TATAPOWER","ADANIGREEN","TORNTPOWER","CESC",
        "DABUR","MARICO","COLPAL","GODREJCP","EMAMILTD","TATACONSUM","VARUNBEV","VBL",
        "AMBUJACEM","DALMIA","SHREECEM","JKCEMENT",
        "DLF","OBEROIRLTY","PRESTIGE","BRIGADE","SOBHA","GODREJPROP",
        "TATACHEM","DEEPAKNTR","GNFC","COROMANDEL","PIIND","RALLIS",
        "KAYNES","DIXON","VOLTAS","BLUESTARCO","AMBER",
        "PAGEIND","TRENT","VEDL","NATIONALUM",
        "IDFCFIRSTB","AUBANK","RBLBANK","BANDHANBNK","FEDERALBNK",
        "CANBK","BANKBARODA","PNB","UNIONBANK",
        "CONCOR","VRL","TCI","BLUEDART",
        "GAIL","MGL","IGL","ATGL","BPCL","HINDPETRO","IOC",
        "GRAPHITE","MOIL","HINDZINC",
        "ABCAPITAL","AARTIIND","VINATI","FINEORG","LINDEINDIA","SRF","ASTRAL","SUPREMEIND",
        "SAFARI","SKFINDIA","GRINDWELL","SCHAEFFLER","TIMKEN",
        "HFCL","STLTECH","TEJASNET","APLAPOLLO","RATNAMANI","WELCORP","JINDALSAW",
        "WOCKPHARMA","TORNTPHARM","IPCALAB","NATCOPHARM","ALKEM",
        "GLENMARK","LAURUSLABS","GRANULES",
    ]


# ── v3.0 Scoring ───────────────────────────────────────────────────────────────
def compute_stage2_score(metrics: dict) -> tuple[int, dict]:
    """
    Returns (total_score, components_dict).
    Knockout: if trend alignment fails, returns (0, all_zeros) immediately.
    Components: {"trend": int, "fundamental": int, "volatility": int, "pivot": int, "rs": int}
    """
    components = {"trend": 0, "fundamental": 0, "volatility": 0, "pivot": 0, "rs": 0}

    # ── 1. TREND ALIGNMENT — KNOCKOUT (30 pts) ────────────────────────────────
    # All 4 must pass: Price > 50SMA > 150EMA > 200SMA AND 200SMA slope > 0
    trend_ok = (
        metrics.get("above_50sma", False) and
        metrics.get("sma50_above_ema150", False) and
        metrics.get("ema150_above_sma200", False) and
        float(metrics.get("sma200_slope") or 0) > 0
    )
    if not trend_ok:
        return 0, components

    components["trend"] = 30
    score = 30

    # ── 2. FUNDAMENTAL ENGINE — ADDITIVE (20 pts) ─────────────────────────────
    eps_ttm      = metrics.get("ttm_eps_growth")
    eps_accel    = metrics.get("eps_is_accelerating", False)
    roce         = metrics.get("roce")
    accel_qtrs   = int(metrics.get("eps_acceleration_quarters") or 0)

    if eps_ttm is not None and eps_ttm > 0 and eps_accel and roce is not None and roce > 15:
        fund_pts = 20   # Full: positive + accelerating + ROCE >15%
    elif (eps_ttm is not None and eps_ttm > 20) or (roce is not None and roce > 15):
        fund_pts = 10   # Partial: strong growth OR solid ROCE
    elif (
        eps_ttm is not None and -70 < eps_ttm < 0 and  # loss but not catastrophic
        accel_qtrs >= 1 and                              # improving at least 1 quarter
        roce is not None and roce > 10                   # some capital efficiency
    ):
        fund_pts = 5    # Turnaround: pre-profit but improving (Medha modification)
    else:
        fund_pts = 0

    score += fund_pts
    components["fundamental"] = fund_pts

    # ── 3. VOLATILITY CONTRACTION — ADDITIVE (20 pts) ─────────────────────────
    # 20-day H-L depth = (max_high - min_low) / close over 20d
    # 5d-vol vs 50d-vol ratio: < 0.5 = dry-up (Minervini VCP v3)
    hl_depth  = float(metrics.get("hl_depth_20d") or 100)
    vol_ratio = float(metrics.get("vol_5d_vs_50d_ratio") or 1.0)

    if hl_depth <= 5 and vol_ratio < 0.5:
        vol_pts = 20   # Full: tight base + confirmed volume dry-up
    elif hl_depth <= 10:
        vol_pts = 10   # Partial: acceptable contraction
    else:
        vol_pts = 0    # Loose/choppy base

    score += vol_pts
    components["volatility"] = vol_pts

    # ── 4. PIVOT PROXIMITY — ADDITIVE (15 pts) ────────────────────────────────
    # (close - 10d_high) / 10d_high * 100  →  negative = below 10d high (in zone)
    pivot = float(metrics.get("pivot_proximity_pct") or -50.0)

    if -5 <= pivot <= 2:
        pivot_pts = 15   # Full: within the coil (-5% to +2%)
    elif -10 <= pivot < -5:
        pivot_pts = 7    # Partial: slightly below, still watchable
    else:
        pivot_pts = 0    # Extended (chasing) or too far below

    score += pivot_pts
    components["pivot"] = pivot_pts

    # ── 5. RELATIVE STRENGTH — ADDITIVE (15 pts) ─────────────────────────────
    # Dual-timeframe leadership: 52W rank + 63d RS outperformance
    rs_52w = metrics.get("rs_52w_percentile")
    rs_63d = float(metrics.get("rs_63d_score") or 0)

    if rs_52w is not None and rs_52w >= 85 and rs_63d >= 10:
        rs_pts = 15   # Full: top-decile leader + strong recent momentum
    elif rs_52w is not None and rs_52w >= 70 and rs_63d >= 5:
        rs_pts = 7    # Partial: leadership + positive momentum
    else:
        rs_pts = 0    # Lagging market

    score += rs_pts
    components["rs"] = rs_pts

    return min(100, score), components


def tier_from_score(score: int) -> str:
    if score >= 85: return "CONFIRMED"
    if score >= 70: return "EMERGING"
    return "NONE"


def get_stage2_subtype(sma50_val: float, sma200_val: float) -> str:
    """Gap between 50 SMA and 200 SMA determines how far into Stage 2 the stock is."""
    if sma200_val <= 0:
        return "EARLY STAGE 2"
    gap_pct = (sma50_val - sma200_val) / sma200_val * 100
    if gap_pct <= 15:
        return "EARLY STAGE 2"
    elif gap_pct <= 30:
        return "MID STAGE 2"
    else:
        return "LATE STAGE 2"


def lifecycle_from_context(
    score: int,
    prev_score_5d: int | None,
    days_confirmed: int,
    above_50sma: bool,
    above_150ema: bool,
) -> str:
    if not above_150ema or score < 60:
        return "EXITED"
    if score >= 85:
        if days_confirmed >= 30 and above_50sma:
            return "SUSTAINED"
        if prev_score_5d is not None and (prev_score_5d - score) > 12:
            return "WEAKENING"
        if not above_50sma:
            return "WEAKENING"
        return "CONFIRMED"
    if score >= 70:
        # Can be weakening if recently dropped from CONFIRMED territory
        if prev_score_5d is not None and prev_score_5d >= 85 and (prev_score_5d - score) > 12:
            return "WEAKENING"
        return "EMERGING"
    return "WATCHING"   # 60-69


# ── VCP (legacy — displayed but not used in v3.0 scoring) ────────────────────
def compute_vcp(hist: pd.DataFrame) -> tuple:
    try:
        close  = hist["Close"].squeeze()
        volume = hist["Volume"].squeeze()
        high   = hist["High"].squeeze()
        low    = hist["Low"].squeeze()
        if len(close) < 25:
            return None, None, 0
        vol_5d  = float(volume.iloc[-6:-1].mean())
        vol_20d = float(volume.iloc[-21:-1].mean())
        vcp_vol = round(vol_5d / vol_20d, 3) if vol_20d > 0 else 1.0
        adr_5d  = float(((high - low) / close).iloc[-6:-1].mean())
        adr_15d = float(((high - low) / close).iloc[-21:-6].mean())
        vcp_adr = round(adr_5d / adr_15d, 3) if adr_15d > 0 else 1.0
        def vpts(r): return 5 if r <= 0.5 else 4 if r <= 0.65 else 2 if r <= 0.8 else 0
        return vcp_vol, vcp_adr, vpts(vcp_vol) + vpts(vcp_adr)
    except Exception:
        return None, None, 0


# ── Fundamentals ───────────────────────────────────────────────────────────────
def get_fundamentals(ticker_obj: yf.Ticker) -> dict:
    out = dict(
        ttm_eps_growth=None, roce=None, pe_ratio=None,
        eps_acceleration_quarters=0, eps_is_accelerating=False,
    )
    try:
        info = ticker_obj.info
        out["pe_ratio"] = info.get("trailingPE")
        roe = info.get("returnOnEquity")
        if roe is not None:
            out["roce"] = round(roe * 100, 2)

        qf = ticker_obj.quarterly_financials
        if qf is not None and not qf.empty and qf.shape[1] >= 5:
            net_key = next(
                (k for k in qf.index
                 if "net income" in str(k).lower() or "profit after" in str(k).lower()),
                None,
            )
            if net_key:
                vals = qf.loc[net_key].dropna()
                if len(vals) >= 5:
                    ttm_curr = float(vals.iloc[0] + vals.iloc[1] + vals.iloc[2] + vals.iloc[3])
                    ttm_prev = float(vals.iloc[1] + vals.iloc[2] + vals.iloc[3] + vals.iloc[4])
                    if ttm_prev and ttm_prev != 0:
                        out["ttm_eps_growth"] = round(
                            (ttm_curr - ttm_prev) / abs(ttm_prev) * 100, 2
                        )

                # EPS acceleration: count quarters where Q_n YoY > Q_{n+1} YoY
                # Rubric: Q0 YoY > Q1 YoY means eps_is_accelerating = True (accel_count >= 1)
                if len(vals) >= 8:
                    yoy = []
                    for i in range(4):
                        curr = float(vals.iloc[i])
                        prev_q = float(vals.iloc[i + 4]) if i + 4 < len(vals) else None
                        if prev_q and prev_q != 0:
                            yoy.append((curr - prev_q) / abs(prev_q) * 100)
                    if len(yoy) >= 2:
                        accel = sum(1 for i in range(len(yoy) - 1) if yoy[i] > yoy[i + 1])
                        out["eps_acceleration_quarters"] = accel
                        out["eps_is_accelerating"] = accel >= 1   # Q0 YoY > Q1 YoY
    except Exception:
        pass
    return out


# ── Technical analysis ─────────────────────────────────────────────────────────
def analyse(hist: pd.DataFrame, bench_hist: pd.DataFrame, ticker_obj: yf.Ticker) -> dict | None:
    """
    Full technical analysis. Returns metrics dict or None (failed hard filters).
    Hard filters applied here match the knockout exactly — only qualifying stocks
    are returned and stored, keeping the DB clean.
    """
    if hist.empty or len(hist) < 210:
        return None

    if isinstance(hist.columns, pd.MultiIndex):
        hist = hist.xs(hist.columns.get_level_values(1)[0], level=1, axis=1)

    hist = hist.dropna(subset=["Close"])
    if len(hist) < 200:
        return None

    close  = hist["Close"].squeeze()
    volume = hist["Volume"].fillna(0).squeeze()
    high   = hist["High"].squeeze()
    low    = hist["Low"].squeeze()

    # Liquidity filter
    adtv_20 = float((close * volume).rolling(20).mean().iloc[-1])
    if adtv_20 < MIN_ADTV or pd.isna(adtv_20):
        return None

    last_close = float(close.iloc[-1])
    if pd.isna(last_close) or last_close <= 0:
        return None

    # ── Moving Averages ───────────────────────────────────────────────────────
    ema150 = close.ewm(span=150, adjust=False).mean()
    sma200 = close.rolling(200).mean()
    sma50  = close.rolling(50).mean()
    sma20  = close.rolling(20).mean()

    last_ema150 = float(ema150.iloc[-1])
    last_sma200 = float(sma200.iloc[-1]) if not pd.isna(sma200.iloc[-1]) else 0.0
    last_sma50  = float(sma50.iloc[-1])  if not pd.isna(sma50.iloc[-1])  else 0.0
    last_sma20  = float(sma20.iloc[-1])  if not pd.isna(sma20.iloc[-1])  else last_close

    if pd.isna(last_ema150) or last_close <= last_ema150:
        return None   # Below 150 EMA — Stage 2 not active

    # ── Trend alignment (knockout conditions) ─────────────────────────────────
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

    # Apply hard filters matching knockout — don't store non-qualifying stocks
    if not (above_50sma and sma50_above_ema150 and ema150_above_sma200 and sma200_slope > 0):
        return None

    # ── EMA150 analytics (display) ────────────────────────────────────────────
    ema150_slope = round(
        (float(ema150.iloc[-1]) - float(ema150.iloc[-21])) / float(ema150.iloc[-21]) * 100
        if len(ema150) >= 21 else 0, 4
    )
    ema_dist = round((last_close - last_ema150) / last_ema150 * 100, 2)

    # ── Base tightness from 20d SMA (display) ────────────────────────────────
    base_20d_dist = round((last_close - last_sma20) / last_sma20 * 100, 2)

    # ── Days continuously above 150 EMA ──────────────────────────────────────
    above_ema150_flags = (close > ema150).values
    days_in_s2 = 0
    for flag in reversed(above_ema150_flags):
        if flag: days_in_s2 += 1
        else: break

    # ── Stage 2 sub-type (50SMA vs 200SMA gap) ───────────────────────────────
    subtype = get_stage2_subtype(last_sma50, last_sma200)

    # ── 20-day H-L depth (v3.0 Volatility Contraction) ───────────────────────
    hl_depth_20d = round((float(high.tail(20).max()) - float(low.tail(20).min())) / last_close * 100, 2)

    # ── Volume 5d vs 50d avg (v3.0 VCP criterion) ────────────────────────────
    vol_5d_avg  = float(volume.tail(5).mean())
    vol_50d_avg = float(volume.rolling(50).mean().iloc[-1])
    vol_5d_vs_50d = round(vol_5d_avg / vol_50d_avg, 3) if vol_50d_avg > 0 else 1.0

    # ── Pivot proximity: distance from 10-day high ────────────────────────────
    high_10d = float(high.tail(10).max())
    pivot_pct = round((last_close - high_10d) / high_10d * 100, 2)

    # ── RS vs Nifty Total Market — 63-day slope ───────────────────────────────
    rs_63d_score, rs_trend = 0.0, "Flat"
    try:
        if bench_hist is not None and not bench_hist.empty:
            bc = bench_hist["Close"].squeeze().reindex(close.index, method="ffill")
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

    # ── Legacy VCP (retained for display) ────────────────────────────────────
    vcp_vol_ratio, vcp_adr_ratio, vcp_score = compute_vcp(hist)

    # ── Volume on last session ────────────────────────────────────────────────
    vol_sma20 = float(volume.rolling(20).mean().iloc[-2]) if len(volume) > 20 else 1.0
    vol_mult  = round(float(volume.iloc[-1]) / vol_sma20, 2) if vol_sma20 > 0 else 0.0

    # ── 52W raw return (cross-universe percentile ranking) ────────────────────
    price_52w_ago = float(close.iloc[-253]) if len(close) >= 253 else float(close.iloc[0])
    rs_52w_raw = round((last_close - price_52w_ago) / price_52w_ago * 100, 2) if price_52w_ago > 0 else 0.0

    # ── Fundamentals ─────────────────────────────────────────────────────────
    fund = get_fundamentals(ticker_obj)

    return {
        # Knockout / Trend
        "above_50sma":              above_50sma,
        "sma50_above_ema150":       sma50_above_ema150,
        "ema150_above_sma200":      ema150_above_sma200,
        "above_200sma":             above_200sma,
        "sma200_slope":             sma200_slope,
        "stage2_subtype":           subtype,
        # Stage duration
        "days_in_stage2":           days_in_s2,
        # EMA display
        "ema150_distance_pct":      ema_dist,
        "ema150_slope":             ema150_slope,
        "base_20d_distance_pct":    base_20d_dist,
        # v3.0 Volatility Contraction
        "hl_depth_20d":             hl_depth_20d,
        "vol_5d_vs_50d_ratio":      vol_5d_vs_50d,
        # v3.0 Pivot Proximity
        "pivot_proximity_pct":      pivot_pct,
        # RS
        "rs_trend":                 rs_trend,
        "rs_63d_score":             rs_63d_score,
        "rs_52w_raw":               rs_52w_raw,
        # Legacy VCP (display only)
        "vcp_volume_ratio":         vcp_vol_ratio,
        "vcp_adr_ratio":            vcp_adr_ratio,
        "vcp_score":                vcp_score,
        # Volume
        "volume_multiplier":        vol_mult,
        # Close for logging
        "close":                    last_close,
        **fund,
    }


# ── PEAD confluence ───────────────────────────────────────────────────────────
def get_pead_high_scorers() -> set[str]:
    cutoff = (date.today() - timedelta(days=30)).isoformat()
    try:
        resp = sb.table("pead_signals") \
            .select("ticker").gte("signal_date", cutoff).gte("pead_score", 70).execute()
        return {row["ticker"] for row in (resp.data or [])}
    except Exception as e:
        print(f"[pead] {e}")
        return set()


# ── Signal history for lifecycle context ──────────────────────────────────────
def get_recent_signal_history() -> dict:
    cutoff = (date.today() - timedelta(days=10)).isoformat()
    try:
        resp = sb.table("stage2_signals") \
            .select("ticker,signal_date,stage2_score,lifecycle_state,entry_date") \
            .gte("signal_date", cutoff) \
            .order("signal_date", desc=False) \
            .execute()
        history: dict[str, list] = {}
        for row in (resp.data or []):
            t = row["ticker"]
            if t not in history:
                history[t] = []
            history[t].append(row)
        return history
    except Exception as e:
        print(f"[history] {e}")
        return {}


# ── DB upsert ─────────────────────────────────────────────────────────────────
def upsert_signal(
    ticker: str, metrics: dict, score: int, components: dict,
    tier: str, lifecycle: str,
    company_name: str | None, sector: str | None,
    is_pead: bool, is_smd: bool,
    score_3d_delta: int | None, score_trend: str,
    entry_date_val: str, is_reentry: bool, reentry_gap: int | None,
    rs_52w_percentile: int | None,
    signal_date_override: str | None = None,
) -> str | None:

    sig_date = signal_date_override or TODAY
    row = {
        "ticker":                    ticker,
        "company_name":              company_name,
        "sector":                    sector,
        "signal_date":               sig_date,
        "stage2_score":              score,
        # Trend
        "above_50sma":               metrics.get("above_50sma", False),
        "sma50_above_ema150":        metrics.get("sma50_above_ema150", False),
        "ema150_above_sma200":       metrics.get("ema150_above_sma200", False),
        "above_200sma":              metrics.get("above_200sma", False),
        "sma200_slope":              metrics.get("sma200_slope"),
        "stage2_subtype":            metrics.get("stage2_subtype"),
        # Stage duration
        "days_in_stage2":            metrics.get("days_in_stage2"),
        "ema150_distance_pct":       metrics.get("ema150_distance_pct"),
        "ema150_slope":              metrics.get("ema150_slope"),
        "base_20d_distance_pct":     metrics.get("base_20d_distance_pct"),
        # v3.0 Volatility
        "hl_depth_20d":              metrics.get("hl_depth_20d"),
        "vol_5d_vs_50d_ratio":       metrics.get("vol_5d_vs_50d_ratio"),
        # v3.0 Pivot
        "pivot_proximity_pct":       metrics.get("pivot_proximity_pct"),
        # RS
        "rs_trend":                  metrics.get("rs_trend"),
        "rs_63d_score":              metrics.get("rs_63d_score"),
        "rs_52w_percentile":         rs_52w_percentile,
        # Legacy VCP (display)
        "vcp_volume_ratio":          metrics.get("vcp_volume_ratio"),
        "vcp_adr_ratio":             metrics.get("vcp_adr_ratio"),
        "vcp_score":                 metrics.get("vcp_score", 0),
        # Volume
        "volume_multiplier":         metrics.get("volume_multiplier"),
        "breakout_volume_ratio":     metrics.get("volume_multiplier"),
        # Fundamentals
        "ttm_eps_growth":            metrics.get("ttm_eps_growth"),
        "roce":                      metrics.get("roce"),
        "pe_ratio":                  metrics.get("pe_ratio"),
        "eps_acceleration_quarters": metrics.get("eps_acceleration_quarters", 0),
        "eps_is_accelerating":       metrics.get("eps_is_accelerating", False),
        # Lifecycle
        "tier":                      tier,
        "lifecycle_state":           lifecycle,
        "entry_date":                entry_date_val,
        "last_confirmed_date":       sig_date if tier in ("CONFIRMED", "EMERGING") else None,
        # Score tracking
        "score_3d_delta":            score_3d_delta,
        "score_trend":               score_trend,
        # Flags
        "is_pead_confluence":        is_pead,
        "is_smart_money_divergence": is_smd,
        "is_reentry":                is_reentry,
        "reentry_gap_days":          reentry_gap,
    }
    try:
        res = sb.table("stage2_signals").upsert(row, on_conflict="ticker,signal_date").execute()
        sig_id = res.data[0]["id"] if res.data else None
        if sig_id:
            sb.table("stage2_performance").upsert(
                {"signal_id": sig_id}, on_conflict="signal_id"
            ).execute()
            sb.table("stage2_score_log").upsert({
                "signal_id":       sig_id,
                "ticker":          ticker,
                "log_date":        sig_date,
                "score":           score,
                "lifecycle_state": lifecycle,
                "close_price":     metrics.get("close"),
            }, on_conflict="ticker,log_date").execute()
        return sig_id
    except Exception as e:
        print(f"  [db] {ticker}: {e}")
        return None


# ── Telegram ───────────────────────────────────────────────────────────────────
def send_telegram(confirmed: list, emerging: list) -> None:
    if not TG_TOKEN or not TG_CHAT_ID:
        return
    lines = [
        f"Stage 2 Engine v3.0 — {dt.now().strftime('%d %b %Y')}",
        f"Rubric: Weinstein+Minervini | CONFIRMED≥85 | EMERGING 70-84",
    ]
    if confirmed:
        lines.append(f"\nCONFIRMED (85+) — {len(confirmed)} stocks")
        for s in sorted(confirmed, key=lambda x: x["score"], reverse=True)[:8]:
            lines.append(
                f"  {s['ticker']} [{s.get('subtype','')[:5]}] "
                f"score={s['score']} {s['state']} d={s['days']} RS={s.get('rs52','?')}%ile"
            )
    if emerging:
        lines.append(f"\nEMERGING (70-84) — {len(emerging)} stocks (top 5):")
        for s in sorted(emerging, key=lambda x: x["score"], reverse=True)[:5]:
            lines.append(f"  {s['ticker']} score={s['score']} {s.get('subtype','')}")
    try:
        requests.post(
            f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
            json={"chat_id": TG_CHAT_ID, "text": "\n".join(lines)},
            timeout=10,
        )
        print("[telegram] sent")
    except Exception as e:
        print(f"[telegram] {e}")


# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    print(f"=== Stage 2 Engine v3.0 — {TODAY} ===")
    print("Rubric: Weinstein+Minervini | 30+20+20+15+15 | CONFIRMED≥85 | EMERGING 70-84")

    tickers = get_universe_tickers()
    print(f"[universe] {len(tickers)} tickers to scan")

    print("[benchmark] fetching Nifty Total Market...")
    bench_hist = None
    try:
        bench_hist = yf.Ticker(BENCHMARK).history(period="2y", interval="1d", auto_adjust=True)
        time.sleep(1)
    except Exception as e:
        print(f"[benchmark] {e}")

    pead_set = get_pead_high_scorers()
    history  = get_recent_signal_history()
    print(f"[pead] {len(pead_set)} | [history] {len(history)} tickers with recent data")

    # Pass 1: download + filter + collect 52W raw returns
    print("[pass1] downloading and analysing...")
    results_map: dict[str, tuple[dict, pd.DataFrame]] = {}
    rs_52w_raw_map: dict[str, float] = {}

    for i, ticker in enumerate(tickers, 1):
        ns = ticker if ticker.endswith(".NS") else ticker + ".NS"
        print(f"[{i}/{len(tickers)}] {ns}", end="  ")
        try:
            t    = yf.Ticker(ns)
            hist = t.history(period="2y", interval="1d", auto_adjust=True)
            time.sleep(0.5)
        except Exception as e:
            print(f"-> dl_fail: {e}")
            continue

        metrics = analyse(hist, bench_hist, t)
        if metrics is None:
            print("-> skip")
            continue

        results_map[ticker] = (metrics, hist)
        rs_52w_raw_map[ticker] = metrics["rs_52w_raw"]
        print(
            f"-> PASS | HL={metrics['hl_depth_20d']:.1f}% "
            f"piv={metrics['pivot_proximity_pct']:+.1f}% "
            f"vol5d={metrics['vol_5d_vs_50d_ratio']:.2f}x "
            f"{metrics['stage2_subtype']}"
        )

    # Compute 52W percentile across qualifying stocks
    print(f"\n[percentile] ranking {len(rs_52w_raw_map)} tickers...")
    sorted_tk  = sorted(rs_52w_raw_map, key=lambda t: rs_52w_raw_map[t])
    n          = len(sorted_tk)
    pct_map    = {tk: int(rank / n * 100) for rank, tk in enumerate(sorted_tk, 1)}

    # Pass 2: score, lifecycle, upsert
    print("[pass2] scoring and upserting...")
    confirmed_list, emerging_list = [], []

    for ticker, (metrics, hist) in results_map.items():
        rs_52w_pct = pct_map.get(ticker)
        metrics["rs_52w_percentile"] = rs_52w_pct

        score, components = compute_stage2_score(metrics)
        if score == 0:
            continue   # shouldn't happen (hard filters match knockout), but safe guard

        tier = tier_from_score(score)

        # Lifecycle context
        ticker_hist    = history.get(ticker, [])
        confirmed_days = sum(1 for h in ticker_hist if h.get("lifecycle_state") == "CONFIRMED")

        score_3d_delta, score_trend = None, "NEUTRAL"
        hist_3d = [h for h in ticker_hist
                   if h.get("signal_date") == (date.today() - timedelta(days=3)).isoformat()]
        if hist_3d:
            old = hist_3d[0]["stage2_score"]
            score_3d_delta = score - old
            if score_3d_delta >= 8:   score_trend = "STRENGTHENING"
            elif score_3d_delta <= -8: score_trend = "WEAKENING"

        earliest = min(
            (h.get("entry_date") or h.get("signal_date") for h in ticker_hist
             if h.get("entry_date") or h.get("signal_date")),
            default=None,
        )
        entry_date_val = earliest or TODAY

        last_states = [h.get("lifecycle_state") for h in ticker_hist]
        is_reentry  = "EXITED" in last_states and entry_date_val == TODAY
        reentry_gap = None
        if is_reentry:
            for h in reversed(ticker_hist):
                if h.get("lifecycle_state") == "EXITED":
                    reentry_gap = (date.today() - date.fromisoformat(h["signal_date"])).days
                    break

        prev_score_5d = None
        hist_5d = [h for h in ticker_hist
                   if h.get("signal_date") == (date.today() - timedelta(days=5)).isoformat()]
        if hist_5d:
            prev_score_5d = hist_5d[0]["stage2_score"]

        lifecycle = lifecycle_from_context(
            score, prev_score_5d, confirmed_days,
            above_50sma=metrics.get("above_50sma", True),
            above_150ema=True,
        )

        is_pead = ticker in pead_set or (ticker + ".NS") in pead_set
        is_smd  = (
            (metrics.get("ttm_eps_growth") or 0) < 0 and
            (metrics.get("volume_multiplier") or 0) >= 3.0 and
            score >= 70
        )
        if is_reentry:
            score = min(100, score + 2)

        # Company info
        company_name = sector = None
        try:
            ns   = ticker if ticker.endswith(".NS") else ticker + ".NS"
            info = yf.Ticker(ns).info
            company_name = info.get("longName") or info.get("shortName")
            sector       = info.get("sector")
            time.sleep(0.3)
        except Exception:
            pass

        upsert_signal(
            ticker, metrics, score, components, tier, lifecycle,
            company_name, sector, is_pead, is_smd,
            score_3d_delta, score_trend,
            entry_date_val, is_reentry, reentry_gap,
            rs_52w_pct,
        )

        subtype = metrics.get("stage2_subtype", "")
        t_out = components["trend"]
        f_out = components["fundamental"]
        v_out = components["volatility"]
        p_out = components["pivot"]
        r_out = components["rs"]
        print(
            f"  {ticker}: {score}pt [{tier}] {lifecycle} | "
            f"T={t_out} F={f_out} V={v_out} P={p_out} RS={r_out} | "
            f"HL={metrics['hl_depth_20d']:.1f}% piv={metrics['pivot_proximity_pct']:+.1f}% "
            f"vol={metrics['vol_5d_vs_50d_ratio']:.2f}x RS52={rs_52w_pct}%ile | {subtype}"
        )

        d = {
            "ticker": ticker, "score": score, "state": lifecycle,
            "days": metrics["days_in_stage2"], "vol": metrics.get("volume_multiplier", 0),
            "subtype": subtype, "rs52": rs_52w_pct,
        }
        if score >= 85:
            confirmed_list.append(d)
        elif score >= 70:
            emerging_list.append(d)

    print(
        f"\n[done] {len(results_map)} qualified | "
        f"{len(confirmed_list)} CONFIRMED | {len(emerging_list)} EMERGING"
    )
    send_telegram(confirmed_list, emerging_list)


if __name__ == "__main__":
    main()

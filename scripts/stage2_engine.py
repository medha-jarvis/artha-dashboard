"""
Stage 2 Intelligence Engine v4.0 — Pure Weinstein Stage Classification
========================================================================
Primary Dataset  : Weekly OHLCV (Friday close)
Secondary Dataset: Daily OHLCV (Minervini radar badges only — informational)
Benchmark        : Nifty Total Market weekly (Mansfield RS)

Weinstein Stage Classification:
  EARLY_STAGE_2    : Prime Buy Alert — breakout + volume surge + Mansfield RS
  LATE_STAGE_2     : Hold/Add — established uptrend above EMA_10W
  STAGE_1_BASING   : Watchlist — basing around flat MA_30W
  STAGE_3_TOPPING  : Warning — MA_30W flattening after extended uptrend
  STAGE_4_DECLINING: Disqualified — price below declining MA_30W

Minervini Radar (informational only, daily data):
  vcp_depth_20d_pct  : (Max_H_20d - Min_L_20d) / Max_H_20d
  is_volume_dry_up   : Daily Vol < 0.5x SMA(Vol, 50d)
  pivot_proximity_pct: (Close - Max_H_10d) / Max_H_10d
  is_daily_ma_stacked: Price > SMA(50) > EMA(150) > SMA(200)

DB column repurposing (backward compat):
  stage2_subtype      ← Weinstein stage string
  stage2_score        ← synthetic (90/70/40/20/0)
  above_50sma         ← Price > MA_30W
  sma50_above_ema150  ← MA_30W slope >= 0
  ema150_above_sma200 ← Price > EMA_10W
  above_200sma        ← Price > resistance ceiling
  sma200_slope        ← MA_30W_slope value
  ema150_distance_pct ← % distance from MA_30W
  days_in_stage2      ← weeks above MA_30W
  vol_5d_vs_50d_ratio ← Vol_Ratio_Weekly
  rs_63d_score        ← Mansfield RS value
  hl_depth_20d        ← Minervini VCP depth (daily)
  vcp_volume_ratio    ← daily vol/50d ratio (for dry-up flag)
  pivot_proximity_pct ← Minervini pivot proximity (daily)
  rs_line_new_high    ← is_daily_ma_stacked
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
BENCHMARK       = "^CRSLDX"   # Nifty Total Market — Mansfield RS benchmark
MIN_WEEKLY_TVR  = 5_000_000   # ₹50L weekly turnover ≈ ₹1Cr daily ADTV proxy
MIN_ADTV        = 10_000_000  # kept for backfill compat

NSE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept":     "application/json, */*",
    "Referer":    "https://www.nseindia.com/",
}

STAGE_SYNTHETIC_SCORES = {
    "EARLY_STAGE_2":     90,
    "LATE_STAGE_2":      70,
    "STAGE_1_BASING":    40,
    "STAGE_3_TOPPING":   20,
    "STAGE_4_DECLINING":  0,
}

def compute_wcs(metrics: dict, stage: str) -> int:
    """
    Weinstein Conviction Score (WCS) 0–100.
    Quality gradient within a stage — not a gate. Stage-specific weights.

    Stage 2A: Vol(35) + MRS(30) + Slope(20) + Radar(15) = 100
    Stage 2B: Slope(30) + MRS(30) + 52WPos(20) + MADist(10) + Radar(10) = 100
    Stage 1:  MRS(30) + 52WPos(30) + Slope-flat(20) + Radar(20) = 100
    """
    vol    = float(metrics.get("vol_5d_vs_50d_ratio") or 0)
    mrs    = float(metrics.get("rs_63d_score") or 0)
    slope  = float(metrics.get("sma200_slope") or 0) * 100   # → %/wk
    pos52w = float(metrics.get("price_52w_position") or 50)
    madist = float(metrics.get("ema150_distance_pct") or 0)

    # Minervini radar green chip count (0–4)
    chips = 0
    if float(metrics.get("hl_depth_20d") or 100) <= 6:      chips += 1
    if float(metrics.get("vcp_volume_ratio") or 1) < 0.5:   chips += 1
    piv = metrics.get("pivot_proximity_pct")
    if piv is not None and -5 <= float(piv) <= 2:            chips += 1
    if metrics.get("rs_line_new_high"):                      chips += 1

    # Radar points tables (indexed by chip count 0-4)
    R2A = [0, 4, 8, 12, 15]   # max 15 for 2A
    R2B = [0, 3, 5,  8, 10]   # max 10 for 2B
    R1  = [0, 5, 10, 15, 20]  # max 20 for Stage 1

    if stage == "EARLY_STAGE_2":
        vol_pts = (35 if vol >= 3.0 else 28 if vol >= 2.5 else
                   20 if vol >= 2.0 else 14 if vol >= 1.75 else
                    8 if vol >= 1.5 else 0)
        mrs_pts = (30 if mrs > 25 else 22 if mrs > 15 else
                   15 if mrs > 10 else 10 if mrs >  5 else
                    5 if mrs >  0 else 0)
        slp_pts = (20 if slope > 0.5 else 15 if slope > 0.3 else
                    8 if slope > 0.1 else  3 if slope >= 0 else 0)
        return min(100, vol_pts + mrs_pts + slp_pts + R2A[chips])

    elif stage == "LATE_STAGE_2":
        slp_pts = (30 if slope > 0.5 else 22 if slope > 0.3 else
                   12 if slope > 0.1 else  5 if slope >= 0 else 0)
        mrs_pts = (30 if mrs > 25 else 22 if mrs > 15 else
                   15 if mrs > 10 else 10 if mrs >  5 else
                    5 if mrs >  0 else 0)
        pos_pts = (20 if pos52w >= 90 else 15 if pos52w >= 75 else
                    8 if pos52w >= 50 else 0)
        dist_pts = (10 if madist <= 15 else 5 if madist <= 25 else
                     2 if madist <= 35 else 0)
        return min(100, slp_pts + mrs_pts + pos_pts + dist_pts + R2B[chips])

    elif stage == "STAGE_1_BASING":
        mrs_pts = (30 if mrs > 10 else 20 if mrs >  5 else
                   12 if mrs >  0 else  5 if mrs > -5 else 0)
        pos_pts = (30 if pos52w >= 85 else 20 if pos52w >= 70 else
                   10 if pos52w >= 55 else 0)
        absslp  = abs(slope)
        slp_pts = (20 if absslp <= 0.10 else 12 if absslp <= 0.30 else
                    5 if absslp <= 0.50 else 0)
        return min(100, mrs_pts + pos_pts + slp_pts + R1[chips])

    return 0

STAGE_TIERS = {
    "EARLY_STAGE_2":     "CONFIRMED",
    "LATE_STAGE_2":      "EMERGING",
    "STAGE_1_BASING":    "WATCHING",
    "STAGE_3_TOPPING":   "WATCHING",
    "STAGE_4_DECLINING": "NONE",
}

STAGES_TO_STORE = {"EARLY_STAGE_2", "LATE_STAGE_2", "STAGE_1_BASING"}


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
    try:
        import io
        r = requests.get(
            "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv",
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=30,
        )
        df = pd.read_csv(io.StringIO(r.text))
        sym_col    = next((c for c in df.columns if "SYMBOL" in c.upper()), None)
        series_col = next((c for c in df.columns if "SERIES" in c.upper()), None)
        if sym_col is None:
            return []
        if series_col is not None:
            df = df[df[series_col].isin(["EQ", "BE"])]
        symbols = df[sym_col].dropna().str.strip().tolist()
        symbols = [s for s in symbols if s and (s.isalnum() or (len(s) < 20 and s.replace("-","").replace("&","").isalnum()))]
        print(f"[universe] NSE CSV: {len(symbols)} EQ+BE series stocks")
        return symbols
    except Exception as e:
        print(f"[universe] NSE CSV failed: {e}")
        return []


def get_universe_tickers() -> list[str]:
    csv_tickers = _nse_equity_csv()
    if len(csv_tickers) > 500:
        return csv_tickers

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

    print("[universe] falling back to hardcoded list")
    return get_nifty500_tickers()


def get_nifty500_tickers() -> list[str]:
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
            and item["symbol"].replace("-","").replace("&","").replace("_","").isalnum()
        ]
        if len(tickers) > 100:
            return tickers
    except Exception as e:
        print(f"[universe] N500 fallback failed: {e}")
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


# ── Mansfield RS ───────────────────────────────────────────────────────────────
def compute_mansfield_rs(close_w: pd.Series, bench_w: pd.DataFrame) -> tuple[float, bool]:
    """
    Returns (mansfield_rs_now, is_rising_over_4wks).
    Mansfield RS = ((R_stock / R_bench) - 1) * 100
    where R = close_now / close_52wks_ago
    """
    try:
        if bench_w is None or bench_w.empty:
            return 0.0, False
        bench_close = bench_w["Close"].squeeze() if "Close" in bench_w.columns else bench_w.iloc[:, 0]
        aligned = pd.DataFrame({"stock": close_w, "bench": bench_close}).dropna()
        if len(aligned) < 54:
            return 0.0, False

        # RS line value = (stock/stock_52wk) / (bench/bench_52wk)
        rs_now = (float(aligned["stock"].iloc[-1]) / float(aligned["stock"].iloc[-53])) / \
                 (float(aligned["bench"].iloc[-1]) / float(aligned["bench"].iloc[-53]))
        mansfield_rs = round((rs_now - 1) * 100, 2)

        # 4-week slope
        if len(aligned) >= 57:
            rs_4w_ago = (float(aligned["stock"].iloc[-5]) / float(aligned["stock"].iloc[-57])) / \
                        (float(aligned["bench"].iloc[-5]) / float(aligned["bench"].iloc[-57]))
            is_rising = rs_now > rs_4w_ago
        else:
            is_rising = mansfield_rs > 0

        return mansfield_rs, is_rising
    except Exception:
        return 0.0, False


# ── Weinstein stage classifier ──────────────────────────────────────────────────
def _classify_weinstein_stage(
    price_above_ma30w: bool,
    ma30w_slope: float,
    price_above_ema10w: bool,
    price_above_resistance: bool,
    vol_ratio_weekly: float,
    mansfield_rs: float,
    mansfield_rs_rising: bool,
    ma30w_dist_pct: float,
    weeks_above_ma30w: int,
) -> str:
    # Stage 4: price below declining MA
    if not price_above_ma30w and ma30w_slope < 0:
        return "STAGE_4_DECLINING"

    # Stage 3: topping — extended uptrend with MA now flattening
    if weeks_above_ma30w >= 20 and ma30w_slope <= 0.0 and not price_above_resistance:
        return "STAGE_3_TOPPING"

    if price_above_ma30w:
        # Early Stage 2: breakout with volume + RS confirmation
        if (ma30w_slope >= 0.0 and
                price_above_resistance and
                vol_ratio_weekly >= 1.5 and
                (mansfield_rs > 0 or mansfield_rs_rising)):
            return "EARLY_STAGE_2"

        # Late Stage 2: established uptrend (strong slope + above EMA_10W)
        if ma30w_slope > 0.002 and price_above_ema10w and weeks_above_ma30w >= 4:
            return "LATE_STAGE_2"

        # Late Stage 2: well above MA in broad uptrend
        if ma30w_slope >= 0.0 and weeks_above_ma30w >= 8:
            return "LATE_STAGE_2"

    # Stage 1: basing — price near MA, slope flat
    if abs(ma30w_dist_pct) <= 10 and -0.001 <= ma30w_slope <= 0.001:
        return "STAGE_1_BASING"

    # Catch-all
    if price_above_ma30w:
        return "LATE_STAGE_2" if ma30w_slope >= 0 else "STAGE_1_BASING"
    return "STAGE_4_DECLINING"


# ── Minervini radar (daily data, informational) ────────────────────────────────
def compute_minervini_radar(daily_hist: pd.DataFrame) -> dict:
    defaults = {
        "hl_depth_20d":    None,   # vcp_depth_20d_pct
        "vcp_volume_ratio": 1.0,   # daily vol / 50d avg
        "pivot_proximity_pct": None,
        "rs_line_new_high": False,  # is_daily_ma_stacked
    }
    try:
        if daily_hist.empty or len(daily_hist) < 60:
            return defaults
        if isinstance(daily_hist.columns, pd.MultiIndex):
            daily_hist = daily_hist.xs(daily_hist.columns.get_level_values(1)[0], level=1, axis=1)
        close  = daily_hist["Close"].squeeze()
        high   = daily_hist["High"].squeeze()
        low    = daily_hist["Low"].squeeze()
        volume = daily_hist["Volume"].fillna(0).squeeze()
        last_close = float(close.iloc[-1])

        # VCP depth: (Max_H_20d - Min_L_20d) / Max_H_20d
        max_h_20d = float(high.tail(20).max())
        min_l_20d = float(low.tail(20).min())
        vcp_depth = round((max_h_20d - min_l_20d) / max_h_20d * 100, 2) if max_h_20d > 0 else None

        # Volume dry-up: last daily vol vs 50d SMA
        vol_sma_50d = float(volume.rolling(50).mean().iloc[-1])
        last_vol    = float(volume.iloc[-1])
        vol_ratio_daily = round(last_vol / vol_sma_50d, 3) if vol_sma_50d > 0 else 1.0

        # Pivot proximity: (Close - Max_H_10d) / Max_H_10d
        max_h_10d = float(high.tail(10).max())
        pivot_prox = round((last_close - max_h_10d) / max_h_10d * 100, 2) if max_h_10d > 0 else None

        # Daily MA stack: Price > SMA(50) > EMA(150) > SMA(200)
        sma50_d  = close.rolling(50).mean().iloc[-1]
        ema150_d = close.ewm(span=150, adjust=False).mean().iloc[-1]
        sma200_d = close.rolling(200).mean().iloc[-1]
        is_stacked = bool(
            not any(pd.isna(v) for v in [sma50_d, ema150_d, sma200_d]) and
            last_close > float(sma50_d) > float(ema150_d) > float(sma200_d)
        )

        return {
            "hl_depth_20d":       vcp_depth,
            "vcp_volume_ratio":   vol_ratio_daily,
            "pivot_proximity_pct": pivot_prox,
            "rs_line_new_high":   is_stacked,
        }
    except Exception:
        return defaults


# ── Core Weinstein analysis (weekly) ──────────────────────────────────────────
def analyse_weekly(weekly_hist: pd.DataFrame, bench_weekly: pd.DataFrame) -> dict | None:
    """
    Weinstein stage analysis from weekly OHLCV.
    Returns metrics dict or None (fails liquidity / data filter).
    """
    if weekly_hist.empty:
        return None
    if isinstance(weekly_hist.columns, pd.MultiIndex):
        weekly_hist = weekly_hist.xs(weekly_hist.columns.get_level_values(1)[0], level=1, axis=1)
    weekly_hist = weekly_hist.dropna(subset=["Close"])
    if len(weekly_hist) < 35:
        return None

    close_w  = weekly_hist["Close"].squeeze()
    volume_w = weekly_hist["Volume"].fillna(0).squeeze()
    high_w   = weekly_hist["High"].squeeze()
    low_w    = weekly_hist["Low"].squeeze()

    last_close = float(close_w.iloc[-1])
    if pd.isna(last_close) or last_close <= 0:
        return None

    # Liquidity: 4-week avg weekly turnover
    weekly_tvr = (close_w * volume_w).rolling(4).mean()
    avg_tvr = float(weekly_tvr.iloc[-1]) if not pd.isna(weekly_tvr.iloc[-1]) else 0.0
    if avg_tvr < MIN_WEEKLY_TVR:
        return None

    # Core Weinstein indicators
    ma_30w     = close_w.rolling(30).mean()
    ema_10w    = close_w.ewm(span=10, adjust=False).mean()
    vol_avg_30w = volume_w.rolling(30).mean()

    if pd.isna(ma_30w.iloc[-1]):
        return None

    last_ma_30w  = float(ma_30w.iloc[-1])
    last_ema_10w = float(ema_10w.iloc[-1])
    last_vol_avg = float(vol_avg_30w.iloc[-1]) if not pd.isna(vol_avg_30w.iloc[-1]) else 1.0
    last_vol_w   = float(volume_w.iloc[-1])

    # MA_30W slope: spec formula (MA[-1] - MA[-5]) / MA[-5] — 4-week change
    ma_clean = ma_30w.dropna()
    if len(ma_clean) >= 5:
        ma30w_slope = (float(ma_clean.iloc[-1]) - float(ma_clean.iloc[-5])) / abs(float(ma_clean.iloc[-5]))
    else:
        ma30w_slope = 0.0

    vol_ratio_weekly = round(last_vol_w / last_vol_avg, 3) if last_vol_avg > 0 else 1.0

    # Stage 1 resistance ceiling: max high of prior 20–40 weeks
    n_look = min(40, max(20, len(high_w) - 2))
    resistance_ceiling = float(high_w.iloc[-(n_look + 1):-1].max()) if n_look > 0 else last_close

    # Mansfield RS
    mansfield_rs, mansfield_rs_rising = compute_mansfield_rs(close_w, bench_weekly)

    # Key booleans
    price_above_ma30w       = bool(last_close > last_ma_30w)
    price_above_ema10w      = bool(last_close > last_ema_10w)
    price_above_resistance  = bool(last_close > resistance_ceiling)
    ma30w_dist_pct          = round((last_close - last_ma_30w) / last_ma_30w * 100, 2)

    # Count consecutive weeks above MA_30W
    above_flags = (close_w > ma_30w).values
    weeks_above_ma30w = 0
    for flag in reversed(above_flags):
        if pd.isna(flag): break
        if flag: weeks_above_ma30w += 1
        else: break

    # Stage classification
    weinstein_stage = _classify_weinstein_stage(
        price_above_ma30w, ma30w_slope, price_above_ema10w,
        price_above_resistance, vol_ratio_weekly,
        mansfield_rs, mansfield_rs_rising,
        ma30w_dist_pct, weeks_above_ma30w,
    )

    # 52W data (weekly)
    n_52w    = min(52, len(high_w))
    high_52w = float(high_w.tail(n_52w).max())
    low_52w  = float(low_w.tail(n_52w).min())
    price_52w_pos = round((last_close - low_52w) / (high_52w - low_52w) * 100, 1) \
                    if (high_52w - low_52w) > 0 else 50.0

    price_52w_ago = float(close_w.iloc[-53]) if len(close_w) >= 53 else float(close_w.iloc[0])
    rs_52w_raw = round((last_close - price_52w_ago) / price_52w_ago * 100, 2) if price_52w_ago > 0 else 0.0

    rs_trend = "Positive" if mansfield_rs > 5 else ("Negative" if mansfield_rs < -5 else "Flat")

    return {
        # Stage
        "weinstein_stage":      weinstein_stage,
        # Weinstein indicators → repurposed DB columns
        "above_50sma":          price_above_ma30w,       # Price > MA_30W
        "sma50_above_ema150":   bool(ma30w_slope >= 0),  # MA slope flat/up
        "ema150_above_sma200":  price_above_ema10w,      # Price > EMA_10W
        "above_200sma":         price_above_resistance,   # Price > resistance ceiling
        "sma200_slope":         round(ma30w_slope, 6),   # MA_30W_slope value
        "ema150_distance_pct":  ma30w_dist_pct,          # Distance from MA_30W
        "ema150_slope":         0.0,
        "base_20d_distance_pct": ma30w_dist_pct,
        # Duration / position
        "days_in_stage2":       weeks_above_ma30w,       # weeks above MA_30W
        "price_52w_position":   price_52w_pos,
        "base_width_weeks":     weeks_above_ma30w,
        # Volume
        "vol_5d_vs_50d_ratio":  vol_ratio_weekly,        # weekly vol ratio
        "volume_multiplier":    vol_ratio_weekly,
        # RS
        "rs_63d_score":         mansfield_rs,            # Mansfield RS
        "rs_52w_raw":           rs_52w_raw,
        "rs_trend":             rs_trend,
        # Minervini radar (filled by compute_minervini_radar later)
        "hl_depth_20d":         None,
        "vcp_volume_ratio":     1.0,
        "pivot_proximity_pct":  None,
        "rs_line_new_high":     False,
        # Legacy VCP (not used in v4.0)
        "vcp_adr_ratio":        None,
        "vcp_score":            0,
        "adr_pct":              0.0,
        # Reference
        "close":                last_close,
        "resistance_ceiling":   resistance_ceiling,
    }


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
                        out["eps_is_accelerating"] = accel >= 1
    except Exception:
        pass
    return out


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
            .select("ticker,signal_date,stage2_score,lifecycle_state,entry_date,stage2_subtype,is_reentry") \
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


def get_base_counts() -> dict[str, int]:
    try:
        resp = sb.table("stage2_signals").select("ticker").eq("is_reentry", True).execute()
        counts: dict[str, int] = {}
        for row in (resp.data or []):
            t = row["ticker"]
            counts[t] = counts.get(t, 0) + 1
        return counts
    except Exception as e:
        print(f"[base_counts] {e}")
        return {}


def write_transition(
    ticker: str,
    from_sub: str | None, to_sub: str | None,
    from_lc:  str | None, to_lc:  str | None,
    price: float,
) -> None:
    if from_sub == to_sub and from_lc == to_lc:
        return
    try:
        sb.table("stage2_transitions").insert({
            "ticker":              ticker,
            "from_subtype":        from_sub,
            "to_subtype":          to_sub,
            "from_lifecycle":      from_lc,
            "to_lifecycle":        to_lc,
            "transition_date":     TODAY,
            "price_at_transition": price,
        }).execute()
    except Exception as e:
        print(f"  [transition] {ticker}: {e}")


# ── Lifecycle from stage ───────────────────────────────────────────────────────
def lifecycle_from_stage(
    stage: str,
    weeks_above_ma30w: int,
    prev_stage: str | None,
    prev_score_5d: int | None,
) -> str:
    if stage == "EARLY_STAGE_2":
        return "CONFIRMED"
    if stage == "LATE_STAGE_2":
        if weeks_above_ma30w >= 30:
            return "SUSTAINED"
        if prev_stage == "EARLY_STAGE_2":
            return "CONFIRMED"   # just entered late — still fresh
        return "EMERGING"
    if stage == "STAGE_1_BASING":
        if prev_stage in ("EARLY_STAGE_2", "LATE_STAGE_2"):
            return "WEAKENING"
        return "WATCHING"
    if stage == "STAGE_3_TOPPING":
        return "WEAKENING"
    return "EXITED"


# ── DB upsert ─────────────────────────────────────────────────────────────────
def upsert_signal(
    ticker: str, metrics: dict, score: int,
    tier: str, lifecycle: str,
    company_name: str | None, sector: str | None,
    is_pead: bool,
    score_3d_delta: int | None, score_trend: str,
    entry_date_val: str, is_reentry: bool, reentry_gap: int | None,
    rs_52w_percentile: int | None,
    base_count: int = 1,
    signal_date_override: str | None = None,
) -> str | None:
    sig_date = signal_date_override or TODAY
    stage = metrics.get("weinstein_stage", "LATE_STAGE_2")

    row = {
        "ticker":                    ticker,
        "company_name":              company_name,
        "sector":                    sector,
        "signal_date":               sig_date,
        "stage2_score":              score,
        # Weinstein conditions (repurposed columns)
        "above_50sma":               metrics.get("above_50sma", False),
        "sma50_above_ema150":        metrics.get("sma50_above_ema150", False),
        "ema150_above_sma200":       metrics.get("ema150_above_sma200", False),
        "above_200sma":              metrics.get("above_200sma", False),
        "sma200_slope":              metrics.get("sma200_slope"),
        "stage2_subtype":            stage,
        "days_in_stage2":            metrics.get("days_in_stage2"),
        "ema150_distance_pct":       metrics.get("ema150_distance_pct"),
        "ema150_slope":              metrics.get("ema150_slope"),
        "base_20d_distance_pct":     metrics.get("base_20d_distance_pct"),
        # Minervini radar (stored in legacy VCP/vol columns)
        "hl_depth_20d":              metrics.get("hl_depth_20d"),
        "vol_5d_vs_50d_ratio":       metrics.get("vol_5d_vs_50d_ratio"),
        "pivot_proximity_pct":       metrics.get("pivot_proximity_pct"),
        # RS
        "rs_trend":                  metrics.get("rs_trend"),
        "rs_63d_score":              metrics.get("rs_63d_score"),
        "rs_52w_percentile":         rs_52w_percentile,
        "rs_line_new_high":          metrics.get("rs_line_new_high", False),
        # v3.1 kept fields
        "adr_pct":                   metrics.get("adr_pct"),
        "price_52w_position":        metrics.get("price_52w_position"),
        "base_width_weeks":          metrics.get("base_width_weeks"),
        "base_count":                base_count,
        "is_active":                 True,
        # Legacy VCP
        "vcp_volume_ratio":          metrics.get("vcp_volume_ratio"),
        "vcp_adr_ratio":             metrics.get("vcp_adr_ratio"),
        "vcp_score":                 metrics.get("vcp_score", 0),
        # Volume
        "volume_multiplier":         metrics.get("volume_multiplier"),
        "breakout_volume_ratio":     metrics.get("vol_5d_vs_50d_ratio"),
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
        "score_3d_delta":            score_3d_delta,
        "score_trend":               score_trend,
        # Flags
        "is_pead_confluence":        is_pead,
        "is_smart_money_divergence": False,
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
def send_telegram(early_s2: list, late_s2: list, stage1: list) -> None:
    if not TG_TOKEN or not TG_CHAT_ID:
        return
    lines = [
        f"Stage 2 Engine v4.0 — Pure Weinstein — {dt.now().strftime('%d %b %Y')}",
        f"Primary: Weekly OHLCV | Minervini: Radar only",
    ]
    if early_s2:
        lines.append(f"\n🟢 EARLY STAGE 2 (Prime Buy) — {len(early_s2)} stocks")
        for s in sorted(early_s2, key=lambda x: x["rs"], reverse=True)[:8]:
            lines.append(
                f"  {s['ticker']} | RS={s['rs']:+.0f} | Vol={s['vol']:.1f}x | Wks={s['wks']}"
            )
    if late_s2:
        lines.append(f"\n🔵 LATE STAGE 2 (Hold/Add) — {len(late_s2)} stocks (top 5):")
        for s in sorted(late_s2, key=lambda x: x["wks"], reverse=True)[:5]:
            lines.append(f"  {s['ticker']} | {s['wks']}wks | RS={s['rs']:+.0f}")
    if stage1:
        lines.append(f"\n⚪ STAGE 1 BASING (Watchlist) — {len(stage1)} stocks")
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
    print(f"=== Stage 2 Engine v4.0 — Pure Weinstein — {TODAY} ===")
    print("Primary: Weekly OHLCV | Minervini: Radar badges only")

    tickers = get_universe_tickers()
    print(f"[universe] {len(tickers)} tickers to scan")

    # Benchmark weekly data
    print(f"[benchmark] fetching {BENCHMARK} weekly...")
    bench_weekly = None
    try:
        bench_weekly = yf.Ticker(BENCHMARK).history(period="5y", interval="1wk", auto_adjust=True)
        time.sleep(1)
        print(f"[benchmark] {len(bench_weekly)} weekly candles")
    except Exception as e:
        print(f"[benchmark] {e}")

    pead_set    = get_pead_high_scorers()
    history     = get_recent_signal_history()
    base_counts = get_base_counts()
    print(f"[pead] {len(pead_set)} | [history] {len(history)} | [base_counts] {len(base_counts)}")

    # Pass 1: weekly analysis — classify stage for all tickers
    print("[pass1] weekly analysis...")
    results_map: dict[str, dict] = {}       # ticker → metrics
    rs_52w_raw_map: dict[str, float] = {}

    for i, ticker in enumerate(tickers, 1):
        ns = ticker if ticker.endswith(".NS") else ticker + ".NS"
        print(f"[{i}/{len(tickers)}] {ns}", end="  ")
        try:
            t_obj    = yf.Ticker(ns)
            wk_hist  = t_obj.history(period="5y", interval="1wk", auto_adjust=True)
            time.sleep(0.4)
        except Exception as e:
            print(f"-> dl_fail: {e}")
            continue

        metrics = analyse_weekly(wk_hist, bench_weekly)
        if metrics is None:
            print("-> skip (data/liquidity)")
            continue

        stage = metrics["weinstein_stage"]
        if stage not in STAGES_TO_STORE:
            print(f"-> {stage} (not stored)")
            continue

        results_map[ticker] = metrics
        rs_52w_raw_map[ticker] = metrics["rs_52w_raw"]
        print(
            f"-> {stage} | slope={metrics['sma200_slope']:+.4f} "
            f"vol={metrics['vol_5d_vs_50d_ratio']:.2f}x "
            f"RS={metrics['rs_63d_score']:+.1f} "
            f"wks={metrics['days_in_stage2']}"
        )

    print(f"\n[pass1] {len(results_map)} qualifying tickers")

    # Pass 2: daily fetch for Minervini radar + fundamentals + company info
    print("[pass2] daily radar + fundamentals...")
    for ticker, metrics in results_map.items():
        ns = ticker if ticker.endswith(".NS") else ticker + ".NS"
        try:
            t_obj    = yf.Ticker(ns)
            day_hist = t_obj.history(period="1y", interval="1d", auto_adjust=True)
            time.sleep(0.4)
            radar = compute_minervini_radar(day_hist)
            metrics.update(radar)
            fund  = get_fundamentals(t_obj)
            metrics.update(fund)
            info  = t_obj.info
            metrics["company_name"] = info.get("longName") or info.get("shortName")
            metrics["sector"]       = info.get("sector")
            time.sleep(0.3)
        except Exception as e:
            print(f"  [pass2] {ticker}: {e}")
            metrics["company_name"] = None
            metrics["sector"]       = None

    # 52W percentile ranking across qualifying stocks
    print(f"\n[percentile] ranking {len(rs_52w_raw_map)} tickers...")
    sorted_tk = sorted(rs_52w_raw_map, key=lambda t: rs_52w_raw_map[t])
    n         = len(sorted_tk)
    pct_map   = {tk: int(rank / n * 100) for rank, tk in enumerate(sorted_tk, 1)}

    # Pass 3: score → lifecycle → upsert
    print("[pass3] scoring and upserting...")
    early_list, late_list, stage1_list = [], [], []

    for ticker, metrics in results_map.items():
        stage      = metrics["weinstein_stage"]
        score      = compute_wcs(metrics, stage)   # real WCS 0-100
        tier       = STAGE_TIERS.get(stage, "WATCHING")
        rs_52w_pct = pct_map.get(ticker)
        metrics["rs_52w_percentile"] = rs_52w_pct

        # Lifecycle context from DB history
        ticker_hist  = history.get(ticker, [])
        prev_stage   = ticker_hist[-1].get("stage2_subtype") if ticker_hist else None
        prev_score_5d = None
        hist_5d = [h for h in ticker_hist
                   if h.get("signal_date") == (date.today() - timedelta(days=5)).isoformat()]
        if hist_5d:
            prev_score_5d = hist_5d[0]["stage2_score"]

        lifecycle = lifecycle_from_stage(
            stage, metrics["days_in_stage2"], prev_stage, prev_score_5d
        )

        # Score trend (vs 3 days ago)
        score_3d_delta, score_trend = None, "NEUTRAL"
        hist_3d = [h for h in ticker_hist
                   if h.get("signal_date") == (date.today() - timedelta(days=3)).isoformat()]
        if hist_3d:
            old = hist_3d[0]["stage2_score"]
            score_3d_delta = score - old
            if score_3d_delta >= 15:   score_trend = "STRENGTHENING"
            elif score_3d_delta <= -15: score_trend = "WEAKENING"

        # Entry date tracking
        earliest = min(
            (h.get("entry_date") or h.get("signal_date") for h in ticker_hist
             if h.get("entry_date") or h.get("signal_date")),
            default=None,
        )
        entry_date_val = earliest or TODAY

        # Re-entry detection
        last_states = [h.get("lifecycle_state") for h in ticker_hist]
        is_reentry  = "EXITED" in last_states and entry_date_val == TODAY
        reentry_gap = None
        if is_reentry:
            for h in reversed(ticker_hist):
                if h.get("lifecycle_state") == "EXITED":
                    reentry_gap = (date.today() - date.fromisoformat(h["signal_date"])).days
                    break

        # Transition log
        last_hist    = ticker_hist[-1] if ticker_hist else None
        prev_lc      = last_hist.get("lifecycle_state") if last_hist else None
        write_transition(ticker, prev_stage, stage, prev_lc, lifecycle, metrics["close"])

        is_pead = ticker in pead_set or (ticker + ".NS") in pead_set
        base_count_val = base_counts.get(ticker, 0) + 1

        upsert_signal(
            ticker, metrics, score, tier, lifecycle,
            metrics.get("company_name"), metrics.get("sector"),
            is_pead, score_3d_delta, score_trend,
            entry_date_val, is_reentry, reentry_gap,
            rs_52w_pct, base_count_val,
        )

        print(
            f"  {ticker}: {stage} [{tier}] {lifecycle} | "
            f"slope={metrics['sma200_slope']:+.4f} vol={metrics['vol_5d_vs_50d_ratio']:.2f}x "
            f"RS={metrics['rs_63d_score']:+.1f} wks={metrics['days_in_stage2']} "
            f"radar_stacked={metrics.get('rs_line_new_high', False)}"
        )

        d = {
            "ticker": ticker, "wks": metrics["days_in_stage2"],
            "vol": metrics["vol_5d_vs_50d_ratio"],
            "rs": metrics["rs_63d_score"],
        }
        if stage == "EARLY_STAGE_2":   early_list.append(d)
        elif stage == "LATE_STAGE_2":  late_list.append(d)
        else:                          stage1_list.append(d)

    print(
        f"\n[done] {len(results_map)} stored | "
        f"EARLY={len(early_list)} | LATE={len(late_list)} | STAGE1={len(stage1_list)}"
    )

    # Mark old signals inactive
    try:
        cutoff_90d = (date.today() - timedelta(days=90)).isoformat()
        sb.table("stage2_signals").update({"is_active": False}) \
          .gte("signal_date", cutoff_90d).neq("signal_date", TODAY).execute()
        sb.table("stage2_signals").update({"is_active": True}) \
          .eq("signal_date", TODAY).execute()
        print(f"[is_active] marked {len(results_map)} signals active for {TODAY}")
    except Exception as e:
        print(f"[is_active] {e}")

    send_telegram(early_list, late_list, stage1_list)


# ── Compat aliases for backfill script ────────────────────────────────────────
def compute_stage2_score(metrics: dict) -> tuple[int, dict]:
    """Compat shim: return WCS (or synthetic fallback) and empty components."""
    stage = metrics.get("weinstein_stage", "STAGE_4_DECLINING")
    score = compute_wcs(metrics, stage) or STAGE_SYNTHETIC_SCORES.get(stage, 0)
    return score, {"trend": 0, "fundamental": 0, "volatility": 0, "pivot": 0, "rs": 0}

def tier_from_score(score: int) -> str:
    if score >= 85: return "CONFIRMED"
    if score >= 70: return "EMERGING"
    return "NONE"

def get_stage2_subtype(sma50: float, sma200: float) -> str:
    return "LATE_STAGE_2"

def lifecycle_from_context(score, prev5d, days_confirmed, above_50sma, above_150ema):
    if not above_150ema: return "EXITED"
    if score >= 85: return "CONFIRMED"
    if score >= 70: return "EMERGING"
    return "WATCHING"

RS_PERIOD  = 63
EMA_PERIOD = 150
VOL_SMA    = 20


if __name__ == "__main__":
    main()

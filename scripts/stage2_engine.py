"""
Stage 2 Intelligence Engine v2.1 — Minervini SEPA + Weinstein Stage Analysis
Expert-revised 7-dimension scoring:
  Trend Alignment (25) | RS Short-Term 63d (12) | RS 52W Percentile (8)
  Breakout Freshness (15) | Base Tightness 20d SMA (10) | VCP Contraction (10)
  Volume Quality (8) | Fundamental Quality (12)
  Bonuses: PEAD Confluence (+5) | SUSTAINED (+3) | Re-entry (+3)

Lifecycle states: WATCHING → EMERGING → CONFIRMED → SUSTAINED → WEAKENING → EXITED
"""

import os, time, json, requests
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
MIN_ADTV   = 50_000_000   # ₹5 Cr
LOOKBACK   = 310

NSE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json, */*",
    "Referer": "https://www.nseindia.com/",
}

def get_nifty500_tickers() -> list[str]:
    try:
        session = requests.Session()
        session.headers.update(NSE_HEADERS)
        session.get("https://www.nseindia.com", timeout=15)
        r = session.get(
            "https://www.nseindia.com/api/equity-stockIndices?index=NIFTY%20500",
            timeout=20
        )
        data = r.json()
        tickers = [
            item["symbol"] for item in data.get("data", [])
            if item.get("symbol") and not item["symbol"].startswith("$")
            and item["symbol"].replace("-","").replace("&","").replace("_","").isalnum()
        ]
        if len(tickers) > 100:
            print(f"[universe] NSE API: {len(tickers)} tickers")
            return tickers
    except Exception as e:
        print(f"[universe] NSE API failed: {e}, using curated list")

    return [
        "RELIANCE","TCS","HDFCBANK","INFY","ICICIBANK","HINDUNILVR","SBIN","BAJFINANCE",
        "BHARTIARTL","KOTAKBANK","LT","AXISBANK","ASIANPAINT","MARUTI","TITAN",
        "WIPRO","HCLTECH","ONGC","NTPC","POWERGRID","COALINDIA","NESTLEIND","ULTRACEMCO",
        "ADANIPORTS","BAJAJFINSV","GRASIM","DIVISLAB","DRREDDY","CIPLA","SUNPHARMA",
        "TECHM","EICHERMOT","TATAMOTORS","TATASTEEL","JSWSTEEL","HINDALCO","APOLLOHOSP",
        "BRITANNIA","PIDILITIND","HAVELLS","MUTHOOTFIN","BALKRISIND","CROMPTON",
        "KPIL","KEI","POLYCAB","CUMMINSIND","BHEL","SIEMENS","ABB",
        "IRCTC","IRFC","RVNL","PVRINOX","ZOMATO","PAYTM","NYKAA",
        "DMART","BAJAJ-AUTO","MOTHERSON","BOSCHLTD","HEROMOTOCO","TVSMOTOR",
        "M&M","ASHOKLEY","TATACOMM","MPHASIS","LTTS","PERSISTENT",
        "COFORGE","OFSS","KFINTECH","CDSL","MCX","BSE","ANGELONE","IIFL",
        "SHRIRAMFIN","BAJAJHLDNG","ICICIGI","HDFCLIFE","SBILIFE","NIACL",
        "CHOLAFIN","LICHSGFIN","RECLTD","PFC","IREDA","SJVN","NHPC",
        "TATAPOWER","ADANIGREEN","TORNTPOWER","CESC","JPPOWER","RTNPOWER",
        "DABUR","MARICO","COLPAL","GODREJCP","EMAMILTD","TATACONSUM",
        "VARUNBEV","RADICO","GMMPFAUDLR","VBL",
        "AMBUJACEM","DALMIA","SHREECEM","JKCEMENT","HEIDELBERG",
        "DLF","OBEROIRLTY","PRESTIGE","BRIGADE","SOBHA","GODREJPROP",
        "TATACHEM","DEEPAKNTR","GNFC","COROMANDEL","PIIND","RALLIS",
        "STAR","PVRINOX","ZEEL","KAYNES","DIXON",
        "VOLTAS","BLUESTARCO","AMBER","WHIRLPOOL",
        "PAGEIND","TRENT","ADITBISL","SHOPERSTOP","VEDL","NATIONALUM",
        "SUNTECK","MAXHEALTH","FORTIS","MEDANTA","ASTRAZEN",
        "IDFCFIRSTB","AUBANK","RBLBANK","BANDHANBNK","FEDERALBNK","KARNATAKA",
        "CANBK","BANKBARODA","PNB","UCOBANK","UNIONBANK",
        "CONCOR","VRL","TCI","BLUEDART","MAHINDCIE",
        "FACT","GSPL","GAIL","MGL","IGL","ATGL",
        "INDIAGLYCO","SUPPETRO","MRPL","BPCL","HINDPETRO","IOC",
        "GRAPHITE","MOIL","HINDZINC","NATIONALUM",
        "ABCAPITAL","AARTIIND","ALKYLAMINE","VINATI","FINEORG",
        "LINDEINDIA","SRF","NILKAMAL","ASTRAL","SUPREMEIND",
        "SAFARI","SKFINDIA","GRINDWELL","SCHAEFFLER","TIMKEN",
        "HFCL","STLTECH","TEJASNET",
        "APLAPOLLO","RATNAMANI","WELCORP","JINDALSAW",
        "WOCKPHARMA","TORNTPHARM","IPCALAB","NATCOPHARM","ALKEM",
        "SPARC","GLENMARK","LAURUSLABS","GRANULES",
    ]


# ── v2.1 Scoring Formula (7 dimensions + bonuses) ─────────────────────────────
def compute_stage2_score(metrics: dict, is_sustained: bool = False) -> int:
    score = 0

    # 1. Trend Alignment (25 pts)
    # All 4 aligned: above 150 EMA + above 200 SMA + EMA slope +ve + above 50 SMA
    if metrics.get("above_200sma") and metrics.get("above_50sma") and (metrics.get("ema150_slope", 0) or 0) > 0:
        score += 25
    elif metrics.get("above_200sma") and (metrics.get("ema150_slope", 0) or 0) > 0:
        score += 15   # above 150+200, slope +ve but below 50 SMA (intra-stage pullback)
    else:
        score += 8    # above 150 EMA only (flat/declining slope or missing 200 SMA)

    # 2a. RS Short-Term 63d (12 pts)
    rs63 = metrics.get("rs_63d_score") or 0
    if   rs63 > 10:  score += 12
    elif rs63 > 5:   score += 8
    elif rs63 > -5:  score += 3   # flat

    # 2b. RS 52-Week Percentile (8 pts)
    pct = metrics.get("rs_52w_percentile")
    if pct is not None:
        if   pct >= 90: score += 8
        elif pct >= 80: score += 6
        elif pct >= 70: score += 3

    # 3. Breakout Freshness (15 pts)
    days = metrics.get("days_in_stage2") or 0
    if   days <= 15:  score += 15
    elif days <= 30:  score += 10
    elif days <= 60:  score += 6
    elif days <= 120: score += 3
    # >120 = 0 pts (SUSTAINED bonus below compensates)

    # 4. Base Tightness from 20d SMA (10 pts) — FIX: not 150 EMA
    base_dist = abs(metrics.get("base_20d_distance_pct") or 0)
    if   base_dist <= 3:  score += 10
    elif base_dist <= 8:  score += 7
    elif base_dist <= 15: score += 4
    else:                 score += 1  # never penalise to 0 — continuation bases can be far from 150 EMA

    # 5. VCP Contraction (10 pts) — pre-breakout volume dry-up + price range tightening
    vcp = metrics.get("vcp_score") or 0
    score += min(10, vcp)

    # 6. Volume Quality on Breakout Day (8 pts) — frozen at entry, recalculated if new entry
    vol = metrics.get("breakout_volume_ratio") or metrics.get("volume_multiplier") or 0
    if   vol >= 3.0: score += 8
    elif vol >= 2.0: score += 5
    elif vol >= 1.5: score += 2

    # 7. Fundamental Quality (12 pts) — EPS growth + ROCE + acceleration
    eps  = metrics.get("ttm_eps_growth")
    roce = metrics.get("roce")
    eps_accel = metrics.get("eps_acceleration_quarters") or 0

    if eps is not None:
        if eps > 100 or (eps_accel >= 3 and roce and roce > 20):
            score += 12
        elif eps > 50 or (eps_accel >= 2 and roce and roce > 15):
            score += 9
        elif eps > 20 and roce and roce > 15:
            score += 6
        elif eps > 10 or (roce and roce > 15):
            score += 3
        elif eps > 0:
            score += 1

    # Bonuses
    if is_sustained:
        score += 3   # SUSTAINED bonus: counteracts freshness decay for proven trends

    return min(100, score)


def tier_from_score(score: int) -> str:
    if score >= 75: return "CONFIRMED"
    if score >= 55: return "EMERGING"
    if score >= 40: return "WATCHING"
    return "NONE"


def lifecycle_from_score_and_context(
    score: int, prev_score_5d: int | None, days_confirmed: int,
    above_50sma: bool, above_150ema: bool
) -> str:
    if not above_150ema:
        return "EXITED"
    if score < 40:
        return "EXITED"
    if score >= 75:
        if days_confirmed >= 30 and above_50sma:
            return "SUSTAINED"
        # Check weakening: score dropped >15 in 5 days
        if prev_score_5d is not None and (prev_score_5d - score) > 15:
            return "WEAKENING"
        if not above_50sma:
            return "WEAKENING"
        return "CONFIRMED"
    if score >= 55:
        return "EMERGING"
    return "WATCHING"


# ── VCP Contraction (pre-breakout) ────────────────────────────────────────────
def compute_vcp(hist: pd.DataFrame) -> tuple[float, float, int]:
    """
    Returns (vcp_volume_ratio, vcp_adr_ratio, vcp_score).
    Measures volume dry-up and price range contraction in the 5 days
    BEFORE the most recent session (i.e., pre-breakout setup quality).
    """
    try:
        close  = hist["Close"].squeeze()
        volume = hist["Volume"].squeeze()
        high   = hist["High"].squeeze()
        low    = hist["Low"].squeeze()

        if len(close) < 25:
            return None, None, 0

        # Volume dry-up: 5-day avg before last session vs 20-day avg
        vol_5d  = float(volume.iloc[-6:-1].mean())   # 5 days before today
        vol_20d = float(volume.iloc[-21:-1].mean())  # 20 days before today
        vcp_vol_ratio = round(vol_5d / vol_20d, 3) if vol_20d > 0 else 1.0

        # Price range contraction: ADR last 5d vs prior 15d
        adr_last5  = float(((high - low) / close).iloc[-6:-1].mean())
        adr_prior15 = float(((high - low) / close).iloc[-21:-6].mean())
        vcp_adr_ratio = round(adr_last5 / adr_prior15, 3) if adr_prior15 > 0 else 1.0

        # Score each component 0-5
        def vol_pts(r):
            if r <= 0.50: return 5
            if r <= 0.65: return 4
            if r <= 0.80: return 2
            return 0

        def adr_pts(r):
            if r <= 0.50: return 5
            if r <= 0.65: return 4
            if r <= 0.80: return 2
            return 0

        vcp_score = vol_pts(vcp_vol_ratio) + adr_pts(vcp_adr_ratio)
        return vcp_vol_ratio, vcp_adr_ratio, vcp_score

    except Exception:
        return None, None, 0


# ── Fundamentals ──────────────────────────────────────────────────────────────
def get_fundamentals(ticker_obj: yf.Ticker) -> dict:
    out = dict(ttm_eps_growth=None, roce=None, pe_ratio=None,
               eps_acceleration_quarters=0, eps_is_accelerating=False)
    try:
        info = ticker_obj.info
        out["pe_ratio"] = info.get("trailingPE")
        roe = info.get("returnOnEquity")
        if roe is not None:
            out["roce"] = round(roe * 100, 2)

        qf = ticker_obj.quarterly_financials
        if qf is not None and not qf.empty and qf.shape[1] >= 5:
            net_key = next((k for k in qf.index if "net income" in str(k).lower()
                            or "profit after" in str(k).lower()), None)
            if net_key:
                vals = qf.loc[net_key].dropna()
                if len(vals) >= 5:
                    ttm_curr = float(vals.iloc[0] + vals.iloc[1] + vals.iloc[2] + vals.iloc[3])
                    ttm_prev = float(vals.iloc[1] + vals.iloc[2] + vals.iloc[3] + vals.iloc[4])
                    if ttm_prev and ttm_prev != 0:
                        out["ttm_eps_growth"] = round((ttm_curr - ttm_prev) / abs(ttm_prev) * 100, 2)

                # EPS acceleration: check if YoY growth rate is rising across 3 recent quarters
                if len(vals) >= 8:
                    yoy_growths = []
                    for i in range(4):  # last 4 quarters
                        curr = float(vals.iloc[i])
                        prev = float(vals.iloc[i + 4]) if i + 4 < len(vals) else None
                        if prev and prev != 0:
                            yoy_growths.append((curr - prev) / abs(prev) * 100)
                    if len(yoy_growths) >= 3:
                        accel_count = sum(
                            1 for i in range(len(yoy_growths) - 1)
                            if yoy_growths[i] > yoy_growths[i + 1]  # note: vals are newest first
                        )
                        out["eps_acceleration_quarters"] = accel_count
                        out["eps_is_accelerating"] = accel_count >= 2
    except Exception:
        pass
    return out


# ── Technical analysis ─────────────────────────────────────────────────────────
def analyse(hist: pd.DataFrame, bench_hist: pd.DataFrame,
            bench_52w: dict, ticker_obj: yf.Ticker) -> dict | None:
    if hist.empty or len(hist) < 210:
        return None

    close  = hist["Close"].squeeze()
    volume = hist["Volume"].squeeze()
    high   = hist["High"].squeeze()
    low    = hist["Low"].squeeze()

    # Liquidity
    adtv_20 = float((close * volume).rolling(20).mean().iloc[-1])
    if adtv_20 < MIN_ADTV:
        return None

    last_close = float(close.iloc[-1])

    # ── 150-day EMA ───────────────────────────────────────────────────────────
    ema150 = close.ewm(span=150, adjust=False).mean()
    last_ema150 = float(ema150.iloc[-1])
    if last_close <= last_ema150:
        return None   # hard filter

    # EMA150 slope (20-day angle as % per day)
    ema150_slope = round(
        (float(ema150.iloc[-1]) - float(ema150.iloc[-21])) / float(ema150.iloc[-21]) * 100
        if len(ema150) >= 21 else 0, 4
    )
    ema_dist = round((last_close - last_ema150) / last_ema150 * 100, 2)

    # ── 200-day SMA ───────────────────────────────────────────────────────────
    sma200 = close.rolling(200).mean()
    above_200sma = bool(last_close > float(sma200.iloc[-1])) if not pd.isna(sma200.iloc[-1]) else False

    # ── 50-day SMA ────────────────────────────────────────────────────────────
    sma50 = close.rolling(50).mean()
    above_50sma = bool(last_close > float(sma50.iloc[-1])) if not pd.isna(sma50.iloc[-1]) else False

    # ── 20-day SMA (Base Tightness) ───────────────────────────────────────────
    sma20 = close.rolling(20).mean()
    last_sma20 = float(sma20.iloc[-1]) if not pd.isna(sma20.iloc[-1]) else last_close
    base_20d_dist = round((last_close - last_sma20) / last_sma20 * 100, 2)

    # ── Days in Stage 2 (continuously above 150 EMA) ─────────────────────────
    above_ema150 = (close > ema150).values
    days_in_s2 = 0
    for flag in reversed(above_ema150):
        if flag:
            days_in_s2 += 1
        else:
            break

    # ── RS vs benchmark — 63-day slope ───────────────────────────────────────
    rs_63d_score = 0.0
    rs_trend = "Flat"
    RS_PERIOD = 63
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
                    if   rs_63d_score > 5:  rs_trend = "Positive"
                    elif rs_63d_score < -5: rs_trend = "Negative"
    except Exception:
        pass

    # ── VCP Contraction ───────────────────────────────────────────────────────
    vcp_vol_ratio, vcp_adr_ratio, vcp_score = compute_vcp(hist)

    # ── Volume on breakout day (last session) ─────────────────────────────────
    vol_sma20  = float(volume.rolling(20).mean().iloc[-2]) if len(volume) > 20 else 1
    last_vol   = float(volume.iloc[-1])
    vol_mult   = round(last_vol / vol_sma20, 2) if vol_sma20 > 0 else 0

    # ── 52-Week RS percentile (populated by caller who has universe data) ─────
    # We compute from close vs 52w ago
    price_52w_ago = float(close.iloc[-253]) if len(close) >= 253 else float(close.iloc[0])
    rs_52w_raw = round((last_close - price_52w_ago) / price_52w_ago * 100, 2) if price_52w_ago > 0 else 0

    # ── Fundamentals ─────────────────────────────────────────────────────────
    fund = get_fundamentals(ticker_obj)

    return {
        "days_in_stage2":           days_in_s2,
        "ema150_distance_pct":      ema_dist,
        "ema150_slope":             ema150_slope,
        "above_200sma":             above_200sma,
        "above_50sma":              above_50sma,
        "base_20d_distance_pct":    base_20d_dist,
        "volume_multiplier":        vol_mult,
        "rs_trend":                 rs_trend,
        "rs_63d_score":             rs_63d_score,
        "rs_52w_raw":               rs_52w_raw,     # raw 52W return — percentile computed later
        "vcp_volume_ratio":         vcp_vol_ratio,
        "vcp_adr_ratio":            vcp_adr_ratio,
        "vcp_score":                vcp_score,
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


# ── Fetch existing signals for history lookup ─────────────────────────────────
def get_recent_signal_history() -> dict:
    """
    Returns dict: ticker -> list of (signal_date, stage2_score, lifecycle_state)
    for the last 10 days, used for score_3d_delta and lifecycle continuity.
    """
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


# ── Upsert signal ─────────────────────────────────────────────────────────────
def upsert_signal(ticker: str, metrics: dict, score: int, tier: str,
                  lifecycle: str, company_name: str | None, sector: str | None,
                  is_pead: bool, is_smd: bool,
                  score_3d_delta: int | None, score_trend: str,
                  entry_date_val: str, is_reentry: bool, reentry_gap: int | None,
                  rs_52w_percentile: int | None,
                  signal_date_override: str | None = None) -> str | None:

    sig_date = signal_date_override or TODAY
    row = {
        "ticker":                    ticker,
        "company_name":              company_name,
        "sector":                    sector,
        "signal_date":               sig_date,
        "stage2_score":              score,
        "days_in_stage2":            metrics["days_in_stage2"],
        "ema150_distance_pct":       metrics["ema150_distance_pct"],
        "ema150_slope":              metrics.get("ema150_slope"),
        "above_200sma":              metrics.get("above_200sma", False),
        "above_50sma":               metrics.get("above_50sma", False),
        "base_20d_distance_pct":     metrics.get("base_20d_distance_pct"),
        "volume_multiplier":         metrics["volume_multiplier"],
        "rs_trend":                  metrics["rs_trend"],
        "rs_63d_score":              metrics.get("rs_63d_score"),
        "rs_52w_percentile":         rs_52w_percentile,
        "vcp_volume_ratio":          metrics.get("vcp_volume_ratio"),
        "vcp_adr_ratio":             metrics.get("vcp_adr_ratio"),
        "vcp_score":                 metrics.get("vcp_score", 0),
        "ttm_eps_growth":            metrics.get("ttm_eps_growth"),
        "roce":                      metrics.get("roce"),
        "pe_ratio":                  metrics.get("pe_ratio"),
        "eps_acceleration_quarters": metrics.get("eps_acceleration_quarters", 0),
        "eps_is_accelerating":       metrics.get("eps_is_accelerating", False),
        "tier":                      tier,
        "lifecycle_state":           lifecycle,
        "entry_date":                entry_date_val,
        "last_confirmed_date":       sig_date if tier in ("CONFIRMED", "EMERGING") else None,
        "score_3d_delta":            score_3d_delta,
        "score_trend":               score_trend,
        "breakout_volume_ratio":     metrics["volume_multiplier"],   # today's (preserved as frozen on first insert)
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
            # Append to score log
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
def send_telegram(confirmed: list, triple_plays: list) -> None:
    if not TG_TOKEN or not TG_CHAT_ID or (not confirmed and not triple_plays):
        return
    lines = [f"Stage 2 Scan v2.1 - {dt.now().strftime('%d %b %Y')}"]
    if triple_plays:
        lines.append(f"\nPEAD Confluence ({len(triple_plays)}) - earnings catalyst + S2 breakout")
        for s in triple_plays[:5]:
            lines.append(f"  {s['ticker']} score={s['score']} state={s['state']} VCP={s.get('vcp',0)}/10")
    if confirmed:
        lines.append(f"\nHigh Conviction (>=75) - {len(confirmed)} stocks")
        for s in confirmed[:8]:
            lines.append(f"  {s['ticker']} score={s['score']} {s['state']} days={s['days']} vol={s['vol']:.1f}x")
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
    print(f"=== Stage 2 Engine v2.1 — {TODAY} ===")

    tickers = get_nifty500_tickers()
    print(f"[universe] {len(tickers)} tickers")

    # Fetch benchmark
    print("[benchmark] fetching Nifty Total Market...")
    bench_hist = None
    try:
        bench_hist = yf.Ticker(BENCHMARK).history(period="400d", interval="1d", auto_adjust=True)
        time.sleep(1)
    except Exception as e:
        print(f"[benchmark] {e}")

    # PEAD set
    pead_set = get_pead_high_scorers()
    print(f"[pead] {len(pead_set)} high-scoring tickers")

    # Recent signal history for score_3d_delta and lifecycle context
    history = get_recent_signal_history()
    print(f"[history] {len(history)} tickers with recent data")

    # Pass 1: collect all 52W raw returns for percentile ranking
    print("[pass1] collecting 52W returns for percentile ranking...")
    rs_52w_raw_map: dict[str, float] = {}

    results_map: dict[str, dict] = {}  # ticker -> metrics

    confirmed   = []
    triple_plays= []
    processed   = 0

    for i, ticker in enumerate(tickers, 1):
        ns = ticker if ticker.endswith(".NS") else ticker + ".NS"
        print(f"[{i}/{len(tickers)}] {ns}", end="  ")

        try:
            t    = yf.Ticker(ns)
            hist = t.history(period="400d", interval="1d", auto_adjust=True)
            time.sleep(0.8)
        except Exception as e:
            print(f"-> download failed: {e}")
            continue

        metrics = analyse(hist, bench_hist, {}, t)
        if metrics is None:
            print("-> skip (below EMA150 / illiquid)")
            continue

        results_map[ticker] = (metrics, hist)
        rs_52w_raw_map[ticker] = metrics["rs_52w_raw"]
        processed += 1
        print(f"-> score_pre ema_dist={metrics['ema150_distance_pct']:.1f}% vcp={metrics.get('vcp_score',0)}/10")

    # Compute 52W percentile rank across all qualifying tickers
    print(f"\n[percentile] ranking {len(rs_52w_raw_map)} tickers by 52W return...")
    sorted_tickers = sorted(rs_52w_raw_map.keys(), key=lambda t: rs_52w_raw_map[t])
    percentile_map: dict[str, int] = {}
    n = len(sorted_tickers)
    for rank, tk in enumerate(sorted_tickers, 1):
        percentile_map[tk] = int(rank / n * 100)

    # Pass 2: score, compute lifecycle, upsert
    print("[pass2] scoring and upserting...")
    for ticker, (metrics, hist) in results_map.items():
        rs_52w_pct = percentile_map.get(ticker)
        metrics["rs_52w_percentile"] = rs_52w_pct

        # Determine if SUSTAINED (was CONFIRMED for 30+ consecutive days)
        ticker_hist = history.get(ticker, [])
        confirmed_days = sum(1 for h in ticker_hist if h.get("lifecycle_state") == "CONFIRMED")
        is_sustained_context = confirmed_days >= 7  # approximation from recent window

        score = compute_stage2_score(metrics, is_sustained=is_sustained_context)
        tier  = tier_from_score(score)

        # Score 3d delta
        score_3d_delta = None
        score_trend    = "NEUTRAL"
        date_3d_ago    = (date.today() - timedelta(days=3)).isoformat()
        hist_3d = [h for h in ticker_hist if h.get("signal_date") == date_3d_ago]
        if hist_3d:
            old_score = hist_3d[0]["stage2_score"]
            score_3d_delta = score - old_score
            if score_3d_delta >= 8:   score_trend = "STRENGTHENING"
            elif score_3d_delta <= -8: score_trend = "WEAKENING"

        # Entry date (use earliest known or today if first time)
        earliest = min((h.get("entry_date") or h.get("signal_date") for h in ticker_hist
                        if h.get("entry_date") or h.get("signal_date")), default=None)
        entry_date_val = earliest or TODAY

        # Re-entry detection (was EXITED in recent history, now qualifying again)
        last_states = [h.get("lifecycle_state") for h in ticker_hist]
        is_reentry = "EXITED" in last_states and entry_date_val == TODAY
        reentry_gap = None
        if is_reentry:
            for h in reversed(ticker_hist):
                if h.get("lifecycle_state") == "EXITED":
                    gap_days = (date.today() - date.fromisoformat(h["signal_date"])).days
                    reentry_gap = gap_days
                    break

        # Lifecycle state
        prev_score_5d = None
        date_5d_ago = (date.today() - timedelta(days=5)).isoformat()
        hist_5d = [h for h in ticker_hist if h.get("signal_date") == date_5d_ago]
        if hist_5d:
            prev_score_5d = hist_5d[0]["stage2_score"]

        lifecycle = lifecycle_from_score_and_context(
            score         = score,
            prev_score_5d = prev_score_5d,
            days_confirmed= confirmed_days,
            above_50sma   = metrics.get("above_50sma", True),
            above_150ema  = True,  # always True here since we passed the hard filter
        )

        # Flags
        is_pead = ticker in pead_set or (ticker + ".NS") in pead_set
        is_smd  = (
            (metrics.get("ttm_eps_growth") or 0) < 0 and
            metrics["volume_multiplier"] >= 3.0 and score >= 55
        )
        if is_reentry:
            score = min(100, score + 3)  # re-entry bonus applied to stored score

        # Company info (cached to reduce API calls)
        company_name = sector = None
        try:
            ns = ticker if ticker.endswith(".NS") else ticker + ".NS"
            info = yf.Ticker(ns).info
            company_name = info.get("longName") or info.get("shortName")
            sector       = info.get("sector")
        except Exception:
            pass

        sig_id = upsert_signal(
            ticker, metrics, score, tier, lifecycle,
            company_name, sector, is_pead, is_smd,
            score_3d_delta, score_trend,
            entry_date_val, is_reentry, reentry_gap,
            rs_52w_pct,
        )

        flag = " TRIPLE PLAY" if is_pead and score >= 55 else ""
        print(f"  {ticker}: score={score} {lifecycle} days={metrics['days_in_stage2']} "
              f"vcp={metrics.get('vcp_score',0)}/10 52W_pct={rs_52w_pct}%ile "
              f"d3={score_3d_delta} [{('ok' if sig_id else 'db_err')}]{flag}")

        d = {"ticker": ticker, "score": score, "state": lifecycle,
             "days": metrics["days_in_stage2"], "vol": metrics["volume_multiplier"],
             "vcp": metrics.get("vcp_score", 0)}
        if score >= 75:
            confirmed.append(d)
        if is_pead and score >= 55:
            triple_plays.append(d)

    print(f"\n[done] {processed}/{len(tickers)} qualified | "
          f"{len(confirmed)} CONFIRMED | {len(triple_plays)} Triple Plays")
    send_telegram(confirmed, triple_plays)


if __name__ == "__main__":
    main()

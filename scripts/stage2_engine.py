"""
Stage 2 Intelligence Engine — daily scan of liquid NSE equities for early-stage
Weinstein / Minervini / SOIC structural breakouts.

Quantitative score 0-100 across 5 factors:
  Freshness (25) | Base Proximity (20) | Volume Signature (20)
  RS vs Nifty500 (15) | SOIC Fundamentals (20)

Tiers: CONFIRMED ≥ 75 | EMERGING 55-74 | NONE < 55
Runs: daily after market close via GitHub Actions.
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
BENCHMARK     = "^CRSLDX"    # Nifty Total Market TRI
EMA_PERIOD    = 150
VOL_SMA       = 20
RS_PERIOD     = 63           # ~3 months
MIN_ADTV      = 50_000_000   # ₹5 Cr daily traded value minimum
LOOKBACK      = 260          # trading days of history to fetch

# ── Nifty 500 Stock Universe ───────────────────────────────────────────────────
NSE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json, */*",
    "Referer": "https://www.nseindia.com/",
}

def get_nifty500_tickers() -> list[str]:
    """Fetch Nifty 500 index constituents from NSE. Falls back to curated list."""
    try:
        session = requests.Session()
        session.headers.update(NSE_HEADERS)
        session.get("https://www.nseindia.com", timeout=15)
        r = session.get(
            "https://www.nseindia.com/api/equity-stockIndices?index=NIFTY%20500",
            timeout=20
        )
        data = r.json()
        tickers = [item["symbol"] for item in data.get("data", []) if item.get("symbol")]
        if len(tickers) > 100:
            print(f"[universe] NSE API: {len(tickers)} Nifty 500 constituents")
            return tickers
    except Exception as e:
        print(f"[universe] NSE API failed: {e}, using curated list")

    # Curated list — top liquid NSE stocks across sectors
    return [
        "RELIANCE","TCS","HDFCBANK","INFY","ICICIBANK","HINDUNILVR","SBIN","BAJFINANCE",
        "BHARTIARTL","KOTAKBANK","LT","AXISBANK","ASIANPAINT","MARUTI","TITAN",
        "WIPRO","HCLTECH","ONGC","NTPC","POWERGRID","COALINDIA","NESTLEIND","ULTRACEMCO",
        "ADANIPORTS","BAJAJFINSV","GRASIM","DIVISLAB","DRREDDY","CIPLA","SUNPHARMA",
        "TECHM","EICHERMOT","TATAMOTORS","TATASTEEL","JSWSTEEL","HINDALCO","APOLLOHOSP",
        "BRITANNIA","PIDILITIND","HAVELLS","MUTHOOTFIN","BALKRISIND","CROMPTON",
        "KPIL","KEI","POLYCAB","CUMMINSIND","BHEL","SIEMENS","ABB",
        "IRCTC","IRFC","RVNL","PVRINOX","ZOMATO","PAYTM","NYKAA",
        "DMART","BAJAJ-AUTO","MOTHERSON","BOSCHLTD","HEROMOTOCO","TVSMOTORS",
        "TVSMOTOR","M&M","ASHOKLEY","TATACOMM","MPHASIS","LTTS","PERSISTENT",
        "COFORGE","OFSS","KFINTECH","CDSL","MCX","BSE","ANGELONE","IIFL",
        "SHRIRAMFIN","BAJAJHLDNG","ICICIGI","HDFCLIFE","SBILIFE","NIACL",
        "CHOLAFIN","LICHSGFIN","RECLTD","PFC","IREDA","SJVN","NHPC",
        "TATAPOWER","ADANIGREEN","TORNTPOWER","CESC","JPPOWER","RTNPOWER",
        "DABUR","MARICO","COLPAL","GODREJCP","EMAMILTD","TATACONSUM",
        "VARUNBEV","RADICO","GMMPFAUDLR","VBL",
        "AMBUJACEM","DALMIA","SHREECEM","JKCEMENT","HEIDELBERG",
        "DLF","OBEROIRLTY","PRESTIGE","BRIGADE","SOBHA","GODREJPROP",
        "TATACHEM","DEEPAKNTR","GNFC","COROMANDEL","PIIND","RALLIS",
        "STAR","PVR","ZEEL","SUNTVNETWORK","INOXGREEN","KAYNES","DIXON",
        "VOLTAS","BLUESTARCO","AMBER","WHIRLPOOL",
        "PAGEIND","TRENT","ADITBISL","SHOPERSTOP","VEDL","NATIONALUM",
        "SUNTECK","MAXHEALTH","FORTIS","MEDANTA","ASTRAZEN",
        "IDFCFIRSTB","AUBANK","RBLBANK","BANDHANBNK","FEDERALBNK","KARNATAKA",
        "CANBK","BANKBARODA","PNB","UCOBANK","UNIONBANK",
        "CONCOR","VRL","TCI","BLUEDART","MAHINDCIE",
        "FACT","GSPL","GAIL","MGL","IGL","ATGL",
        "INDIAGLYCO","SUPPETRO","MRPL","BPCL","HINDPETRO","IOC",
        "GRAPHITE","MOIL","HINDZINC","VEDL","NALCO",
        "ABCAPITAL","AARTIIND","ALKYLAMINE","VINATI","FINEORG",
        "LINDEINDIA","SRF","NILKAMAL","ASTRAL","SUPREMEIND",
        "SAFARI","SKFINDIA","GRINDWELL","SCHAEFFLER","TIMKEN","NRB",
        "HFCL","STLTECH","KICL","JYOTISTRUC","RAILTEL","TEJASNET",
        "APLAPOLLO","RATNAMANI","WELCORP","JINDALSAW","ISMT",
        "WOCKPHARMA","TORNTPHARM","IPCALAB","NATCOPHARM","ALKEM",
        "SPARC","GLENMARK","LAURUSLABS","GRANULES","SEQUENT",
    ]


# ── Scoring ────────────────────────────────────────────────────────────────────
def compute_stage2_score(days_in_s2, ema_dist, vol_mult, rs_trend, eps_growth, roce):
    score = 0

    # 1. Freshness (25 pts)
    if days_in_s2 is not None:
        if   days_in_s2 < 15: score += 25
        elif days_in_s2 < 30: score += 15
        elif days_in_s2 < 45: score += 10

    # 2. Base Proximity (20 pts) — tighter to 150 EMA = fresher breakout
    if ema_dist is not None and ema_dist >= 0:
        if   ema_dist <= 10: score += 20
        elif ema_dist <= 15: score += 10

    # 3. Volume Signature (20 pts)
    if vol_mult is not None:
        if   vol_mult >= 3.0: score += 20
        elif vol_mult >= 2.0: score += 10

    # 4. RS vs Nifty 500 (15 pts)
    if rs_trend == "Positive": score += 15
    elif rs_trend == "Flat":   score +=  5

    # 5. SOIC Fundamental Anchor (20 pts)
    if eps_growth is not None and roce is not None:
        if   eps_growth > 20 and roce > 15: score += 20
        elif eps_growth > 10:                score += 10
    elif eps_growth is not None and eps_growth > 20:
        score += 10  # partial credit if ROCE not available

    return min(100, score)


def tier_from_score(score: int) -> str:
    if score >= 75: return "CONFIRMED"
    if score >= 55: return "EMERGING"
    return "NONE"


# ── Fundamentals via yfinance ─────────────────────────────────────────────────
def get_fundamentals(ticker_obj: yf.Ticker) -> dict:
    """Returns ttm_eps_growth (%) and roce (%) via yfinance data."""
    out = dict(ttm_eps_growth=None, roce=None)
    try:
        info = ticker_obj.info
        # ROCE approximation from yfinance
        roe  = info.get("returnOnEquity")
        if roe is not None:
            out["roce"] = round(roe * 100, 2)

        # TTM EPS growth from quarterly financials
        qf = ticker_obj.quarterly_financials
        if qf is not None and not qf.empty and qf.shape[1] >= 5:
            net_key = next((k for k in qf.index if "net income" in str(k).lower() or "profit after" in str(k).lower()), None)
            if net_key:
                vals = qf.loc[net_key].dropna()
                if len(vals) >= 5:
                    ttm_curr = float(vals.iloc[0] + vals.iloc[1] + vals.iloc[2] + vals.iloc[3])
                    ttm_prev = float(vals.iloc[1] + vals.iloc[2] + vals.iloc[3] + vals.iloc[4])
                    if ttm_prev and ttm_prev != 0:
                        out["ttm_eps_growth"] = round((ttm_curr - ttm_prev) / abs(ttm_prev) * 100, 2)
    except Exception:
        pass
    return out


# ── Technical analysis ─────────────────────────────────────────────────────────
def analyse(hist: pd.DataFrame, bench_hist: pd.DataFrame, ticker_obj: yf.Ticker) -> dict | None:
    """
    Returns a dict of all stage2 metrics, or None if stock doesn't qualify
    (below 150 EMA or fails liquidity filter).
    """
    if hist.empty or len(hist) < EMA_PERIOD + 10:
        return None

    close  = hist["Close"].squeeze()
    volume = hist["Volume"].squeeze()
    high   = hist["High"].squeeze()
    low    = hist["Low"].squeeze()

    # ── Liquidity filter ──────────────────────────────────────────────────────
    adtv_20 = float((close * volume).rolling(20).mean().iloc[-1])
    if adtv_20 < MIN_ADTV:
        return None

    # ── 150 EMA ───────────────────────────────────────────────────────────────
    ema150 = close.ewm(span=EMA_PERIOD, adjust=False).mean()
    last_close  = float(close.iloc[-1])
    last_ema150 = float(ema150.iloc[-1])

    # Must be above 150 EMA to be in Stage 2
    if last_close <= last_ema150:
        return None

    # ── Days in Stage 2 ───────────────────────────────────────────────────────
    above = (close > ema150).values
    days_in_s2 = 0
    for flag in reversed(above):
        if flag:
            days_in_s2 += 1
        else:
            break

    # ── Base proximity ────────────────────────────────────────────────────────
    ema_dist = round((last_close - last_ema150) / last_ema150 * 100, 2)

    # ── Volume signature ──────────────────────────────────────────────────────
    vol_sma20 = float(volume.rolling(VOL_SMA).mean().iloc[-2])
    last_vol  = float(volume.iloc[-1])
    vol_mult  = round(last_vol / vol_sma20, 2) if vol_sma20 > 0 else 0

    # ── Relative Strength vs benchmark ───────────────────────────────────────
    rs_trend = "Flat"
    try:
        if bench_hist is not None and not bench_hist.empty:
            bench_close = bench_hist["Close"].squeeze().reindex(close.index, method="ffill")
            if len(bench_close.dropna()) >= RS_PERIOD:
                rs_line = close / bench_close
                rs_slope = float(
                    np.polyfit(range(RS_PERIOD), rs_line.dropna().iloc[-RS_PERIOD:].values, 1)[0]
                )
                rs_median = float(rs_line.dropna().iloc[-RS_PERIOD:].median())
                threshold = abs(rs_median) * 0.0005
                if   rs_slope > threshold:  rs_trend = "Positive"
                elif rs_slope < -threshold: rs_trend = "Negative"
    except Exception:
        pass

    # ── Fundamentals ─────────────────────────────────────────────────────────
    fund = get_fundamentals(ticker_obj)

    return {
        "days_in_stage2":     days_in_s2,
        "ema150_distance_pct":ema_dist,
        "volume_multiplier":  vol_mult,
        "rs_trend":           rs_trend,
        "ttm_eps_growth":     fund["ttm_eps_growth"],
        "roce":               fund["roce"],
    }


# ── PEAD confluence check ─────────────────────────────────────────────────────
def get_pead_high_scorers() -> set[str]:
    """Returns set of tickers with pead_score >= 70 in last 30 days."""
    cutoff = (date.today() - timedelta(days=30)).isoformat()
    try:
        resp = sb.table("pead_signals") \
            .select("ticker") \
            .gte("signal_date", cutoff) \
            .gte("pead_score", 70) \
            .execute()
        return {row["ticker"] for row in (resp.data or [])}
    except Exception as e:
        print(f"[pead] query failed: {e}")
        return set()


# ── Supabase upsert ───────────────────────────────────────────────────────────
def upsert_signal(ticker: str, metrics: dict, score: int, tier: str,
                  company_name: str | None, sector: str | None,
                  is_pead: bool, is_smd: bool,
                  signal_date_override: str | None = None) -> str | None:
    row = {
        "ticker":                    ticker,
        "company_name":              company_name,
        "sector":                    sector,
        "signal_date":               signal_date_override or TODAY,
        "stage2_score":              score,
        "days_in_stage2":            metrics["days_in_stage2"],
        "ema150_distance_pct":       metrics["ema150_distance_pct"],
        "volume_multiplier":         metrics["volume_multiplier"],
        "rs_trend":                  metrics["rs_trend"],
        "ttm_eps_growth":            metrics["ttm_eps_growth"],
        "roce":                      metrics["roce"],
        "tier":                      tier,
        "is_pead_confluence":        is_pead,
        "is_smart_money_divergence": is_smd,
    }
    try:
        res = sb.table("stage2_signals").upsert(row, on_conflict="ticker,signal_date").execute()
        sig_id = res.data[0]["id"] if res.data else None
        if sig_id:
            sb.table("stage2_performance").upsert(
                {"signal_id": sig_id}, on_conflict="signal_id"
            ).execute()
        return sig_id
    except Exception as e:
        print(f"  [db] {ticker}: {e}")
        return None


# ── Telegram ───────────────────────────────────────────────────────────────────
def send_telegram(confirmed: list[dict], triple_plays: list[dict]) -> None:
    if not TG_TOKEN or not TG_CHAT_ID:
        return
    if not confirmed and not triple_plays:
        return
    lines = [f"📊 *Stage 2 Scan — {dt.now().strftime('%d %b %Y')}*"]
    if triple_plays:
        lines.append(f"\n🔥 *PEAD Confluence ({len(triple_plays)}) — earnings catalyst + S2 breakout*")
        for s in triple_plays[:5]:
            lines.append(f"  ⭐ *{s['ticker']}* score={s['score']} | {s['days']}d in S2 | +{s['ema_dist']:.1f}% above EMA150")
    if confirmed:
        lines.append(f"\n🟢 *High Conviction (≥75) — {len(confirmed)} stocks*")
        for s in confirmed[:8]:
            lines.append(f"  *{s['ticker']}* score={s['score']} | {s['days']}d | vol {s['vol']:.1f}x")
    try:
        requests.post(
            f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
            json={"chat_id": TG_CHAT_ID, "text": "\n".join(lines), "parse_mode": "Markdown"},
            timeout=10,
        )
        print("[telegram] sent")
    except Exception as e:
        print(f"[telegram] {e}")


# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    print(f"=== Stage 2 Engine — {TODAY} ===")

    tickers = get_nifty500_tickers()
    print(f"[universe] {len(tickers)} tickers to scan")

    # Fetch benchmark data once
    print("[benchmark] fetching Nifty Total Market...")
    try:
        bench_ticker = yf.Ticker(BENCHMARK)
        bench_hist   = bench_ticker.history(period="300d", interval="1d", auto_adjust=True)
        time.sleep(1)
    except Exception as e:
        print(f"[benchmark] failed: {e}")
        bench_hist = None

    # Get PEAD high scorers for confluence check
    pead_set = get_pead_high_scorers()
    print(f"[pead] {len(pead_set)} high-scoring PEAD tickers for confluence check")

    confirmed   = []
    triple_plays= []
    processed = 0

    for i, ticker in enumerate(tickers, 1):
        ns = ticker if ticker.endswith(".NS") else ticker + ".NS"
        print(f"[{i}/{len(tickers)}] {ns}", end="  ")

        try:
            t    = yf.Ticker(ns)
            hist = t.history(period="300d", interval="1d", auto_adjust=True)
            time.sleep(1)
        except Exception as e:
            print(f"→ download failed: {e}")
            continue

        metrics = analyse(hist, bench_hist, t)
        if metrics is None:
            print("→ skip (below EMA150 or illiquid)")
            continue

        score = compute_stage2_score(
            days_in_s2  = metrics["days_in_stage2"],
            ema_dist    = metrics["ema150_distance_pct"],
            vol_mult    = metrics["volume_multiplier"],
            rs_trend    = metrics["rs_trend"],
            eps_growth  = metrics["ttm_eps_growth"],
            roce        = metrics["roce"],
        )
        tier = tier_from_score(score)

        is_pead = ticker in pead_set or ns in pead_set
        is_smd  = (
            metrics["ttm_eps_growth"] is not None and metrics["ttm_eps_growth"] < 0 and
            metrics["volume_multiplier"] >= 3.0 and score >= 55
        )

        # Get company info
        try:
            info = t.info
            company_name = info.get("longName") or info.get("shortName")
            sector       = info.get("sector")
        except Exception:
            company_name = sector = None

        # Only store stocks scoring >= 55
        sig_id = None
        if score >= 55:
            sig_id = upsert_signal(ticker, metrics, score, tier, company_name, sector, is_pead, is_smd)

        flag = " 🔥TRIPLE PLAY" if is_pead and score >= 55 else ""
        stored = "✓" if sig_id else ("skip<55" if score < 55 else "✗db")
        print(f"→ score={score} tier={tier} days={metrics['days_in_stage2']} vol={metrics['volume_multiplier']:.1f}x [{stored}]{flag}")
        processed += 1

        d = {"ticker": ticker, "score": score, "days": metrics["days_in_stage2"],
             "ema_dist": metrics["ema150_distance_pct"], "vol": metrics["volume_multiplier"]}
        # Telegram: alert if score >= 75 OR pead_confluence
        if score >= 75:
            confirmed.append(d)
        if is_pead and score >= 55:
            triple_plays.append(d)

    print(f"\n[done] {processed}/{len(tickers)} qualified for Stage 2 | {len(confirmed)} CONFIRMED | {len(triple_plays)} Triple Plays")
    send_telegram(confirmed, triple_plays)


if __name__ == "__main__":
    main()

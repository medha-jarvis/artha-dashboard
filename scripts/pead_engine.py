"""
PEAD Engine v3 — scores every company reporting earnings today on 0-100 scale.
Stores all records to Supabase. Telegram alert only for score >= 70.

Data sources:
  - NSE Financial Results API  → today's earnings reporters (requires Indian IP)
  - yfinance quarterly_financials → YoY profit, revenue, OPM (works everywhere)
  - yfinance history             → EMA200, volume, day gap

StockScans.in was removed — it no longer serves the /results endpoint.

Runs: Mon-Fri 4:00 PM IST via VPS cron.
"""

import os, time, requests
from datetime import date, datetime, timedelta
import pandas as pd
import yfinance as yf
from supabase import create_client, Client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
TG_TOKEN     = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TG_CHAT_ID   = os.environ.get("TELEGRAM_CHAT_ID", "")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
TODAY    = date.today().isoformat()

EMA_PERIOD     = 200
VOL_SMA_PERIOD = 20

NSE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://www.nseindia.com/",
    "DNT": "1",
}


# ── Indian fiscal quarter helper ────────────────────────────────────────────────
def current_fy_quarter() -> tuple[str, str]:
    """Returns (fiscal_year, quarter) e.g. ('2026-27', 'Q1')."""
    today = date.today()
    fy_start = today.year if today.month >= 4 else today.year - 1
    fiscal_year = f"{fy_start}-{str(fy_start + 1)[-2:]}"
    m = today.month
    quarter = "Q1" if m in (4, 5, 6) else "Q2" if m in (7, 8, 9) else "Q3" if m in (10, 11, 12) else "Q4"
    return fiscal_year, quarter


# ── NSE results API ─────────────────────────────────────────────────────────────
def get_nse_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(NSE_HEADERS)
    try:
        session.get("https://www.nseindia.com", timeout=15)
        time.sleep(1)
    except Exception as e:
        print(f"[nse] session init: {e}")
    return session


def fetch_todays_reporters(session: requests.Session, target_date: str | None = None) -> list[dict]:
    """
    Fetch companies that reported earnings today using the NSE corporate-announcements API.
    Filters for 'Outcome of Board Meeting' announcements containing 'financial result'.
    This API updates in real-time unlike corporates-financial-results (which lags by days).
    """
    check_date = target_date or TODAY
    # NSE date format for query: DD-MM-YYYY
    try:
        dt = datetime.strptime(check_date, "%Y-%m-%d")
        nse_date = dt.strftime("%d-%m-%Y")
    except ValueError:
        nse_date = check_date

    url = (
        f"https://www.nseindia.com/api/corporate-announcements"
        f"?index=equities&from_date={nse_date}&to_date={nse_date}"
    )
    reporters = []
    try:
        r = session.get(url, timeout=20)
        items = r.json() if r.text else []
        if isinstance(items, dict):
            items = items.get("data", [])
        for item in items:
            desc = (item.get("desc") or "").strip()
            text = (item.get("attchmntText") or "").lower()
            if desc != "Outcome of Board Meeting":
                continue
            if "financial result" not in text:
                continue
            symbol = (item.get("symbol") or "").strip().upper()
            cname  = (item.get("sm_name") or symbol).strip()
            if symbol:
                reporters.append({"ticker": symbol, "company_name": cname})
        print(f"[nse] announcements API: {len(reporters)} result reporters on {check_date}")
    except Exception as e:
        print(f"[nse] announcements API error: {e}")

    # Deduplicate (same company can file standalone + consolidated)
    seen, unique = set(), []
    for r in reporters:
        if r["ticker"] not in seen:
            seen.add(r["ticker"])
            unique.append(r)

    print(f"[nse] {len(unique)} unique reporters today")
    return unique


# ── yfinance: quarterly fundamentals ───────────────────────────────────────────
def get_quarterly_fundamentals(ticker: str) -> dict:
    """YoY profit, revenue growth, OPM expansion from yfinance quarterly data."""
    ns = ticker if ticker.endswith(".NS") else ticker + ".NS"
    out = dict(yoy_profit=None, yoy_revenue=None, opm_bps=None, ttm_pe=None,
               company_name=None, sector=None)
    try:
        t  = yf.Ticker(ns)
        inf = t.info
        out["company_name"] = inf.get("longName") or inf.get("shortName")
        out["sector"]       = inf.get("sector")
        out["ttm_pe"]       = inf.get("trailingPE")

        qf = t.quarterly_financials
        if qf is None or qf.empty or qf.shape[1] < 5:
            return out
        cols = qf.columns.tolist()

        def safe(row_key, col_idx):
            try:
                matching = [k for k in qf.index if row_key.lower() in str(k).lower()]
                if not matching or col_idx >= len(cols):
                    return None
                v = qf.loc[matching[0], cols[col_idx]]
                return float(v) if v is not None and v == v else None
            except Exception:
                return None

        rev_c = safe("Total Revenue", 0)
        rev_p = safe("Total Revenue", 4)
        net_c = safe("Net Income",    0)
        net_p = safe("Net Income",    4)
        opi_c = safe("Operating",     0)
        opi_p = safe("Operating",     4)

        if rev_c and rev_p and rev_p != 0:
            out["yoy_revenue"] = round((rev_c - rev_p) / abs(rev_p) * 100, 2)
        if net_c and net_p and net_p != 0:
            out["yoy_profit"]  = round((net_c - net_p) / abs(net_p) * 100, 2)
        if opi_c and rev_c and opi_p and rev_p and rev_c != 0 and rev_p != 0:
            opm_c = opi_c / rev_c * 100
            opm_p = opi_p / rev_p * 100
            out["opm_bps"] = round((opm_c - opm_p) * 100, 1)
    except Exception as e:
        print(f"  [fund] {ns}: {e}")
    return out


# ── yfinance: price/volume technicals ──────────────────────────────────────────
def fetch_technicals(ticker: str) -> dict:
    ns = ticker if ticker.endswith(".NS") else ticker + ".NS"
    out = dict(price_vs_ema200_pct=None, vol_mult=None, day_gap_pct=None)
    try:
        t  = yf.Ticker(ns)
        df = t.history(period="250d", interval="1d", auto_adjust=True)
        if df.empty or len(df) < 22:
            return out
        close  = df["Close"]
        volume = df["Volume"]
        open_  = df["Open"]
        ema200   = float(close.ewm(span=EMA_PERIOD, adjust=False).mean().iloc[-1])
        vol_sma  = float(volume.rolling(VOL_SMA_PERIOD).mean().iloc[-2])
        last_c   = float(close.iloc[-1])
        last_o   = float(open_.iloc[-1])
        last_v   = float(volume.iloc[-1])
        out["price_vs_ema200_pct"] = round((last_c - ema200) / ema200 * 100, 2)
        out["vol_mult"]            = round(last_v / vol_sma, 2) if vol_sma > 0 else 0
        out["day_gap_pct"]         = round((last_c - last_o) / last_o * 100, 2) if last_o else 0
    except Exception as e:
        print(f"  [tech] {ns}: {e}")
    return out


# ── Scoring ─────────────────────────────────────────────────────────────────────
def compute_score(yoy_profit, yoy_revenue, opm_bps, price_vs_ema, vol_mult, day_gap) -> int:
    score = 0
    if yoy_profit is not None:
        if   yoy_profit > 100: score += 20
        elif yoy_profit >  50: score += 15
        elif yoy_profit >  30: score += 10
        elif yoy_profit >   0: score +=  5
    if yoy_revenue is not None:
        if   yoy_revenue > 25: score += 10
        elif yoy_revenue > 15: score +=  5
    if opm_bps is not None:
        if   opm_bps > 300: score += 15
        elif opm_bps > 200: score += 10
        elif opm_bps > 100: score +=  5
    if price_vs_ema is not None and price_vs_ema > 0:
        score += 20
    if vol_mult is not None:
        if   vol_mult > 5.0: score += 20
        elif vol_mult > 3.0: score += 15
        elif vol_mult > 2.0: score += 10
        elif vol_mult > 1.5: score +=  5
    if day_gap is not None:
        if   day_gap > 4.0: score += 15
        elif day_gap > 2.0: score +=  8
        elif day_gap > 0.0: score +=  3
    return min(100, score)


def path_from_score(score: int) -> str:
    if score >= 70: return 'A'
    if score >= 50: return 'WATCH'
    return 'NONE'


# ── Supabase upsert ─────────────────────────────────────────────────────────────
def upsert_signal(ticker, company_name, sector, signal_date, score, trigger_path,
                  yoy_profit, yoy_revenue, opm_bps, price_vs_ema, vol_mult,
                  day_gap, ttm_pe) -> str | None:
    row = {
        "ticker": ticker, "company_name": company_name, "sector": sector,
        "signal_date": signal_date, "pead_score": score, "trigger_path": trigger_path,
        "yoy_profit_pct": yoy_profit, "yoy_revenue_pct": yoy_revenue,
        "opm_expansion_bps": opm_bps, "price_vs_ema200_pct": price_vs_ema,
        "volume_multiplier": vol_mult, "day_gap_pct": day_gap, "ttm_pe": ttm_pe,
    }
    try:
        res = supabase.table("pead_signals").upsert(row, on_conflict="ticker,signal_date").execute()
        sig_id = res.data[0]["id"] if res.data else None
        if sig_id:
            supabase.table("drift_performance").upsert(
                {"signal_id": sig_id}, on_conflict="signal_id"
            ).execute()
        return sig_id
    except Exception as e:
        print(f"  [db] upsert failed for {ticker}: {e}")
        return None


# ── Telegram ────────────────────────────────────────────────────────────────────
def send_telegram(alerts: list[dict]) -> None:
    if not TG_TOKEN or not TG_CHAT_ID or not alerts:
        return
    lines = [f"⚡ *PEAD Alerts — {datetime.now().strftime('%d %b %Y')}*"]
    for a in alerts:
        lines.append(
            f"🟢 *{a['ticker']}* — Score {a['score']}/100 (Path {a['path']})\n"
            f"  Vol {a.get('vol_mult',0):.1f}x · YoY {a.get('yoy_profit',0):+.1f}% · Gap {a.get('day_gap',0):+.1f}%"
        )
    try:
        requests.post(
            f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
            json={"chat_id": TG_CHAT_ID, "text": "\n\n".join(lines), "parse_mode": "Markdown"},
            timeout=10,
        )
        print("[telegram] sent")
    except Exception as e:
        print(f"[telegram] {e}")


# ── Main ────────────────────────────────────────────────────────────────────────
def main(target_date: str | None = None):
    signal_date = target_date or TODAY
    print(f"=== PEAD Engine v3 — {signal_date} ===")

    session   = get_nse_session()
    reporters = fetch_todays_reporters(session, target_date=signal_date)

    if not reporters:
        print("[main] no earnings reporters found for today")
        return

    alerts = []
    for i, co in enumerate(reporters, 1):
        ticker = co["ticker"]
        print(f"[{i}/{len(reporters)}] {ticker}", end="  ")

        fund = get_quarterly_fundamentals(ticker)
        time.sleep(0.5)
        tech = fetch_technicals(ticker)
        time.sleep(0.5)

        score = compute_score(
            yoy_profit  = fund["yoy_profit"],
            yoy_revenue = fund["yoy_revenue"],
            opm_bps     = fund["opm_bps"],
            price_vs_ema= tech["price_vs_ema200_pct"],
            vol_mult    = tech["vol_mult"],
            day_gap     = tech["day_gap_pct"],
        )
        path = path_from_score(score)

        company_name = fund["company_name"] or co["company_name"]
        sig_id = upsert_signal(
            ticker=ticker, company_name=company_name, sector=fund["sector"],
            signal_date=signal_date, score=score, trigger_path=path,
            yoy_profit=fund["yoy_profit"], yoy_revenue=fund["yoy_revenue"],
            opm_bps=fund["opm_bps"], price_vs_ema=tech["price_vs_ema200_pct"],
            vol_mult=tech["vol_mult"], day_gap=tech["day_gap_pct"], ttm_pe=fund["ttm_pe"],
        )

        print(f"score={score} path={path} profit={fund['yoy_profit']}% vol={tech['vol_mult']}x → {'✓' if sig_id else '✗'}")

        if score >= 70 and sig_id:
            alerts.append({"ticker": ticker, "score": score, "path": path,
                           "yoy_profit": fund["yoy_profit"] or 0,
                           "vol_mult": tech["vol_mult"] or 0,
                           "day_gap": tech["day_gap_pct"] or 0})

    print(f"\n[done] {len(reporters)} processed, {len(alerts)} Path A alerts")
    send_telegram(alerts)


if __name__ == "__main__":
    import sys
    target = sys.argv[1] if len(sys.argv) > 1 else None
    main(target)

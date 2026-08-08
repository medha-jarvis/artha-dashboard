"""
PEAD Engine v4 — MECE 7-component scoring rubric (0–100).

Components (max pts):
  1. Earnings Quality   — PAT YoY      (20)
  2. Revenue Validation — Rev YoY      (10)
  3. Margin Health      — OPM bps      (10)
  4. Delivery Conviction— Delivery %   (20)  ← NSE Bhavcopy
  5. Volume Intensity   — Vol vs 20SMA (15)
  6. Market Re-pricing  — Intraday gap (15)  ← close vs open (not overnight)
  7. Structural Trend   — Price/EMA200 (10)
  + QoQ bonus (+5) · Valuation penalty (−5 to −15)

Divergence flag: is_hidden_catalyst — weak fundamentals + strong institutional buy.

NaN sanitisation — no upsert failures.

Cron: Mon–Fri 3 PM IST (09:30 UTC) and 7 PM IST (13:30 UTC).
"""

import os, time, math, requests
from datetime import date, datetime
from io import StringIO
import pandas as pd
import yfinance as yf
from supabase import create_client, Client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
TG_TOKEN     = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TG_CHAT_ID   = os.environ.get("TELEGRAM_CHAT_ID", "")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
TODAY = date.today().isoformat()

EMA_PERIOD     = 200
VOL_SMA_PERIOD = 20

NSE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0 Safari/537.36",
    "Accept":     "application/json, text/plain, */*",
    "Referer":    "https://www.nseindia.com/",
    "DNT":        "1",
}


# ── NaN / Inf guard ────────────────────────────────────────────────────────────
def _clean(v):
    """Convert float NaN / Inf → None so Supabase JSON stays valid."""
    if v is None:
        return None
    try:
        if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
            return None
    except Exception:
        pass
    return v


# ── NSE session ────────────────────────────────────────────────────────────────
def get_nse_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(NSE_HEADERS)
    try:
        session.get("https://www.nseindia.com", timeout=15)
        time.sleep(1)
    except Exception as e:
        print(f"[nse] session init: {e}")
    return session


# ── Today's earnings reporters ─────────────────────────────────────────────────
def fetch_todays_reporters(session: requests.Session, target_date: str | None = None) -> list[dict]:
    check_date = target_date or TODAY
    try:
        nse_date = datetime.strptime(check_date, "%Y-%m-%d").strftime("%d-%m-%Y")
    except ValueError:
        nse_date = check_date

    url = (
        f"https://www.nseindia.com/api/corporate-announcements"
        f"?index=equities&from_date={nse_date}&to_date={nse_date}"
    )
    RESULT_KEYWORDS = [
        "financial result", "quarterly result", "q1 result", "q2 result",
        "q3 result", "q4 result", "annual result", "unaudited result", "audited result",
    ]
    RESULT_DESCS = {
        "Outcome of Board Meeting", "Financial Results", "Quarterly Results",
        "Board Meeting Outcome", "Annual Results",
    }
    reporters = []
    try:
        r     = session.get(url, timeout=20)
        items = r.json() if r.text else []
        if isinstance(items, dict):
            items = items.get("data", [])
        for item in items:
            desc     = (item.get("desc") or "").strip()
            text     = (item.get("attchmntText") or "").lower()
            combined = (desc + " " + text).lower()
            if not (desc in RESULT_DESCS or any(kw in combined for kw in RESULT_KEYWORDS)):
                continue
            symbol = (item.get("symbol") or "").strip().upper()
            cname  = (item.get("sm_name") or symbol).strip()
            if symbol:
                reporters.append({"ticker": symbol, "company_name": cname})
        print(f"[nse] {len(reporters)} reporters on {check_date}")
    except Exception as e:
        print(f"[nse] API error: {e}")

    seen, unique = set(), []
    for r in reporters:
        if r["ticker"] not in seen:
            seen.add(r["ticker"])
            unique.append(r)
    print(f"[nse] {len(unique)} unique reporters")
    return unique


# ── Bhavcopy: delivery % ───────────────────────────────────────────────────────
_bhavcopy_cache: dict[str, "pd.DataFrame | None"] = {}

def _load_bhavcopy(session: requests.Session, result_date: str) -> "pd.DataFrame | None":
    """Download NSE Bhavcopy for a date; cached per date within one run."""
    if result_date in _bhavcopy_cache:
        return _bhavcopy_cache[result_date]

    try:
        date_str = datetime.strptime(result_date, "%Y-%m-%d").strftime("%d%m%Y")
    except ValueError:
        _bhavcopy_cache[result_date] = None
        return None

    urls = [
        f"https://archives.nseindia.com/products/content/sec_bhavdata_full_{date_str}.csv",
        f"https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_{date_str}.csv",
    ]
    for url in urls:
        try:
            resp = session.get(url, timeout=25)
            if resp.status_code == 200 and len(resp.content) > 2000:
                df = pd.read_csv(StringIO(resp.text))
                df.columns = [c.strip() for c in df.columns]
                if "SYMBOL" in df.columns and "DELIV_PER" in df.columns:
                    df["SYMBOL"] = df["SYMBOL"].str.strip()
                    _bhavcopy_cache[result_date] = df
                    print(f"[bhavcopy] {len(df)} rows for {result_date}")
                    return df
        except Exception as e:
            print(f"[bhavcopy] {url}: {e}")

    print(f"[bhavcopy] not available for {result_date}")
    _bhavcopy_cache[result_date] = None
    return None


def get_delivery_pct(session: requests.Session, ticker: str, result_date: str) -> float | None:
    df = _load_bhavcopy(session, result_date)
    if df is None:
        return None
    sym = ticker.replace(".NS", "").strip().upper()
    row = df[df["SYMBOL"] == sym]
    if row.empty:
        return None
    try:
        val = str(row["DELIV_PER"].iloc[0]).strip()
        if not val or val in ('-', '--', 'N/A', 'NA', ''):
            return None
        return _clean(float(val))
    except (ValueError, TypeError):
        return None


# ── Quarterly fundamentals ─────────────────────────────────────────────────────
def get_quarterly_fundamentals(ticker: str) -> dict:
    ns  = ticker if ticker.endswith(".NS") else ticker + ".NS"
    out = dict(yoy_profit=None, yoy_revenue=None, opm_bps=None,
               qoq_profit=None, ttm_pe=None, company_name=None, sector=None)
    try:
        t   = yf.Ticker(ns)
        inf = t.info
        out["company_name"] = inf.get("longName") or inf.get("shortName")
        out["sector"]       = inf.get("sector")
        out["ttm_pe"]       = _clean(inf.get("trailingPE"))

        qf = t.quarterly_financials
        if qf is None or qf.empty or qf.shape[1] < 5:
            return out
        cols = qf.columns.tolist()

        def safe(row_key: str, col_idx: int) -> float | None:
            try:
                matches = [k for k in qf.index if row_key.lower() in str(k).lower()]
                if not matches or col_idx >= len(cols):
                    return None
                v = qf.loc[matches[0], cols[col_idx]]
                return _clean(float(v)) if v is not None and v == v else None
            except Exception:
                return None

        rev_c    = safe("Total Revenue", 0);  rev_p = safe("Total Revenue", 4)
        net_c    = safe("Net Income",    0);  net_p = safe("Net Income",    4)
        net_prev = safe("Net Income",    1)   # previous quarter for QoQ
        opi_c    = safe("Operating",     0);  opi_p = safe("Operating",     4)

        if rev_c and rev_p and rev_p != 0:
            out["yoy_revenue"] = _clean(round((rev_c - rev_p) / abs(rev_p) * 100, 2))
        if net_c and net_p and net_p != 0:
            out["yoy_profit"]  = _clean(round((net_c - net_p) / abs(net_p) * 100, 2))
        if net_c is not None and net_prev is not None and net_prev != 0:
            out["qoq_profit"]  = _clean(round((net_c - net_prev) / abs(net_prev) * 100, 2))
        if opi_c and rev_c and opi_p and rev_p and rev_c != 0 and rev_p != 0:
            out["opm_bps"]     = _clean(round((opi_c/rev_c - opi_p/rev_p) * 10000, 1))

    except Exception as e:
        print(f"  [fund] {ns}: {e}")
    return out


# ── Price / volume technicals ──────────────────────────────────────────────────
def fetch_technicals(ticker: str) -> dict:
    ns  = ticker if ticker.endswith(".NS") else ticker + ".NS"
    out = dict(price_vs_ema200_pct=None, vol_mult=None, intraday_gap_pct=None)
    try:
        df = yf.Ticker(ns).history(period="250d", interval="1d", auto_adjust=True)
        if df.empty or len(df) < 22:
            return out
        close  = df["Close"]
        vol    = df["Volume"]
        open_  = df["Open"]

        ema200  = _clean(float(close.ewm(span=EMA_PERIOD, adjust=False).mean().iloc[-1]))
        vol_sma = _clean(float(vol.rolling(VOL_SMA_PERIOD).mean().iloc[-2]))
        last_c  = _clean(float(close.iloc[-1]))
        last_o  = _clean(float(open_.iloc[-1]))
        last_v  = _clean(float(vol.iloc[-1]))

        if ema200 and last_c:
            out["price_vs_ema200_pct"] = _clean(round((last_c - ema200) / ema200 * 100, 2))
        if vol_sma and vol_sma > 0 and last_v:
            out["vol_mult"] = _clean(round(last_v / vol_sma, 2))
        # Intraday gap: close vs open on results day (not overnight)
        if last_o and last_o > 0 and last_c:
            out["intraday_gap_pct"] = _clean(round((last_c - last_o) / last_o * 100, 2))

    except Exception as e:
        print(f"  [tech] {ns}: {e}")
    return out


# ── MECE Scoring v4 ────────────────────────────────────────────────────────────
def compute_score_v4(yoy_profit, yoy_revenue, opm_bps, qoq_profit,
                     delivery_pct, vol_mult, intraday_gap,
                     price_vs_ema200, ttm_pe) -> int:

    # 1. Earnings Quality — PAT YoY (max 20)
    s1 = 0
    if yoy_profit is not None:
        if   yoy_profit >= 50: s1 = 20
        elif yoy_profit >= 30: s1 = 15
        elif yoy_profit >= 20: s1 = 10
        elif yoy_profit >= 10: s1 =  5
        elif yoy_profit >=  0: s1 =  2

    # 2. Revenue Validation — Rev YoY (max 10)
    s2 = 0
    if yoy_revenue is not None:
        if   yoy_revenue >= 20: s2 = 10
        elif yoy_revenue >= 10: s2 =  6
        elif yoy_revenue >=  5: s2 =  3

    # 3. Margin Health — OPM bps (max 10)
    s3 = 0
    if opm_bps is not None:
        if   opm_bps >= 200: s3 = 10
        elif opm_bps >= 100: s3 =  7
        elif opm_bps >=  50: s3 =  4
        elif opm_bps >=   0: s3 =  2

    # 4. Delivery Conviction — Delivery % (max 20)
    s4 = 0
    if delivery_pct is not None:
        if   delivery_pct >= 55: s4 = 20
        elif delivery_pct >= 45: s4 = 15
        elif delivery_pct >= 35: s4 =  8
        elif delivery_pct >= 25: s4 =  3

    # 5. Volume Intensity — vol mult vs 20d SMA (max 15)
    s5 = 0
    if vol_mult is not None:
        if   vol_mult >= 5.0: s5 = 15
        elif vol_mult >= 3.0: s5 = 12
        elif vol_mult >= 2.0: s5 =  8
        elif vol_mult >= 1.5: s5 =  4

    # 6. Market Re-pricing — intraday gap (max 15)
    s6 = 0
    if intraday_gap is not None:
        if   intraday_gap >= 5: s6 = 15
        elif intraday_gap >= 3: s6 = 10
        elif intraday_gap >= 1: s6 =  5
        elif intraday_gap >= 0: s6 =  2

    # 7. Structural Trend — price vs 200 EMA (max 10)
    s7 = 0
    if price_vs_ema200 is not None:
        if   price_vs_ema200 >= 10: s7 = 10
        elif price_vs_ema200 >=  0: s7 =  7
        elif price_vs_ema200 >= -10: s7 = 3

    raw = s1 + s2 + s3 + s4 + s5 + s6 + s7   # max 100

    # QoQ bonus (+5) — sequential acceleration
    bonus = 5 if (qoq_profit is not None and qoq_profit > 0) else 0

    # Valuation penalty
    penalty = 0
    if ttm_pe is not None:
        if   ttm_pe >= 80: penalty = -15
        elif ttm_pe >= 50: penalty =  -5
        elif ttm_pe <=  0: penalty =  -5   # loss-making: mild, preserves turnarounds

    return max(0, min(100, raw + bonus + penalty))


def compute_hidden_catalyst(yoy_profit, yoy_revenue, vol_mult,
                            delivery_pct, intraday_gap) -> bool:
    """Smart money buying hard despite weak fundamentals — divergence signal."""
    fundamental_weak = (
        (yoy_profit  is not None and yoy_profit  < 0) or
        (yoy_revenue is not None and yoy_revenue < 5)
    )
    return bool(
        fundamental_weak
        and vol_mult      is not None and vol_mult      >= 3.0
        and delivery_pct  is not None and delivery_pct  >= 45
        and intraday_gap  is not None and intraday_gap  >= 3
    )


def path_from_score(score: int) -> str:
    if score >= 70: return "ACT"
    if score >= 50: return "WATCH"
    return "NONE"


# ── Supabase upsert ────────────────────────────────────────────────────────────
def upsert_signal(ticker, company_name, sector, signal_date, score, trigger_path,
                  yoy_profit, yoy_revenue, opm_bps, qoq_profit,
                  price_vs_ema, vol_mult, intraday_gap, ttm_pe,
                  delivery_pct, is_hidden_catalyst) -> str | None:
    row = {
        "ticker":              ticker,
        "company_name":        company_name,
        "sector":              sector,
        "signal_date":         signal_date,
        "pead_score":          score,
        "trigger_path":        trigger_path,
        "yoy_profit_pct":      _clean(yoy_profit),
        "yoy_revenue_pct":     _clean(yoy_revenue),
        "opm_expansion_bps":   _clean(opm_bps),
        "qoq_profit_pct":      _clean(qoq_profit),
        "price_vs_ema200_pct": _clean(price_vs_ema),
        "volume_multiplier":   _clean(vol_mult),
        "day_gap_pct":         _clean(intraday_gap),
        "ttm_pe":              _clean(ttm_pe),
        "delivery_pct":        _clean(delivery_pct),
        "is_hidden_catalyst":  bool(is_hidden_catalyst),
    }
    try:
        res = supabase.table("pead_signals").upsert(
            row, on_conflict="ticker,signal_date"
        ).execute()
        sig_id = res.data[0]["id"] if res.data else None
        if sig_id:
            supabase.table("drift_performance").upsert(
                {"signal_id": sig_id}, on_conflict="signal_id"
            ).execute()
        return sig_id
    except Exception as e:
        print(f"  [db] upsert failed for {ticker}: {e}")
        return None


# ── Telegram alert ─────────────────────────────────────────────────────────────
def send_telegram(alerts: list[dict]) -> None:
    if not TG_TOKEN or not TG_CHAT_ID or not alerts:
        return
    lines = [f"⚡ *PEAD ACT Signals — {datetime.now().strftime('%d %b %Y')}*\n_{len(alerts)} signal(s) score ≥70_"]
    for a in alerts:
        hc_tag  = "  🔍 _Hidden Catalyst_" if a.get("is_hidden_catalyst") else ""
        del_str = f" · Del {a['delivery_pct']:.0f}%" if a.get("delivery_pct") is not None else ""
        lines.append(
            f"🟢 *{a['ticker']}* — {a['score']}/100{hc_tag}\n"
            f"  PAT {a['yoy_profit']:+.1f}% · Vol {a['vol_mult']:.1f}x{del_str} · Gap {a['intraday_gap']:+.1f}%"
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


# ── Main ───────────────────────────────────────────────────────────────────────
def main(target_date: str | None = None) -> None:
    signal_date = target_date or TODAY
    print(f"=== PEAD Engine v4 — {signal_date} ===")

    session   = get_nse_session()
    reporters = fetch_todays_reporters(session, target_date=signal_date)
    if not reporters:
        print("[main] no earnings reporters found"); return

    alerts = []
    for i, co in enumerate(reporters, 1):
        ticker = co["ticker"]
        print(f"[{i}/{len(reporters)}] {ticker}", end="  ")

        fund     = get_quarterly_fundamentals(ticker);  time.sleep(0.4)
        tech     = fetch_technicals(ticker);            time.sleep(0.4)
        delivery = get_delivery_pct(session, ticker, signal_date)

        score  = compute_score_v4(
            yoy_profit   = fund["yoy_profit"],
            yoy_revenue  = fund["yoy_revenue"],
            opm_bps      = fund["opm_bps"],
            qoq_profit   = fund["qoq_profit"],
            delivery_pct = delivery,
            vol_mult     = tech["vol_mult"],
            intraday_gap = tech["intraday_gap_pct"],
            price_vs_ema200 = tech["price_vs_ema200_pct"],
            ttm_pe       = fund["ttm_pe"],
        )
        path   = path_from_score(score)
        hidden = compute_hidden_catalyst(
            fund["yoy_profit"], fund["yoy_revenue"],
            tech["vol_mult"], delivery, tech["intraday_gap_pct"],
        )
        company_name = fund["company_name"] or co["company_name"]

        sig_id = upsert_signal(
            ticker=ticker, company_name=company_name, sector=fund["sector"],
            signal_date=signal_date, score=score, trigger_path=path,
            yoy_profit=fund["yoy_profit"], yoy_revenue=fund["yoy_revenue"],
            opm_bps=fund["opm_bps"], qoq_profit=fund["qoq_profit"],
            price_vs_ema=tech["price_vs_ema200_pct"], vol_mult=tech["vol_mult"],
            intraday_gap=tech["intraday_gap_pct"], ttm_pe=fund["ttm_pe"],
            delivery_pct=delivery, is_hidden_catalyst=hidden,
        )
        print(f"score={score} path={path} profit={fund['yoy_profit']}% del={delivery}% → {'✓' if sig_id else '✗'}")

        if score >= 70 and sig_id:
            alerts.append({
                "ticker":            ticker,
                "score":             score,
                "yoy_profit":        fund["yoy_profit"] or 0,
                "vol_mult":          tech["vol_mult"] or 0,
                "intraday_gap":      tech["intraday_gap_pct"] or 0,
                "delivery_pct":      delivery,
                "is_hidden_catalyst": hidden,
            })

    print(f"\n[done] {len(reporters)} processed · {len(alerts)} ACT alerts")
    send_telegram(alerts)


if __name__ == "__main__":
    import sys
    main(sys.argv[1] if len(sys.argv) > 1 else None)

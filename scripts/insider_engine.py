"""
Insider Intelligence Engine v2 — NSE PIT (Prohibition of Insider Trading) disclosures.
Promoters, Directors, KMP — open-market trades only.

Scoring (max 100):
  Magnitude   (20): trade size — absolute (₹Cr) and % of free float
  Credibility (60): actual past returns at 3m / 6m / 1y for this acquirer in this stock
                    -- the primary signal; weights promoters who have historically called
                       the market correctly vs. noise traders
  Context     (20): price relative to 150-day EMA at time of trade

Tiers: HIGH CONVICTION ≥75 | NOTABLE 50-74 | NOISE <50
Runs: Mon-Fri 6:00 PM IST via VPS cron (requires Indian IP for NSE PIT).
"""

import os, time, json, requests
from datetime import date, timedelta, datetime as dt
import pandas as pd
import yfinance as yf
from supabase import create_client, Client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
TG_TOKEN     = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TG_CHAT_ID   = os.environ.get("TELEGRAM_CHAT_ID", "")

sb: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
TODAY = date.today().isoformat()

NSE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nseindia.com/companies-listing/corporate-filings-insider-trading",
    "DNT": "1",
}

MIN_TRADE_VALUE  = 5_000_000   # ₹50 Lakhs minimum
EMA_PERIOD       = 150
VALID_CATEGORIES = {"Promoters", "Promoter Group", "Director", "Key Managerial Personnel"}
VALID_MODES      = {"Market Purchase", "Market Sale"}


# ── NSE session ─────────────────────────────────────────────────────────────────
def get_nse_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(NSE_HEADERS)
    try:
        session.get("https://www.nseindia.com", timeout=15)
        time.sleep(2)
        session.get("https://www.nseindia.com/companies-listing/corporate-filings-insider-trading", timeout=10)
        time.sleep(1)
    except Exception as e:
        print(f"[nse] session init: {e}")
    return session


def fetch_pit_recent(session: requests.Session, days: int = 90) -> list[dict]:
    """Fetch PIT records for the past `days` days.
    NSE publishes insider data with ~60-90 day lag so we use a rolling window.
    Requires Indian IP — must run from VPS."""
    to_dt   = date.today()
    from_dt = to_dt - timedelta(days=days)
    fd = from_dt.strftime("%d-%m-%Y")
    td = to_dt.strftime("%d-%m-%Y")
    try:
        r = session.get(
            f"https://www.nseindia.com/api/corporates-pit?index=equities&from_date={fd}&to_date={td}",
            timeout=20,
        )
        data = r.json()
        records = data if isinstance(data, list) else data.get("data", data.get("result", []))
        print(f"[nse] fetched {len(records)} PIT records ({fd} → {td})")
        return records
    except Exception as e:
        print(f"[nse] PIT fetch failed: {e}")
        return []


# ── Parse & filter ──────────────────────────────────────────────────────────────
def parse_record(rec: dict) -> dict | None:
    try:
        person_cat = (rec.get("personCategory") or rec.get("personCat") or "").strip()
        mode       = (rec.get("modeOfAcquisition") or rec.get("acqMode") or "").strip()
        if not any(cat in person_cat for cat in VALID_CATEGORIES):
            return None
        if mode not in VALID_MODES:
            return None

        val_raw = rec.get("secVal") or rec.get("transactionValue") or "0"
        try:
            trade_value = float(str(val_raw).replace(",", ""))
        except (ValueError, TypeError):
            trade_value = 0
        if trade_value < MIN_TRADE_VALUE:
            return None

        tx_type = "BUY" if "Purchase" in mode else "SELL"

        date_str = rec.get("date") or rec.get("acqfromDt") or rec.get("intimDt") or ""
        signal_date = date.today()
        for fmt in ("%d-%b-%Y %H:%M", "%d-%b-%Y", "%d-%m-%Y"):
            try:
                signal_date = dt.strptime(date_str.split()[0], fmt.split()[0]).date()
                break
            except (ValueError, AttributeError):
                pass

        try:
            secs_traded = float(str(rec.get("secAcq") or rec.get("secAcqNo") or "0").replace(",", ""))
        except (ValueError, TypeError):
            secs_traded = 0

        return {
            "ticker":           (rec.get("symbol") or "").strip().upper(),
            "company_name":     (rec.get("company") or rec.get("companyName") or "").strip(),
            "acquirer_name":    (rec.get("acqName") or rec.get("acquirerName") or "").strip(),
            "transaction_type": tx_type,
            "signal_date":      signal_date.isoformat(),
            "trade_value_cr":   round(trade_value / 1e7, 4),
            "secs_traded":      secs_traded,
            "person_category":  person_cat,
        }
    except Exception as e:
        print(f"  [parse] {e}")
        return None


# ── Technicals ──────────────────────────────────────────────────────────────────
_tech_cache: dict[str, dict] = {}

def get_technicals(ticker: str) -> dict:
    if ticker in _tech_cache:
        return _tech_cache[ticker]
    ns = ticker if ticker.endswith(".NS") else ticker + ".NS"
    out = dict(ema150_dist=None, shares_out=None, base_price=None)
    try:
        t    = yf.Ticker(ns)
        hist = t.history(period="300d", interval="1d", auto_adjust=True)
        time.sleep(0.5)
        if hist.empty or len(hist) < EMA_PERIOD:
            return out
        close = hist["Close"].squeeze()
        ema150 = float(close.ewm(span=EMA_PERIOD, adjust=False).mean().iloc[-1])
        last_c = float(close.iloc[-1])
        out["ema150_dist"] = round((last_c - ema150) / ema150 * 100, 2)
        out["base_price"]  = round(last_c, 2)
        out["shares_out"]  = t.info.get("sharesOutstanding") or t.info.get("impliedSharesOutstanding")
    except Exception as e:
        print(f"  [tech] {ns}: {e}")
    _tech_cache[ticker] = out
    return out


# ── Credibility: actual past returns ───────────────────────────────────────────
def get_past_returns(acquirer_name: str, ticker: str) -> list[dict]:
    """Fetch actual return records from past signals for this acquirer across ALL tickers.
    Promoters often trade multiple group companies; we want their full track record."""
    try:
        resp = sb.table("insider_signals") \
            .select("actual_return_3m,actual_return_6m,actual_return_1y,transaction_type,ticker") \
            .eq("acquirer_name", acquirer_name) \
            .not_.eq("ticker", ticker) \
            .order("signal_date", desc=True) \
            .limit(20) \
            .execute()
        # Also include same-ticker signals (excluding this exact signal by keeping older ones)
        resp2 = sb.table("insider_signals") \
            .select("actual_return_3m,actual_return_6m,actual_return_1y,transaction_type,ticker") \
            .eq("acquirer_name", acquirer_name) \
            .eq("ticker", ticker) \
            .order("signal_date", desc=True) \
            .limit(10) \
            .execute()
        return (resp.data or []) + (resp2.data or [])
    except Exception:
        return []


def score_credibility(past: list[dict], tx_type: str) -> tuple[int, str]:
    """
    60-point credibility sub-score.
    Weights: 3m (20pt) + 6m (25pt) + 1y (15pt).
    For BUY: positive returns are good. For SELL: negative returns are good.
    First-time/no return data: 30/60 (neutral).
    """
    if not past:
        return 30, "No prior signals — neutral (30/60)"

    r3  = [r["actual_return_3m"] for r in past if r.get("actual_return_3m") is not None]
    r6  = [r["actual_return_6m"] for r in past if r.get("actual_return_6m") is not None]
    r1y = [r["actual_return_1y"] for r in past if r.get("actual_return_1y") is not None]

    m = 1 if tx_type == "BUY" else -1  # SELL: negative returns are correct calls

    def pts(vals, neutral, thresholds):
        if not vals:
            return neutral
        avg = (sum(vals) / len(vals)) * m
        for thresh, p in thresholds:
            if avg >= thresh:
                return p
        return 0

    s3  = pts(r3,  10, [(15, 20), (8, 12), (0, 5)])   # 3m: max 20
    s6  = pts(r6,  12, [(25, 25), (12, 15), (0, 6)])  # 6m: max 25 (highest weight)
    s1y = pts(r1y,  8, [(40, 15), (20, 9), (0, 4)])   # 1y: max 15
    total = s3 + s6 + s1y

    n = len(past)
    avg6_str = f"{sum(r6)/len(r6)*m:+.1f}%" if r6 else "pending"
    return total, f"{n} prior signal(s), avg 6m: {avg6_str}"


# ── Cluster flag ────────────────────────────────────────────────────────────────
def check_cluster(ticker: str, tx_type: str, signal_date: str) -> bool:
    try:
        cutoff = (date.fromisoformat(signal_date) - timedelta(days=14)).isoformat()
        resp = sb.table("insider_signals") \
            .select("acquirer_name") \
            .eq("ticker", ticker) \
            .eq("transaction_type", tx_type) \
            .gte("signal_date", cutoff) \
            .execute()
        return len({r["acquirer_name"] for r in (resp.data or [])}) >= 3
    except Exception:
        return False


# ── Composite score ─────────────────────────────────────────────────────────────
def compute_score(trade_cr: float, equity_pct: float | None,
                  cred: int, ema_dist: float | None, tx_type: str) -> int:
    # Magnitude: 20pts
    if trade_cr > 5 or (equity_pct and equity_pct > 1):     mag = 20
    elif trade_cr > 1 or (equity_pct and equity_pct > 0.5): mag = 13
    else:                                                     mag = 6

    # Context: 20pts
    ctx = 0
    if ema_dist is not None:
        if tx_type == "BUY":
            if   ema_dist <= 10: ctx = 20
            elif ema_dist <= 20: ctx = 10
        else:
            if   ema_dist >= 20: ctx = 20
            elif ema_dist >= 10: ctx = 10

    return min(100, mag + cred + ctx)


def tier_from_score(score: int) -> str:
    if score >= 75: return "HIGH CONVICTION"
    if score >= 50: return "NOTABLE"
    return "NOISE"


# ── Telegram ────────────────────────────────────────────────────────────────────
def send_telegram(alerts: list[dict]) -> None:
    if not TG_TOKEN or not TG_CHAT_ID or not alerts:
        return
    lines = [f"🕵️ *Insider Signals — {dt.now().strftime('%d %b %Y')}*"]
    for a in alerts:
        e = "🟢 BUY" if a["tx"] == "BUY" else "🔴 SELL"
        lines.append(f"{e} *{a['ticker']}* — Score {a['score']}/100\n  {a['acquirer']} · ₹{a['val']:.1f}Cr · {a['tier']}")
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
def get_latest_db_date() -> str:
    """Return the latest signal_date already stored, so we only alert on new data."""
    try:
        resp = sb.table("insider_signals").select("signal_date").order("signal_date", desc=True).limit(1).execute()
        return (resp.data or [{}])[0].get("signal_date", "2000-01-01")
    except Exception:
        return "2000-01-01"


def main():
    print(f"=== Insider Engine v2 — {TODAY} ===")
    session = get_nse_session()
    # NSE PIT has ~60-90 day lag; use 150-day window to reliably capture latest available data
    records = fetch_pit_recent(session, days=150)

    if not records:
        print("[main] no PIT data — check Indian IP (VPS) and NSE availability")
        return

    # Only send Telegram for trades newer than what we already have in DB
    last_known_date = get_latest_db_date()
    print(f"[main] last known date in DB: {last_known_date}")

    parsed = [p for rec in records if (p := parse_record(rec)) and p["ticker"]]
    print(f"[filter] {len(parsed)} qualifying trades (≥₹50L, promoter/director, market)")

    alerts, processed = [], 0
    for p in parsed:
        ticker = p["ticker"]
        print(f"  {ticker} | {p['acquirer_name'][:28]} | {p['transaction_type']} | ₹{p['trade_value_cr']:.1f}Cr", end="  ")

        tech = get_technicals(ticker)
        past = get_past_returns(p["acquirer_name"], ticker)

        equity_pct = None
        if tech["shares_out"] and p["secs_traded"]:
            equity_pct = round(p["secs_traded"] / tech["shares_out"] * 100, 4)

        cred, cred_reason = score_credibility(past, p["transaction_type"])
        score = compute_score(p["trade_value_cr"], equity_pct, cred, tech["ema150_dist"], p["transaction_type"])
        tier  = tier_from_score(score)
        print(f"→ score={score} cred={cred}/60 tier={tier}")

        if score < 50:
            continue

        cluster = check_cluster(ticker, p["transaction_type"], p["signal_date"])
        row = {
            "ticker":              ticker,
            "company_name":        p["company_name"],
            "acquirer_name":       p["acquirer_name"],
            "transaction_type":    p["transaction_type"],
            "signal_date":         p["signal_date"],
            "insider_score":       score,
            "trade_value_in_cr":   p["trade_value_cr"],
            "equity_pct_traded":   equity_pct,
            "ema150_distance_pct": tech["ema150_dist"],
            "cluster_trade_flag":  cluster,
            "tier":                tier,
            "base_price":          tech["base_price"],
            "person_category":     p["person_category"],
            "secs_traded":         p["secs_traded"],
        }
        try:
            sb.table("insider_signals").upsert(
                row, on_conflict="ticker,signal_date,acquirer_name,transaction_type"
            ).execute()
            processed += 1
        except Exception as e:
            print(f"    [db] {e}")
            continue

        # Only alert for signals newer than what was already in DB before this run
        if score >= 75 and p["signal_date"] > last_known_date:
            alerts.append({"ticker": ticker, "tx": p["transaction_type"],
                           "acquirer": p["acquirer_name"], "val": p["trade_value_cr"],
                           "score": score, "tier": tier})

    print(f"\n[done] {processed} signals stored | {len(alerts)} HIGH CONVICTION alerts")
    send_telegram(alerts)


if __name__ == "__main__":
    main()

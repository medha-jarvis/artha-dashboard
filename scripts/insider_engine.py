"""
Insider Intelligence Engine — tracks high-conviction open-market Buys AND Sells
by Promoters, Directors, and Promoter Groups using NSE PIT (Prohibition of
Insider Trading) disclosure data.

Scoring (max 100):
  Magnitude   (30): trade value / % equity traded
  Credibility (40): simulated historical performance of this acquirer's past calls
  Context     (30): price relative to 150 EMA (buy = near base, sell = extended)

Tiers: HIGH CONVICTION ≥75 | NOTABLE 50-74 | NOISE <50
Runs: 12:30 UTC = 6:00 PM IST daily.
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

MIN_TRADE_VALUE = 5_000_000   # ₹50 Lakhs minimum
EMA_PERIOD      = 150


# ── NSE PIT data ───────────────────────────────────────────────────────────────
def fetch_pit_data() -> list[dict]:
    """Fetch NSE PIT (insider trading) disclosures for equities."""
    session = requests.Session()
    session.headers.update(NSE_HEADERS)
    # Establish session cookie
    try:
        session.get("https://www.nseindia.com", timeout=15)
        time.sleep(2)
        session.get("https://www.nseindia.com/companies-listing/corporate-filings-insider-trading", timeout=15)
        time.sleep(2)
    except Exception as e:
        print(f"[nse] session init: {e}")

    try:
        r = session.get(
            "https://www.nseindia.com/api/corporates-pit?index=equities",
            timeout=20
        )
        data = r.json()
        records = data if isinstance(data, list) else data.get("data", data.get("result", []))
        print(f"[nse] fetched {len(records)} PIT records")
        return records
    except Exception as e:
        print(f"[nse] PIT fetch failed: {e}")
        return []


# ── Filter & parse ─────────────────────────────────────────────────────────────
VALID_CATEGORIES = {"Promoters", "Promoter Group", "Director", "Key Managerial Personnel"}
VALID_MODES      = {"Market Purchase", "Market Sale"}

def parse_record(rec: dict) -> dict | None:
    """Extract and validate a single PIT record."""
    try:
        person_cat = (rec.get("personCategory") or rec.get("personCat") or "").strip()
        mode       = (rec.get("modeOfAcquisition") or rec.get("modeOfAcq") or "").strip()

        # Filter by person category and acquisition mode
        if not any(cat in person_cat for cat in VALID_CATEGORIES):
            return None
        if mode not in VALID_MODES:
            return None

        # Transaction value
        val_raw = rec.get("secVal") or rec.get("transactionValue") or "0"
        try:
            trade_value = float(str(val_raw).replace(",", ""))
        except (ValueError, TypeError):
            trade_value = 0

        if trade_value < MIN_TRADE_VALUE:
            return None

        # Determine BUY or SELL
        tx_type = "BUY" if "Purchase" in mode else "SELL"

        # Parse date
        date_str = rec.get("date") or rec.get("acqfromDt") or ""
        try:
            # NSE uses DD-MMM-YYYY or DD-MM-YYYY
            try:   signal_date = dt.strptime(date_str, "%d-%b-%Y").date()
            except: signal_date = dt.strptime(date_str, "%d-%m-%Y").date()
        except Exception:
            signal_date = date.today()

        # Shares traded
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
            "trade_value_cr":   round(trade_value / 1e7, 4),  # in Crores
            "secs_traded":      secs_traded,
            "person_category":  person_cat,
        }
    except Exception as e:
        print(f"  [parse] {e}")
        return None


# ── Technical context ──────────────────────────────────────────────────────────
_tech_cache: dict[str, dict] = {}

def get_technicals(ticker: str) -> dict:
    """Returns ema150_distance_pct and shares_outstanding."""
    if ticker in _tech_cache:
        return _tech_cache[ticker]

    ns = ticker if ticker.endswith(".NS") else ticker + ".NS"
    out = dict(ema150_dist=None, shares_out=None)
    try:
        t    = yf.Ticker(ns)
        hist = t.history(period="300d", interval="1d", auto_adjust=True)
        time.sleep(0.8)
        if hist.empty or len(hist) < EMA_PERIOD:
            return out
        close    = hist["Close"].squeeze()
        ema150   = float(close.ewm(span=EMA_PERIOD, adjust=False).mean().iloc[-1])
        last_c   = float(close.iloc[-1])
        out["ema150_dist"]  = round((last_c - ema150) / ema150 * 100, 2)
        out["shares_out"]   = t.info.get("sharesOutstanding") or t.info.get("impliedSharesOutstanding")
    except Exception as e:
        print(f"  [tech] {ns}: {e}")
    _tech_cache[ticker] = out
    return out


# ── Historical credibility lookup (Supabase) ───────────────────────────────────
def get_acquirer_history(acquirer_name: str, ticker: str) -> float | None:
    """
    Look up past insider_signals for this acquirer+ticker to simulate historical return.
    Returns mean of promoter_historical_6m_return, or None if no history.
    """
    try:
        resp = sb.table("insider_signals") \
            .select("promoter_historical_6m_return") \
            .eq("acquirer_name", acquirer_name) \
            .eq("ticker", ticker) \
            .not_.is_("promoter_historical_6m_return", "null") \
            .execute()
        vals = [r["promoter_historical_6m_return"] for r in (resp.data or []) if r["promoter_historical_6m_return"] is not None]
        return round(sum(vals) / len(vals), 2) if vals else None
    except Exception:
        return None


# ── Cluster flag ────────────────────────────────────────────────────────────────
def check_cluster_flag(ticker: str, tx_type: str, signal_date: str) -> bool:
    """True if ≥3 unique insiders traded in the same direction within 14 days."""
    try:
        cutoff = (date.fromisoformat(signal_date) - timedelta(days=14)).isoformat()
        resp = sb.table("insider_signals") \
            .select("acquirer_name") \
            .eq("ticker", ticker) \
            .eq("transaction_type", tx_type) \
            .gte("signal_date", cutoff) \
            .execute()
        unique = {r["acquirer_name"] for r in (resp.data or [])}
        return len(unique) >= 3
    except Exception:
        return False


# ── Scoring ─────────────────────────────────────────────────────────────────────
def compute_insider_score(trade_cr: float, equity_pct: float | None,
                           hist_return: float | None, ema_dist: float | None,
                           tx_type: str) -> int:
    score = 0

    # 1. Magnitude (30 pts)
    if trade_cr > 5 or (equity_pct and equity_pct > 1):    score += 30
    elif trade_cr > 1 or (equity_pct and equity_pct > 0.5): score += 20
    else:                                                     score += 10

    # 2. Credibility (40 pts) — historical performance of this acquirer
    if hist_return is None:
        score += 20  # first-time = neutral
    elif tx_type == "BUY":
        if   hist_return > 40:  score += 40
        elif hist_return > 20:  score += 25
        else:                   score += 10
    else:  # SELL
        if   hist_return < -20: score += 40
        elif hist_return < -10: score += 25
        else:                   score += 10

    # 3. Context (30 pts) — price relative to EMA150
    if ema_dist is not None:
        if tx_type == "BUY" and ema_dist <= 10:   score += 30
        elif tx_type == "BUY" and ema_dist <= 20:  score += 15
        elif tx_type == "SELL" and ema_dist >= 20: score += 30
        elif tx_type == "SELL" and ema_dist >= 10: score += 15

    return min(100, score)


def tier_from_score(score: int, tx_type: str) -> str:
    if score >= 75: return "HIGH CONVICTION"
    if score >= 50: return "NOTABLE"
    return "NOISE"


# ── Telegram ───────────────────────────────────────────────────────────────────
def send_telegram(alerts: list[dict]) -> None:
    if not TG_TOKEN or not TG_CHAT_ID or not alerts:
        return
    lines = [f"🕵️ *Insider Signals — {dt.now().strftime('%d %b %Y')}*"]
    for a in alerts:
        emoji = "🟢 BUY" if a["tx"] == "BUY" else "🔴 SELL WARNING"
        lines.append(
            f"{emoji} *{a['ticker']}* — Score {a['score']}/100\n"
            f"  {a['acquirer']} · ₹{a['value_cr']:.1f}Cr · {a['tier']}"
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
def main():
    print(f"=== Insider Intelligence Engine — {TODAY} ===")

    records = fetch_pit_data()
    if not records:
        print("[main] no PIT data — exiting")
        return

    parsed = []
    for rec in records:
        p = parse_record(rec)
        if p:
            parsed.append(p)
    print(f"[filter] {len(parsed)} qualifying trades (≥₹50L, promoter/director, market)")

    alerts = []
    processed = 0

    for p in parsed:
        ticker = p["ticker"]
        if not ticker:
            continue

        print(f"  {ticker} | {p['acquirer_name'][:30]} | {p['transaction_type']} | ₹{p['trade_cr']:.1f}Cr", end="  ")

        tech   = get_technicals(ticker)
        hist_r = get_acquirer_history(p["acquirer_name"], ticker)

        # equity_pct_traded
        equity_pct = None
        if tech["shares_out"] and p["secs_traded"]:
            equity_pct = round(p["secs_traded"] / tech["shares_out"] * 100, 4)

        score = compute_insider_score(
            trade_cr    = p["trade_cr"],
            equity_pct  = equity_pct,
            hist_return = hist_r,
            ema_dist    = tech["ema150_dist"],
            tx_type     = p["transaction_type"],
        )
        tier = tier_from_score(score, p["transaction_type"])

        print(f"→ score={score} tier={tier}")

        if score < 50:
            continue  # Only store ≥50

        # Check cluster after we know this trade qualifies
        cluster = check_cluster_flag(ticker, p["transaction_type"], p["signal_date"])

        row = {
            "ticker":                       ticker,
            "company_name":                 p["company_name"],
            "acquirer_name":                p["acquirer_name"],
            "transaction_type":             p["transaction_type"],
            "signal_date":                  p["signal_date"],
            "insider_score":                score,
            "trade_value_in_cr":            p["trade_cr"],
            "equity_pct_traded":            equity_pct,
            "promoter_historical_6m_return": hist_r,
            "ema150_distance_pct":          tech["ema150_dist"],
            "cluster_trade_flag":           cluster,
            "tier":                         tier,
        }
        try:
            sb.table("insider_signals").upsert(
                row, on_conflict="ticker,signal_date,acquirer_name,transaction_type"
            ).execute()
            processed += 1
        except Exception as e:
            print(f"    [db] upsert failed: {e}")
            continue

        if score >= 75:
            alerts.append({
                "ticker":   ticker,
                "tx":       p["transaction_type"],
                "acquirer": p["acquirer_name"],
                "value_cr": p["trade_cr"],
                "score":    score,
                "tier":     tier,
            })

    print(f"\n[done] {processed} signals stored | {len(alerts)} HIGH CONVICTION alerts")
    send_telegram(alerts)


if __name__ == "__main__":
    main()

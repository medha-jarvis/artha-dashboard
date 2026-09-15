"""
Promoter Intelligence Center — Daily Dual-Stream Engine
Stream 1: NSE Bulk Deals — promoter match via promoter_entities lookup (same-day)
Stream 2: NSE SHP (shareholding pattern) — promoter % delta detection (1-10 days)
Runs Mon-Fri 7:30 PM IST via cron.
"""

import os, sys, time, json, requests, re
from datetime import date, timedelta, datetime as dt
from xml.etree import ElementTree as ET
import yfinance as yf
from supabase import create_client, Client

# ── Shared imports from existing engines ────────────────────────────────────────
sys.path.insert(0, os.path.dirname(__file__))
from insider_engine import get_nse_session, get_technicals, send_telegram as _send_tg
from super_investor_engine import (
    HFT_BLACKLIST, fetch_deals, parse_deal, net_trades, is_hft,
)
from insider_returns_updater import compute_returns_for

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
TG_TOKEN     = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TG_CHAT_ID   = os.environ.get("TELEGRAM_CHAT_ID", "")

sb: Client   = create_client(SUPABASE_URL, SUPABASE_KEY)
TODAY        = date.today().isoformat()

NSE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nseindia.com/companies-listing/corporate-filings-shareholders",
    "DNT": "1",
}

SHP_MIN_DELTA      = 0.25   # % minimum promoter change to generate a signal
SHP_XBRL_THRESHOLD = 0.5    # % delta threshold to fetch XBRL for pledge data
MIN_MCAP_CR        = 200    # skip micro-caps below this
MIN_ABS_VALUE_CR   = 2      # skip if |delta%| * mcap < Rs 2Cr
BULK_MIN_CR_EXACT  = 5.0
BULK_MIN_CR_PATTERN = 10.0  # higher bar for pattern matches


# ── Telegram ─────────────────────────────────────────────────────────────────────
def send_telegram(msg: str):
    if not TG_TOKEN or not TG_CHAT_ID:
        return
    try:
        requests.post(
            f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
            json={"chat_id": TG_CHAT_ID, "text": msg, "parse_mode": "HTML"},
            timeout=10,
        )
    except Exception as e:
        print(f"[tg] {e}")


# ── Track record bonus ───────────────────────────────────────────────────────────
def get_track_record_bonus(ticker: str) -> tuple[int, str]:
    try:
        past = sb.table("promoter_signals") \
            .select("actual_return_3m") \
            .eq("ticker", ticker).eq("signal_type", "ACCUMULATION") \
            .not_.is_("actual_return_3m", "null") \
            .order("submission_date", desc=True).limit(8).execute().data or []
    except Exception:
        return 0, "FIRST_SIGNAL"
    if not past:
        return 0, "FIRST_SIGNAL"
    avg = sum(r["actual_return_3m"] for r in past) / len(past)
    if avg >= 15: return 15, f"strong track record (avg 3m +{avg:.1f}%)"
    if avg >=  8: return 10, f"good track record (avg 3m +{avg:.1f}%)"
    if avg >=  0: return  5, f"neutral track record (avg 3m +{avg:.1f}%)"
    if avg >= -5: return -5, f"weak track record (avg 3m {avg:.1f}%)"
    return -10, f"poor track record (avg 3m {avg:.1f}%)"


# ── SHP scoring ──────────────────────────────────────────────────────────────────
def score_shp(delta: float, pledge_pct: float | None, pledge_prev: float | None,
              pledge_delta: float | None, ema_dist: float | None,
              track_bonus: int) -> tuple[int, str]:
    # Magnitude (0-50)
    abs_d = abs(delta)
    if abs_d >= 5:   mag = 50
    elif abs_d >= 3: mag = 40
    elif abs_d >= 2: mag = 32
    elif abs_d >= 1: mag = 22
    elif abs_d >= 0.5: mag = 14
    else:             mag = 8

    # Pledge context (0-30)
    pledge = pledge_pct if pledge_pct is not None else None
    if pledge is None:
        plg = 15  # unknown → neutral
    elif pledge <= 5:  plg = 30
    elif pledge <= 20: plg = 20
    elif pledge <= 50: plg = 10
    else:              plg = 0

    if pledge_delta is not None:
        if pledge_delta < 0:          plg = min(plg + 10, 40)
        elif pledge_delta > 5:        plg = max(plg - 15, 0)

    # Technical (0-20)
    if ema_dist is None:   tch = 10
    elif ema_dist <= 10:   tch = 20
    elif ema_dist <= 20:   tch = 12
    elif ema_dist <= 30:   tch = 6
    else:                  tch = 2

    raw   = mag + plg + tch + track_bonus
    final = max(0, min(100, raw))
    reason = f"mag={mag} pledge={plg} tech={tch} track={track_bonus:+d} → {final}"
    return final, reason


def tier_from_score(score: int) -> str:
    if score >= 75: return "HIGH CONVICTION"
    if score >= 50: return "NOTABLE"
    if score >= 30: return "WATCH"
    return "BEARISH"


# ── XBRL pledge & entity extraction ─────────────────────────────────────────────
def fetch_xbrl_data(xbrl_url: str) -> tuple[float | None, list[str]]:
    """Returns (pledge_pct, [promoter_names])."""
    try:
        r = requests.get(xbrl_url, headers=NSE_HEADERS, timeout=30)
        root = ET.fromstring(r.content)
        ns   = {k: v for _, (k, v) in ET.iterparse(xbrl_url.replace("https://", ""), events=["start-ns"])} if False else {}

        pledge_pct = None
        names: list[str] = []

        for elem in root.iter():
            tag = elem.tag.split("}")[-1] if "}" in elem.tag else elem.tag
            if tag == "EncumberedShareUnderPledgedAsPercentageOfTotalNumberOfShares":
                try:
                    pledge_pct = float(elem.text or 0)
                except (ValueError, TypeError):
                    pass
            if tag == "NameOfTheShareholder" and elem.text:
                n = elem.text.strip().upper()
                if n and len(n) > 3:
                    names.append(n)

        return pledge_pct, list(set(names))
    except Exception as e:
        print(f"  [xbrl] {xbrl_url[:60]}... error: {e}")
        return None, []


def upsert_promoter_entities(ticker: str, names: list[str]):
    if not names:
        return
    rows = [{"ticker": ticker, "entity_name": n, "entity_type": "PROMOTER", "source": "XBRL"} for n in names]
    try:
        sb.table("promoter_entities").upsert(rows, on_conflict="ticker,entity_name").execute()
        print(f"  [entities] {ticker}: upserted {len(names)} promoter names")
    except Exception as e:
        print(f"  [entities] upsert error: {e}")


# ── SHP fetcher ──────────────────────────────────────────────────────────────────
def fetch_shp_filings(session: requests.Session, from_date: date, to_date: date) -> list[dict]:
    fd = from_date.strftime("%d-%m-%Y")
    td = to_date.strftime("%d-%m-%Y")
    try:
        r = session.get(
            f"https://www.nseindia.com/api/corporate-share-holdings-master?index=equities&from_date={fd}&to_date={td}",
            timeout=30,
        )
        data = r.json()
        records = data if isinstance(data, list) else data.get("data", data.get("result", []))
        print(f"[shp] fetched {len(records)} filings ({fd} → {td})")
        return records
    except Exception as e:
        print(f"[shp] fetch error: {e}")
        return []


def get_previous_promoter_pct(ticker: str) -> float | None:
    try:
        row = sb.table("promoter_signals") \
            .select("promoter_pct,submission_date") \
            .eq("ticker", ticker) \
            .order("submission_date", desc=True).limit(1).execute().data
        return float(row[0]["promoter_pct"]) if row else None
    except Exception:
        return None


def get_previous_pledge_pct(ticker: str) -> float | None:
    try:
        row = sb.table("promoter_signals") \
            .select("pledge_pct") \
            .eq("ticker", ticker) \
            .not_.is_("pledge_pct", "null") \
            .order("submission_date", desc=True).limit(1).execute().data
        return float(row[0]["pledge_pct"]) if row else None
    except Exception:
        return None


# ── SHP Stream ───────────────────────────────────────────────────────────────────
def run_shp_stream(session: requests.Session) -> list[dict]:
    to_d   = date.today()
    from_d = to_d - timedelta(days=3)
    filings = fetch_shp_filings(session, from_d, to_d)

    # Deduplicate: keep latest submission per ticker
    latest: dict[str, dict] = {}
    for f in filings:
        ticker = (f.get("symbol") or "").strip().upper()
        sub_dt = f.get("submissionDate") or f.get("date") or ""
        if ticker and sub_dt:
            if ticker not in latest or sub_dt > latest[ticker].get("submissionDate", ""):
                latest[ticker] = f

    signals_inserted = []

    for ticker, filing in latest.items():
        try:
            promoter_pct_raw = filing.get("promoterAndPromoterGroupHolding") or \
                               filing.get("promoterHolding") or \
                               filing.get("promoterPct")
            if promoter_pct_raw is None:
                continue
            promoter_pct = float(str(promoter_pct_raw).replace(",", ""))
        except (ValueError, TypeError):
            continue

        prev_pct = get_previous_promoter_pct(ticker)
        if prev_pct is None:
            delta = 0.0  # first record — store but no signal yet
        else:
            delta = round(promoter_pct - prev_pct, 4)

        if abs(delta) < SHP_MIN_DELTA and prev_pct is not None:
            continue

        # Noise: micro-cap
        tech = get_technicals(ticker)
        mcap = tech.get("market_cap_cr")
        if mcap is not None and mcap < MIN_MCAP_CR:
            print(f"  [shp] skip {ticker}: micro-cap mcap={mcap:.0f}Cr")
            continue

        if mcap is not None and prev_pct is not None:
            abs_value_cr = (abs(delta) / 100) * mcap
            if abs_value_cr < MIN_ABS_VALUE_CR:
                print(f"  [shp] skip {ticker}: low abs value {abs_value_cr:.1f}Cr")
                continue

        submission_date = filing.get("submissionDate") or filing.get("date") or TODAY
        quarter_label   = filing.get("period") or filing.get("quarterEnd") or ""
        company_name    = (filing.get("companyName") or filing.get("company") or "").strip()

        # ESOP dilution check
        employee_trusts_now  = float(filing.get("employeeTrusts") or 0)
        employee_trusts_prev = 0.0  # assume zero if no prev data
        noise_flags: list[str] = []
        if delta < -0.3 and employee_trusts_now > employee_trusts_prev:
            noise_flags.append("ESOP_DILUTION_LIKELY")

        # Pledge invocation check
        prev_pledge = get_previous_pledge_pct(ticker)
        if delta < -2.0 and prev_pledge is not None and prev_pledge > 30:
            noise_flags.append("PLEDGE_INVOCATION_LIKELY")

        # Preferential allotment check
        if delta > 5.0:
            noise_flags.append("PREF_ALLOTMENT_LIKELY")

        # XBRL for pledge data on significant moves
        pledge_pct   = None
        pledge_delta = None
        promoter_names: list[str] = []
        xbrl_url = filing.get("xbrl") or filing.get("xbrlUrl") or ""

        if abs(delta) >= SHP_XBRL_THRESHOLD and xbrl_url:
            pledge_pct, promoter_names = fetch_xbrl_data(xbrl_url)
            if pledge_pct is not None and prev_pledge is not None:
                pledge_delta = round(pledge_pct - prev_pledge, 4)
            upsert_promoter_entities(ticker, promoter_names)
            time.sleep(0.5)

        # Signal type
        if "PLEDGE_INVOCATION_LIKELY" in noise_flags:
            signal_type = "PLEDGE_INVOCATION"
        elif delta > 0:
            signal_type = "ACCUMULATION"
        elif pledge_pct is not None and pledge_delta is not None:
            if pledge_delta > 5:
                signal_type = "PLEDGE_ALARM"
            elif pledge_delta < -5:
                signal_type = "PLEDGE_CLEAR"
            else:
                signal_type = "DISTRIBUTION"
        else:
            signal_type = "DISTRIBUTION"

        track_bonus, track_note = get_track_record_bonus(ticker)
        if track_note == "FIRST_SIGNAL":
            noise_flags.append("FIRST_SIGNAL")

        score, score_reason = score_shp(
            delta, pledge_pct, prev_pledge, pledge_delta,
            tech.get("ema150_dist"), track_bonus
        )
        tier = tier_from_score(score)

        row = {
            "ticker":              ticker,
            "company_name":        company_name or None,
            "submission_date":     submission_date[:10] if len(submission_date) > 10 else submission_date,
            "quarter_label":       quarter_label or None,
            "promoter_pct":        promoter_pct,
            "promoter_pct_prev":   prev_pct,
            "promoter_delta":      delta if prev_pct is not None else None,
            "pledge_pct":          pledge_pct,
            "pledge_pct_prev":     prev_pledge if pledge_pct is not None else None,
            "pledge_delta":        pledge_delta,
            "has_pledge_data":     pledge_pct is not None,
            "conviction_score":    score,
            "tier":                tier,
            "signal_type":         signal_type,
            "noise_flags":         "|".join(noise_flags) if noise_flags else None,
            "ema150_distance_pct": tech.get("ema150_dist"),
            "base_price":          tech.get("base_price"),
            "source":              "NSE_SHP",
        }

        try:
            sb.table("promoter_signals").upsert(row, on_conflict="ticker,submission_date").execute()
            print(f"  [shp] {ticker} delta={delta:+.2f}% score={score} tier={tier} flags={noise_flags}")
            if delta is not None:
                signals_inserted.append(row)
        except Exception as e:
            print(f"  [shp] upsert {ticker}: {e}")

        time.sleep(0.3)

    return signals_inserted


# ── Bulk Deal Promoter Stream ─────────────────────────────────────────────────────
def get_all_promoter_entities() -> dict[str, list[str]]:
    """Returns {ticker: [entity_name, ...]} for bulk-deal matching."""
    try:
        rows = sb.table("promoter_entities").select("ticker,entity_name").execute().data or []
        result: dict[str, list[str]] = {}
        for r in rows:
            result.setdefault(r["ticker"], []).append(r["entity_name"].upper())
        return result
    except Exception:
        return {}


def match_promoter(client_name: str, promoter_map: dict[str, list[str]]) -> tuple[str | None, str]:
    """Match a bulk deal client against known promoter entities.
    Returns (ticker, match_type) or (None, '')."""
    client_up = client_name.upper().strip()
    for ticker, names in promoter_map.items():
        for name in names:
            if client_up == name:
                return ticker, "EXACT"
        for name in names:
            # Pattern match: all words of name present in client
            words = [w for w in name.split() if len(w) > 3]
            if words and all(w in client_up for w in words):
                return ticker, "PATTERN"
    return None, ""


def score_bulk(trade_value_cr: float, match_type: str) -> int:
    if trade_value_cr >= 100: base = 50
    elif trade_value_cr >= 50: base = 40
    elif trade_value_cr >= 10: base = 30
    elif trade_value_cr >= 5:  base = 20
    else:                      base = 10

    bonus = 25 if match_type == "EXACT" else 10
    return min(100, base + bonus)


def run_bulk_stream(session: requests.Session) -> list[dict]:
    promoter_map = get_all_promoter_entities()
    if not promoter_map:
        print("[bulk] no promoter_entities in DB — skipping bulk stream")
        return []

    bulk_raw, block_raw = fetch_deals(session)
    all_raw = bulk_raw + block_raw
    print(f"[bulk] fetched {len(all_raw)} bulk/block records")

    parsed = []
    for rec in all_raw:
        p = parse_deal(rec, "BULK")
        if p:
            parsed.append(p)

    # Net round-trips
    netted = net_trades(parsed)
    inserted = []

    for deal in netted:
        client = deal.get("client", "")
        if is_hft(client):
            continue

        matched_ticker, match_type = match_promoter(client, promoter_map)
        if not matched_ticker:
            continue

        trade_cr = deal.get("trade_value_cr", 0) or 0
        min_cr   = BULK_MIN_CR_PATTERN if match_type == "PATTERN" else BULK_MIN_CR_EXACT
        if trade_cr < min_cr:
            continue

        tech   = get_technicals(matched_ticker)
        mcap   = tech.get("market_cap_cr")
        if mcap and trade_cr / mcap * 100 < 0.3:
            continue  # insignificant vs market cap

        noise_flags: list[str] = []
        if match_type == "PATTERN":
            noise_flags.append("PATTERN_MATCH_ONLY")
        if mcap and mcap < MIN_MCAP_CR:
            noise_flags.append("LOW_MCAP")

        score = score_bulk(trade_cr, match_type)
        tier  = tier_from_score(score)

        buysell = deal.get("transaction_type", "BUY")

        row = {
            "ticker":           matched_ticker,
            "company_name":     deal.get("company_name") or None,
            "signal_date":      TODAY,
            "client_name":      client,
            "transaction_type": buysell,
            "qty":              deal.get("qty"),
            "price":            deal.get("price"),
            "trade_value_cr":   round(trade_cr, 2),
            "match_type":       match_type,
            "conviction_score": score,
            "tier":             tier,
            "noise_flags":      "|".join(noise_flags) if noise_flags else None,
            "base_price":       tech.get("base_price"),
        }

        try:
            sb.table("promoter_bulk_signals").upsert(
                row, on_conflict="ticker,signal_date,client_name,transaction_type"
            ).execute()
            print(f"  [bulk] {matched_ticker} {buysell} ₹{trade_cr:.1f}Cr ({match_type}) score={score}")
            inserted.append(row)
        except Exception as e:
            print(f"  [bulk] upsert {matched_ticker}: {e}")

    return inserted


# ── Telegram summary ─────────────────────────────────────────────────────────────
def send_summary(shp_signals: list[dict], bulk_signals: list[dict]):
    if not shp_signals and not bulk_signals:
        msg = "📊 <b>Promoter Intel</b> — no new signals today"
        send_telegram(msg)
        return

    lines = ["📊 <b>Promoter Intelligence Center</b>", ""]

    high = [s for s in shp_signals if s.get("tier") == "HIGH CONVICTION"]
    if high:
        lines.append(f"🔥 <b>High Conviction ({len(high)})</b>")
        for s in high[:5]:
            d = s.get("promoter_delta")
            dstr = f"{d:+.2f}%" if d else "new"
            lines.append(f"  • {s['ticker']} {s.get('signal_type','?')} {dstr} | score {s.get('conviction_score')}")
        lines.append("")

    notable = [s for s in shp_signals if s.get("tier") == "NOTABLE"]
    if notable:
        lines.append(f"⭐ Notable ({len(notable)})")

    if bulk_signals:
        lines.append(f"\n🏦 <b>Promoter Bulk Deals ({len(bulk_signals)})</b>")
        for b in bulk_signals[:5]:
            lines.append(f"  • {b['ticker']} {b.get('transaction_type','?')} ₹{b.get('trade_value_cr',0):.0f}Cr ({b.get('match_type')})")

    lines.append(f"\nTotal: {len(shp_signals)} SHP + {len(bulk_signals)} bulk")
    send_telegram("\n".join(lines))


# ── Main ─────────────────────────────────────────────────────────────────────────
def main():
    print(f"[promoter-intel] starting — {TODAY}")
    session = get_nse_session()

    print("\n── Stream 1: Bulk Deals ──────────────────────────────")
    bulk_signals = run_bulk_stream(session)

    print("\n── Stream 2: SHP Daily Scan ──────────────────────────")
    shp_signals = run_shp_stream(session)

    print(f"\n[promoter-intel] done — {len(shp_signals)} SHP + {len(bulk_signals)} bulk signals")
    send_summary(shp_signals, bulk_signals)


if __name__ == "__main__":
    main()

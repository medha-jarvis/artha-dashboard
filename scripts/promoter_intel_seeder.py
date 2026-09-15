"""
Promoter Intelligence Seeder — 5-Year Historical Backfill
4-phase architecture: fetch SHP -> compute deltas -> yfinance prices -> score + upsert
Runtime: ~25-30 minutes. Use --dry-run to preview without DB writes.
"""

import os, sys, time, argparse, json
from datetime import date, timedelta, datetime as dt
import yfinance as yf
from supabase import create_client, Client

sys.path.insert(0, os.path.dirname(__file__))
from insider_engine import get_nse_session, get_technicals
from insider_returns_updater import get_price_on

import requests

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
sb: Client   = create_client(SUPABASE_URL, SUPABASE_KEY)

NSE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nseindia.com/companies-listing/corporate-filings-shareholders",
    "DNT": "1",
}

MIN_DELTA   = 0.25
MIN_MCAP_CR = 200
TODAY       = date.today()


# 20 quarters: Q3 FY22 (Oct 2021) → Q2 FY27 (Sep 2026)
QUARTERS = [
    ("Q3FY22", "01-10-2021", "31-12-2021"),
    ("Q4FY22", "01-01-2022", "31-03-2022"),
    ("Q1FY23", "01-04-2022", "30-06-2022"),
    ("Q2FY23", "01-07-2022", "30-09-2022"),
    ("Q3FY23", "01-10-2022", "31-12-2022"),
    ("Q4FY23", "01-01-2023", "31-03-2023"),
    ("Q1FY24", "01-04-2023", "30-06-2023"),
    ("Q2FY24", "01-07-2023", "30-09-2023"),
    ("Q3FY24", "01-10-2023", "31-12-2023"),
    ("Q4FY24", "01-01-2024", "31-03-2024"),
    ("Q1FY25", "01-04-2024", "30-06-2024"),
    ("Q2FY25", "01-07-2024", "30-09-2024"),
    ("Q3FY25", "01-10-2024", "31-12-2024"),
    ("Q4FY25", "01-01-2025", "31-03-2025"),
    ("Q1FY26", "01-04-2025", "30-06-2025"),
    ("Q2FY26", "01-07-2025", "30-09-2025"),
    ("Q3FY26", "01-10-2025", "31-12-2025"),
    ("Q4FY26", "01-01-2026", "31-03-2026"),
    ("Q1FY27", "01-04-2026", "30-06-2026"),
    ("Q2FY27", "01-07-2026", "30-09-2026"),
]


# ── Phase 1: Fetch SHP for all quarters ─────────────────────────────────────────
def fetch_quarter_shp(session, quarter_label: str, from_date: str, to_date: str) -> list[dict]:
    for attempt in range(3):
        try:
            r = session.get(
                f"https://www.nseindia.com/api/corporate-share-holdings-master?index=equities&from_date={from_date}&to_date={to_date}",
                timeout=30,
            )
            data = r.json()
            records = data if isinstance(data, list) else data.get("data", data.get("result", []))
            print(f"  [{quarter_label}] {len(records)} filings")
            return records
        except Exception as e:
            print(f"  [{quarter_label}] attempt {attempt+1} error: {e}")
            time.sleep(5)
    return []


# ── Phase 2: Compute deltas ──────────────────────────────────────────────────────
def extract_promoter_pct(filing: dict) -> float | None:
    for key in ("promoterAndPromoterGroupHolding", "promoterHolding", "promoterPct"):
        val = filing.get(key)
        if val is not None:
            try:
                return float(str(val).replace(",", ""))
            except (ValueError, TypeError):
                pass
    return None


def compute_signals(all_quarter_data: list[tuple[str, list[dict]]]) -> list[dict]:
    """
    all_quarter_data: [(quarter_label, [filings...]), ...]  sorted chronologically.
    Returns list of signal dicts.
    """
    # Build per-ticker time series
    by_ticker: dict[str, list[tuple[str, str, float, dict]]] = {}

    for qlabel, filings in all_quarter_data:
        # Keep latest submission per ticker for each quarter
        latest: dict[str, dict] = {}
        for f in filings:
            ticker = (f.get("symbol") or "").strip().upper()
            sub_dt = f.get("submissionDate") or f.get("date") or ""
            if ticker and sub_dt:
                if ticker not in latest or sub_dt > latest[ticker].get("submissionDate", ""):
                    latest[ticker] = f

        for ticker, filing in latest.items():
            pct = extract_promoter_pct(filing)
            if pct is None:
                continue
            sub_dt = (filing.get("submissionDate") or filing.get("date") or "")[:10]
            company = (filing.get("companyName") or filing.get("company") or "").strip()
            by_ticker.setdefault(ticker, []).append((qlabel, sub_dt, pct, filing))

    signals: list[dict] = []
    for ticker, history in by_ticker.items():
        history.sort(key=lambda x: x[1])  # sort by submission date
        for i in range(1, len(history)):
            qlabel, sub_dt, pct_now, filing = history[i]
            _, _, pct_prev, prev_filing     = history[i - 1]
            delta = round(pct_now - pct_prev, 4)
            if abs(delta) < MIN_DELTA:
                continue

            noise_flags: list[str] = []

            # ESOP dilution check
            et_now  = float(filing.get("employeeTrusts") or 0)
            et_prev = float(prev_filing.get("employeeTrusts") or 0)
            if delta < -0.3 and et_now > et_prev:
                noise_flags.append("ESOP_DILUTION_LIKELY")

            if delta < -2.0:
                noise_flags.append("PLEDGE_INVOCATION_CHECK")

            if delta > 5.0:
                noise_flags.append("PREF_ALLOTMENT_LIKELY")

            # Signal type
            if delta > 0:
                signal_type = "ACCUMULATION"
            else:
                signal_type = "DISTRIBUTION"

            company = (filing.get("companyName") or filing.get("company") or "").strip()

            signals.append({
                "ticker":           ticker,
                "company_name":     company or None,
                "submission_date":  sub_dt,
                "quarter_label":    qlabel,
                "promoter_pct":     pct_now,
                "promoter_pct_prev": pct_prev,
                "promoter_delta":   delta,
                "has_pledge_data":  False,
                "signal_type":      signal_type,
                "noise_flags":      "|".join(noise_flags) if noise_flags else None,
                "source":           "NSE_SHP",
            })

    print(f"[seeder] Phase 2 complete: {len(signals)} candidate signals")
    return signals


# ── Phase 3: Price histories ─────────────────────────────────────────────────────
def fetch_price_histories(tickers: list[str]) -> dict[str, object]:
    price_histories: dict[str, object] = {}
    total = len(tickers)
    for i, ticker in enumerate(tickers, 1):
        ns = ticker if ticker.endswith(".NS") else ticker + ".NS"
        try:
            t    = yf.Ticker(ns)
            hist = t.history(period="5y", interval="1d", auto_adjust=True)
            if not hist.empty:
                price_histories[ticker] = hist
            if i % 50 == 0:
                print(f"  [prices] {i}/{total} fetched")
        except Exception as e:
            print(f"  [prices] {ticker}: {e}")
        time.sleep(0.4)
    print(f"[seeder] Phase 3 complete: {len(price_histories)}/{total} price histories")
    return price_histories


def pct_return(hist, base_date: date, fwd_days: int) -> float | None:
    target = base_date + timedelta(days=fwd_days)
    if target > TODAY:
        return None
    try:
        base_px = get_price_on(None, hist, base_date)
        tgt_px  = get_price_on(None, hist, target)
        if base_px and tgt_px:
            return round((tgt_px / base_px - 1) * 100, 2)
    except Exception:
        pass
    return None


# ── Phase 4: Score + upsert ──────────────────────────────────────────────────────
def score_shp_simple(delta: float, ema_dist: float | None) -> tuple[int, str]:
    abs_d = abs(delta)
    if abs_d >= 5:   mag = 50
    elif abs_d >= 3: mag = 40
    elif abs_d >= 2: mag = 32
    elif abs_d >= 1: mag = 22
    elif abs_d >= 0.5: mag = 14
    else:              mag = 8

    if ema_dist is None:   tch = 10
    elif ema_dist <= 10:   tch = 20
    elif ema_dist <= 20:   tch = 12
    elif ema_dist <= 30:   tch = 6
    else:                  tch = 2

    # No track-record bonus for seeder (circular; let returns_updater handle later)
    raw = mag + 15 + tch  # pledge=15 (unknown default)
    return max(0, min(100, raw)), f"mag={mag} pledge=15(default) tech={tch}"


def tier_from_score(score: int) -> str:
    if score >= 75: return "HIGH CONVICTION"
    if score >= 50: return "NOTABLE"
    if score >= 30: return "WATCH"
    return "BEARISH"


def upsert_batch(signals_batch: list[dict], dry_run: bool):
    if dry_run:
        for s in signals_batch[:3]:
            print(f"  DRY-RUN: {s['ticker']} {s['submission_date']} delta={s.get('promoter_delta'):+.2f}%"
                  f" score={s.get('conviction_score')} r3m={s.get('actual_return_3m')}")
        return

    try:
        sb.table("promoter_signals").upsert(
            signals_batch, on_conflict="ticker,submission_date"
        ).execute()
    except Exception as e:
        print(f"  [upsert] batch error: {e}")
        # fallback: one by one
        for row in signals_batch:
            try:
                sb.table("promoter_signals").upsert(row, on_conflict="ticker,submission_date").execute()
            except Exception as e2:
                print(f"  [upsert] {row['ticker']} {row['submission_date']}: {e2}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--years", type=int, default=5)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    quarters_to_use = QUARTERS[-args.years * 4:] if args.years < 5 else QUARTERS
    print(f"[seeder] starting — {len(quarters_to_use)} quarters, dry_run={args.dry_run}")

    # Phase 1
    session = get_nse_session()
    all_quarter_data: list[tuple[str, list[dict]]] = []
    for qlabel, fd, td in quarters_to_use:
        filings = fetch_quarter_shp(session, qlabel, fd, td)
        all_quarter_data.append((qlabel, filings))
        time.sleep(1)

    # Phase 2
    signals = compute_signals(all_quarter_data)
    if args.dry_run:
        print(f"\nDRY RUN — {len(signals)} signals would be processed")
        print("Sample (first 10):")
        for s in signals[:10]:
            print(f"  {s['ticker']:12} {s['submission_date']}  delta={s['promoter_delta']:+.2f}%  {s['signal_type']}")
        return

    # Phase 3
    unique_tickers = list(set(s["ticker"] for s in signals))
    print(f"\n[seeder] Phase 3: fetching price histories for {len(unique_tickers)} tickers...")
    price_histories = fetch_price_histories(unique_tickers)

    # Phase 4
    print(f"\n[seeder] Phase 4: scoring + computing returns...")
    batch: list[dict] = []
    skipped_mcap = 0

    for sig in signals:
        ticker = sig["ticker"]
        hist   = price_histories.get(ticker)

        # EMA dist from price history
        ema_dist = None
        base_price = None
        if hist is not None and len(hist) >= 150:
            try:
                close     = hist["Close"].squeeze()
                ema150    = float(close.ewm(span=150, adjust=False).mean().iloc[-1])
                last_c    = float(close.iloc[-1])
                ema_dist  = round((last_c - ema150) / ema150 * 100, 2)
                base_price = round(last_c, 2)
            except Exception:
                pass

        score, _ = score_shp_simple(sig["promoter_delta"], ema_dist)
        tier      = tier_from_score(score)

        # Returns
        sub_date = date.fromisoformat(sig["submission_date"])
        r3m  = pct_return(hist, sub_date, 91)  if hist is not None else None
        r6m  = pct_return(hist, sub_date, 183) if hist is not None else None
        r1y  = pct_return(hist, sub_date, 365) if hist is not None else None

        sig.update({
            "conviction_score":    score,
            "tier":                tier,
            "ema150_distance_pct": ema_dist,
            "base_price":          base_price,
            "actual_return_3m":    r3m,
            "actual_return_6m":    r6m,
            "actual_return_1y":    r1y,
            "returns_updated_at":  dt.utcnow().isoformat() if any([r3m, r6m, r1y]) else None,
        })
        batch.append(sig)

        if len(batch) >= 100:
            upsert_batch(batch, dry_run=False)
            print(f"  [upsert] {len(batch)} rows flushed")
            batch = []

    if batch:
        upsert_batch(batch, dry_run=False)
        print(f"  [upsert] final {len(batch)} rows flushed")

    print(f"\n[seeder] complete — {len(signals)} signals seeded, {skipped_mcap} skipped (micro-cap)")


if __name__ == "__main__":
    main()

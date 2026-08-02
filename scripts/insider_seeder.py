"""
Insider Seeder — backfills 6 months of real NSE PIT data into insider_signals.

Data source: NSE PIT date-range endpoint (works from Indian IP / VPS only).
Fetches Market Purchase / Market Sale by Promoters, Directors, KMP.
Scores each trade using the v2 engine scoring.
For trades > 90 days old, also computes actual 3m/6m/1y returns via yfinance.

Usage:
    python scripts/insider_seeder.py                     # last 6 months
    python scripts/insider_seeder.py --from 2026-01-01   # custom start date
    python scripts/insider_seeder.py --dry-run           # print without inserting
"""

import os, time, argparse, sys, pathlib
from datetime import date, timedelta, datetime as dt
import yfinance as yf
from supabase import create_client, Client
import requests

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]

sb: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Import scoring helpers from insider_engine
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from insider_engine import (
    get_nse_session, parse_record, get_technicals,
    score_credibility, compute_score, tier_from_score, check_cluster
)
from insider_returns_updater import compute_returns_for

NSE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://www.nseindia.com/companies-listing/corporate-filings-insider-trading",
}

TODAY = date.today()


def fetch_pit_range(from_date: date, to_date: date) -> list[dict]:
    """Fetch NSE PIT disclosures for a date range. Requires Indian IP."""
    session = get_nse_session()
    fd = from_date.strftime("%d-%m-%Y")
    td = to_date.strftime("%d-%m-%Y")
    url = f"https://www.nseindia.com/api/corporates-pit?index=equities&from_date={fd}&to_date={td}"
    try:
        r = session.get(url, timeout=30)
        data = r.json()
        records = data if isinstance(data, list) else data.get("data", data.get("result", []))
        print(f"[nse] fetched {len(records)} PIT records for {fd} → {td}")
        return records
    except Exception as e:
        print(f"[nse] fetch failed: {e}")
        return []


def get_price_on(hist, target_date: date) -> float | None:
    """Find closing price nearest to target_date in yfinance history df."""
    try:
        idx = hist.index.tz_localize(None) if hist.index.tzinfo else hist.index
        target = dt.combine(target_date, dt.min.time())
        diffs  = abs(idx - target)
        pos    = int(diffs.argmin())
        if diffs[pos].days > 7:
            return None
        return float(hist["Close"].iloc[pos])
    except Exception:
        return None


def get_base_price_on_date(ticker: str, signal_date: date) -> float | None:
    """Get the actual stock price ON the signal date."""
    ns = ticker if ticker.endswith(".NS") else ticker + ".NS"
    try:
        t = yf.Ticker(ns)
        hist = t.history(
            start=(signal_date - timedelta(days=5)).isoformat(),
            end=(signal_date + timedelta(days=5)).isoformat(),
            interval="1d", auto_adjust=True
        )
        time.sleep(0.3)
        return get_price_on(hist, signal_date)
    except Exception:
        return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--from", dest="from_date", default=None,
                        help="Start date YYYY-MM-DD (default: 6 months ago)")
    parser.add_argument("--to",   dest="to_date",   default=None,
                        help="End date YYYY-MM-DD (default: today)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print results without inserting to DB")
    args = parser.parse_args()

    from_date = date.fromisoformat(args.from_date) if args.from_date else TODAY - timedelta(days=183)
    to_date   = date.fromisoformat(args.to_date)   if args.to_date   else TODAY

    print(f"=== Insider Seeder — {from_date} → {to_date} ===")
    if args.dry_run:
        print("[dry-run] no DB writes")

    # Fetch raw PIT data
    records = fetch_pit_range(from_date, to_date)
    if not records:
        print("[seeder] no records fetched — check NSE access (Indian IP required)")
        return

    # Parse and filter
    parsed = []
    for rec in records:
        p = parse_record(rec)
        if p and p["ticker"]:
            parsed.append(p)

    print(f"[filter] {len(parsed)} qualifying trades (≥₹50L, promoter/director, market)")

    # Group by ticker to avoid re-fetching yfinance data
    by_ticker: dict[str, list[dict]] = {}
    for p in parsed:
        by_ticker.setdefault(p["ticker"], []).append(p)

    inserted, skipped = 0, 0
    cutoff_3m = TODAY - timedelta(days=91)

    for ticker, trades in sorted(by_ticker.items()):
        print(f"\n── {ticker} ({len(trades)} trades) ──")

        # Fetch current technicals once per ticker
        tech = get_technicals(ticker)
        time.sleep(0.3)

        # Also fetch full history for base price computation (for old trades)
        ns = ticker if ticker.endswith(".NS") else ticker + ".NS"
        full_hist = None
        oldest_trade_date = min(date.fromisoformat(t["signal_date"]) for t in trades)
        if oldest_trade_date < cutoff_3m:
            try:
                yf_t = yf.Ticker(ns)
                full_hist = yf_t.history(
                    start=(oldest_trade_date - timedelta(days=10)).isoformat(),
                    end=(TODAY + timedelta(days=1)).isoformat(),
                    interval="1d", auto_adjust=True
                )
                time.sleep(0.5)
            except Exception as e:
                print(f"  [yf full history] {e}")

        for p in sorted(trades, key=lambda x: x["signal_date"]):
            sig_date = date.fromisoformat(p["signal_date"])
            print(f"  {p['signal_date']} | {p['acquirer_name'][:30]} | {p['transaction_type']} | ₹{p['trade_value_cr']:.1f}Cr", end="  ")

            # equity_pct
            equity_pct = None
            if tech["shares_out"] and p["secs_traded"]:
                equity_pct = round(p["secs_traded"] / tech["shares_out"] * 100, 4)

            # EMA distance at time of trade (use current as proxy for recent, historical approx for old)
            ema_dist = tech["ema150_dist"]  # approximation for older trades

            # Get past returns for credibility (signals already in DB)
            from insider_engine import get_past_returns
            past = get_past_returns(p["acquirer_name"], ticker)
            cred, _ = score_credibility(past, p["transaction_type"])
            score    = compute_score(p["trade_value_cr"], equity_pct, cred, ema_dist, p["transaction_type"])
            tier     = tier_from_score(score)

            if score < 50:
                print(f"score={score} → NOISE, skip")
                skipped += 1
                continue

            cluster = check_cluster(ticker, p["transaction_type"], p["signal_date"])

            # Base price on actual trade date
            base_price = None
            if full_hist is not None and not full_hist.empty:
                base_price = get_price_on(full_hist, sig_date)
            if base_price is None:
                base_price = tech["base_price"]  # fallback: current price

            # Actual returns for old signals
            ret_3m = ret_6m = ret_1y = None
            if sig_date <= cutoff_3m and full_hist is not None and not full_hist.empty and base_price:
                d3m = sig_date + timedelta(days=91)
                d6m = sig_date + timedelta(days=183)
                d1y = sig_date + timedelta(days=365)

                p3 = get_price_on(full_hist, d3m)
                p6 = get_price_on(full_hist, d6m)
                p1 = get_price_on(full_hist, d1y)

                if p3: ret_3m = round((p3 - base_price) / base_price * 100, 2)
                if p6: ret_6m = round((p6 - base_price) / base_price * 100, 2)
                if p1 and TODAY >= d1y: ret_1y = round((p1 - base_price) / base_price * 100, 2)

            row = {
                "ticker":              ticker,
                "company_name":        p["company_name"] or ticker,
                "acquirer_name":       p["acquirer_name"],
                "transaction_type":    p["transaction_type"],
                "signal_date":         p["signal_date"],
                "insider_score":       score,
                "trade_value_in_cr":   p["trade_value_cr"],
                "equity_pct_traded":   equity_pct,
                "ema150_distance_pct": ema_dist,
                "cluster_trade_flag":  cluster,
                "tier":                tier,
                "base_price":          round(base_price, 2) if base_price else None,
                "person_category":     p["person_category"],
                "secs_traded":         p["secs_traded"],
                "actual_return_3m":    ret_3m,
                "actual_return_6m":    ret_6m,
                "actual_return_1y":    ret_1y,
            }

            ret_str = f"3m={ret_3m:+.1f}%" if ret_3m is not None else ""
            if ret_6m is not None: ret_str += f" 6m={ret_6m:+.1f}%"
            print(f"score={score} cred={cred}/60 tier={tier} {ret_str}")

            if args.dry_run:
                continue

            try:
                sb.table("insider_signals").upsert(
                    row, on_conflict="ticker,signal_date,acquirer_name,transaction_type"
                ).execute()
                inserted += 1
            except Exception as e:
                print(f"    [db] {e}")

    print(f"\n=== Seeder done — {inserted} inserted, {skipped} skipped (score<50) ===")


if __name__ == "__main__":
    main()

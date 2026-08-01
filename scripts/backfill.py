"""
Backfill — seeds last N days of earnings into pead_signals.

Uses NSE India's corporate results API to get the list of companies that
reported in the date range, then runs full PEAD scoring via yfinance.

Usage:
    python scripts/backfill.py --days 7
    python scripts/backfill.py --from 2026-07-25 --to 2026-08-01
"""

import os, time, argparse, asyncio
from datetime import date, timedelta
import requests
import yfinance as yf

# Import scoring helpers from pead_engine
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from pead_engine import compute_score, path_from_score, upsert_signal

# ── NSE session ────────────────────────────────────────────────────────────────
NSE_HEADERS = {
    "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept":          "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer":         "https://www.nseindia.com/",
    "DNT":             "1",
}


def get_nse_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(NSE_HEADERS)
    try:
        session.get("https://www.nseindia.com", timeout=15)
        time.sleep(1)
    except Exception as e:
        print(f"[nse] session init: {e}")
    return session


def get_nse_results(session: requests.Session, from_date: date, to_date: date) -> list[dict]:
    """
    Fetches corporate quarterly results from NSE for the date range.
    Returns list of {symbol, companyName, broadcastDate}.
    """
    fd = from_date.strftime("%d-%m-%Y")
    td = to_date.strftime("%d-%m-%Y")
    url = (f"https://www.nseindia.com/api/corporates-financial-results"
           f"?index=equities&period=Quarterly&from_date={fd}&to_date={td}")
    try:
        r = session.get(url, timeout=20)
        data = r.json()
        results = data if isinstance(data, list) else data.get("data", [])
        print(f"[nse] {len(results)} results from {fd} to {td}")
        return results
    except Exception as e:
        print(f"[nse] API error: {e}")
        return []


# ── yfinance helpers ───────────────────────────────────────────────────────────
def get_historical_technicals(ticker: str, result_date: date) -> dict:
    """
    Gets OHLCV-derived technicals using data available ON the result_date.
    Uses historical slice — no look-ahead.
    """
    ns = ticker if ticker.endswith(".NS") else ticker + ".NS"
    out = dict(price_vs_ema200_pct=None, vol_mult=None, day_gap_pct=None,
               company_name=None, sector=None, ttm_pe=None)
    try:
        t  = yf.Ticker(ns)
        # Use history up to and including result_date
        end = result_date + timedelta(days=1)
        df  = t.history(start=(result_date - timedelta(days=300)).isoformat(),
                        end=end.isoformat(), interval="1d", auto_adjust=True)
        inf = t.info

        out["company_name"] = inf.get("longName") or inf.get("shortName")
        out["sector"]       = inf.get("sector")
        out["ttm_pe"]       = inf.get("trailingPE")

        if df.empty or len(df) < 22:
            return out

        close  = df["Close"]
        volume = df["Volume"]
        open_  = df["Open"]

        ema200   = float(close.ewm(span=200, adjust=False).mean().iloc[-1])
        vol_sma  = float(volume.rolling(20).mean().iloc[-2])
        last_c   = float(close.iloc[-1])
        last_o   = float(open_.iloc[-1])
        last_v   = float(volume.iloc[-1])

        out["price_vs_ema200_pct"] = round((last_c - ema200) / ema200 * 100, 2)
        out["vol_mult"]            = round(last_v / vol_sma, 2) if vol_sma > 0 else 0
        out["day_gap_pct"]         = round((last_c - last_o) / last_o * 100, 2) if last_o else 0

    except Exception as e:
        print(f"  [tech] {ns} on {result_date}: {e}")
    return out


def get_quarterly_fundamentals(ticker: str) -> dict:
    """
    Gets YoY profit, revenue growth, and OPM expansion from yfinance quarterly data.
    Compares most recent quarter to same quarter last year.
    """
    ns = ticker if ticker.endswith(".NS") else ticker + ".NS"
    out = dict(yoy_profit=None, yoy_revenue=None, opm_bps=None)
    try:
        t  = yf.Ticker(ns)
        qf = t.quarterly_financials

        if qf is None or qf.empty or qf.shape[1] < 4:
            return out

        # Rows: Total Revenue, Net Income, Operating Income, etc.
        # Cols: most recent quarter first
        cols = qf.columns.tolist()
        # Compare most recent (0) vs same quarter last year (4 quarters back = col 4)
        if len(cols) < 5:
            return out

        def safe(df, row_key, col_idx):
            try:
                matching = [k for k in df.index if row_key.lower() in str(k).lower()]
                if not matching: return None
                v = df.loc[matching[0], cols[col_idx]]
                return float(v) if v is not None and v == v else None
            except Exception:
                return None

        rev_curr  = safe(qf, "Total Revenue", 0)
        rev_prev  = safe(qf, "Total Revenue", 4)
        net_curr  = safe(qf, "Net Income",    0)
        net_prev  = safe(qf, "Net Income",    4)
        opi_curr  = safe(qf, "Operating",     0)
        opi_prev  = safe(qf, "Operating",     4)

        if rev_curr and rev_prev and rev_prev != 0:
            out["yoy_revenue"] = round((rev_curr - rev_prev) / abs(rev_prev) * 100, 2)
        if net_curr and net_prev and net_prev != 0:
            out["yoy_profit"]  = round((net_curr - net_prev) / abs(net_prev) * 100, 2)
        if opi_curr and rev_curr and opi_prev and rev_prev and rev_prev != 0 and rev_curr != 0:
            opm_c = opi_curr / rev_curr * 100
            opm_p = opi_prev / rev_prev * 100
            out["opm_bps"] = round((opm_c - opm_p) * 100, 1)

    except Exception as e:
        print(f"  [fund] {ns}: {e}")
    return out


# ── Main backfill ──────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=7, help="Days to backfill (from today)")
    parser.add_argument("--from", dest="from_date", type=str, help="YYYY-MM-DD")
    parser.add_argument("--to",   dest="to_date",   type=str, help="YYYY-MM-DD")
    args = parser.parse_args()

    today = date.today()
    if args.from_date:
        from_date = date.fromisoformat(args.from_date)
        to_date   = date.fromisoformat(args.to_date) if args.to_date else today
    else:
        from_date = today - timedelta(days=args.days)
        to_date   = today

    print(f"=== Backfill {from_date} → {to_date} ===")

    # Step 1: Get ticker list from NSE
    session  = get_nse_session()
    nse_data = get_nse_results(session, from_date, to_date)

    if not nse_data:
        print("[backfill] No NSE data — try a different date range or check NSE API status")
        return

    # Group by broadcast date
    from collections import defaultdict
    by_date: dict[str, list[dict]] = defaultdict(list)
    for item in nse_data:
        symbol = (item.get("symbol") or item.get("SYMBOL") or "").strip().upper()
        bdate  = (item.get("broadcastDate") or item.get("BROADCAST_DATE") or "").strip()
        cname  = (item.get("companyName") or item.get("COMPANY_NAME") or symbol).strip()

        if not symbol or not bdate:
            continue

        # Convert DD-MMM-YYYY to YYYY-MM-DD
        try:
            from datetime import datetime as dt
            parsed = dt.strptime(bdate, "%d-%b-%Y").date()
            if from_date <= parsed <= to_date:
                by_date[parsed.isoformat()].append({
                    "ticker":       symbol,
                    "company_name": cname,
                    "bdate":        parsed.isoformat(),
                })
        except Exception:
            continue

    total = sum(len(v) for v in by_date.values())
    print(f"[backfill] {total} records across {len(by_date)} dates")

    processed = 0
    for signal_date_str, companies in sorted(by_date.items()):
        signal_date = date.fromisoformat(signal_date_str)
        print(f"\n─── {signal_date_str} ({len(companies)} companies) ───")

        for co in companies:
            ticker       = co["ticker"]
            company_name = co["company_name"]
            print(f"  {ticker}")

            tech  = get_historical_technicals(ticker, signal_date)
            time.sleep(0.5)
            fund  = get_quarterly_fundamentals(ticker)
            time.sleep(0.5)

            score = compute_score(
                yoy_profit  = fund.get("yoy_profit"),
                yoy_revenue = fund.get("yoy_revenue"),
                opm_bps     = fund.get("opm_bps"),
                price_vs_ema= tech.get("price_vs_ema200_pct"),
                vol_mult    = tech.get("vol_mult"),
                day_gap     = tech.get("day_gap_pct"),
            )
            path  = path_from_score(score)
            ttm_pe = tech.get("ttm_pe")
            cname  = tech.get("company_name") or company_name
            sector = tech.get("sector")

            sig_id = upsert_signal(
                ticker       = ticker,
                company_name = cname,
                sector       = sector,
                signal_date  = signal_date_str,
                score        = score,
                trigger_path = path,
                yoy_profit   = fund.get("yoy_profit"),
                yoy_revenue  = fund.get("yoy_revenue"),
                opm_bps      = fund.get("opm_bps"),
                price_vs_ema = tech.get("price_vs_ema200_pct"),
                vol_mult     = tech.get("vol_mult"),
                day_gap      = tech.get("day_gap_pct"),
                ttm_pe       = ttm_pe,
            )
            status = f"score={score} path={path}"
            print(f"    → {status} {'✓' if sig_id else '✗'}")
            processed += 1

    print(f"\n[backfill] done — {processed}/{total} records processed")


if __name__ == "__main__":
    main()

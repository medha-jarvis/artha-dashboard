"""
Super Investor Backfill — two modes:

  1. --today   : seeds today's/last-trading-day's data from NSE live API.
                 Safe to re-run (unique constraint prevents duplicates).
                 Run this now to get data immediately.

  2. --csv <file> : bulk-import from manually downloaded NSE CSV.
                    Download from: https://www.nseindia.com/market-data/bulk-block-deals
                    Click the date picker → select range → hit Download.
                    Expected CSV columns (NSE format):
                      Date, Symbol, Security Name, Client Name,
                      Buy/Sell, Qty Traded, Trade Price / Wt. Avg. Price, Remarks

WHY NO AUTO HISTORICAL BACKFILL:
  NSE's public snapshot-capital-market-largedeal API ignores from_date/to_date params
  and always returns the most recent trading day's data. All historical/* endpoints
  return 503. There is no free programmatic way to access NSE bulk deal history.
  For 6-month history, download month-by-month CSVs from the NSE website and
  run: python3 scripts/super_investor_backfill.py --csv bulk_jan2026.csv

Usage:
  python3 scripts/super_investor_backfill.py --today
  python3 scripts/super_investor_backfill.py --csv /path/to/bulk_deals.csv
"""

import os, sys, time, csv, io, requests
from datetime import date, datetime
from collections import defaultdict
from supabase import create_client, Client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]

sb: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

NSE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://www.nseindia.com/market-data/bulk-block-deals",
    "DNT": "1",
}

HFT_BLACKLIST = [
    'GRAVITON', 'HRTI', 'TOWER RESEARCH', 'JANE STREET', 'OPTIVER', 'CITADEL',
    'IRAGE', 'NK SECURITIES', 'QE SECURITIES', 'MICROCURVES', 'JUNOMONETA',
    'ACME CAPITAL', 'ARIHANT CAPITAL', 'SILVERLEAF', 'DEALMONEY', 'ALTIZEN',
    'CHAUBARA', 'ALPHAGREP', 'ESTEE', 'QUADEYE', 'MULTIPLIER',
]

SUPER_INVESTOR_WHITELIST = [
    'RAKESH JHUNJHUNWALA', 'RARE ENTERPRISES', 'REKHA JHUNJHUNWALA',
    'ASHISH KACHOLIA', 'RADHAKISHAN DAMANI', 'DERIVE INVESTMENTS',
    'SUNIL SINGHANIA', 'ABAKKUS', 'VIJAY KEDIA', 'MUKUL AGRAWAL',
    'DOLLY KHANNA', 'NEMISH', 'AKASH BHANSHALI', 'VALLABH BHANSHALI',
    'ASHISH DHAWAN', 'PORINJU', 'MOHNISH PABRAI',
    'GOVERNMENT OF SINGAPORE', 'ABU DHABI INVESTMENT', 'VANGUARD',
    'GOLDMAN SACHS', 'NOMURA', 'MORGAN STANLEY', 'SOCIETE GENERALE',
    'COPTHALL', 'NALANDA', 'WHITE OAK', 'STEADVIEW', 'MALABAR',
    'WARD FERRY', 'GOVINDLAL M PARIKH', 'GOVIND PARIKH', 'CHINMAY PARIKH',
    'SANDHYA PARIKH', 'ASHISH PARIKH',
    # Additional institutional smart money
    'FIH MAURITIUS', 'FAIRFAX', 'AMERICAN FUNDS', 'SMALLCAP WORLD FUND',
    'FIDELITY', 'BLACKROCK', 'ABERDEEN', 'FRANKLIN TEMPLETON',
    'KOTAK MUTUAL', 'MIRAE ASSET', 'AXIS MUTUAL',
]

MIN_TRADE_VALUE_CR = 5.0


def is_hft(client: str) -> bool:
    return any(h in client for h in HFT_BLACKLIST)


def is_super_investor(client: str) -> bool:
    return any(w in client for w in SUPER_INVESTOR_WHITELIST)


def parse_nse_date(s: str) -> str | None:
    for fmt in ("%d-%b-%Y", "%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%d %b %Y"):
        try:
            return datetime.strptime(s.strip(), fmt).date().isoformat()
        except ValueError:
            continue
    return None


def net_and_upsert(raw_records: list[dict]) -> int:
    """Group by (ticker, client, date), net buys vs sells, upsert qualifying rows."""
    groups: dict = defaultdict(lambda: {
        "buy_qty": 0, "buy_val": 0.0, "sell_qty": 0, "sell_val": 0.0, "deal_type": "BULK",
    })
    for r in raw_records:
        key = (r["ticker"], r["client"], r["signal_date"])
        g = groups[key]
        g["deal_type"] = r.get("deal_type", "BULK")
        if r["txn"] == "BUY":
            g["buy_qty"] += r["qty"]; g["buy_val"] += r["qty"] * r["price"]
        else:
            g["sell_qty"] += r["qty"]; g["sell_val"] += r["qty"] * r["price"]

    rows = []
    for (ticker, client, sig_date), g in groups.items():
        net_qty = g["buy_qty"] - g["sell_qty"]
        if net_qty > 0:
            txn = "BUY";  avg_price = g["buy_val"]  / g["buy_qty"]  if g["buy_qty"]  else 0.0
        elif net_qty < 0:
            txn = "SELL"; avg_price = g["sell_val"] / g["sell_qty"] if g["sell_qty"] else 0.0; net_qty = abs(net_qty)
        else:
            continue

        trade_value_cr = (net_qty * avg_price) / 10_000_000
        if trade_value_cr < MIN_TRADE_VALUE_CR:
            continue

        rows.append({
            "ticker": ticker, "client_name": client,
            "deal_type": g["deal_type"], "transaction_type": txn,
            "signal_date": sig_date, "net_quantity": net_qty,
            "avg_price": round(avg_price, 2), "trade_value_cr": round(trade_value_cr, 4),
        })

    if rows:
        sb.table("super_investor_signals").upsert(
            rows, on_conflict="ticker,client_name,signal_date"
        ).execute()
    return len(rows)


# ── Mode 1: seed today via live API ─────────────────────────────────────────

def run_today():
    print("[backfill --today] seeding last trading day from NSE live API")
    session = requests.Session(); session.headers.update(NSE_HEADERS)
    try:
        session.get("https://www.nseindia.com", timeout=15); time.sleep(2)
        session.get("https://www.nseindia.com/market-data/bulk-block-deals", timeout=10); time.sleep(1)
    except Exception as e:
        print(f"  session init: {e}")

    try:
        r = session.get("https://www.nseindia.com/api/snapshot-capital-market-largedeal", timeout=20)
        data = r.json()
    except Exception as e:
        print(f"  fetch failed: {e}"); return

    bulk  = data.get("BULK_DEALS_DATA",  []) or []
    block = data.get("BLOCK_DEALS_DATA", []) or []
    print(f"  fetched bulk={len(bulk)}, block={len(block)}")

    raw = []
    for rec in bulk + block:
        deal_type   = "BULK" if rec in bulk else "BLOCK"
        ticker      = rec.get("symbol",     "").strip().upper()
        client      = rec.get("clientName", "").strip().upper()
        bs_raw      = rec.get("buySell",    "").strip().upper()
        qty_raw     = rec.get("qty",  "0")
        price_raw   = rec.get("watp", "0")
        date_raw    = rec.get("date", "")
        signal_date = parse_nse_date(date_raw) or date.today().isoformat()

        if not ticker or not client: continue
        if bs_raw not in ("BUY", "SELL"): continue
        if is_hft(client) or not is_super_investor(client): continue
        try:
            qty   = int(str(qty_raw).replace(",", ""))
            price = float(str(price_raw).replace(",", ""))
        except: continue
        if qty <= 0 or price <= 0: continue

        raw.append({"ticker": ticker, "client": client, "txn": bs_raw,
                    "qty": qty, "price": price, "deal_type": deal_type, "signal_date": signal_date})

    n = net_and_upsert(raw)
    print(f"  {n} qualifying trades upserted")


# ── Mode 2: import from manually downloaded NSE CSV ─────────────────────────

def run_csv(filepath: str):
    """
    Import from NSE bulk/block deal CSV download.
    Download from: NSE website → Market Data → Bulk/Block Deals → select date range → Download
    """
    print(f"[backfill --csv] importing {filepath}")
    deal_type = "BLOCK" if "block" in filepath.lower() else "BULK"

    raw = []
    try:
        with open(filepath, "r", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for row in reader:
                # NSE CSV columns (may vary slightly):
                # Date | Symbol | Security Name | Client Name | Buy/Sell | Qty Traded | Trade Price/Wt Avg Price | Remarks
                ticker    = (row.get("Symbol") or row.get("SYMBOL") or "").strip().upper()
                client    = (row.get("Client Name") or row.get("CLIENT NAME") or row.get("clientName") or "").strip().upper()
                bs_raw    = (row.get("Buy/Sell") or row.get("BUY/SELL") or "").strip().upper()
                qty_raw   = row.get("Qty Traded") or row.get("QTY TRADED") or row.get("qty") or "0"
                price_raw = (row.get("Trade Price / Wt. Avg. Price") or row.get("Trade Price/Wt Avg Price")
                             or row.get("TRADE PRICE /WT. AVG. PRICE") or row.get("watp") or "0")
                date_raw  = (row.get("Date") or row.get("DATE") or row.get("date") or "").strip()

                if not ticker or not client: continue
                signal_date = parse_nse_date(date_raw)
                if not signal_date: continue

                if "BUY" in bs_raw:   txn = "BUY"
                elif "SELL" in bs_raw: txn = "SELL"
                else: continue

                if is_hft(client) or not is_super_investor(client): continue

                try:
                    qty   = int(str(qty_raw).replace(",", ""))
                    price = float(str(price_raw).replace(",", ""))
                except: continue
                if qty <= 0 or price <= 0: continue

                raw.append({"ticker": ticker, "client": client, "txn": txn,
                            "qty": qty, "price": price, "deal_type": deal_type, "signal_date": signal_date})

    except FileNotFoundError:
        print(f"  File not found: {filepath}"); return

    print(f"  parsed {len(raw)} matching records from CSV")

    # Group by date for reporting
    from collections import Counter
    date_counts = Counter(r["signal_date"] for r in raw)
    for d, c in sorted(date_counts.items()): print(f"    {d}: {c} qualifying pre-net records")

    n = net_and_upsert(raw)
    print(f"  {n} rows upserted to super_investor_signals")


# ── Entry point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if "--csv" in sys.argv:
        idx = sys.argv.index("--csv")
        if idx + 1 >= len(sys.argv):
            print("Usage: python3 super_investor_backfill.py --csv /path/to/file.csv")
            sys.exit(1)
        run_csv(sys.argv[idx + 1])
    else:
        # Default: seed today's data
        run_today()

"""
Super Investor Backfill — fetches 6 months of historical NSE bulk/block deals.
Runs ONCE manually. Uses the same snapshot-capital-market-largedeal endpoint
with from_date/to_date params (weekly chunks to stay within NSE rate limits).

Run: python3 scripts/super_investor_backfill.py
"""

import os, time, requests
from datetime import date, datetime, timedelta
from collections import defaultdict
from supabase import create_client, Client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]

sb: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

NSE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Referer": "https://www.nseindia.com/market-data/bulk-block-deals",
    "DNT": "1",
    "Connection": "keep-alive",
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
]

MIN_TRADE_VALUE_CR = 5.0
BACKFILL_MONTHS    = 6
CHUNK_DAYS         = 7   # fetch in weekly windows


def get_nse_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(NSE_HEADERS)
    try:
        session.get("https://www.nseindia.com", timeout=15)
        time.sleep(3)
        session.get("https://www.nseindia.com/market-data/bulk-block-deals", timeout=10)
        time.sleep(2)
    except Exception as e:
        print(f"[session] init error: {e}")
    return session


def fmt_date_nse(d: date) -> str:
    """Format date as DD-MM-YYYY for NSE API params."""
    return d.strftime("%d-%m-%Y")


def parse_nse_date(s: str) -> str | None:
    """Parse NSE date formats: '31-Jul-2026' or '2026-07-31' → 'YYYY-MM-DD'."""
    for fmt in ("%d-%b-%Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(s.strip(), fmt).date().isoformat()
        except ValueError:
            continue
    return None


def fetch_chunk(session: requests.Session, from_d: date, to_d: date) -> list[dict]:
    """Fetch bulk+block deals for a date range. Returns list of parsed raw records."""
    from_str = fmt_date_nse(from_d)
    to_str   = fmt_date_nse(to_d)
    url = (
        f"https://www.nseindia.com/api/snapshot-capital-market-largedeal"
        f"?from_date={from_str}&to_date={to_str}"
    )
    try:
        r = session.get(url, timeout=25)
        data = r.json()
        bulk  = data.get("BULK_DEALS_DATA",  []) or []
        block = data.get("BLOCK_DEALS_DATA", []) or []
        print(f"  [{from_str} → {to_str}] bulk={len(bulk)}, block={len(block)}")
        return [(rec, "BULK") for rec in bulk] + [(rec, "BLOCK") for rec in block]
    except Exception as e:
        print(f"  [{from_str} → {to_str}] ERROR: {e}")
        return []


def parse_record(rec: dict, deal_type: str) -> dict | None:
    """Parse one deal record using verified NSE field names."""
    try:
        ticker = rec.get("symbol",     "").strip().upper()
        client = rec.get("clientName", "").strip().upper()
        bs_raw = rec.get("buySell",    "").strip().upper()
        qty_raw   = rec.get("qty",  "0")
        price_raw = rec.get("watp", "0")
        date_raw  = rec.get("date",  "")

        if not ticker or not client or not date_raw:
            return None

        signal_date = parse_nse_date(date_raw)
        if not signal_date:
            return None

        if bs_raw == "BUY":
            txn = "BUY"
        elif bs_raw == "SELL":
            txn = "SELL"
        else:
            return None

        qty   = int(str(qty_raw).replace(",", ""))    if qty_raw   else 0
        price = float(str(price_raw).replace(",", "")) if price_raw else 0.0
        if qty <= 0 or price <= 0:
            return None

        return {
            "ticker": ticker, "client": client, "txn": txn,
            "qty": qty, "price": price,
            "deal_type": deal_type, "signal_date": signal_date,
        }
    except Exception as e:
        print(f"  [parse] {e}")
        return None


def is_hft(client: str) -> bool:
    return any(h in client for h in HFT_BLACKLIST)


def is_super_investor(client: str) -> bool:
    return any(w in client for w in SUPER_INVESTOR_WHITELIST)


def net_and_upsert(raw_records: list[dict]) -> int:
    """Group by (ticker, client, date), net buys vs sells, upsert qualifying rows."""
    groups: dict = defaultdict(lambda: {
        "buy_qty": 0, "buy_val": 0.0,
        "sell_qty": 0, "sell_val": 0.0,
        "deal_type": "BULK",
    })
    for r in raw_records:
        key = (r["ticker"], r["client"], r["signal_date"])
        g = groups[key]
        g["deal_type"] = r["deal_type"]
        if r["txn"] == "BUY":
            g["buy_qty"] += r["qty"]
            g["buy_val"] += r["qty"] * r["price"]
        else:
            g["sell_qty"] += r["qty"]
            g["sell_val"] += r["qty"] * r["price"]

    rows = []
    for (ticker, client, sig_date), g in groups.items():
        net_qty = g["buy_qty"] - g["sell_qty"]
        if net_qty > 0:
            txn      = "BUY"
            avg_price = g["buy_val"]  / g["buy_qty"]  if g["buy_qty"]  else 0.0
        elif net_qty < 0:
            txn      = "SELL"
            net_qty  = abs(net_qty)
            avg_price = g["sell_val"] / g["sell_qty"] if g["sell_qty"] else 0.0
        else:
            continue

        trade_value_cr = (net_qty * avg_price) / 10_000_000
        if trade_value_cr < MIN_TRADE_VALUE_CR:
            continue

        rows.append({
            "ticker":           ticker,
            "client_name":      client,
            "deal_type":        g["deal_type"],
            "transaction_type": txn,
            "signal_date":      sig_date,
            "net_quantity":     net_qty,
            "avg_price":        round(avg_price, 2),
            "trade_value_cr":   round(trade_value_cr, 4),
        })

    if rows:
        sb.table("super_investor_signals").upsert(
            rows, on_conflict="ticker,client_name,signal_date"
        ).execute()
    return len(rows)


def run():
    today    = date.today()
    end_date = today
    start_date = today - timedelta(days=BACKFILL_MONTHS * 30)

    print(f"[backfill] {start_date} → {end_date} in {CHUNK_DAYS}-day chunks")
    print("[backfill] establishing NSE session...")
    session = get_nse_session()

    total_inserted = 0
    chunk_start = start_date

    while chunk_start <= end_date:
        chunk_end = min(chunk_start + timedelta(days=CHUNK_DAYS - 1), end_date)

        raw_pairs = fetch_chunk(session, chunk_start, chunk_end)

        # Parse all records
        raw = []
        for rec, deal_type in raw_pairs:
            p = parse_record(rec, deal_type)
            if p: raw.append(p)

        # Apply filters
        raw = [r for r in raw if not is_hft(r["client"])]
        raw = [r for r in raw if is_super_investor(r["client"])]

        if raw:
            n = net_and_upsert(raw)
            total_inserted += n
            if n > 0:
                print(f"  → {n} rows upserted")
        else:
            print(f"  → 0 qualifying trades")

        chunk_start = chunk_end + timedelta(days=1)
        time.sleep(3)  # be polite to NSE servers

    print(f"\n[backfill] complete — {total_inserted} total rows inserted")


if __name__ == "__main__":
    run()

"""
Super Investor Flow Pipeline — NSE Bulk & Block Deals.
Filters HFT noise, keeps curated super investors, upserts to Supabase.
Runs Mon-Fri 7:00 PM IST from VPS cron (requires Indian IP for NSE).
"""

import os, time, requests
from datetime import date
from collections import defaultdict
from supabase import create_client, Client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
TG_TOKEN     = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TG_CHAT_ID   = os.environ.get("TELEGRAM_CHAT_ID", "")

sb: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
TODAY = date.today().isoformat()

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


def get_nse_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(NSE_HEADERS)
    try:
        session.get("https://www.nseindia.com", timeout=15)
        time.sleep(2)
        session.get("https://www.nseindia.com/market-data/bulk-block-deals", timeout=10)
        time.sleep(1)
    except Exception as e:
        print(f"[nse] session init: {e}")
    return session


def fetch_deals(session: requests.Session) -> tuple[list[dict], list[dict]]:
    try:
        r = session.get(
            "https://www.nseindia.com/api/snapshot-capital-market-largedeal",
            timeout=20
        )
        data = r.json()
        bulk  = data.get("BULK_DEALS_TABLE",  []) or []
        block = data.get("BLOCK_DEALS_TABLE", []) or []
        print(f"[nse] bulk={len(bulk)}, block={len(block)}")
        return bulk, block
    except Exception as e:
        print(f"[nse] fetch failed: {e}")
        return [], []


def parse_deal(rec: dict, deal_type: str) -> dict | None:
    try:
        ticker = (
            rec.get("BD_SYMBOL") or rec.get("symbol") or rec.get("name") or ""
        ).strip().upper()
        client = (
            rec.get("BD_CLIENT_NAME") or rec.get("clientName") or rec.get("clientname") or ""
        ).strip().upper()
        bs_raw = (
            rec.get("BD_BUY_SELL") or rec.get("buySell") or ""
        ).strip().upper()
        qty_raw   = rec.get("BD_QTY_TRD")   or rec.get("quantity")   or rec.get("noOfSharesBoughtSold") or 0
        price_raw = rec.get("BD_TP_WATP")   or rec.get("wapRate")    or rec.get("price") or 0

        if not ticker or not client:
            return None

        if bs_raw in ("B", "BUY", "PURCHASE"):
            txn = "BUY"
        elif bs_raw in ("S", "SELL", "SALE"):
            txn = "SELL"
        else:
            return None

        qty   = int(str(qty_raw).replace(",", ""))   if qty_raw   else 0
        price = float(str(price_raw).replace(",", "")) if price_raw else 0.0
        if qty <= 0 or price <= 0:
            return None

        return {"ticker": ticker, "client": client, "txn": txn,
                "qty": qty, "price": price, "deal_type": deal_type}
    except Exception as e:
        print(f"[parse] {e}")
        return None


def net_trades(records: list[dict]) -> list[dict]:
    """Net buy vs sell for same (ticker, client) pair; blended avg price."""
    groups: dict = defaultdict(lambda: {
        "buy_qty": 0, "buy_val": 0.0,
        "sell_qty": 0, "sell_val": 0.0,
        "deal_type": "BULK",
    })
    for r in records:
        key = (r["ticker"], r["client"])
        g = groups[key]
        g["deal_type"] = r["deal_type"]
        if r["txn"] == "BUY":
            g["buy_qty"] += r["qty"]
            g["buy_val"] += r["qty"] * r["price"]
        else:
            g["sell_qty"] += r["qty"]
            g["sell_val"] += r["qty"] * r["price"]

    result = []
    for (ticker, client), g in groups.items():
        net_qty = g["buy_qty"] - g["sell_qty"]
        if net_qty > 0:
            txn, total_qty, total_val = "BUY",  g["buy_qty"],  g["buy_val"]
        elif net_qty < 0:
            txn, total_qty, total_val = "SELL", g["sell_qty"], g["sell_val"]
            net_qty = abs(net_qty)
        else:
            continue

        avg_price      = total_val / total_qty if total_qty else 0.0
        trade_value_cr = (net_qty * avg_price) / 10_000_000
        result.append({
            "ticker": ticker, "client": client,
            "txn": txn, "net_qty": net_qty,
            "avg_price": round(avg_price, 2),
            "trade_value_cr": round(trade_value_cr, 4),
            "deal_type": g["deal_type"],
        })
    return result


def is_hft(client: str) -> bool:
    return any(h in client for h in HFT_BLACKLIST)


def is_super_investor(client: str) -> bool:
    return any(w in client for w in SUPER_INVESTOR_WHITELIST)


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


def run():
    print(f"[super_investor] starting — {TODAY}")
    session = get_nse_session()
    bulk, block = fetch_deals(session)

    raw = []
    for rec in bulk:
        p = parse_deal(rec, "BULK")
        if p:
            raw.append(p)
    for rec in block:
        p = parse_deal(rec, "BLOCK")
        if p:
            raw.append(p)
    print(f"[filter] parsed {len(raw)} raw deals")

    raw = [r for r in raw if not is_hft(r["client"])]
    print(f"[filter] after HFT drop: {len(raw)}")

    raw = [r for r in raw if is_super_investor(r["client"])]
    print(f"[filter] after whitelist: {len(raw)}")

    netted = net_trades(raw)
    print(f"[net] after netting: {len(netted)} rows")

    netted = [r for r in netted if r["trade_value_cr"] >= MIN_TRADE_VALUE_CR]
    print(f"[filter] after min ₹{MIN_TRADE_VALUE_CR}Cr: {len(netted)}")

    if not netted:
        print("[super_investor] no qualifying trades today")
        return

    rows = [{
        "ticker":           r["ticker"],
        "client_name":      r["client"],
        "deal_type":        r["deal_type"],
        "transaction_type": r["txn"],
        "signal_date":      TODAY,
        "net_quantity":     r["net_qty"],
        "avg_price":        r["avg_price"],
        "trade_value_cr":   r["trade_value_cr"],
    } for r in netted]

    sb.table("super_investor_signals").upsert(
        rows, on_conflict="ticker,client_name,signal_date"
    ).execute()
    print(f"[db] upserted {len(rows)} rows")

    lines = ["<b>🏦 Super Investor Flow</b>", f"<i>{TODAY}</i>", ""]
    for r in sorted(netted, key=lambda x: -x["trade_value_cr"]):
        em = "🟢" if r["txn"] == "BUY" else "🔴"
        lines.append(f"{em} <b>{r['ticker']}</b> — {r['client'][:30]}")
        lines.append(f"   {r['txn']} ₹{r['trade_value_cr']:.1f}Cr @ ₹{r['avg_price']:.1f}")
    send_telegram("\n".join(lines))
    print("[super_investor] done")


if __name__ == "__main__":
    run()

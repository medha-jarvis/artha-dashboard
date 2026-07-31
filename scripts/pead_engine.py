"""
PEAD Engine — Post-Earnings Announcement Drift signal generator.

Runs daily at 10:15 UTC (3:45 PM IST, ~30 min after market close).
Scrapes stockscans.in/results for today's earnings, scores them against
Path A (classic PEAD) and Path B (trap reversal), and writes signals to Supabase.
"""

import os, time, json, asyncio, requests
from datetime import date, datetime
import pandas as pd
import yfinance as yf
from playwright.async_api import async_playwright
from supabase import create_client, Client

# ── Credentials (from GitHub Actions secrets) ─────────────────────────────────
SUPABASE_URL  = os.environ["SUPABASE_URL"]
SUPABASE_KEY  = os.environ["SUPABASE_KEY"]
TG_TOKEN      = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TG_CHAT_ID    = os.environ.get("TELEGRAM_CHAT_ID", "")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

TODAY = date.today().isoformat()

# ── Constants ──────────────────────────────────────────────────────────────────
PATH_A_PROFIT_THRESH  = 30.0   # YoY Net Profit growth % threshold
PATH_A_OPM_BPS        = 200    # OPM expansion bps threshold
PATH_A_EMA_PERIOD     = 200
PATH_A_VOL_MULT       = 2.5
PATH_B_PROFIT_THRESH  = 0.0    # YoY profit must be negative (miss)
PATH_B_PRICE_GAP      = 4.0    # Close must be ≥ 4% above Open
PATH_B_VOL_MULT       = 3.0
VOL_SMA_PERIOD        = 20


# ── Scraper ────────────────────────────────────────────────────────────────────
async def scrape_earnings() -> list[dict]:
    """
    Scrapes stockscans.in/results for today's earnings announcement data.
    Returns list of {ticker, yoy_profit_pct, opm_pct, prev_opm_pct}.
    """
    results = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True, args=["--no-sandbox"])
        page = await browser.new_page(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        )
        try:
            await page.goto("https://stockscans.in/results", wait_until="networkidle", timeout=60000)
            await page.wait_for_timeout(3000)

            # Find all table rows (skip header row)
            rows = await page.query_selector_all("table tbody tr")
            if not rows:
                # Try alternate selector patterns
                rows = await page.query_selector_all(".results-table tr, .stock-results tr, table tr")

            print(f"[scraper] Found {len(rows)} rows")

            for row in rows:
                try:
                    cells = await row.query_selector_all("td")
                    if len(cells) < 4:
                        continue

                    texts = [await c.inner_text() for c in cells]

                    # stockscans.in results table columns (typical layout):
                    # 0: Company/Ticker  1: Sector  2: Revenue%  3: Net Profit%  4: OPM  5: OPM prev  ...
                    # Extract ticker from first column — usually "TICKER\nCompany Name" or just ticker
                    raw_ticker = texts[0].strip().split("\n")[0].strip().upper()
                    if not raw_ticker or len(raw_ticker) > 15:
                        continue

                    # Parse YoY net profit % — look for a column containing %
                    yoy_profit = None
                    opm_curr   = None
                    opm_prev   = None

                    for i, t in enumerate(texts[1:], 1):
                        clean = t.replace("%", "").replace(",", "").strip()
                        try:
                            val = float(clean)
                            # Heuristic: net profit column usually has large swings (±100s %)
                            if yoy_profit is None and i >= 3 and abs(val) <= 10000:
                                yoy_profit = val
                            elif opm_curr is None and i >= 4 and 0 <= val <= 80:
                                opm_curr = val
                            elif opm_prev is None and i >= 5 and 0 <= val <= 80:
                                opm_prev = val
                        except (ValueError, TypeError):
                            continue

                    if yoy_profit is None:
                        continue

                    results.append({
                        "ticker":      raw_ticker + ".NS",
                        "raw_ticker":  raw_ticker,
                        "yoy_profit":  yoy_profit,
                        "opm_curr":    opm_curr,
                        "opm_prev":    opm_prev,
                    })
                except Exception as e:
                    print(f"[scraper] Row parse error: {e}")
                    continue

        except Exception as e:
            print(f"[scraper] Page error: {e}")
        finally:
            await browser.close()

    print(f"[scraper] Parsed {len(results)} earnings records")
    return results


# ── Technical indicators ───────────────────────────────────────────────────────
def fetch_technicals(ticker_ns: str) -> dict | None:
    """Fetch last 200 trading days of OHLCV and compute EMA200, VolSMA20."""
    try:
        df = yf.download(ticker_ns, period="250d", interval="1d",
                         auto_adjust=True, progress=False)
        if df.empty or len(df) < 22:
            return None

        close  = df["Close"].squeeze()
        volume = df["Volume"].squeeze()
        open_  = df["Open"].squeeze()

        ema200     = float(close.ewm(span=PATH_A_EMA_PERIOD, adjust=False).mean().iloc[-1])
        vol_sma20  = float(volume.rolling(VOL_SMA_PERIOD).mean().iloc[-2])  # -2 = yesterday's SMA (avoid look-ahead)
        last_close = float(close.iloc[-1])
        last_open  = float(open_.iloc[-1])
        last_vol   = float(volume.iloc[-1])
        vol_mult   = last_vol / vol_sma20 if vol_sma20 > 0 else 0

        return {
            "close":      last_close,
            "open":       last_open,
            "ema200":     ema200,
            "vol_sma20":  vol_sma20,
            "last_vol":   last_vol,
            "vol_mult":   round(vol_mult, 2),
            "price_vs_open_pct": round((last_close - last_open) / last_open * 100, 2) if last_open else 0,
        }
    except Exception as e:
        print(f"[technicals] {ticker_ns}: {e}")
        return None


# ── Signal scoring ─────────────────────────────────────────────────────────────
def score_signal(earnings: dict, tech: dict) -> str | None:
    """
    Returns 'A', 'B', or None.
    Path A: Strong beat + above EMA200 + volume surge
    Path B: Profit miss but price gaps up hard + monster volume (trap/short-squeeze)
    """
    profit  = earnings["yoy_profit"]
    opm_c   = earnings["opm_curr"]
    opm_p   = earnings["opm_prev"]
    opm_exp = ((opm_c - opm_p) * 100) if (opm_c is not None and opm_p is not None) else 0  # bps

    # Path A — Classic PEAD
    profit_beat = profit >= PATH_A_PROFIT_THRESH
    opm_expand  = opm_exp >= PATH_A_OPM_BPS
    if (profit_beat or opm_expand) and \
       tech["close"] > tech["ema200"] and \
       tech["vol_mult"] >= PATH_A_VOL_MULT:
        return "A"

    # Path B — Discrepancy / Trap Reversal
    if profit < PATH_B_PROFIT_THRESH and \
       tech["price_vs_open_pct"] >= PATH_B_PRICE_GAP and \
       tech["vol_mult"] >= PATH_B_VOL_MULT:
        return "B"

    return None


# ── Supabase write ─────────────────────────────────────────────────────────────
def push_signal(earnings: dict, tech: dict, path: str) -> str | None:
    """Insert signal; skip if same ticker+date already exists. Returns new id or None."""
    # Idempotent: skip duplicates
    existing = supabase.table("pead_signals") \
        .select("id") \
        .eq("ticker", earnings["raw_ticker"]) \
        .eq("signal_date", TODAY) \
        .execute()
    if existing.data:
        print(f"[db] {earnings['raw_ticker']} already recorded for {TODAY}, skipping")
        return None

    score_text = json.dumps({
        "yoy_profit_pct": earnings["yoy_profit"],
        "opm_curr":       earnings.get("opm_curr"),
        "opm_prev":       earnings.get("opm_prev"),
        "close":          tech["close"],
        "ema200":         tech["ema200"],
        "vol_mult":       tech["vol_mult"],
        "price_vs_open":  tech["price_vs_open_pct"],
    })

    row = {
        "ticker":            earnings["raw_ticker"],
        "signal_date":       TODAY,
        "trigger_path":      path,
        "fundamental_score": score_text,
        "volume_multiplier": tech["vol_mult"],
        "status":            "active",
    }
    res = supabase.table("pead_signals").insert(row).execute()
    new_id = res.data[0]["id"] if res.data else None

    # Also create an empty drift_performance row
    if new_id:
        supabase.table("drift_performance").insert({"signal_id": new_id}).execute()

    return new_id


# ── Telegram alert ─────────────────────────────────────────────────────────────
def send_telegram(signals: list[dict]) -> None:
    if not TG_TOKEN or not TG_CHAT_ID or not signals:
        return

    lines = ["📊 *PEAD Signals — {}*".format(datetime.now().strftime("%d %b %Y"))]
    for s in signals:
        path_emoji = "🟢" if s["path"] == "A" else "🟡"
        lines.append(
            f"{path_emoji} *{s['ticker']}* — Path {s['path']}\n"
            f"  Vol: {s['vol_mult']}x | YoY: {s['yoy_profit']:+.1f}% | "
            f"{'Above' if s['close'] > s['ema200'] else 'Below'} EMA200"
        )

    text = "\n\n".join(lines)
    try:
        requests.post(
            f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
            json={"chat_id": TG_CHAT_ID, "text": text, "parse_mode": "Markdown"},
            timeout=10,
        )
        print("[telegram] Alert sent")
    except Exception as e:
        print(f"[telegram] Failed: {e}")


# ── Main ───────────────────────────────────────────────────────────────────────
async def main():
    print(f"=== PEAD Engine {TODAY} ===")

    earnings_list = await scrape_earnings()
    if not earnings_list:
        print("[main] No earnings data scraped — exiting")
        return

    triggered: list[dict] = []

    for i, earnings in enumerate(earnings_list):
        ticker_ns = earnings["ticker"]
        print(f"[{i+1}/{len(earnings_list)}] Fetching technicals: {ticker_ns}")
        tech = fetch_technicals(ticker_ns)
        time.sleep(1)  # Rate-limit yfinance requests

        if tech is None:
            print(f"  → No price data, skipping")
            continue

        path = score_signal(earnings, tech)
        if path:
            print(f"  → PATH {path} TRIGGERED  vol={tech['vol_mult']}x")
            sig_id = push_signal(earnings, tech, path)
            if sig_id:
                triggered.append({
                    "ticker":      earnings["raw_ticker"],
                    "path":        path,
                    "vol_mult":    tech["vol_mult"],
                    "yoy_profit":  earnings["yoy_profit"],
                    "close":       tech["close"],
                    "ema200":      tech["ema200"],
                })
        else:
            print(f"  → No trigger (vol={tech['vol_mult']}x, yoy={earnings['yoy_profit']:.1f}%)")

    print(f"\n[main] {len(triggered)} signal(s) triggered out of {len(earnings_list)} earnings")
    send_telegram(triggered)


if __name__ == "__main__":
    asyncio.run(main())

"""
PEAD Engine — Post-Earnings Announcement Drift signal generator.

Runs daily at 10:15 UTC (3:45 PM IST, ~30 min after NSE close).
Scrapes stockscans.in/results → scores against Path A/B → POSTs to VPS API.
No Supabase. No external DB dependency.
"""

import os, time, json, asyncio, requests
from datetime import date, datetime
from playwright.async_api import async_playwright
import yfinance as yf

# ── Config ─────────────────────────────────────────────────────────────────────
VPS_API   = os.environ.get("VPS_API_URL", "http://31.97.227.135/api")
API_KEY   = os.environ.get("VPS_API_KEY", "")
TG_TOKEN  = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TG_CHAT   = os.environ.get("TELEGRAM_CHAT_ID", "")

HEADERS = {"Content-Type": "application/json", "x-pead-key": API_KEY}
TODAY   = date.today().isoformat()

# Signal thresholds
PATH_A_PROFIT_THRESH = 30.0
PATH_A_OPM_BPS       = 200
EMA_PERIOD           = 200
VOL_SMA_PERIOD       = 20
PATH_A_VOL_MULT      = 2.5
PATH_B_VOL_MULT      = 3.0
PATH_B_PRICE_GAP     = 4.0


# ── Scraper ────────────────────────────────────────────────────────────────────
async def scrape_earnings() -> list[dict]:
    results = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True, args=["--no-sandbox"])
        page = await browser.new_page(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        )
        try:
            await page.goto("https://stockscans.in/results", wait_until="networkidle", timeout=60000)
            await page.wait_for_timeout(3000)

            rows = await page.query_selector_all("table tbody tr")
            if not rows:
                rows = await page.query_selector_all("table tr")

            print(f"[scraper] {len(rows)} rows found")

            for row in rows:
                try:
                    cells = await row.query_selector_all("td")
                    if len(cells) < 4:
                        continue
                    texts = [await c.inner_text() for c in cells]

                    raw_ticker = texts[0].strip().split("\n")[0].strip().upper()
                    if not raw_ticker or len(raw_ticker) > 15:
                        continue

                    # Parse numeric columns — YoY profit and OPM
                    yoy_profit = opm_curr = opm_prev = None
                    nums_found = []
                    for t in texts[1:]:
                        try:
                            nums_found.append(float(t.replace("%", "").replace(",", "").strip()))
                        except (ValueError, TypeError):
                            nums_found.append(None)

                    # Heuristic assignment — adapt based on actual column order
                    valid = [v for v in nums_found if v is not None]
                    if len(valid) >= 1:
                        yoy_profit = valid[0]
                    if len(valid) >= 2:
                        opm_curr = valid[1] if 0 <= valid[1] <= 80 else None
                    if len(valid) >= 3:
                        opm_prev = valid[2] if 0 <= valid[2] <= 80 else None

                    if yoy_profit is None:
                        continue

                    results.append({
                        "ticker":     raw_ticker,
                        "yoy_profit": yoy_profit,
                        "opm_curr":   opm_curr,
                        "opm_prev":   opm_prev,
                    })
                except Exception as e:
                    print(f"[scraper] row error: {e}")
                    continue
        except Exception as e:
            print(f"[scraper] page error: {e}")
        finally:
            await browser.close()

    print(f"[scraper] parsed {len(results)} records")
    return results


# ── Technicals ─────────────────────────────────────────────────────────────────
def fetch_technicals(ticker: str) -> dict | None:
    try:
        df = yf.download(ticker + ".NS", period="250d", interval="1d",
                         auto_adjust=True, progress=False)
        if df.empty or len(df) < 22:
            return None

        close  = df["Close"].squeeze()
        volume = df["Volume"].squeeze()
        open_  = df["Open"].squeeze()

        ema200    = float(close.ewm(span=EMA_PERIOD, adjust=False).mean().iloc[-1])
        vol_sma20 = float(volume.rolling(VOL_SMA_PERIOD).mean().iloc[-2])
        last_c    = float(close.iloc[-1])
        last_o    = float(open_.iloc[-1])
        last_v    = float(volume.iloc[-1])
        vol_mult  = round(last_v / vol_sma20, 2) if vol_sma20 > 0 else 0

        return {
            "close":             last_c,
            "open":              last_o,
            "ema200":            ema200,
            "vol_sma20":         vol_sma20,
            "last_vol":          last_v,
            "vol_mult":          vol_mult,
            "price_vs_open_pct": round((last_c - last_o) / last_o * 100, 2) if last_o else 0,
        }
    except Exception as e:
        print(f"[tech] {ticker}: {e}")
        return None


# ── Signal scoring ─────────────────────────────────────────────────────────────
def score(earnings: dict, tech: dict) -> str | None:
    yoy     = earnings["yoy_profit"]
    opm_c   = earnings.get("opm_curr")
    opm_p   = earnings.get("opm_prev")
    opm_bps = ((opm_c - opm_p) * 100) if (opm_c and opm_p) else 0

    # Path A — classic PEAD beat
    if ((yoy >= PATH_A_PROFIT_THRESH) or (opm_bps >= PATH_A_OPM_BPS)) and \
       tech["close"] > tech["ema200"] and \
       tech["vol_mult"] >= PATH_A_VOL_MULT:
        return "A"

    # Path B — trap / short-squeeze reversal
    if yoy < 0 and \
       tech["price_vs_open_pct"] >= PATH_B_PRICE_GAP and \
       tech["vol_mult"] >= PATH_B_VOL_MULT:
        return "B"

    return None


# ── VPS API push ───────────────────────────────────────────────────────────────
def push_signal(earnings: dict, tech: dict, path: str) -> str | None:
    score_json = json.dumps({
        "yoy_profit_pct":  earnings["yoy_profit"],
        "opm_curr":        earnings.get("opm_curr"),
        "opm_prev":        earnings.get("opm_prev"),
        "close":           tech["close"],
        "ema200":          tech["ema200"],
        "vol_mult":        tech["vol_mult"],
        "price_vs_open":   tech["price_vs_open_pct"],
    })
    payload = {
        "ticker":            earnings["ticker"],
        "signal_date":       TODAY,
        "trigger_path":      path,
        "fundamental_score": score_json,
        "volume_multiplier": tech["vol_mult"],
        "status":            "active",
    }
    try:
        r = requests.post(f"{VPS_API}/pead/signals", json=payload, headers=HEADERS, timeout=10)
        data = r.json()
        if data.get("skipped"):
            print(f"  → already recorded, skipped")
            return None
        return data.get("id")
    except Exception as e:
        print(f"  [api] push failed: {e}")
        return None


# ── Telegram ───────────────────────────────────────────────────────────────────
def send_telegram(triggered: list[dict]) -> None:
    if not TG_TOKEN or not TG_CHAT or not triggered:
        return
    lines = [f"⚡ *PEAD Signals — {datetime.now().strftime('%d %b %Y')}*"]
    for s in triggered:
        emoji = "🟢" if s["path"] == "A" else "🟡"
        lines.append(
            f"{emoji} *{s['ticker']}* — Path {s['path']}\n"
            f"  Vol: {s['vol_mult']}x | YoY: {s['yoy_profit']:+.1f}% | "
            f"{'▲ Above' if s['close'] > s['ema200'] else '▼ Below'} EMA200"
        )
    try:
        requests.post(
            f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
            json={"chat_id": TG_CHAT, "text": "\n\n".join(lines), "parse_mode": "Markdown"},
            timeout=10,
        )
        print("[telegram] alert sent")
    except Exception as e:
        print(f"[telegram] failed: {e}")


# ── Main ───────────────────────────────────────────────────────────────────────
async def main():
    print(f"=== PEAD Engine {TODAY} ===")
    earnings_list = await scrape_earnings()
    if not earnings_list:
        print("[main] nothing scraped — done")
        return

    triggered = []
    for i, e in enumerate(earnings_list, 1):
        ticker = e["ticker"]
        print(f"[{i}/{len(earnings_list)}] {ticker}")
        tech = fetch_technicals(ticker)
        time.sleep(1)
        if not tech:
            print("  → no price data")
            continue
        path = score(e, tech)
        if path:
            print(f"  → PATH {path}  vol={tech['vol_mult']}x")
            sig_id = push_signal(e, tech, path)
            if sig_id:
                triggered.append({**e, "path": path, **tech})
        else:
            print(f"  → no trigger (vol={tech['vol_mult']}x, yoy={e['yoy_profit']:.1f}%)")

    print(f"\n[main] {len(triggered)} signal(s)")
    send_telegram(triggered)


if __name__ == "__main__":
    asyncio.run(main())

"""
PEAD Engine v2 — scores EVERY company reporting earnings today on 0-100 scale.
Stores all records to Supabase. Telegram alert only for score >= 70.

Runs: Mon-Fri at 10:15 UTC (3:45 PM IST, 30 min after NSE close).
"""

import os, time, json, asyncio, requests
from datetime import date, datetime
import pandas as pd
import yfinance as yf
from playwright.async_api import async_playwright
from supabase import create_client, Client

# ── Credentials ────────────────────────────────────────────────────────────────
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
TG_TOKEN     = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TG_CHAT_ID   = os.environ.get("TELEGRAM_CHAT_ID", "")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
TODAY = date.today().isoformat()

EMA_PERIOD     = 200
VOL_SMA_PERIOD = 20


# ── Composite PEAD Score (max 100) ─────────────────────────────────────────────
def compute_score(yoy_profit: float | None, yoy_revenue: float | None,
                  opm_bps: float | None, price_vs_ema: float | None,
                  vol_mult: float | None, day_gap: float | None) -> int:
    score = 0

    # YoY Net Profit (20 pts)
    if yoy_profit is not None:
        if   yoy_profit > 100: score += 20
        elif yoy_profit >  50: score += 15
        elif yoy_profit >  30: score += 10
        elif yoy_profit >   0: score +=  5

    # YoY Revenue (10 pts)
    if yoy_revenue is not None:
        if   yoy_revenue > 25: score += 10
        elif yoy_revenue > 15: score +=  5

    # OPM Expansion (15 pts)
    if opm_bps is not None:
        if   opm_bps > 300: score += 15
        elif opm_bps > 200: score += 10
        elif opm_bps > 100: score +=  5

    # Trend vs 200 EMA (20 pts)
    if price_vs_ema is not None and price_vs_ema > 0:
        score += 20

    # Volume Multiplier (20 pts)
    if vol_mult is not None:
        if   vol_mult > 5.0: score += 20
        elif vol_mult > 3.0: score += 15
        elif vol_mult > 2.0: score += 10
        elif vol_mult > 1.5: score +=  5

    # Day Gap — Close vs Open (15 pts)
    if day_gap is not None:
        if   day_gap > 4.0: score += 15
        elif day_gap > 2.0: score +=  8
        elif day_gap > 0.0: score +=  3

    return min(100, score)


def path_from_score(score: int) -> str:
    if score >= 70: return 'A'
    if score >= 50: return 'WATCH'
    return 'NONE'


# ── Playwright scraper ─────────────────────────────────────────────────────────
async def scrape_earnings(target_date: str | None = None) -> list[dict]:
    """
    Scrapes stockscans.in/results for today's earnings.
    Returns list of dicts with: ticker, company_name, yoy_profit, yoy_revenue,
    opm_curr, opm_prev, ttm_pe.
    """
    url = "https://stockscans.in/results"
    if target_date:
        url += f"?date={target_date}"

    results = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True, args=["--no-sandbox"])
        page = await browser.new_page(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        )
        try:
            await page.goto(url, wait_until="networkidle", timeout=60000)
            await page.wait_for_timeout(3000)

            rows = await page.query_selector_all("table tbody tr")
            if not rows:
                rows = await page.query_selector_all("table tr")
            print(f"[scraper] {len(rows)} rows at {url}")

            for row in rows:
                try:
                    cells = await row.query_selector_all("td")
                    if len(cells) < 4:
                        continue
                    texts = [(await c.inner_text()).strip() for c in cells]

                    # Col 0: Ticker (sometimes "TICKER\nCompany Name")
                    parts = texts[0].split("\n")
                    raw_ticker    = parts[0].strip().upper()
                    company_name  = parts[1].strip() if len(parts) > 1 else raw_ticker

                    if not raw_ticker or len(raw_ticker) > 15 or not raw_ticker.replace("-","").isalpha():
                        continue

                    # Parse numeric columns — order varies by site version
                    nums = []
                    for t in texts[1:]:
                        try:
                            nums.append(float(t.replace("%","").replace(",","").strip()))
                        except (ValueError, TypeError):
                            nums.append(None)

                    # Heuristic assignment (adapt as site changes):
                    # Typical order after ticker: Revenue%, NetProfit%, OPM_curr%, OPM_prev%, TTM_PE
                    yoy_revenue = nums[0] if len(nums) > 0 else None
                    yoy_profit  = nums[1] if len(nums) > 1 else None
                    opm_curr    = nums[2] if len(nums) > 2 and nums[2] is not None and 0 <= nums[2] <= 80 else None
                    opm_prev    = nums[3] if len(nums) > 3 and nums[3] is not None and 0 <= nums[3] <= 80 else None
                    ttm_pe      = nums[4] if len(nums) > 4 and nums[4] is not None and 0 < nums[4] < 1000 else None

                    if yoy_profit is None and yoy_revenue is None:
                        continue

                    results.append({
                        "ticker":       raw_ticker,
                        "company_name": company_name,
                        "yoy_profit":   yoy_profit,
                        "yoy_revenue":  yoy_revenue,
                        "opm_curr":     opm_curr,
                        "opm_prev":     opm_prev,
                        "ttm_pe":       ttm_pe,
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


# ── yfinance technicals ────────────────────────────────────────────────────────
def fetch_technicals(ticker: str) -> dict:
    """Returns technical dict. Empty fields set to None, never raises."""
    ns = ticker if ticker.endswith(".NS") else ticker + ".NS"
    out = dict(close=None, open_=None, ema200=None, vol_mult=None,
               price_vs_ema200_pct=None, day_gap_pct=None,
               sector=None, company_name=None, ttm_pe=None)
    try:
        t   = yf.Ticker(ns)
        df  = t.history(period="250d", interval="1d", auto_adjust=True)
        inf = t.info

        out["company_name"] = inf.get("longName") or inf.get("shortName")
        out["sector"]       = inf.get("sector")
        out["ttm_pe"]       = inf.get("trailingPE")

        if df.empty or len(df) < 22:
            return out

        close  = df["Close"]
        volume = df["Volume"]
        open_  = df["Open"]

        ema200   = float(close.ewm(span=EMA_PERIOD, adjust=False).mean().iloc[-1])
        vol_sma  = float(volume.rolling(VOL_SMA_PERIOD).mean().iloc[-2])
        last_c   = float(close.iloc[-1])
        last_o   = float(open_.iloc[-1])
        last_v   = float(volume.iloc[-1])
        vol_mult = last_v / vol_sma if vol_sma > 0 else 0

        out["close"]              = last_c
        out["open_"]              = last_o
        out["ema200"]             = ema200
        out["vol_mult"]           = round(vol_mult, 2)
        out["price_vs_ema200_pct"]= round((last_c - ema200) / ema200 * 100, 2)
        out["day_gap_pct"]        = round((last_c - last_o) / last_o * 100, 2) if last_o else 0

    except Exception as e:
        print(f"  [tech] {ns}: {e}")
    return out


# ── Supabase upsert ────────────────────────────────────────────────────────────
def upsert_signal(ticker: str, company_name: str | None, sector: str | None,
                  signal_date: str, score: int, trigger_path: str,
                  yoy_profit: float | None, yoy_revenue: float | None,
                  opm_bps: float | None, price_vs_ema: float | None,
                  vol_mult: float | None, day_gap: float | None,
                  ttm_pe: float | None) -> str | None:
    row = {
        "ticker":              ticker,
        "company_name":        company_name,
        "sector":              sector,
        "signal_date":         signal_date,
        "pead_score":          score,
        "trigger_path":        trigger_path,
        "yoy_profit_pct":      yoy_profit,
        "yoy_revenue_pct":     yoy_revenue,
        "opm_expansion_bps":   opm_bps,
        "price_vs_ema200_pct": price_vs_ema,
        "volume_multiplier":   vol_mult,
        "day_gap_pct":         day_gap,
        "ttm_pe":              ttm_pe,
    }
    try:
        res = supabase.table("pead_signals").upsert(row, on_conflict="ticker,signal_date").execute()
        sig_id = res.data[0]["id"] if res.data else None
        if sig_id:
            supabase.table("drift_performance").upsert(
                {"signal_id": sig_id}, on_conflict="signal_id"
            ).execute()
        return sig_id
    except Exception as e:
        print(f"  [db] upsert failed for {ticker}: {e}")
        return None


# ── Telegram ───────────────────────────────────────────────────────────────────
def send_telegram(alerts: list[dict]) -> None:
    if not TG_TOKEN or not TG_CHAT_ID or not alerts:
        return
    lines = [f"⚡ *PEAD Alerts — {datetime.now().strftime('%d %b %Y')}*"]
    for a in alerts:
        lines.append(
            f"🟢 *{a['ticker']}* — Score {a['score']}/100 (Path {a['path']})\n"
            f"  Vol {a['vol_mult']}x · YoY {a['yoy_profit']:+.1f}% · Gap {a['day_gap']:+.1f}%"
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
async def main(target_date: str | None = None):
    signal_date = target_date or TODAY
    print(f"=== PEAD Engine v2 — {signal_date} ===")

    earnings = await scrape_earnings(target_date)
    if not earnings:
        print("[main] nothing scraped — exiting")
        return

    alerts = []

    for i, e in enumerate(earnings, 1):
        ticker = e["ticker"]
        print(f"[{i}/{len(earnings)}] {ticker}")

        tech = fetch_technicals(ticker)
        time.sleep(1)

        opm_bps = ((e["opm_curr"] - e["opm_prev"]) * 100
                   if (e.get("opm_curr") is not None and e.get("opm_prev") is not None)
                   else None)

        score = compute_score(
            yoy_profit  = e.get("yoy_profit"),
            yoy_revenue = e.get("yoy_revenue"),
            opm_bps     = opm_bps,
            price_vs_ema= tech["price_vs_ema200_pct"],
            vol_mult    = tech["vol_mult"],
            day_gap     = tech["day_gap_pct"],
        )
        path = path_from_score(score)

        company_name = tech["company_name"] or e.get("company_name")
        ttm_pe       = e.get("ttm_pe") or tech["ttm_pe"]
        sector       = tech["sector"]

        sig_id = upsert_signal(
            ticker       = ticker,
            company_name = company_name,
            sector       = sector,
            signal_date  = signal_date,
            score        = score,
            trigger_path = path,
            yoy_profit   = e.get("yoy_profit"),
            yoy_revenue  = e.get("yoy_revenue"),
            opm_bps      = opm_bps,
            price_vs_ema = tech["price_vs_ema200_pct"],
            vol_mult     = tech["vol_mult"],
            day_gap      = tech["day_gap_pct"],
            ttm_pe       = ttm_pe,
        )

        print(f"  score={score} path={path} vol={tech['vol_mult']}x → {'saved' if sig_id else 'FAILED'}")

        if score >= 70 and sig_id:
            alerts.append({
                "ticker":    ticker,
                "score":     score,
                "path":      path,
                "yoy_profit": e.get("yoy_profit") or 0,
                "vol_mult":  tech["vol_mult"] or 0,
                "day_gap":   tech["day_gap_pct"] or 0,
            })

    print(f"\n[main] done — {len(earnings)} processed, {len(alerts)} Path A alerts")
    send_telegram(alerts)


if __name__ == "__main__":
    import sys
    target = sys.argv[1] if len(sys.argv) > 1 else None
    asyncio.run(main(target))

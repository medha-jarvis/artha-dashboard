"""
sync_stockscans.py — Weekly StockScans → Supabase sync

Uses Playwright headless to:
1. Log into StockScans (self-healing auth via storage_state.json)
2. Call /api/company/popular-custom-index from browser context (auth cookies included)
3. Parse and upsert all sector definitions + constituents to Supabase

Runs: Sunday 3:30 AM UTC = 9:00 AM IST via GitHub Actions cron.
"""

import asyncio, json, os, re
from pathlib import Path
from playwright.async_api import async_playwright
from supabase import create_client, Client

SB_URL      = os.environ["SUPABASE_URL"]
SB_KEY      = os.environ["SUPABASE_SERVICE_KEY"]
SS_USER     = os.environ["STOCKSCANS_USER"]
SS_PASS     = os.environ["STOCKSCANS_PASS"]
SESSION_FILE = Path(__file__).parent / "storage_state.json"

supabase: Client = create_client(SB_URL, SB_KEY)

LOGIN_URL = "https://www.stockscans.in/#/signin"


def slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", name.lower().strip(), "-")
    return s.strip("-")


def normalise_tickers(company_ids: list[str]) -> list[str]:
    nse, bse = {}, {}
    for cid in company_ids:
        if ":" not in cid:
            continue
        exchange, ticker = cid.split(":", 1)
        if exchange == "NSE":
            nse[ticker] = True
        elif exchange == "BSE":
            bse[ticker] = True
    result = [t + ".NS" for t in nse]
    result += [t + ".BO" for t in bse if t not in nse]
    return sorted(result)


async def _login(pw) -> None:
    print("  [auth] Logging into StockScans...")
    browser = await pw.chromium.launch(headless=True)
    ctx  = await browser.new_context()
    page = await ctx.new_page()

    # SPA hash route — domcontentloaded fires fast, then wait for the form to render
    await page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=30000)
    await page.wait_for_selector(
        'input[type="email"], input[name="email"], input[placeholder*="mail" i]',
        timeout=45000,
        state="visible",
    )

    await page.fill('input[type="email"], input[name="email"], input[placeholder*="mail" i]', SS_USER)
    await page.fill('input[type="password"]', SS_PASS)
    async with page.expect_navigation(timeout=30000, wait_until="networkidle"):
        await page.click('button[type="submit"], button:has-text("Login"), button:has-text("Sign In")')
    await page.wait_for_timeout(2000)

    if "signin" in page.url.lower():
        raise RuntimeError("Login failed — still on signin page. Check credentials.")

    await ctx.storage_state(path=str(SESSION_FILE))
    await browser.close()
    print("  [auth] Login successful.")


async def _fetch_indexes(pw) -> dict:
    browser = await pw.chromium.launch(headless=True)
    kw = {"storage_state": str(SESSION_FILE)} if SESSION_FILE.exists() else {}
    ctx  = await browser.new_context(**kw)
    page = await ctx.new_page()

    await page.goto("https://www.stockscans.in/#/customindex", wait_until="networkidle", timeout=30000)
    await page.wait_for_timeout(2000)

    data = await page.evaluate("""async () => {
        const r = await fetch('/api/company/popular-custom-index', {credentials: 'include'});
        return r.json();
    }""")

    await browser.close()
    return data


def upsert_to_supabase(indexes: list[dict]) -> int:
    count = 0
    for idx in indexes:
        name    = idx["customIndexName"]
        slug    = re.sub(r"[^a-z0-9]+", "-", name.lower().strip()).strip("-")
        tickers = normalise_tickers(idx["companyIds"])

        supabase.table("sector_definitions").upsert(
            {"name": name, "slug": slug, "is_active": True},
            on_conflict="slug",
        ).execute()

        row = supabase.table("sector_definitions").select("id").eq("slug", slug).single().execute()
        sector_id = row.data["id"]

        if tickers:
            supabase.table("sector_constituents").upsert(
                [{"sector_id": sector_id, "symbol": sym, "company_name": None} for sym in tickers],
                on_conflict="sector_id,symbol",
            ).execute()

        print(f"  ✓ {name}: {len(tickers)} tickers")
        count += 1
    return count


async def run() -> None:
    async with async_playwright() as pw:
        try:
            print("[sync] Fetching StockScans custom indexes...")
            data = await _fetch_indexes(pw)
            if not data.get("customIndex"):
                raise ValueError("Empty response — session may be stale")
        except Exception as e:
            print(f"[sync] Session failed ({e}), re-authenticating...")
            await _login(pw)
            data = await _fetch_indexes(pw)

    indexes = data.get("customIndex", [])
    if not indexes:
        print("[sync] No indexes returned. Aborting.")
        return

    print(f"[sync] Upserting {len(indexes)} indexes...")
    n = upsert_to_supabase(indexes)
    print(f"\n[sync] Complete — {n} sectors synced to Supabase.")


if __name__ == "__main__":
    asyncio.run(run())

"""
Promoter Returns Updater — monthly backfill of 3m/6m/1y returns.
Imports compute_returns_for() from insider_returns_updater.py.
Runs: 1st of month, 7:30 AM IST via cron.
"""

import os, sys, time
from datetime import date
from supabase import create_client, Client

sys.path.insert(0, os.path.dirname(__file__))
from insider_returns_updater import compute_returns_for

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
sb: Client   = create_client(SUPABASE_URL, SUPABASE_KEY)
TODAY        = date.today()


def update_shp_returns():
    rows = sb.table("promoter_signals") \
        .select("id,ticker,submission_date,base_price") \
        .is_("actual_return_3m", "null") \
        .lte("submission_date", (TODAY.replace(day=1)).isoformat()) \
        .execute().data or []

    print(f"[returns] {len(rows)} SHP signals need return computation")
    updated = 0
    for row in rows:
        rets = compute_returns_for(row["ticker"], row["submission_date"], row.get("base_price"))
        if not any(rets.values()):
            continue
        try:
            sb.table("promoter_signals").update(rets).eq("id", row["id"]).execute()
            updated += 1
        except Exception as e:
            print(f"  [shp] {row['ticker']}: {e}")
        time.sleep(0.3)

    print(f"[returns] SHP: {updated}/{len(rows)} updated")
    return updated


def update_bulk_returns():
    rows = sb.table("promoter_bulk_signals") \
        .select("id,ticker,signal_date,base_price") \
        .is_("actual_return_3m", "null") \
        .lte("signal_date", (TODAY.replace(day=1)).isoformat()) \
        .execute().data or []

    print(f"[returns] {len(rows)} bulk signals need return computation")
    updated = 0
    for row in rows:
        rets = compute_returns_for(row["ticker"], row["signal_date"], row.get("base_price"))
        if not any(rets.values()):
            continue
        try:
            sb.table("promoter_bulk_signals").update(rets).eq("id", row["id"]).execute()
            updated += 1
        except Exception as e:
            print(f"  [bulk] {row['ticker']}: {e}")
        time.sleep(0.3)

    print(f"[returns] bulk: {updated}/{len(rows)} updated")
    return updated


def main():
    print(f"[promoter-returns] starting — {TODAY}")
    s = update_shp_returns()
    b = update_bulk_returns()
    print(f"[promoter-returns] done — {s} SHP + {b} bulk returns updated")


if __name__ == "__main__":
    main()

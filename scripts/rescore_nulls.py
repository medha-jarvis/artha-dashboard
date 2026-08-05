"""
rescore_nulls.py — Re-scores pead_signals where fundamentals are NULL.

Runs after the daily pead_engine when yfinance quarterly data wasn't yet
available at 4 PM on the result day. Targets last 30 days only.
"""

import os, time
from datetime import date, timedelta
import yfinance as yf
from supabase import create_client, Client
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from pead_engine import compute_score, path_from_score

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
sb: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

EMA_PERIOD = 200
VOL_SMA    = 20


def get_fundamentals(ticker: str) -> dict:
    ns = ticker if ticker.endswith(".NS") else ticker + ".NS"
    out = dict(yoy_profit=None, yoy_revenue=None, opm_bps=None, ttm_pe=None)
    try:
        t  = yf.Ticker(ns)
        out["ttm_pe"] = t.info.get("trailingPE")
        qf = t.quarterly_financials
        if qf is None or qf.empty or qf.shape[1] < 5:
            return out
        cols = qf.columns.tolist()

        def safe(row_key, idx):
            try:
                k = next((k for k in qf.index if row_key.lower() in str(k).lower()), None)
                if not k or idx >= len(cols): return None
                v = qf.loc[k, cols[idx]]
                return float(v) if v is not None and v == v else None
            except Exception:
                return None

        rev_c, rev_p = safe("Total Revenue", 0), safe("Total Revenue", 4)
        net_c, net_p = safe("Net Income",    0), safe("Net Income",    4)
        opi_c, opi_p = safe("Operating",     0), safe("Operating",     4)

        if rev_c and rev_p and rev_p != 0:
            out["yoy_revenue"] = round((rev_c - rev_p) / abs(rev_p) * 100, 2)
        if net_c and net_p and net_p != 0:
            out["yoy_profit"]  = round((net_c - net_p) / abs(net_p) * 100, 2)
        if opi_c and rev_c and opi_p and rev_p and rev_c != 0 and rev_p != 0:
            out["opm_bps"] = round((opi_c/rev_c*100 - opi_p/rev_p*100) * 100, 1)
    except Exception as e:
        print(f"  [fund] {ticker}: {e}")
    return out


def get_technicals(ticker: str, signal_date: date) -> dict:
    ns = ticker if ticker.endswith(".NS") else ticker + ".NS"
    out = dict(price_vs_ema200_pct=None, vol_mult=None, day_gap_pct=None)
    try:
        end = (signal_date + timedelta(days=1)).isoformat()
        df  = yf.Ticker(ns).history(
            start=(signal_date - timedelta(days=300)).isoformat(),
            end=end, interval="1d", auto_adjust=True)
        if df.empty or len(df) < 22:
            return out
        close, volume, open_ = df["Close"], df["Volume"], df["Open"]
        ema200  = float(close.ewm(span=EMA_PERIOD, adjust=False).mean().iloc[-1])
        vol_sma = float(volume.rolling(VOL_SMA).mean().iloc[-2])
        last_c  = float(close.iloc[-1])
        last_v  = float(volume.iloc[-1])
        prev_c  = float(close.iloc[-2])
        last_o  = float(open_.iloc[-1])
        out["price_vs_ema200_pct"] = round((last_c - ema200) / ema200 * 100, 2)
        out["vol_mult"]            = round(last_v / vol_sma, 2) if vol_sma > 0 else 0
        out["day_gap_pct"]         = round((last_o - prev_c) / prev_c * 100, 2) if prev_c else 0
    except Exception as e:
        print(f"  [tech] {ticker}: {e}")
    return out


def main():
    today  = date.today()
    cutoff = (today - timedelta(days=30)).isoformat()

    # Fetch signals where fundamentals are null (unscored or scored as 0 with no data)
    resp = sb.table("pead_signals") \
        .select("id,ticker,signal_date,pead_score") \
        .gte("signal_date", cutoff) \
        .is_("yoy_profit_pct", "null") \
        .order("signal_date", desc=True) \
        .execute()

    signals = resp.data or []
    print(f"=== Rescore Nulls — {today} | {len(signals)} entries with null fundamentals ===")

    updated = 0
    for sig in signals:
        ticker      = sig["ticker"]
        sig_date    = date.fromisoformat(sig["signal_date"])
        print(f"→ {ticker} ({sig_date})", end="  ")

        fund = get_fundamentals(ticker)
        time.sleep(0.4)
        tech = get_technicals(ticker, sig_date)
        time.sleep(0.4)

        score = compute_score(
            yoy_profit  = fund["yoy_profit"],
            yoy_revenue = fund["yoy_revenue"],
            opm_bps     = fund["opm_bps"],
            price_vs_ema= tech["price_vs_ema200_pct"],
            vol_mult    = tech["vol_mult"],
            day_gap     = tech["day_gap_pct"],
        )
        path = path_from_score(score)

        update = {
            "pead_score":         score,
            "trigger_path":       path,
            "yoy_profit_pct":     fund["yoy_profit"],
            "yoy_revenue_pct":    fund["yoy_revenue"],
            "opm_expansion_bps":  fund["opm_bps"],
            "price_vs_ema200_pct":tech["price_vs_ema200_pct"],
            "volume_multiplier":  tech["vol_mult"],
            "day_gap_pct":        tech["day_gap_pct"],
            "ttm_pe":             fund["ttm_pe"],
        }
        try:
            sb.table("pead_signals").update(update).eq("id", sig["id"]).execute()
            print(f"score={score} path={path} ✓")
            updated += 1
        except Exception as e:
            print(f"db error: {e}")

    print(f"\n[done] {updated}/{len(signals)} rescored")


if __name__ == "__main__":
    main()

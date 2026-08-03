"""
dispatch.py — Supabase upsert + Telegram rich alert

Sends:
  1. ⚡ FRESH STAGE ENTRIES — sectors that just confirmed a new Stage 2A/2B
  2. Full Stage 2A / Stage 2B / Stage 1 breakdown
  3. Summary of Avoid/Weak sectors
"""

import os, datetime, requests
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
CHAT_ID   = os.environ["TELEGRAM_CHAT_ID"]
SB_URL    = os.environ["SUPABASE_URL"]
SB_KEY    = os.environ["SUPABASE_SERVICE_KEY"]
supabase: Client = create_client(SB_URL, SB_KEY)


def _tg(text: str) -> None:
    url  = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    resp = requests.post(url, json={
        "chat_id":    CHAT_ID,
        "text":       text,
        "parse_mode": "Markdown",
    }, timeout=15)
    if not resp.ok:
        print(f"  Telegram error: {resp.status_code} {resp.text[:200]}")


def _fmt_rs(rs: float | None) -> str:
    if rs is None: return "—"
    return f"{'+' if rs >= 0 else ''}{rs:.1f}%"


def _fmt_atr(r: float | None) -> str:
    if r is None: return "—"
    if r < 0.70: return f"Tight VCP ({r:.2f})"
    if r < 0.85: return f"Compressed ({r:.2f})"
    return f"Normal ({r:.2f})"


def _days_label(days: int | None) -> str:
    if days is None: return ""
    if days <= 14:  return f"🆕 {days}d"
    if days <= 45:  return f"{days}d"
    return f"{days}d ⚠️"


def build_message(rows: list[dict]) -> str:
    today = datetime.date.today().strftime("%-d %b %Y, %A")

    # Use confirmed_stage if available, fall back to raw stage
    def stage(r): return r.get("confirmed_stage") or r.get("stage", "")

    stage2a = [r for r in rows if stage(r) == "Stage 2A Early Inflection"]
    stage2b = [r for r in rows if stage(r) == "Stage 2B Sustained Trend"]
    stage1  = [r for r in rows if stage(r) == "Stage 1 Consolidation"]
    avoid   = [r for r in rows if stage(r) == "Avoid / Weak"]

    # Fresh entries = sectors that just confirmed a new Stage 2A or 2B
    fresh = [
        r for r in rows
        if r.get("is_fresh_entry") and stage(r) in ("Stage 2A Early Inflection", "Stage 2B Sustained Trend")
        and (r.get("days_in_current_stage") or 999) <= 14
    ]

    lines = [
        "🔭 *ARTHA SECTOR PULSE — WEEKLY CHART EDITION*",
        f"📅 *{today}*",
        "_Scored on weekly candles · 2-week stage confirmation_",
        "",
    ]

    # ── Fresh entries (most actionable) ──────────────────────────────────────
    if fresh:
        lines.append("⚡ *FRESH STAGE ENTRIES  ←  ACT ON THESE*")
        for r in sorted(fresh, key=lambda x: x.get("score", 0), reverse=True):
            tops     = r.get("top_constituents") or []
            top_syms = ", ".join(
                (t["symbol"].replace(".NS","").replace(".BO","") if isinstance(t,dict) else str(t))
                for t in tops[:3]
            )
            prev = r.get("prev_stage", "")
            prev_txt = f" _(was {prev.split()[1] if prev else '?'})_" if prev else ""
            lines += [
                f"• *{r['name']}* — {stage(r).split()[1]} | Score {r.get('score',0)}/100{prev_txt}",
                f"  ↳ RS: {_fmt_rs(r.get('rs_score'))} | Breadth: {r.get('breadth_pct',0):.0f}% | {_days_label(r.get('days_in_current_stage'))} in stage",
            ]
            if top_syms:
                lines.append(f"  ↳ Leaders above 10W SMA: {top_syms}")
            lines.append("")

    # ── Stage 2A ─────────────────────────────────────────────────────────────
    if stage2a:
        lines.append("🔥 *STAGE 2A — EARLY INFLECTION (Score ≥ 80)*")
        for r in sorted(stage2a, key=lambda x: x.get("score",0), reverse=True):
            tops     = r.get("top_constituents") or []
            top_syms = ", ".join(
                (t["symbol"].replace(".NS","").replace(".BO","") if isinstance(t,dict) else str(t))
                for t in tops[:3]
            )
            lines += [
                f"• *{r['name']}* | Score: *{r.get('score',0)}/100* | {_days_label(r.get('days_in_current_stage'))} in stage",
                f"  ↳ RS: {_fmt_rs(r.get('rs_score'))} | Breadth: {r.get('breadth_pct',0):.0f}% | ATR: {_fmt_atr(r.get('atr_ratio'))}",
            ]
            if top_syms:
                lines.append(f"  ↳ Leaders: {top_syms}")
            lines.append("")

    # ── Stage 2B ─────────────────────────────────────────────────────────────
    if stage2b:
        lines.append("📈 *STAGE 2B — SUSTAINED TREND (Score 65–79)*")
        for r in sorted(stage2b, key=lambda x: x.get("score",0), reverse=True):
            tops     = r.get("top_constituents") or []
            top_syms = ", ".join(
                (t["symbol"].replace(".NS","").replace(".BO","") if isinstance(t,dict) else str(t))
                for t in tops[:3]
            )
            lines += [
                f"• *{r['name']}* | {r.get('score',0)}/100 | {_days_label(r.get('days_in_current_stage'))} in stage",
                f"  ↳ RS: {_fmt_rs(r.get('rs_score'))} | Breadth: {r.get('breadth_pct',0):.0f}%",
            ]
            if top_syms:
                lines.append(f"  ↳ Leaders: {top_syms}")
            lines.append("")

    if stage1:
        names = ", ".join(r["name"] for r in sorted(stage1, key=lambda x: x.get("score",0), reverse=True))
        lines.append(f"🟡 *Stage 1 Consolidation:* {names}")
        lines.append("")
    if avoid:
        names = ", ".join(r["name"] for r in avoid)
        lines.append(f"🔴 *Avoid / Weak:* {names}")
        lines.append("")

    lines.append(f"_Monitored: {len(rows)} sectors · Scores from weekly candles_")
    return "\n".join(lines)


def dispatch_from_db() -> None:
    today = datetime.date.today().isoformat()
    res   = supabase.table("daily_sector_scores").select(
        "score, stage, confirmed_stage, stage_entry_date, days_in_current_stage, "
        "prev_stage, is_fresh_entry, distance_52w_high, rs_score, atr_ratio, "
        "breadth_pct, top_constituents, sector_definitions(name, slug)"
    ).eq("date", today).order("score", desc=True).execute()

    if not res.data:
        _tg(f"⚠️ *Sector Pulse*: No scores for {today}. Pipeline may not have run.")
        return

    rows = []
    for r in res.data:
        sdef = r.get("sector_definitions") or {}
        rows.append({
            "name":                  sdef.get("name", "Unknown"),
            "slug":                  sdef.get("slug", ""),
            "score":                 r["score"],
            "stage":                 r["stage"],
            "confirmed_stage":       r.get("confirmed_stage"),
            "stage_entry_date":      r.get("stage_entry_date"),
            "days_in_current_stage": r.get("days_in_current_stage"),
            "prev_stage":            r.get("prev_stage"),
            "is_fresh_entry":        r.get("is_fresh_entry"),
            "distance_52w_high":     r.get("distance_52w_high"),
            "rs_score":              r.get("rs_score"),
            "atr_ratio":             r.get("atr_ratio"),
            "breadth_pct":           r.get("breadth_pct"),
            "top_constituents":      r.get("top_constituents"),
        })

    msg = build_message(rows)
    _tg(msg)
    qualifying = sum(1 for r in rows if (r.get("confirmed_stage") or r["stage"]) in (
        "Stage 2A Early Inflection", "Stage 2B Sustained Trend"))
    print(f"[dispatch] Sent: {len(rows)} sectors, {qualifying} qualifying.")


def dispatch_from_results(results: list[dict]) -> None:
    rows = []
    for r in results:
        meta, row, si = r["meta"], r["row"], r.get("stage_info", {})
        rows.append({
            "name":                  meta["name"],
            "slug":                  meta.get("slug", ""),
            "score":                 row["score"],
            "stage":                 row["stage"],
            "confirmed_stage":       row.get("confirmed_stage"),
            "stage_entry_date":      row.get("stage_entry_date"),
            "days_in_current_stage": row.get("days_in_current_stage"),
            "prev_stage":            row.get("prev_stage"),
            "is_fresh_entry":        row.get("is_fresh_entry"),
            "distance_52w_high":     row.get("distance_52w_high"),
            "rs_score":              row.get("rs_score"),
            "atr_ratio":             row.get("atr_ratio"),
            "breadth_pct":           row.get("breadth_pct"),
            "top_constituents":      row.get("top_constituents"),
        })

    qualifying = [r for r in rows if (r.get("confirmed_stage") or r["stage"]) in (
        "Stage 2A Early Inflection", "Stage 2B Sustained Trend")]
    if not qualifying:
        print("[dispatch] No sectors qualifying. Skipping Telegram.")
        return

    _tg(build_message(rows))
    print(f"[dispatch] Sent: {len(rows)} sectors, {len(qualifying)} qualifying.")


if __name__ == "__main__":
    dispatch_from_db()

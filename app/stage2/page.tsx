'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, RefreshCw, AlertCircle, ChevronUp, ChevronDown,
  Layers, ExternalLink, TrendingUp, TrendingDown, Minus, Star,
} from 'lucide-react';
import { InfoTooltip } from '../components/InfoTooltip';

const sb = (path: string) =>
  fetch(`/api/sb/${path}`, { cache: 'no-store' }).then(r => r.json());

interface Signal {
  id: string;
  ticker: string;
  company_name: string | null;
  sector: string | null;
  signal_date: string;
  entry_date: string | null;
  stage2_score: number;
  days_in_stage2: number | null;
  ema150_distance_pct: number | null;
  ema150_slope: number | null;
  above_200sma: boolean | null;
  above_50sma: boolean | null;
  sma50_above_ema150: boolean | null;
  ema150_above_sma200: boolean | null;
  sma200_slope: number | null;
  stage2_subtype: string | null;
  base_20d_distance_pct: number | null;
  hl_depth_20d: number | null;
  vol_5d_vs_50d_ratio: number | null;
  pivot_proximity_pct: number | null;
  volume_multiplier: number | null;
  rs_trend: string | null;
  rs_63d_score: number | null;
  rs_52w_percentile: number | null;
  rs_line_new_high: boolean | null;
  adr_pct: number | null;
  price_52w_position: number | null;
  base_width_weeks: number | null;
  base_count: number | null;
  vcp_score: number | null;
  vcp_volume_ratio: number | null;
  vcp_adr_ratio: number | null;
  ttm_eps_growth: number | null;
  roce: number | null;
  eps_is_accelerating: boolean | null;
  eps_acceleration_quarters: number | null;
  pe_ratio: number | null;
  tier: string;
  lifecycle_state: string | null;
  score_3d_delta: number | null;
  score_trend: string | null;
  is_pead_confluence: boolean;
  is_smart_money_divergence: boolean;
  is_reentry: boolean | null;
  returns_since_breakout?: number | null;
  daily_return?: number | null;
  t_5_return?: number | null;
  t_20_return?: number | null;
}

type SortKey =
  | 'ticker' | 'stage2_score' | 'days_in_stage2' | 'hl_depth_20d'
  | 'pivot_proximity_pct' | 'vol_5d_vs_50d_ratio' | 'rs_52w_percentile'
  | 'rs_63d_score' | 'ttm_eps_growth' | 'signal_date' | 'stage2_subtype'
  | 'returns_since_breakout' | 'daily_return' | 'score_3d_delta'
  | 'adr_pct' | 'price_52w_position' | 'base_width_weeks' | 'base_count';

type SortDir    = 'asc' | 'desc';
type FilterMode = 'all' | 'confirmed' | 'emerging' | 'early_stage2' | 'fresh' | 'strengthening' | 'golden_window';

const fmtPct = (v: number | null | undefined, dec = 1) =>
  v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(dec)}%`;

const fmtDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—';

const retCls = (v: number | null | undefined) =>
  v == null ? 'text-slate-500' :
  v > 15    ? 'text-emerald-300 font-bold' :
  v > 0     ? 'text-emerald-400' :
  v > -10   ? 'text-red-400' : 'text-red-500 font-bold';

// ─── Tooltip definitions ───────────────────────────────────────────────────────
const TIPS: Record<string, { title: string; content: string }> = {
  ticker: {
    title: 'Stock',
    content: 'NSE ticker symbol with company name. Special badges below the name: PEAD+S2 (post-earnings drift confluence), REENTRY (re-qualified after exit), SMD (smart money divergence — unusual volume without earnings). Click the ticker to open StockScans chart.',
  },
  stage2_subtype: {
    title: 'Stage 2 Phase',
    content: 'Where the stock is in its Stage 2 lifecycle — based on % gap between 50 SMA and 200 SMA. EARLY (≤15% gap): just crossed the institutional threshold — maximum upside, lowest macro risk. Best for new positions. MID (15–30% gap): established Stage 2, 2nd or 3rd base still highly actionable. LATE (>30% gap): extended run — bases prone to failure, size down significantly. Always prefer EARLY for initiating new trades.',
  },
  lifecycle_state: {
    title: 'Lifecycle State',
    content: 'CONFIRMED (85+): all 4 knockout conditions met, all additive dimensions strong — active buy zone. SUSTAINED: CONFIRMED for 30+ consecutive days, proven multi-week leader. EMERGING (70–84): building base, add to watchlist. WEAKENING: score dropped >12 pts in 5 days OR price below 50 SMA — tighten stops immediately. EXITED: failed trend knockout or below 150 EMA — Stage 2 is over, exit or reduce position.',
  },
  stage2_score: {
    title: 'Score (0–100)',
    content: 'Weinstein + Minervini rubric v3.0. Five dimensions: (1) Trend Alignment KNOCKOUT 30pts — Price>50SMA>150EMA>200SMA AND 200SMA slope>0; any failure = score 0. (2) Fundamentals 20pts — EPS TTM>0 + accelerating + ROCE>15%. (3) Volatility Contraction 20pts — 20d H-L ≤5% AND volume <50% of 50d avg. (4) Pivot Proximity 15pts — within −5% to +2% of 10-day high. (5) Relative Strength 15pts — 52W rank ≥85 AND 63d RS ≥+10%. Score 85+ = CONFIRMED. 70–84 = EMERGING.',
  },
  score_3d_delta: {
    title: '3-Day Score Change',
    content: 'Score momentum vs 3 trading days ago. STRENGTHENING (↑, score rose 8+ pts): setup is aligning — signals are confirming each other, consider entering. WEAKENING (↓, dropped 8+ pts): signals deteriorating — trim position or tighten stop-loss. NEUTRAL: stable setup, watch for a decisive move in either direction.',
  },
  trend: {
    title: 'Trend Knockout (4 dots)',
    content: 'The four conditions that ALL must be green for a stock to qualify. Red dot on ANY = stock fails immediately. Left to right: (1) Price > 50 SMA — intermediate uptrend active. (2) 50 SMA > 150 EMA — moving averages in correct Weinstein order. (3) 150 EMA > 200 SMA — long-term acceleration confirmed. (4) 200 SMA slope > 0 — the macro trend itself is rising; a declining 200 SMA means Stage 4 distribution, not Stage 2. If ANY dot is red, the score is 0 and the stock should NOT be in your watchlist.',
  },
  volatility: {
    title: 'Volatility Contraction (VCP)',
    content: 'Minervini VCP v3.0. Two metrics: (1) 20-day H-L depth = (highest high − lowest low) / close over 20 days. ≤5% (green): textbook tight coil — full 20 pts. ≤10% (amber): acceptable contraction — 10 pts. >10% (red): loose, choppy base — 0 pts. (2) Volume ratio = 5-day avg vol ÷ 50-day avg vol. <0.5x (green): seller exhaustion confirmed — supply drying up. 0.5–0.75x (amber): drying up. >0.75x (red): still active sellers. Both green together = textbook VCP: price tightening + volume shrinking = coiled spring.',
  },
  adr_pct: {
    title: 'ADR% — Average Daily Range',
    content: 'Average of (High − Low) / Close over last 20 trading days, expressed as %. Minervini\'s volatility sizing tool. 3–7% (green): ideal sweet spot — enough daily movement to generate returns, not enough to shake you out on random noise. Below 3% (grey): stock is too slow, won\'t generate meaningful short-term returns. Above 7–10% (amber): elevated volatility. Above 10% (red): too volatile — normal daily swings will trigger your stop-loss randomly. Practical use: risk 1 ADR% below your entry for stop placement.',
  },
  pivot: {
    title: 'Entry Zone (Pivot Proximity)',
    content: '(Close − 10-day High) / 10-day High × 100. Green "In Zone" = within −5% to +2% of the 10-day high — this is the coil, your buy zone. Amber "Near" = −10% to −5%, still watchable, may enter zone soon. Red "Extended" = above +2%, you are chasing — expect to get shaken out on routine dips. Red "Far" = below −10%, base not yet fully formed. Enter only when In Zone AND volume confirms.',
  },
  rs: {
    title: 'Relative Strength',
    content: 'Dual-timeframe leadership filter. 52W percentile: where this stock ranks by 1-year return among all qualifying stocks in the universe (0–100). 63d score: % outperformance vs Nifty Total Market over 63 trading days (~3 months). 15 pts: rank ≥85th AND 63d ≥+10% — both must be true (dual leader). 7 pts: rank ≥70th AND 63d ≥+5%. 0 pts: lagging. Target stocks in the top 20% of the universe. A high-RS stock that consolidates while the market is flat is institutions quietly accumulating.',
  },
  rs_line_new_high: {
    title: 'RS Line at New High',
    content: 'Is the Relative Strength Line (stock price ÷ Nifty Total Market) at a new 52-week high right now? When YES: the stock is outperforming the entire market at its highest rate in over a year. This is the #1 institutional momentum confirmation. When price breaks out AND the RS line simultaneously hits a new high, win rates are significantly higher than breakouts where the RS line is lagging. Weinstein called this "leading the market up." NO means the stock is rising, but the market is rising faster — less conviction.',
  },
  price_52w_position: {
    title: '52-Week Price Position',
    content: 'Where the current price sits within its 52-week High–Low range. Formula: (Close − 52W Low) / (52W High − 52W Low) × 100. 75–100% (green): Minervini SEPA requirement — must be near 52W highs. Institutions accumulate at new highs, not dips — this is unintuitive but institutional reality. 90–100%: maximum momentum signature — the stock is leading. Below 75% (amber/red): the stock is "broken" relative to its annual range — the setup is premature; wait for recovery to highs.',
  },
  fundamentals: {
    title: 'Fundamental Engine',
    content: 'EPS TTM = trailing 12-month net profit growth YoY. ↑↑ = accelerating (Q0 YoY > Q1 YoY — Minervini hallmark of a true growth stock). Qtrs = how many consecutive quarters of acceleration. ROCE = Return on Capital Employed (how efficiently the business uses capital). P/E = price-to-earnings (context only, not scored). 20 pts: EPS>0 + accelerating + ROCE>15%. 10 pts: strong EPS OR ROCE>15%. 5 pts: TURN — EPS negative but improving >30% YoY (turnaround tier for pre-profit growth companies). P/E shown as context: high RS + reasonable P/E = institutional sweet spot.',
  },
  days_base: {
    title: 'Stage Duration, Base Analysis',
    content: 'Three metrics in one cell. Days: consecutive days above 150 EMA — the clock for your Stage 2 thesis. B1/B2/B3 badge: which base number this is in the current Stage 2 run (1st base has highest win rate historically; by 3rd+ base risk of Stage 3 correction increases). Base Width (wks): weeks since the stock last made its 52-week high — how long it has been consolidating. Weinstein requires ≥6 weeks for a quality base. Short bases (2–3 weeks) have higher failure rates. Color: Green ≤15d (golden window — best risk-reward), Amber ≤45d, Grey >45d.',
  },
  returns_since_breakout: {
    title: 'Returns Since Entry',
    content: 'Left: total return since entry_date (when stock first qualified for Stage 2). Right: today\'s price change. Near 0%: fresh setup, move has barely started — ideal entry window. Already 20–30%+: first leg likely done, wait for new tight base to form before entering. Negative total: breakout is failing — watch for close below 150 EMA as the definitive exit signal (Stage 2 over).',
  },
  pead_badge: {
    title: 'PEAD + Stage 2 Confluence',
    content: 'Post-Earnings Announcement Drift detected. This stock had a significant positive earnings surprise AND is simultaneously in a Stage 2 setup. Academic research on PEAD shows stocks that gap up sharply on earnings continue drifting higher for 60–90 days as analysts revise estimates upward. When PEAD aligns with Stage 2 technical structure: both the fundamental catalyst AND the technical breakout pattern are in place at the same time. Historically one of the highest-probability setup combinations.',
  },
  smd_badge: {
    title: 'Smart Money Divergence',
    content: 'Unusual institutional volume (3x+ of 20-day average) is occurring DESPITE negative earnings growth. Smart money (institutional funds) is accumulating BEFORE earnings turn positive — they see something the street hasn\'t priced in. This is a pre-breakout accumulation signal. High risk, high reward: the thesis requires the earnings recovery to materialize. Best used when score ≥75, ROCE >10%, and the buying is concentrated in up-days. Warrants position sizing caution until earnings confirm.',
  },
  reentry_badge: {
    title: 'Re-Entry Signal',
    content: 'This stock previously dropped below its 150 EMA (exited Stage 2) and has now re-qualified. A re-entry can signal a second chance at a missed move. Re-entries within 20–40 days of the exit with a tighter second base than the first are historically as profitable as the original breakout. Shorter re-entry gaps (stock quickly reclaimed 150 EMA) are more bullish — indicates institutional buying absorbed the correction. Very long gaps (>60 days) or multiple re-entries suggest structural weakness.',
  },
};

// ─── Components ───────────────────────────────────────────────────────────────

function LifecyclePill({ state }: { state: string | null }) {
  const s = state || 'WATCHING';
  const cfg: Record<string, string> = {
    SUSTAINED: 'bg-cyan-900/50 text-cyan-400 border-cyan-700/50',
    CONFIRMED: 'bg-emerald-900/50 text-emerald-400 border-emerald-700/50',
    EMERGING:  'bg-amber-900/50 text-amber-400 border-amber-700/50',
    WEAKENING: 'bg-orange-900/50 text-orange-400 border-orange-700/50',
    WATCHING:  'bg-slate-800 text-slate-400 border-slate-700',
    EXITED:    'bg-red-900/50 text-red-400 border-red-700/50',
  };
  return (
    <span className={`inline-block text-[9px] font-bold px-1.5 py-0.5 rounded border ${cfg[s] || cfg.WATCHING}`}>
      {s}
    </span>
  );
}

function StagePill({ subtype, small }: { subtype: string | null; small?: boolean }) {
  if (!subtype) return null;
  const cfg: Record<string, string> = {
    'EARLY STAGE 2': 'bg-emerald-900/40 text-emerald-300 border-emerald-700/50',
    'MID STAGE 2':   'bg-blue-900/40 text-blue-300 border-blue-700/50',
    'LATE STAGE 2':  'bg-orange-900/40 text-orange-300 border-orange-700/50',
  };
  const label: Record<string, string> = {
    'EARLY STAGE 2': 'EARLY',
    'MID STAGE 2':   'MID',
    'LATE STAGE 2':  'LATE',
  };
  const sz = small ? 'text-[8px] px-1 py-0' : 'text-[9px] px-1.5 py-0.5';
  return (
    <span className={`inline-block font-bold rounded border ${sz} ${cfg[subtype] || 'bg-slate-800 text-slate-500 border-slate-700'}`}>
      {label[subtype] || subtype}
    </span>
  );
}

function ScoreDelta({ delta, trend }: { delta: number | null; trend: string | null }) {
  if (delta == null) return <span className="text-slate-600 text-[10px]">—</span>;
  const abs = Math.abs(delta);
  if (trend === 'STRENGTHENING') return (
    <span className="text-emerald-400 text-[10px] font-bold flex items-center gap-0.5">
      <TrendingUp className="w-3 h-3" />+{abs}
    </span>
  );
  if (trend === 'WEAKENING') return (
    <span className="text-red-400 text-[10px] font-bold flex items-center gap-0.5">
      <TrendingDown className="w-3 h-3" />-{abs}
    </span>
  );
  return <span className="text-slate-500 text-[10px] flex items-center gap-0.5"><Minus className="w-3 h-3" />{abs}</span>;
}

function TrendCell({
  above50, sma50AboveEma150, ema150AboveSma200, sma200Slope,
}: {
  above50: boolean | null; sma50AboveEma150: boolean | null;
  ema150AboveSma200: boolean | null; sma200Slope: number | null;
}) {
  const dot = (on: boolean | null, label: string) => (
    <span key={label} title={label}
      className={`w-2 h-2 rounded-full inline-block ${on ? 'bg-emerald-400' : 'bg-red-400/60'}`} />
  );
  return (
    <div className="flex items-center gap-1">
      {dot(above50,          'Price > 50 SMA')}
      {dot(sma50AboveEma150, '50 SMA > 150 EMA')}
      {dot(ema150AboveSma200,'150 EMA > 200 SMA')}
      {dot(sma200Slope != null && sma200Slope > 0, '200 SMA slope > 0')}
    </div>
  );
}

function VolatilityCell({ hl, volRatio }: { hl: number | null; volRatio: number | null }) {
  if (hl == null) return <span className="text-slate-600">—</span>;
  const hlCls = hl <= 5 ? 'text-emerald-400 font-bold'
              : hl <= 10 ? 'text-amber-400 font-medium'
              : 'text-red-400';
  const volCls = volRatio == null ? 'text-slate-600'
               : volRatio < 0.5  ? 'text-emerald-400 font-bold'
               : volRatio < 0.75 ? 'text-amber-400'
               : 'text-red-400';
  return (
    <div className="text-xs">
      <div className={hlCls}>{hl.toFixed(1)}% HL</div>
      {volRatio != null && (
        <div className={`text-[9px] mt-0.5 ${volCls}`}>{volRatio.toFixed(2)}x vol</div>
      )}
    </div>
  );
}

function AdrCell({ adr }: { adr: number | null }) {
  if (adr == null) return <span className="text-slate-600 text-xs">—</span>;
  const cls = (adr >= 3 && adr <= 7)  ? 'text-emerald-400 font-bold'
            : (adr >= 2 && adr < 3)   ? 'text-amber-400'
            : (adr > 7 && adr <= 10)  ? 'text-amber-400'
            : adr > 10                 ? 'text-red-400'
            : 'text-slate-500';
  const label = (adr >= 3 && adr <= 7) ? 'Ideal'
              : adr < 3 ? 'Slow' : adr > 10 ? 'High' : 'OK';
  return (
    <div className="text-xs">
      <span className={cls}>{adr.toFixed(1)}%</span>
      <div className={`text-[9px] mt-0.5 ${cls}`}>{label}</div>
    </div>
  );
}

function PivotCell({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-slate-600">—</span>;
  const cls = (pct >= -5 && pct <= 2)  ? 'text-emerald-400 font-bold'
            : (pct >= -10 && pct < -5)  ? 'text-amber-400 font-medium'
            : pct > 2                    ? 'text-red-400 font-bold'
            : 'text-slate-500';
  const label = (pct >= -5 && pct <= 2)  ? 'In Zone'
              : (pct >= -10 && pct < -5)  ? 'Near'
              : pct > 2                    ? 'Extended'
              : 'Far';
  return (
    <div className="text-xs">
      <span className={cls}>{pct >= 0 ? '+' : ''}{pct.toFixed(1)}%</span>
      <div className={`text-[9px] mt-0.5 ${cls}`}>{label}</div>
    </div>
  );
}

function RSCell({
  rs, pct63, pct52w, rsNH, pos52w,
}: {
  rs: string | null; pct63: number | null; pct52w: number | null;
  rsNH: boolean | null; pos52w: number | null;
}) {
  const trendCls = rs === 'Positive' ? 'text-emerald-400' : rs === 'Negative' ? 'text-red-400' : 'text-slate-400';
  const pct52cls = pct52w == null ? 'text-slate-600'
                 : pct52w >= 85 ? 'text-emerald-400 font-bold'
                 : pct52w >= 70 ? 'text-amber-400'
                 : 'text-slate-500';
  const pos52cls = pos52w == null ? 'text-slate-600'
                 : pos52w >= 75 ? 'text-emerald-400'
                 : pos52w >= 50 ? 'text-amber-400'
                 : 'text-red-400';
  return (
    <div className="text-xs space-y-0.5">
      {pct52w != null && <div className={pct52cls}>{pct52w}th %ile</div>}
      {pct63 != null && (
        <div className={`text-[9px] ${trendCls}`}>
          63d: {pct63 >= 0 ? '+' : ''}{pct63.toFixed(1)}%
        </div>
      )}
      {rsNH && (
        <span className="inline-flex items-center gap-0.5 text-[8px] font-bold text-emerald-400 bg-emerald-900/30 px-1 py-0.5 rounded border border-emerald-700/40">
          <Star className="w-2 h-2" />RS NH
        </span>
      )}
      {pos52w != null && (
        <div className={`text-[9px] ${pos52cls}`}>52W:{pos52w.toFixed(0)}%</div>
      )}
    </div>
  );
}

function FundamentalsCell({
  eps, roce, accel, accelQtrs, pe,
}: {
  eps: number | null; roce: number | null;
  accel: boolean | null; accelQtrs: number | null; pe: number | null;
}) {
  if (eps == null && roce == null) return <span className="text-slate-600">—</span>;
  const epsCls = eps == null ? 'text-slate-600'
               : eps > 0 ? (eps > 20 ? 'text-emerald-400 font-bold' : 'text-emerald-300')
               : eps > -50 ? 'text-amber-400'
               : 'text-red-400';
  const accelIcon = accel ? ' ↑↑' : '';
  const isTurnaround = eps != null && eps < 0;
  return (
    <div className="text-xs space-y-0.5">
      {eps != null && (
        <div className={epsCls}>
          EPS {eps >= 0 ? '+' : ''}{eps.toFixed(1)}%{accelIcon}
          {isTurnaround && (
            <span className="ml-1 text-[8px] text-amber-500 font-bold">TURN</span>
          )}
        </div>
      )}
      {roce != null && (
        <div className={roce > 15 ? 'text-emerald-400' : roce > 10 ? 'text-amber-400' : 'text-slate-400'}>
          {roce.toFixed(1)}% ROCE
        </div>
      )}
      {accelQtrs != null && accelQtrs > 0 && (
        <div className="text-[9px] text-emerald-600">{accelQtrs}Q accel</div>
      )}
      {pe != null && (
        <div className="text-[9px] text-slate-500">P/E {pe.toFixed(0)}x</div>
      )}
    </div>
  );
}

function DaysBaseCell({
  daysLive, entryDate, baseWidthWks, baseCount,
}: {
  daysLive: number; entryDate: string | null;
  baseWidthWks: number | null; baseCount: number | null;
}) {
  const dayCls = daysLive <= 15 ? 'text-emerald-400 font-bold'
               : daysLive <= 45 ? 'text-amber-400 font-semibold'
               : 'text-slate-400';
  const baseCls = baseCount == null ? '' : baseCount === 1 ? 'text-emerald-500'
                : baseCount === 2 ? 'text-amber-500' : 'text-slate-500';
  const wkCls = baseWidthWks == null ? 'text-slate-600'
              : baseWidthWks >= 6 ? 'text-emerald-400' : baseWidthWks >= 3 ? 'text-amber-400' : 'text-slate-500';
  return (
    <div className="text-xs">
      <div className="flex items-center gap-1">
        <span className={dayCls}>{daysLive}d</span>
        {baseCount != null && (
          <span className={`text-[8px] font-bold ${baseCls}`}>B{baseCount}</span>
        )}
      </div>
      <div className="text-[9px] text-slate-600 mt-0.5">{fmtDate(entryDate)}</div>
      {baseWidthWks != null && (
        <div className={`text-[9px] mt-0.5 ${wkCls}`}>{baseWidthWks}wk base</div>
      )}
    </div>
  );
}

function ScoreBar({ score }: { score: number }) {
  const cls = score >= 85 ? 'bg-emerald-500' : score >= 70 ? 'bg-amber-500' : 'bg-slate-600';
  return (
    <div className="mt-1 h-1 w-14 bg-slate-800 rounded-full overflow-hidden">
      <div className={`h-full ${cls} rounded-full`} style={{ width: `${Math.min(100, score)}%` }} />
    </div>
  );
}

// ─── Table header helpers ──────────────────────────────────────────────────────

function Th({ col, label, right, sticky, active, dir, onSort, tipKey }: {
  col: SortKey; label: string; right?: boolean; sticky?: boolean;
  active: boolean; dir: SortDir; onSort: (c: SortKey) => void; tipKey?: string;
}) {
  const tip = tipKey ? TIPS[tipKey] : null;
  return (
    <th
      onClick={() => onSort(col)}
      className={[
        'px-2 py-3 text-[10px] font-semibold uppercase tracking-wider cursor-pointer select-none whitespace-nowrap bg-[#161b22]',
        right ? 'text-right' : 'text-left',
        active ? 'text-white' : 'text-slate-500 hover:text-slate-300',
        sticky ? 'sticky left-0 z-30' : '',
      ].filter(Boolean).join(' ')}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        {active
          ? (dir === 'desc' ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />)
          : <ChevronUp className="w-3 h-3 opacity-20" />}
        {tip && <InfoTooltip title={tip.title} content={tip.content} />}
      </span>
    </th>
  );
}

function ThStatic({ label, tipKey, right }: { label: string; tipKey?: string; right?: boolean }) {
  const tip = tipKey ? TIPS[tipKey] : null;
  return (
    <th className={`px-2 py-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500 bg-[#161b22] whitespace-nowrap ${right ? 'text-right' : ''}`}>
      <span className="inline-flex items-center gap-0.5">
        {label}
        {tip && <InfoTooltip title={tip.title} content={tip.content} />}
      </span>
    </th>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Stage2Page() {
  const [signals,    setSignals]    = useState<Signal[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [triggering, setTriggering] = useState<string | null>(null);
  const [trigMsg,    setTrigMsg]    = useState('');
  const [sortKey,    setSortKey]    = useState<SortKey>('stage2_score');
  const [sortDir,    setSortDir]    = useState<SortDir>('desc');
  const [filter,     setFilter]     = useState<FilterMode>('all');
  const [sectorFilter, setSectorFilter] = useState<string>('all');
  const [showExited,   setShowExited]   = useState(false);
  const [showHistory,  setShowHistory]  = useState(false);

  const loadData = async () => {
    setLoading(true); setError('');
    try {
      // Primary: active signals (today's run). History mode: last 90 days.
      const sigQuery = showHistory
        ? (() => {
            const c = new Date(); c.setDate(c.getDate() - 90);
            return `stage2_signals?select=*&signal_date=gte.${c.toISOString().split('T')[0]}&order=signal_date.desc,stage2_score.desc&limit=5000`;
          })()
        : 'stage2_signals?select=*&is_active=eq.true&order=stage2_score.desc&limit=1000';

      const [rawSigs, rawPerf] = await Promise.all([
        sb(sigQuery),
        sb('stage2_performance?select=signal_id,returns_since_breakout,daily_return,t_5_return,t_20_return'),
      ]);
      if (!Array.isArray(rawSigs)) throw new Error('Bad response');
      const pm: Record<string, Record<string, unknown>> = {};
      (rawPerf || []).forEach((p: Record<string, unknown>) => {
        if (typeof p.signal_id === 'string') pm[p.signal_id] = p;
      });
      setSignals(rawSigs.map((s: Signal) => ({
        ...s,
        returns_since_breakout: (pm[s.id]?.returns_since_breakout as number) ?? null,
        daily_return:           (pm[s.id]?.daily_return as number) ?? null,
        t_5_return:             (pm[s.id]?.t_5_return as number) ?? null,
        t_20_return:            (pm[s.id]?.t_20_return as number) ?? null,
      })));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [showHistory]); // eslint-disable-line react-hooks/exhaustive-deps

  const dispatch = async (script: string) => {
    setTriggering(script); setTrigMsg('');
    try {
      const r = await fetch('/api/stage2-trigger', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script }),
      });
      const d = await r.json();
      const label = script === 'stage2_tracker' ? 'Return tracker'
                  : script === 'backfill_stage2' ? 'Backfill (7 days)'
                  : 'Stage 2 scan';
      setTrigMsg(d.ok ? `Dispatched: ${label} (20-30 min)` : `Error: ${d.error}`);
    } catch { setTrigMsg('Network error'); }
    finally { setTriggering(null); }
  };

  // Deduplicate: one row per ticker (latest signal_date wins) — safety net for history mode
  const deduplicated = useMemo(() => {
    const map = new Map<string, Signal>();
    for (const sig of signals) {
      const existing = map.get(sig.ticker);
      if (!existing || sig.signal_date > existing.signal_date) map.set(sig.ticker, sig);
    }
    return Array.from(map.values());
  }, [signals]);

  // Derive unique sectors
  const sectors = useMemo(() => {
    const s = new Set(deduplicated.map(sig => sig.sector).filter((x): x is string => !!x));
    return Array.from(s).sort();
  }, [deduplicated]);

  const daysLive = (s: Signal) =>
    s.days_in_stage2 ?? Math.floor(
      (Date.now() - new Date((s.entry_date || s.signal_date) + 'T00:00:00').getTime()) / 86400000
    );

  // Filter: EXITED + sector
  const baseFiltered = useMemo(() => {
    let result = deduplicated;
    if (!showExited) result = result.filter(s => s.lifecycle_state !== 'EXITED');
    if (sectorFilter !== 'all') result = result.filter(s => s.sector === sectorFilter);
    return result;
  }, [deduplicated, showExited, sectorFilter]);

  // Mode filter
  const modeFiltered = useMemo(() => {
    switch (filter) {
      case 'confirmed':    return baseFiltered.filter(s => s.stage2_score >= 85);
      case 'emerging':     return baseFiltered.filter(s => s.stage2_score >= 70 && s.stage2_score < 85);
      case 'early_stage2': return baseFiltered.filter(s => s.stage2_subtype === 'EARLY STAGE 2');
      case 'fresh':        return baseFiltered.filter(s => daysLive(s) <= 15);
      case 'strengthening':return baseFiltered.filter(s => s.score_trend === 'STRENGTHENING');
      case 'golden_window':return baseFiltered.filter(s =>
        s.stage2_subtype === 'EARLY STAGE 2' &&
        daysLive(s) <= 21 &&
        s.stage2_score >= 80 &&
        (s.rs_52w_percentile ?? 0) >= 80
      );
      default: return baseFiltered;
    }
  }, [baseFiltered, filter]);

  // Sort
  const sorted = useMemo(() => {
    return [...modeFiltered].sort((a, b) => {
      const d = sortDir === 'desc' ? -1 : 1;
      if (sortKey === 'ticker')         return d * a.ticker.localeCompare(b.ticker);
      if (sortKey === 'stage2_subtype') {
        const order: Record<string, number> = { 'EARLY STAGE 2': 0, 'MID STAGE 2': 1, 'LATE STAGE 2': 2 };
        return d * ((order[a.stage2_subtype || ''] ?? 3) - (order[b.stage2_subtype || ''] ?? 3));
      }
      if (sortKey === 'signal_date')    return d * a.signal_date.localeCompare(b.signal_date);
      if (sortKey === 'days_in_stage2') return d * (daysLive(a) - daysLive(b));
      const nf = sortDir === 'desc' ? -Infinity : Infinity;
      const va = (a[sortKey as keyof Signal] as number | null) ?? nf;
      const vb = (b[sortKey as keyof Signal] as number | null) ?? nf;
      return d * (Number(va) - Number(vb));
    });
  }, [modeFiltered, sortKey, sortDir]);

  const onSort = (col: SortKey) => {
    if (sortKey === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(col); setSortDir('desc'); }
  };

  // Stats
  const confirmed     = baseFiltered.filter(s => s.stage2_score >= 85).length;
  const sustained     = baseFiltered.filter(s => s.lifecycle_state === 'SUSTAINED').length;
  const emerging      = baseFiltered.filter(s => s.stage2_score >= 70 && s.stage2_score < 85).length;
  const earlys2       = baseFiltered.filter(s => s.stage2_subtype === 'EARLY STAGE 2').length;
  const strengthening = baseFiltered.filter(s => s.score_trend === 'STRENGTHENING').length;
  const rsNHCount     = baseFiltered.filter(s => s.rs_line_new_high).length;
  const avgReturn     = (() => {
    const v = baseFiltered.map(s => s.returns_since_breakout).filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  })();

  const stockScansUrl  = (t: string) => `https://www.stockscans.in/charts/NSE:${t.replace(/\.NS$/i, '')}`;
  const tradingViewUrl = (t: string) => `https://in.tradingview.com/symbols/NSE-${t.replace(/\.NS$/i, '')}/`;

  return (
    <div className="min-h-screen bg-[#0d1117] p-3 md:p-5">
      <div className="max-w-[2000px] mx-auto space-y-4">

        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Link href="/" className="text-slate-500 hover:text-slate-300"><ArrowLeft className="w-4 h-4" /></Link>
              <Layers className="w-5 h-5 text-blue-400" />
              <h1 className="text-lg font-black text-white">Stage 2 Intelligence Hub</h1>
              <span className="text-[10px] bg-blue-900/50 text-blue-400 border border-blue-700/40 px-1.5 py-0.5 rounded font-bold">v3.1</span>
            </div>
            <p className="text-xs text-slate-500 ml-11">
              Weinstein + Minervini · Knockout 30 + Funda 20 + VCP 20 + Pivot 15 + RS 15 ·
              CONFIRMED≥85 · ~700 universe · Click headers to sort
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => dispatch('stage2_engine')} disabled={!!triggering}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-semibold disabled:opacity-50 transition">
              <Layers className={`w-3.5 h-3.5 ${triggering === 'stage2_engine' ? 'animate-pulse' : ''}`} />
              Run Scan
            </button>
            <button onClick={() => dispatch('stage2_tracker')} disabled={!!triggering}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded text-xs font-medium disabled:opacity-50 transition">
              <RefreshCw className={`w-3.5 h-3.5 ${triggering === 'stage2_tracker' ? 'animate-spin' : ''}`} />
              Refresh Returns
            </button>
            <button onClick={() => dispatch('backfill_stage2')} disabled={!!triggering}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs disabled:opacity-50 transition">
              Seed 7 Days
            </button>
            <button onClick={loadData} disabled={loading}
              className="p-1.5 bg-slate-900 hover:bg-slate-800 text-slate-400 rounded disabled:opacity-50 transition">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {trigMsg && (
          <div className={`text-xs px-4 py-2.5 rounded-lg border ${
            trigMsg.startsWith('Dispatched')
              ? 'bg-emerald-900/30 border-emerald-700/40 text-emerald-300'
              : 'bg-red-900/30 border-red-700/40 text-red-300'
          }`}>{trigMsg}</div>
        )}
        {error && (
          <div className="flex items-center gap-2 bg-red-900/30 border border-red-700/40 rounded-lg p-3 text-red-300 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0" />{error}
          </div>
        )}

        {/* Stats */}
        {deduplicated.length > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-7 gap-2">
            {[
              { l: 'Confirmed (85+)', v: confirmed.toString(),     c: 'text-emerald-400' },
              { l: 'Sustained',       v: sustained.toString(),     c: 'text-cyan-400' },
              { l: 'Emerging (70–84)',v: emerging.toString(),      c: 'text-amber-400' },
              { l: 'Early Stage 2',   v: earlys2.toString(),       c: 'text-emerald-300' },
              { l: 'Strengthening',   v: strengthening.toString(), c: 'text-blue-400' },
              { l: 'RS Line NH',      v: rsNHCount.toString(),     c: 'text-emerald-400' },
              { l: 'Avg Return',      v: fmtPct(avgReturn),        c: retCls(avgReturn) },
            ].map(s => (
              <div key={s.l} className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-center">
                <div className="text-[10px] text-slate-500 mb-1">{s.l}</div>
                <div className={`text-lg font-black ${s.c}`}>{s.v}</div>
              </div>
            ))}
          </div>
        )}

        {/* Rubric legend */}
        <div className="flex flex-wrap gap-2 text-[9px]">
          {[
            { l: 'Trend KNOCKOUT', v: '30', c: 'bg-blue-900/30 border-blue-700/30 text-blue-300' },
            { l: 'Fundamental',    v: '20', c: 'bg-emerald-900/30 border-emerald-700/30 text-emerald-300' },
            { l: 'VCP/Volatility', v: '20', c: 'bg-violet-900/30 border-violet-700/30 text-violet-300' },
            { l: 'Pivot Proximity',v: '15', c: 'bg-amber-900/30 border-amber-700/30 text-amber-300' },
            { l: 'Rel. Strength',  v: '15', c: 'bg-cyan-900/30 border-cyan-700/30 text-cyan-300' },
            { l: 'CONFIRMED ≥85',  v: '✓',  c: 'bg-emerald-900/40 border-emerald-700/40 text-emerald-400' },
            { l: 'EMERGING 70–84', v: '~',  c: 'bg-amber-900/40 border-amber-700/40 text-amber-400' },
          ].map(b => (
            <span key={b.l} className={`inline-flex items-center gap-1 px-2 py-1 rounded border font-bold ${b.c}`}>
              <span className="opacity-60">{b.l}</span> {b.v}
            </span>
          ))}
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Filter mode */}
          <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-1 gap-1 flex-wrap">
            {([
              ['all',           'All'],
              ['confirmed',     'Confirmed (85+)'],
              ['emerging',      'Emerging (70–84)'],
              ['early_stage2',  'Early S2'],
              ['fresh',         'Fresh (≤15d)'],
              ['strengthening', 'Strengthening'],
              ['golden_window', '⭐ Golden Window'],
            ] as [FilterMode, string][]).map(([v, l]) => (
              <button key={v} onClick={() => setFilter(v)}
                className={`px-3 py-1 text-xs rounded font-medium transition whitespace-nowrap ${
                  filter === v
                    ? v === 'golden_window' ? 'bg-amber-600 text-white' : 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}>{l}</button>
            ))}
          </div>

          {/* Sector */}
          {sectors.length > 0 && (
            <select
              value={sectorFilter}
              onChange={e => setSectorFilter(e.target.value)}
              className="bg-slate-900 border border-slate-800 text-slate-300 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-600"
            >
              <option value="all">All Sectors</option>
              {sectors.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}

          {/* Toggles */}
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 cursor-pointer text-xs text-slate-400 hover:text-slate-300">
              <input type="checkbox" checked={showExited} onChange={e => setShowExited(e.target.checked)}
                className="w-3 h-3 rounded accent-orange-500" />
              Show Exited
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer text-xs text-slate-400 hover:text-slate-300">
              <input type="checkbox" checked={showHistory} onChange={e => setShowHistory(e.target.checked)}
                className="w-3 h-3 rounded accent-slate-500" />
              History Mode (90d)
            </label>
          </div>

          <span className="text-slate-600 text-xs">{sorted.length} setups · {deduplicated.length} unique</span>
        </div>

        {filter === 'golden_window' && (
          <div className="bg-amber-900/20 border border-amber-700/30 rounded-lg px-4 py-2 text-xs text-amber-300">
            <span className="font-bold">Golden Window:</span> EARLY Stage 2 · ≤21 days in stage · Score ≥80 · RS ≥80th percentile.
            These are the top-tier setups with the best risk-reward profile.
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div className="text-center py-20 text-slate-500 text-sm">Loading…</div>
        ) : sorted.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-16 text-center">
            <Layers className="w-8 h-8 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400 font-semibold">No Stage 2 setups in this range</p>
            <p className="text-slate-600 text-xs mt-1">
              {!showHistory && 'Try enabling History Mode or run a fresh scan.'}
            </p>
            <div className="flex gap-3 justify-center mt-4">
              <button onClick={() => dispatch('backfill_stage2')} disabled={!!triggering}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded text-xs font-medium disabled:opacity-50">Seed 7 Days</button>
              <button onClick={() => dispatch('stage2_engine')} disabled={!!triggering}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-medium disabled:opacity-50">Run Scan</button>
            </div>
          </div>
        ) : (
          <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
            <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: 'min(800px, calc(100vh - 320px))' }}>
              <table className="w-full text-xs border-collapse" style={{ minWidth: '1600px' }}>
                <thead className="sticky top-0 z-20">
                  <tr className="bg-[#161b22] border-b-2 border-slate-700">
                    {/* Sticky: Stock */}
                    <Th col="ticker"        label="Stock"      sticky active={sortKey==='ticker'}               dir={sortDir} onSort={onSort} tipKey="ticker" />
                    {/* Phase (sub-stage) */}
                    <Th col="stage2_subtype" label="Phase"     active={sortKey==='stage2_subtype'}              dir={sortDir} onSort={onSort} tipKey="stage2_subtype" />
                    {/* Lifecycle */}
                    <ThStatic label="State" tipKey="lifecycle_state" />
                    {/* Score */}
                    <Th col="stage2_score"  label="Score"      active={sortKey==='stage2_score'}                dir={sortDir} onSort={onSort} tipKey="stage2_score" />
                    {/* 3d momentum */}
                    <Th col="score_3d_delta" label="3d Δ"      active={sortKey==='score_3d_delta'}              dir={sortDir} onSort={onSort} tipKey="score_3d_delta" />
                    {/* Knockout dots */}
                    <ThStatic label="Trend ×4" tipKey="trend" />
                    {/* VCP */}
                    <Th col="hl_depth_20d"  label="VCP"        active={sortKey==='hl_depth_20d'}                dir={sortDir} onSort={onSort} tipKey="volatility" />
                    {/* ADR */}
                    <Th col="adr_pct"       label="ADR%"       active={sortKey==='adr_pct'}                     dir={sortDir} onSort={onSort} tipKey="adr_pct" />
                    {/* Pivot */}
                    <Th col="pivot_proximity_pct" label="Entry Zone" active={sortKey==='pivot_proximity_pct'}   dir={sortDir} onSort={onSort} tipKey="pivot" />
                    {/* RS (includes NH + 52W pos inside cell) */}
                    <Th col="rs_52w_percentile" label="RS"     active={sortKey==='rs_52w_percentile'}           dir={sortDir} onSort={onSort} right tipKey="rs" />
                    {/* Fundamentals */}
                    <Th col="ttm_eps_growth" label="Funda"     active={sortKey==='ttm_eps_growth'}              dir={sortDir} onSort={onSort} tipKey="fundamentals" />
                    {/* Days + base analysis */}
                    <Th col="days_in_stage2" label="Days/Base" active={sortKey==='days_in_stage2'}              dir={sortDir} onSort={onSort} tipKey="days_base" />
                    {/* Return */}
                    <Th col="returns_since_breakout" label="Return" active={sortKey==='returns_since_breakout'} dir={sortDir} onSort={onSort} right tipKey="returns_since_breakout" />
                    {/* Charts */}
                    <ThStatic label="Charts" />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(sig => {
                    const s   = sig.stage2_score;
                    const lc  = sig.lifecycle_state || 'WATCHING';
                    const sym = sig.ticker.replace(/\.NS$/i, '');
                    const dl  = daysLive(sig);

                    const rowBg = lc === 'SUSTAINED' ? 'bg-cyan-950/15 hover:bg-cyan-950/30'
                                : lc === 'CONFIRMED' ? 'bg-emerald-950/15 hover:bg-emerald-950/30'
                                : lc === 'EMERGING'  ? 'bg-amber-950/10 hover:bg-amber-950/20'
                                : lc === 'WEAKENING' ? 'bg-orange-950/15 hover:bg-orange-950/30'
                                : lc === 'EXITED'    ? 'bg-red-950/10 hover:bg-red-950/20 opacity-70'
                                : 'hover:bg-slate-800/20';

                    // Solid bg for sticky cell (must match row bg)
                    const stkBg = lc === 'SUSTAINED' ? '#030f0f'
                                : lc === 'CONFIRMED' ? '#061209'
                                : lc === 'EMERGING'  ? '#0d0d00'
                                : lc === 'WEAKENING' ? '#120800'
                                : lc === 'EXITED'    ? '#120303'
                                : '#0d1117';

                    return (
                      <tr key={sig.id} className={`border-b border-slate-800/50 transition-colors ${rowBg}`}>

                        {/* Stock — STICKY */}
                        <td className="px-3 py-2 whitespace-nowrap sticky left-0 z-10"
                            style={{ backgroundColor: stkBg }}>
                          <a href={stockScansUrl(sig.ticker)} target="_blank" rel="noopener noreferrer"
                            className="font-bold text-white hover:text-blue-400 transition-colors text-sm">{sym}</a>
                          {sig.company_name && (
                            <div className="text-slate-500 text-[10px] truncate max-w-[120px]">{sig.company_name}</div>
                          )}
                          <div className="flex gap-1 mt-0.5 flex-wrap">
                            {sig.is_pead_confluence && (
                              <span title="PEAD + Stage 2 confluence"
                                className="text-[8px] font-bold bg-violet-500/20 text-violet-400 border border-violet-500/30 px-1 py-0.5 rounded cursor-help">
                                PEAD+S2
                              </span>
                            )}
                            {sig.is_reentry && (
                              <span title="Re-entry after Stage 2 exit"
                                className="text-[8px] font-bold bg-purple-500/20 text-purple-400 border border-purple-500/30 px-1 py-0.5 rounded cursor-help">
                                REENTRY
                              </span>
                            )}
                            {sig.is_smart_money_divergence && (
                              <span title="Smart Money Divergence"
                                className="text-[8px] font-bold bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 px-1 py-0.5 rounded cursor-help">
                                SMD
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Phase */}
                        <td className="px-2 py-2 whitespace-nowrap">
                          <StagePill subtype={sig.stage2_subtype} />
                        </td>

                        {/* Lifecycle state */}
                        <td className="px-2 py-2 whitespace-nowrap">
                          <LifecyclePill state={sig.lifecycle_state} />
                        </td>

                        {/* Score */}
                        <td className="px-2 py-2 whitespace-nowrap">
                          <div>
                            <span className={`text-base font-black ${
                              s >= 85 ? 'text-emerald-400' : s >= 70 ? 'text-amber-400' : 'text-slate-500'
                            }`}>{s}</span>
                            <span className={`ml-1 text-[9px] font-bold ${
                              s >= 85 ? 'text-emerald-600' : s >= 70 ? 'text-amber-600' : 'text-slate-600'
                            }`}>{s >= 85 ? 'A+' : s >= 70 ? '~' : 'PASS'}</span>
                          </div>
                          <ScoreBar score={s} />
                        </td>

                        {/* 3d delta */}
                        <td className="px-2 py-2 whitespace-nowrap">
                          <ScoreDelta delta={sig.score_3d_delta} trend={sig.score_trend} />
                        </td>

                        {/* Trend 4-dots */}
                        <td className="px-2 py-2 whitespace-nowrap">
                          <TrendCell
                            above50={sig.above_50sma}
                            sma50AboveEma150={sig.sma50_above_ema150}
                            ema150AboveSma200={sig.ema150_above_sma200}
                            sma200Slope={sig.sma200_slope}
                          />
                          {sig.sma200_slope != null && (
                            <div className="text-[9px] text-slate-600 mt-0.5">
                              200SMA {sig.sma200_slope >= 0 ? '+' : ''}{sig.sma200_slope.toFixed(2)}%
                            </div>
                          )}
                        </td>

                        {/* VCP */}
                        <td className="px-2 py-2 whitespace-nowrap">
                          <VolatilityCell hl={sig.hl_depth_20d} volRatio={sig.vol_5d_vs_50d_ratio} />
                        </td>

                        {/* ADR% */}
                        <td className="px-2 py-2 whitespace-nowrap">
                          <AdrCell adr={sig.adr_pct} />
                        </td>

                        {/* Entry Zone */}
                        <td className="px-2 py-2 whitespace-nowrap">
                          <PivotCell pct={sig.pivot_proximity_pct} />
                        </td>

                        {/* RS */}
                        <td className="px-2 py-2 text-right whitespace-nowrap">
                          <RSCell
                            rs={sig.rs_trend} pct63={sig.rs_63d_score}
                            pct52w={sig.rs_52w_percentile} rsNH={sig.rs_line_new_high}
                            pos52w={sig.price_52w_position}
                          />
                        </td>

                        {/* Fundamentals */}
                        <td className="px-2 py-2 whitespace-nowrap">
                          <FundamentalsCell
                            eps={sig.ttm_eps_growth} roce={sig.roce}
                            accel={sig.eps_is_accelerating} accelQtrs={sig.eps_acceleration_quarters}
                            pe={sig.pe_ratio}
                          />
                        </td>

                        {/* Days + Base */}
                        <td className="px-2 py-2 whitespace-nowrap">
                          <DaysBaseCell
                            daysLive={dl} entryDate={sig.entry_date || sig.signal_date}
                            baseWidthWks={sig.base_width_weeks} baseCount={sig.base_count}
                          />
                        </td>

                        {/* Returns */}
                        <td className="px-2 py-2 text-right whitespace-nowrap">
                          <div className={`font-semibold text-xs ${retCls(sig.returns_since_breakout)}`}>
                            {fmtPct(sig.returns_since_breakout)}
                          </div>
                          <div className={`text-[9px] mt-0.5 ${retCls(sig.daily_return)}`}>
                            {fmtPct(sig.daily_return)} 1d
                          </div>
                        </td>

                        {/* Charts */}
                        <td className="px-2 py-2 text-center whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1">
                            <a href={stockScansUrl(sig.ticker)} target="_blank" rel="noopener noreferrer"
                              title="StockScans chart"
                              className="inline-flex items-center gap-0.5 text-[10px] text-slate-400 hover:text-blue-400 transition-colors px-1.5 py-0.5 rounded border border-slate-700 hover:border-blue-500 font-medium">
                              <ExternalLink className="w-2.5 h-2.5" />SS
                            </a>
                            <a href={tradingViewUrl(sig.ticker)} target="_blank" rel="noopener noreferrer"
                              title="TradingView chart"
                              className="inline-flex items-center gap-0.5 text-[10px] text-slate-500 hover:text-sky-400 transition-colors px-1.5 py-0.5 rounded border border-slate-700 hover:border-sky-500">
                              <ExternalLink className="w-2.5 h-2.5" />TV
                            </a>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 border-t border-slate-800 flex flex-wrap justify-between gap-2 text-[10px] text-slate-600">
              <span>
                {sorted.length} setups · {deduplicated.length} unique · v3.1 Weinstein+Minervini · CONFIRMED≥85 · ~700 universe
              </span>
              <span>Click column headers to sort · SS=StockScans · TV=TradingView · Badges: hover for tooltip</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

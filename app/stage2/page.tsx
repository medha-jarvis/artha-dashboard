'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, RefreshCw, AlertCircle, ChevronUp, ChevronDown,
  Layers, ExternalLink, TrendingUp, TrendingDown, Minus,
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
  stage2_score: number;            // synthetic: 90/70/40
  days_in_stage2: number | null;   // = weeks above MA_30W
  ema150_distance_pct: number | null; // = % distance from MA_30W
  ema150_slope: number | null;
  above_200sma: boolean | null;    // = Price > resistance ceiling
  above_50sma: boolean | null;     // = Price > MA_30W
  sma50_above_ema150: boolean | null; // = MA_30W slope >= 0
  ema150_above_sma200: boolean | null; // = Price > EMA_10W
  sma200_slope: number | null;     // = MA_30W slope value
  stage2_subtype: string | null;   // = Weinstein stage
  base_20d_distance_pct: number | null;
  hl_depth_20d: number | null;     // = Minervini VCP depth (daily)
  vol_5d_vs_50d_ratio: number | null; // = Vol_Ratio_Weekly
  pivot_proximity_pct: number | null; // = Minervini pivot proximity (daily)
  volume_multiplier: number | null;
  rs_trend: string | null;
  rs_63d_score: number | null;     // = Mansfield RS
  rs_52w_percentile: number | null;
  rs_line_new_high: boolean | null; // = is_daily_ma_stacked
  adr_pct: number | null;
  price_52w_position: number | null;
  base_width_weeks: number | null;
  base_count: number | null;
  vcp_score: number | null;
  vcp_volume_ratio: number | null; // = daily vol/50d ratio (dry-up)
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
}

type SortKey =
  | 'ticker' | 'stage2_score' | 'days_in_stage2' | 'vol_5d_vs_50d_ratio'
  | 'rs_63d_score' | 'rs_52w_percentile' | 'ttm_eps_growth' | 'signal_date'
  | 'stage2_subtype' | 'returns_since_breakout' | 'daily_return' | 'score_3d_delta'
  | 'sma200_slope' | 'ema150_distance_pct';

type SortDir    = 'asc' | 'desc';
type FilterMode = 'all' | 'early_s2' | 'late_s2' | 'stage1' | 'fresh' | 'golden_window';

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
    content: 'NSE ticker with company name. Badges: PEAD+S2 (post-earnings + Stage 2 confluence), REENTRY (re-qualified after prior exit). Click to open StockScans chart.',
  },
  stage2_subtype: {
    title: 'Weinstein Stage',
    content: 'Pure Weinstein stage classification using weekly OHLCV. EARLY STAGE 2A (green): Price just broke above Stage 1 resistance ceiling with volume surge — prime buy alert. LATE STAGE 2B (teal): Established uptrend, price above 10W EMA, MA slope rising — hold or add. STAGE 1 (blue): Basing around flat 30W MA, below resistance — watchlist. STAGE 3 (yellow): MA flattening after extended uptrend — distribution warning. STAGE 4 (red): Price below declining 30W MA — disqualified.',
  },
  lifecycle_state: {
    title: 'Lifecycle State',
    content: 'CONFIRMED: Early Stage 2 — active buy zone. SUSTAINED: Late Stage 2 for 30+ weeks — proven trend leader. EMERGING: Late Stage 2 — established trend, hold/add. WEAKENING: Stage dropped from 2 → 1, or topping signals. WATCHING: Stage 1 basing. EXITED: Below 30W MA in decline.',
  },
  stage2_score: {
    title: 'Stage Score',
    content: 'Synthetic score for sorting: Early Stage 2 = 90, Late Stage 2 = 70, Stage 1 = 40. The stage label matters more than the number — this is just for ranking within the same stage.',
  },
  score_3d_delta: {
    title: '3-Day Score Change',
    content: 'How the stage score changed over the past 3 trading days. Stage upgrades (+20: Stage 1 → Stage 2) signal the breakout moment. Stage downgrades (−20 to −50) signal distribution or failure.',
  },
  wein_conditions: {
    title: 'Weinstein Conditions (4 dots)',
    content: 'Four Weinstein conditions, left to right: (1) Price > 30-Week MA — the primary trend is up. (2) 30W MA slope ≥ 0 — MA is flat or curling up (Stage 2 starting or ongoing). (3) Price > 10-Week EMA — short-term momentum is positive. (4) Price > Stage 1 resistance ceiling — the breakout above the basing zone. All four green = textbook Stage 2A. Slope value shown in grey = weekly rate of MA change.',
  },
  weekly_vol: {
    title: 'Weekly Volume Ratio',
    content: 'Current week\'s volume divided by the 30-week average volume. Weinstein requires ≥ 1.5× on the breakout week — this confirms institutional participation. 1.5–2× (green): confirmed breakout volume. 2× + (bold green): exceptionally strong. Below 1× (grey): routine trading, not a breakout week.',
  },
  mansfield_rs: {
    title: 'Mansfield RS + Percentile',
    content: 'Mansfield RS = ((stock 52W return / market 52W return) − 1) × 100. Positive = outperforming Nifty Total Market over the past year. +10 or higher (green) = strong leadership. Near 0 = in line with market. Negative = underperformer — avoid buying into weakness. Also shows the cross-universe percentile rank (0–100) for this stock\'s 1-year return vs the full scanned universe.',
  },
  weeks_stage: {
    title: 'Weeks in Stage',
    content: 'Consecutive weeks the price has been above the 30-Week MA. ≤ 4 weeks (green): fresh breakout — this is the golden window with best risk-reward. 5–20 weeks (amber): established trend, still actionable for 2nd/3rd base entries. 20+ weeks (grey): extended run — be more selective, raise stops. B1/B2/B3 = base number in this Stage 2 cycle.',
  },
  minervini_radar: {
    title: 'Minervini Radar (Informational)',
    content: 'Four Minervini indicators computed from DAILY data — informational context only, not used for stage classification. VCP: 20-day high-low depth; < 5% (green) = textbook tight coil. VD: Volume dry-up (daily vol vs 50d avg); < 0.5× (green) = sellers exhausted. PIV: Distance from 10-day high; −5% to +2% (green) = pivot buy zone. STACK: Price > SMA50 > EMA150 > SMA200 (daily MA alignment — Minervini SEPA criterion). Green badges = positive signal. Amber = partial. Grey = not triggered.',
  },
  fundamentals: {
    title: 'Fundamental Context',
    content: 'EPS TTM growth YoY. ↑↑ = accelerating (Q0 > Q1 YoY). ROCE = Return on Capital Employed. P/E = context only. These are displayed alongside Weinstein stage as qualitative context — they do not affect stage classification.',
  },
  returns_since_breakout: {
    title: 'Returns Since Entry',
    content: 'Total return since entry_date. Near 0%: fresh setup, move barely started. 20–30%+: first leg likely done, wait for new base. Negative: breakout failing — watch close below 30W MA as the definitive exit signal.',
  },
};

// ─── Components ───────────────────────────────────────────────────────────────

function LifecyclePill({ state }: { state: string | null }) {
  const s = state || 'WATCHING';
  const cfg: Record<string, string> = {
    SUSTAINED: 'bg-cyan-900/50 text-cyan-400 border-cyan-700/50',
    CONFIRMED: 'bg-emerald-900/50 text-emerald-400 border-emerald-700/50',
    EMERGING:  'bg-teal-900/50 text-teal-400 border-teal-700/50',
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

function WeinSteinStagePill({ subtype }: { subtype: string | null }) {
  if (!subtype) return null;
  const map: Record<string, { label: string; cls: string }> = {
    EARLY_STAGE_2:     { label: '2A — BUY SIGNAL', cls: 'bg-emerald-900/50 text-emerald-300 border-emerald-700/50' },
    LATE_STAGE_2:      { label: '2B — RIDING TREND', cls: 'bg-teal-900/50 text-teal-300 border-teal-700/50' },
    STAGE_1_BASING:    { label: '1 — WATCHLIST', cls: 'bg-blue-900/50 text-blue-300 border-blue-700/50' },
    STAGE_3_TOPPING:   { label: '3 — DISTRIBUTION', cls: 'bg-yellow-900/50 text-yellow-300 border-yellow-700/50' },
    STAGE_4_DECLINING: { label: '4 — DISQUALIFIED', cls: 'bg-red-900/50 text-red-400 border-red-700/50' },
  };
  const cfg = map[subtype];
  if (!cfg) return <span className="text-slate-500 text-[9px]">{subtype}</span>;
  return (
    <span className={`inline-block text-[8px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap ${cfg.cls}`}>
      STAGE {cfg.label}
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

function WeinConditionsCell({
  aboveMa30w, slopePos, aboveEma10w, aboveResistance, slopeVal,
}: {
  aboveMa30w: boolean | null; slopePos: boolean | null;
  aboveEma10w: boolean | null; aboveResistance: boolean | null;
  slopeVal: number | null;
}) {
  const dot = (on: boolean | null, label: string) => (
    <span key={label} title={label}
      className={`w-2 h-2 rounded-full inline-block ${on ? 'bg-emerald-400' : 'bg-red-400/60'}`} />
  );
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {dot(aboveMa30w,       'Price > 30W MA')}
      {dot(slopePos,         '30W MA slope ≥ 0 (flat/rising)')}
      {dot(aboveEma10w,      'Price > 10W EMA')}
      {dot(aboveResistance,  'Price > Stage 1 resistance ceiling')}
      {slopeVal != null && (
        <span className="text-[9px] text-slate-600 ml-0.5">
          {slopeVal >= 0 ? '+' : ''}{(slopeVal * 100).toFixed(2)}%/wk
        </span>
      )}
    </div>
  );
}

function WeeklyVolCell({ volRatio }: { volRatio: number | null }) {
  if (volRatio == null) return <span className="text-slate-600">—</span>;
  const cls = volRatio >= 2    ? 'text-emerald-300 font-black'
            : volRatio >= 1.5  ? 'text-emerald-400 font-bold'
            : volRatio >= 1.0  ? 'text-slate-300'
            : 'text-slate-500';
  const label = volRatio >= 1.5 ? '✓ Breakout' : volRatio >= 1.0 ? 'Normal' : 'Quiet';
  return (
    <div className="text-xs">
      <span className={cls}>{volRatio.toFixed(2)}×</span>
      <div className={`text-[9px] mt-0.5 ${cls}`}>{label}</div>
    </div>
  );
}

function MansFieldRSCell({
  mansfield, pct52w, pos52w,
}: {
  mansfield: number | null; pct52w: number | null; pos52w: number | null;
}) {
  const mrsCls = mansfield == null ? 'text-slate-600'
               : mansfield > 10    ? 'text-emerald-400 font-bold'
               : mansfield > 0     ? 'text-emerald-300'
               : mansfield > -10   ? 'text-amber-400'
               : 'text-red-400';
  const pct52cls = pct52w == null ? 'text-slate-600'
                 : pct52w >= 85 ? 'text-emerald-400 font-bold'
                 : pct52w >= 70 ? 'text-amber-400'
                 : 'text-slate-500';
  return (
    <div className="text-xs space-y-0.5 text-right">
      {pct52w != null && <div className={pct52cls}>{pct52w}th %ile</div>}
      {mansfield != null && (
        <div className={`text-[10px] ${mrsCls}`}>
          MRS {mansfield >= 0 ? '+' : ''}{mansfield.toFixed(1)}
        </div>
      )}
      {pos52w != null && (
        <div className={`text-[9px] ${pos52w >= 75 ? 'text-emerald-400' : pos52w >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
          52W: {pos52w.toFixed(0)}%
        </div>
      )}
    </div>
  );
}

function WeeksStageCell({
  weeks, entryDate, baseCount,
}: {
  weeks: number; entryDate: string | null; baseCount: number | null;
}) {
  const wkCls = weeks <= 4  ? 'text-emerald-400 font-bold'
              : weeks <= 20 ? 'text-amber-400 font-semibold'
              : 'text-slate-400';
  const baseCls = baseCount == null ? '' : baseCount === 1 ? 'text-emerald-500'
                : baseCount === 2 ? 'text-amber-500' : 'text-slate-500';
  return (
    <div className="text-xs">
      <div className="flex items-center gap-1">
        <span className={wkCls}>{weeks}wk</span>
        {baseCount != null && (
          <span className={`text-[8px] font-bold ${baseCls}`}>B{baseCount}</span>
        )}
      </div>
      <div className="text-[9px] text-slate-600 mt-0.5">{fmtDate(entryDate)}</div>
    </div>
  );
}

// Compact chips — live inside the sticky ticker card
function MinerviniChips({
  vcpDepth, volRatio, pivotPct, isStacked,
}: {
  vcpDepth: number | null; volRatio: number | null;
  pivotPct: number | null; isStacked: boolean | null;
}) {
  type ChipColor = 'green' | 'yellow' | 'gray';
  const chip = (label: string, color: ChipColor, title: string) => {
    const cls: Record<ChipColor, string> = {
      green:  'bg-emerald-950 text-emerald-400 border-emerald-700/60',
      yellow: 'bg-amber-950 text-amber-400 border-amber-700/50',
      gray:   'bg-slate-900 text-slate-600 border-slate-700/40',
    };
    return (
      <span key={label} title={title}
        className={`text-[7px] font-bold px-1 py-[1px] rounded border cursor-help leading-tight ${cls[color]}`}>
        {label}
      </span>
    );
  };

  const vcpColor: ChipColor = vcpDepth == null ? 'gray'
                            : vcpDepth <= 6    ? 'green'
                            : vcpDepth <= 10   ? 'yellow'
                            : 'gray';

  return (
    <div className="flex gap-0.5 flex-wrap mt-1">
      {chip(
        `VCP${vcpDepth != null ? ` ${vcpDepth.toFixed(0)}%` : ''}`,
        vcpColor,
        `VCP depth (20d H-L range): ${vcpDepth?.toFixed(1) ?? '—'}% · ≤6% green, ≤10% yellow`,
      )}
      {chip(
        'VDU',
        volRatio != null && volRatio < 0.5 ? 'green' : 'gray',
        `Volume dry-up: daily vol is ${volRatio?.toFixed(2) ?? '—'}× of 50d avg · green if < 0.5× (sellers exhausted)`,
      )}
      {chip(
        `PIV${pivotPct != null ? ` ${pivotPct >= 0 ? '+' : ''}${pivotPct.toFixed(0)}%` : ''}`,
        pivotPct != null && pivotPct >= -5 && pivotPct <= 2 ? 'green' : 'gray',
        `Pivot proximity: ${pivotPct?.toFixed(1) ?? '—'}% from 10d high · green if −5% to +2% (buy zone)`,
      )}
      {chip(
        'STACK',
        isStacked ? 'green' : 'gray',
        'Daily MA stack: Price > SMA50 > EMA150 > SMA200 · green = Minervini SEPA alignment',
      )}
    </div>
  );
}

// Full detail badges — live in the dedicated Minervini Radar column
function MinerviniRadarCell({
  vcpDepth, volRatio, pivotPct, isStacked,
}: {
  vcpDepth: number | null; volRatio: number | null;
  pivotPct: number | null; isStacked: boolean | null;
}) {
  const badge = (text: string, on: boolean, partial: boolean, title: string) => (
    <span title={title} className={`text-[8px] font-bold px-1 py-0.5 rounded border cursor-help ${
      on      ? 'bg-emerald-900/50 text-emerald-400 border-emerald-700/50'
      : partial ? 'bg-amber-900/30 text-amber-400 border-amber-700/30'
      : 'bg-slate-800/50 text-slate-600 border-slate-700/30'
    }`}>{text}</span>
  );

  const vcpGreen   = vcpDepth != null && vcpDepth <= 6;
  const vcpYellow  = vcpDepth != null && vcpDepth <= 10 && !vcpGreen;
  const vdGood     = volRatio != null && volRatio < 0.5;
  const vdPartial  = volRatio != null && volRatio < 0.75 && !vdGood;
  const pivGood    = pivotPct != null && pivotPct >= -5 && pivotPct <= 2;
  const pivPartial = pivotPct != null && pivotPct >= -10 && !pivGood;

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex flex-wrap gap-0.5">
        {badge(
          `VCP ${vcpDepth != null ? vcpDepth.toFixed(1) + '%' : '—'}`,
          vcpGreen, vcpYellow,
          `20d H-L depth: ${vcpDepth?.toFixed(1) ?? '—'}% · ≤6% = tight coil · ≤10% = forming`,
        )}
        {badge(
          `VDU ${volRatio != null ? volRatio.toFixed(2) + '×' : '—'}`,
          vdGood, vdPartial,
          `Daily vol / 50d avg: ${volRatio?.toFixed(2) ?? '—'}× · <0.5× = sellers exhausted · <0.75× = drying`,
        )}
      </div>
      <div className="flex flex-wrap gap-0.5">
        {badge(
          `PIV ${pivotPct != null ? (pivotPct >= 0 ? '+' : '') + pivotPct.toFixed(1) + '%' : '—'}`,
          pivGood, pivPartial,
          `Pivot proximity: ${pivotPct?.toFixed(1) ?? '—'}% from 10d high · −5% to +2% = buy zone`,
        )}
        {badge(
          isStacked ? 'STACK ✓' : 'STACK ✗',
          !!isStacked, false,
          'Daily: Price > SMA50 > EMA150 > SMA200 · Minervini SEPA daily alignment',
        )}
      </div>
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
               : eps > -50 ? 'text-amber-400' : 'text-red-400';
  return (
    <div className="text-xs space-y-0.5">
      {eps != null && (
        <div className={epsCls}>
          EPS {eps >= 0 ? '+' : ''}{eps.toFixed(1)}%{accel ? ' ↑↑' : ''}
          {eps < 0 && <span className="ml-1 text-[8px] text-amber-500 font-bold">TURN</span>}
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

function ScoreBar({ score, subtype }: { score: number; subtype: string | null }) {
  const cls = subtype === 'EARLY_STAGE_2' ? 'bg-emerald-500'
            : subtype === 'LATE_STAGE_2'  ? 'bg-teal-500'
            : subtype === 'STAGE_1_BASING' ? 'bg-blue-600'
            : 'bg-slate-600';
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
  const [showHistory,  setShowHistory]  = useState(false);

  const loadData = async () => {
    setLoading(true); setError('');
    try {
      const sigQuery = showHistory
        ? (() => {
            const c = new Date(); c.setDate(c.getDate() - 90);
            return `stage2_signals?select=*&signal_date=gte.${c.toISOString().split('T')[0]}&order=signal_date.desc,stage2_score.desc&limit=5000`;
          })()
        : 'stage2_signals?select=*&is_active=eq.true&order=stage2_score.desc&limit=1000';

      const [rawSigs, rawPerf] = await Promise.all([
        sb(sigQuery),
        sb('stage2_performance?select=signal_id,returns_since_breakout,daily_return'),
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
      setTrigMsg(d.ok ? `Dispatched: ${label} (20–30 min)` : `Error: ${d.error}`);
    } catch { setTrigMsg('Network error'); }
    finally { setTriggering(null); }
  };

  // Deduplicate: one row per ticker (latest signal_date wins)
  const deduplicated = useMemo(() => {
    const map = new Map<string, Signal>();
    for (const sig of signals) {
      const existing = map.get(sig.ticker);
      if (!existing || sig.signal_date > existing.signal_date) map.set(sig.ticker, sig);
    }
    return Array.from(map.values());
  }, [signals]);

  const sectors = useMemo(() => {
    const s = new Set(deduplicated.map(sig => sig.sector).filter((x): x is string => !!x));
    return Array.from(s).sort();
  }, [deduplicated]);

  const weeksInStage = (s: Signal) => s.days_in_stage2 ?? 0;

  // Sector filter
  const baseFiltered = useMemo(() => {
    let result = deduplicated;
    if (sectorFilter !== 'all') result = result.filter(s => s.sector === sectorFilter);
    return result;
  }, [deduplicated, sectorFilter]);

  // Mode filter
  const modeFiltered = useMemo(() => {
    switch (filter) {
      case 'early_s2':     return baseFiltered.filter(s => s.stage2_subtype === 'EARLY_STAGE_2');
      case 'late_s2':      return baseFiltered.filter(s => s.stage2_subtype === 'LATE_STAGE_2');
      case 'stage1':       return baseFiltered.filter(s => s.stage2_subtype === 'STAGE_1_BASING');
      case 'fresh':        return baseFiltered.filter(s => weeksInStage(s) <= 4);
      case 'golden_window':return baseFiltered.filter(s =>
        s.stage2_subtype === 'EARLY_STAGE_2' &&
        weeksInStage(s) <= 4 &&
        (s.rs_52w_percentile ?? 0) >= 50
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
        const order: Record<string, number> = {
          EARLY_STAGE_2: 0, LATE_STAGE_2: 1, STAGE_1_BASING: 2,
          STAGE_3_TOPPING: 3, STAGE_4_DECLINING: 4,
        };
        return d * ((order[a.stage2_subtype || ''] ?? 5) - (order[b.stage2_subtype || ''] ?? 5));
      }
      if (sortKey === 'signal_date')    return d * a.signal_date.localeCompare(b.signal_date);
      if (sortKey === 'days_in_stage2') return d * (weeksInStage(a) - weeksInStage(b));
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
  const earlyS2    = baseFiltered.filter(s => s.stage2_subtype === 'EARLY_STAGE_2').length;
  const lateS2     = baseFiltered.filter(s => s.stage2_subtype === 'LATE_STAGE_2').length;
  const stage1cnt  = baseFiltered.filter(s => s.stage2_subtype === 'STAGE_1_BASING').length;
  const freshCnt   = baseFiltered.filter(s => weeksInStage(s) <= 4).length;
  const rsLeaders  = baseFiltered.filter(s => (s.rs_63d_score ?? 0) >= 10).length;
  const stacked    = baseFiltered.filter(s => s.rs_line_new_high).length;
  const avgReturn  = (() => {
    const v = baseFiltered.map(s => s.returns_since_breakout).filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  })();

  const stockScansUrl  = (t: string) => `https://www.stockscans.in/charts/NSE:${t.replace(/\.NS$/i, '')}`;
  const tradingViewUrl = (t: string) => `https://in.tradingview.com/symbols/NSE-${t.replace(/\.NS$/i, '')}/`;

  return (
    <div className="min-h-screen bg-[#0d1117] p-3 md:p-5">
      <div className="max-w-[2200px] mx-auto space-y-4">

        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Link href="/" className="text-slate-500 hover:text-slate-300"><ArrowLeft className="w-4 h-4" /></Link>
              <Layers className="w-5 h-5 text-emerald-400" />
              <h1 className="text-lg font-black text-white">Stage 2 Intelligence Hub</h1>
              <span className="text-[10px] bg-emerald-900/50 text-emerald-400 border border-emerald-700/40 px-1.5 py-0.5 rounded font-bold">v4.0</span>
            </div>
            <p className="text-xs text-slate-500 ml-11">
              Pure Weinstein · Weekly OHLCV · Mansfield RS · Minervini as Radar Only · Click headers to sort
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => dispatch('stage2_engine')} disabled={!!triggering}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-xs font-semibold disabled:opacity-50 transition">
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
              { l: 'Stage 2A (Buy)',    v: earlyS2.toString(),   c: 'text-emerald-400' },
              { l: 'Stage 2B (Trend)',  v: lateS2.toString(),    c: 'text-teal-400' },
              { l: 'Stage 1 (Watch)',   v: stage1cnt.toString(), c: 'text-blue-400' },
              { l: 'Fresh (≤4wk)',      v: freshCnt.toString(),  c: 'text-amber-400' },
              { l: 'RS Leaders (MRS10+)', v: rsLeaders.toString(), c: 'text-emerald-300' },
              { l: 'Radar: STACK',      v: stacked.toString(),   c: 'text-cyan-400' },
              { l: 'Avg Return',        v: fmtPct(avgReturn),    c: retCls(avgReturn) },
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
            { l: 'Stage 2A',       v: 'BUY',     c: 'bg-emerald-900/30 border-emerald-700/30 text-emerald-300' },
            { l: 'Stage 2B',       v: 'TREND',   c: 'bg-teal-900/30 border-teal-700/30 text-teal-300' },
            { l: 'Stage 1',        v: 'WATCH',   c: 'bg-blue-900/30 border-blue-700/30 text-blue-300' },
            { l: 'Minervini',      v: 'Radar',   c: 'bg-violet-900/30 border-violet-700/30 text-violet-300' },
            { l: 'Mansfield RS',   v: 'MRS>0',   c: 'bg-cyan-900/30 border-cyan-700/30 text-cyan-300' },
            { l: 'Weekly',         v: 'OHLCV',   c: 'bg-slate-800/60 border-slate-700/40 text-slate-400' },
          ].map(b => (
            <span key={b.l} className={`inline-flex items-center gap-1 px-2 py-1 rounded border font-bold ${b.c}`}>
              <span className="opacity-60">{b.l}</span> {b.v}
            </span>
          ))}
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-1 gap-1 flex-wrap">
            {([
              ['all',           'All'],
              ['early_s2',      '🟢 Stage 2A (Buy)'],
              ['late_s2',       '🔵 Stage 2B (Trend)'],
              ['stage1',        '⚪ Stage 1 (Watch)'],
              ['fresh',         'Fresh (≤4wk)'],
              ['golden_window', '⭐ Golden Window'],
            ] as [FilterMode, string][]).map(([v, l]) => (
              <button key={v} onClick={() => setFilter(v)}
                className={`px-3 py-1 text-xs rounded font-medium transition whitespace-nowrap ${
                  filter === v
                    ? v === 'golden_window' ? 'bg-amber-600 text-white'
                    : v === 'early_s2' ? 'bg-emerald-700 text-white'
                    : v === 'late_s2'  ? 'bg-teal-700 text-white'
                    : v === 'stage1'   ? 'bg-blue-700 text-white'
                    : 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}>{l}</button>
            ))}
          </div>

          {sectors.length > 0 && (
            <select
              value={sectorFilter}
              onChange={e => setSectorFilter(e.target.value)}
              className="bg-slate-900 border border-slate-800 text-slate-300 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-emerald-600"
            >
              <option value="all">All Sectors</option>
              {sectors.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}

          <label className="flex items-center gap-1.5 cursor-pointer text-xs text-slate-400 hover:text-slate-300">
            <input type="checkbox" checked={showHistory} onChange={e => setShowHistory(e.target.checked)}
              className="w-3 h-3 rounded accent-slate-500" />
            History Mode (90d)
          </label>

          <span className="text-slate-600 text-xs">{sorted.length} setups · {deduplicated.length} unique</span>
        </div>

        {filter === 'golden_window' && (
          <div className="bg-amber-900/20 border border-amber-700/30 rounded-lg px-4 py-2 text-xs text-amber-300">
            <span className="font-bold">Golden Window:</span> Early Stage 2A · ≤ 4 weeks since breakout · Mansfield RS 50th+ percentile.
            This is the highest probability entry window — fresh breakout with relative strength confirming leadership.
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
                className="px-4 py-2 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-xs font-medium disabled:opacity-50">Run Scan</button>
            </div>
          </div>
        ) : (
          <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
            <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: 'min(800px, calc(100vh - 320px))' }}>
              <table className="w-full text-xs border-collapse" style={{ minWidth: '1600px' }}>
                <thead className="sticky top-0 z-20">
                  <tr className="bg-[#161b22] border-b-2 border-slate-700">
                    <Th col="ticker"          label="Stock"         sticky active={sortKey==='ticker'}              dir={sortDir} onSort={onSort} tipKey="ticker" />
                    <Th col="stage2_subtype"  label="Stage"         active={sortKey==='stage2_subtype'}            dir={sortDir} onSort={onSort} tipKey="stage2_subtype" />
                    <ThStatic label="State"  tipKey="lifecycle_state" />
                    <Th col="stage2_score"    label="Score"         active={sortKey==='stage2_score'}              dir={sortDir} onSort={onSort} tipKey="stage2_score" />
                    <Th col="score_3d_delta"  label="3d Δ"          active={sortKey==='score_3d_delta'}            dir={sortDir} onSort={onSort} tipKey="score_3d_delta" />
                    <ThStatic label="Conditions ×4" tipKey="wein_conditions" />
                    <Th col="vol_5d_vs_50d_ratio" label="Weekly Vol" active={sortKey==='vol_5d_vs_50d_ratio'}      dir={sortDir} onSort={onSort} tipKey="weekly_vol" />
                    <Th col="rs_52w_percentile" label="Mansfield RS" right active={sortKey==='rs_52w_percentile'}  dir={sortDir} onSort={onSort} tipKey="mansfield_rs" />
                    <Th col="days_in_stage2"  label="Weeks/Stage"   active={sortKey==='days_in_stage2'}            dir={sortDir} onSort={onSort} tipKey="weeks_stage" />
                    <ThStatic label="Minervini Radar" tipKey="minervini_radar" />
                    <Th col="ttm_eps_growth"  label="Funda"         active={sortKey==='ttm_eps_growth'}            dir={sortDir} onSort={onSort} tipKey="fundamentals" />
                    <Th col="returns_since_breakout" label="Return" right active={sortKey==='returns_since_breakout'} dir={sortDir} onSort={onSort} tipKey="returns_since_breakout" />
                    <ThStatic label="Charts" />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(sig => {
                    const stage = sig.stage2_subtype || '';
                    const lc    = sig.lifecycle_state || 'WATCHING';
                    const sym   = sig.ticker.replace(/\.NS$/i, '');

                    const rowBg = stage === 'EARLY_STAGE_2'  ? 'bg-emerald-950/20 hover:bg-emerald-950/35'
                                : stage === 'LATE_STAGE_2'   ? 'bg-teal-950/15 hover:bg-teal-950/25'
                                : stage === 'STAGE_1_BASING' ? 'bg-blue-950/10 hover:bg-blue-950/20'
                                : lc === 'WEAKENING'         ? 'bg-orange-950/15 hover:bg-orange-950/30'
                                : 'hover:bg-slate-800/20';

                    const stkBg = stage === 'EARLY_STAGE_2'  ? '#030f07'
                                : stage === 'LATE_STAGE_2'   ? '#03100f'
                                : stage === 'STAGE_1_BASING' ? '#040815'
                                : '#0d1117';

                    return (
                      <tr key={sig.id} className={`border-b border-slate-800/50 transition-colors ${rowBg}`}>

                        {/* Stock — STICKY */}
                        <td className="px-3 py-2 whitespace-nowrap sticky left-0 z-10"
                            style={{ backgroundColor: stkBg }}>
                          <a href={stockScansUrl(sig.ticker)} target="_blank" rel="noopener noreferrer"
                            className="font-bold text-white hover:text-emerald-400 transition-colors text-sm">{sym}</a>
                          {sig.company_name && (
                            <div className="text-slate-500 text-[10px] truncate max-w-[130px]">{sig.company_name}</div>
                          )}
                          <MinerviniChips
                            vcpDepth={sig.hl_depth_20d}
                            volRatio={sig.vcp_volume_ratio}
                            pivotPct={sig.pivot_proximity_pct}
                            isStacked={sig.rs_line_new_high}
                          />
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
                          </div>
                        </td>

                        {/* Stage */}
                        <td className="px-2 py-2 whitespace-nowrap">
                          <WeinSteinStagePill subtype={sig.stage2_subtype} />
                        </td>

                        {/* Lifecycle state */}
                        <td className="px-2 py-2 whitespace-nowrap">
                          <LifecyclePill state={sig.lifecycle_state} />
                        </td>

                        {/* Score */}
                        <td className="px-2 py-2 whitespace-nowrap">
                          <div>
                            <span className={`text-base font-black ${
                              stage === 'EARLY_STAGE_2' ? 'text-emerald-400'
                              : stage === 'LATE_STAGE_2' ? 'text-teal-400'
                              : 'text-blue-400'
                            }`}>{sig.stage2_score}</span>
                          </div>
                          <ScoreBar score={sig.stage2_score} subtype={sig.stage2_subtype} />
                        </td>

                        {/* 3d delta */}
                        <td className="px-2 py-2 whitespace-nowrap">
                          <ScoreDelta delta={sig.score_3d_delta} trend={sig.score_trend} />
                        </td>

                        {/* Weinstein conditions 4-dot */}
                        <td className="px-2 py-2 whitespace-nowrap">
                          <WeinConditionsCell
                            aboveMa30w={sig.above_50sma}
                            slopePos={sig.sma50_above_ema150}
                            aboveEma10w={sig.ema150_above_sma200}
                            aboveResistance={sig.above_200sma}
                            slopeVal={sig.sma200_slope}
                          />
                        </td>

                        {/* Weekly vol ratio */}
                        <td className="px-2 py-2 whitespace-nowrap">
                          <WeeklyVolCell volRatio={sig.vol_5d_vs_50d_ratio} />
                        </td>

                        {/* Mansfield RS */}
                        <td className="px-2 py-2 text-right whitespace-nowrap">
                          <MansFieldRSCell
                            mansfield={sig.rs_63d_score}
                            pct52w={sig.rs_52w_percentile}
                            pos52w={sig.price_52w_position}
                          />
                        </td>

                        {/* Weeks in stage */}
                        <td className="px-2 py-2 whitespace-nowrap">
                          <WeeksStageCell
                            weeks={sig.days_in_stage2 ?? 0}
                            entryDate={sig.entry_date || sig.signal_date}
                            baseCount={sig.base_count}
                          />
                        </td>

                        {/* Minervini Radar */}
                        <td className="px-2 py-2 whitespace-nowrap">
                          <MinerviniRadarCell
                            vcpDepth={sig.hl_depth_20d}
                            volRatio={sig.vcp_volume_ratio}
                            pivotPct={sig.pivot_proximity_pct}
                            isStacked={sig.rs_line_new_high}
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
                              className="inline-flex items-center gap-0.5 text-[10px] text-slate-400 hover:text-emerald-400 transition-colors px-1.5 py-0.5 rounded border border-slate-700 hover:border-emerald-500 font-medium">
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
                {sorted.length} setups · {deduplicated.length} unique · v4.0 Pure Weinstein · Weekly OHLCV · Minervini = Radar Only
              </span>
              <span>SS=StockScans · TV=TradingView · Hover badges for details · Click column to sort</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

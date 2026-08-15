'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import {
  ArrowLeft, RefreshCw, AlertCircle, ChevronUp, ChevronDown,
  Layers, ExternalLink, TrendingUp, TrendingDown,
} from 'lucide-react';
import { InfoTooltip } from '../components/InfoTooltip';

const sb = (path: string) =>
  fetch(`/api/sb/${path}`, { cache: 'no-store' }).then(r => r.json());

// ─── Types ────────────────────────────────────────────────────────────────────

interface Signal {
  id: string;
  ticker: string;
  company_name: string | null;
  sector: string | null;
  signal_date: string;
  entry_date: string | null;
  stage2_score: number;
  days_in_stage2: number | null;        // weeks above MA_30W
  ema150_distance_pct: number | null;   // % distance from MA_30W
  above_200sma: boolean | null;         // Price > resistance ceiling
  above_50sma: boolean | null;          // Price > MA_30W
  sma50_above_ema150: boolean | null;   // MA_30W slope >= 0
  ema150_above_sma200: boolean | null;  // Price > EMA_10W
  sma200_slope: number | null;          // MA_30W slope value
  stage2_subtype: string | null;        // Weinstein stage
  hl_depth_20d: number | null;          // Minervini VCP depth (daily)
  vol_5d_vs_50d_ratio: number | null;   // Vol_Ratio_Weekly
  pivot_proximity_pct: number | null;   // Minervini pivot proximity (daily)
  volume_multiplier: number | null;
  rs_trend: string | null;
  rs_63d_score: number | null;          // Mansfield RS
  rs_52w_percentile: number | null;
  rs_line_new_high: boolean | null;     // is_daily_ma_stacked
  price_52w_position: number | null;
  base_width_weeks: number | null;
  base_count: number | null;
  vcp_volume_ratio: number | null;      // daily vol/50d ratio (dry-up)
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
  is_reentry: boolean | null;
  returns_since_breakout?: number | null;
  daily_return?: number | null;
}

type SortKey =
  | 'ticker' | 'stage2_subtype' | 'stage2_score' | 'vol_5d_vs_50d_ratio' | 'days_in_stage2'
  | 'rs_63d_score' | 'rs_52w_percentile' | 'price_52w_position' | 'ema150_distance_pct'
  | 'ttm_eps_growth' | 'returns_since_breakout' | 'daily_return' | 'sma200_slope' | 'sector';

type SortDir    = 'asc' | 'desc';
type FilterMode = 'all' | 'early_s2' | 'late_s2' | 'stage1' | 'elite' | 'prime' | 'golden_window' | 'rs_leaders';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtPct = (v: number | null | undefined, dec = 1) =>
  v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(dec)}%`;

const fmtDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—';

const retCls = (v: number | null | undefined) =>
  v == null ? 'text-slate-500' :
  v > 15    ? 'text-emerald-300 font-bold' :
  v > 0     ? 'text-emerald-400' :
  v > -10   ? 'text-red-400' : 'text-red-500 font-bold';

const greenChipCount = (s: Signal): number => {
  let n = 0;
  if ((s.hl_depth_20d ?? 100) <= 6) n++;
  if ((s.vcp_volume_ratio ?? 1) < 0.5) n++;
  if (s.pivot_proximity_pct != null && s.pivot_proximity_pct >= -5 && s.pivot_proximity_pct <= 2) n++;
  if (s.rs_line_new_high) n++;
  return n;
};

const isPrime = (s: Signal) =>
  ['EARLY_STAGE_2', 'LATE_STAGE_2'].includes(s.stage2_subtype || '') &&
  greenChipCount(s) >= 3;

const isGoldenWindow = (s: Signal) =>
  s.stage2_subtype === 'EARLY_STAGE_2' &&
  (s.days_in_stage2 ?? 99) <= 4 &&
  (s.rs_63d_score ?? -99) > 0;

const isRsLeader = (s: Signal) => (s.rs_63d_score ?? -99) > 10;

// ─── Tooltip definitions ───────────────────────────────────────────────────────

const TIPS: Record<string, { title: string; content: string }> = {
  ticker: {
    title: 'Stock',
    content: 'NSE ticker, company name, and 4 Minervini radar chips (VCP · VDU · PIV · STACK — hover each for details). Green chip = condition met, yellow = partial, grey = not triggered. PEAD+S2 badge = post-earnings drift confluencing with Stage 2. REENTRY = re-qualified after prior Stage 4 exit. Click ticker to open StockScans weekly chart.',
  },
  stage2_subtype: {
    title: 'Weinstein Stage',
    content: 'Stage classification from weekly OHLCV. STAGE 2A (green): Price broke above 20–40wk resistance ceiling + volume surge ≥1.5× + Mansfield RS positive — prime buy signal. STAGE 2B (teal): Established uptrend, price above 10W EMA, 30W MA slope >0.2%/wk — hold or add on base. STAGE 1 (blue): Price basing around flat 30W MA, resistance not broken yet — watchlist only. Stages are mutually exclusive and computed fresh each weekly scan.',
  },
  wein_conditions: {
    title: 'Weinstein Conditions (4 dots)',
    content: 'The four Weinstein structural requirements, left to right. (1) Price > 30W MA — primary weekly uptrend active. (2) 30W MA slope ≥ 0 — MA is flat or curling up, Stage 2 energy building. (3) Price > 10W EMA — short-term weekly momentum positive. (4) Price > Stage 1 resistance ceiling — the actual breakout above the basing zone. All four green = textbook Weinstein Stage 2. Grey value = exact weekly slope rate (%/wk).',
  },
  weekly_vol: {
    title: 'Weekly Volume Ratio',
    content: 'This week\'s volume divided by the 30-week average weekly volume. Weinstein\'s core breakout confirmation: ≥ 1.5× required for Stage 2A. ≥ 2× (bold green) = exceptional institutional participation, highest conviction breakouts. 1.0–1.5× = ordinary volume, no breakout confirmation. < 1× = quiet week, not a breakout. A Stage 2A with 2.5× volume is far more reliable than one with 1.2×.',
  },
  weeks_stage: {
    title: 'Weeks in Stage + Base',
    content: 'Consecutive weeks price has been above the 30-Week MA — your stage clock. ≤ 4wk (green): Golden window — fresh breakout, maximum risk-reward, largest position sizing. 5–20wk (amber): Established trend, still actionable on 2nd or 3rd base entries with tighter sizing. > 20wk (grey): Extended run — be very selective, raise stops, reduce size on new buys. B1/B2/B3 = which base number in this Stage 2 cycle (1st base historically has highest win rate).',
  },
  mansfield_rs: {
    title: 'Mansfield RS',
    content: 'Mansfield RS = ((stock 52W return / index 52W return) − 1) × 100. Compares the stock\'s annual performance to Nifty Total Market. +10 or more (green) = strong outperformer — institutions are quietly accumulating. Near 0 = in line with market. Negative (red) = underperformer — avoid buying weakness, this is the last thing to break out. Percentile rank = where this stock sits in the cross-universe 1-year return ranking (85th+ = elite leadership).',
  },
  price_52w_pos: {
    title: '52-Week Price Position',
    content: 'Where the current price sits within its 52-week High-Low range: (Close − 52W Low) / (52W High − 52W Low) × 100. ≥ 75% (green): Near annual highs — Minervini\'s SEPA criterion. Institutions accumulate at new highs, not on dips — this is counterintuitive but the data is clear. 90–100%: Maximum momentum. 50–75% (amber): Mid-range — setup is premature. < 50% (red): In the bottom half of annual range — broken stock, avoid.',
  },
  ma_distance: {
    title: 'Distance Above 30W MA',
    content: 'How far the current price is above the 30-Week Moving Average. This is your extension and risk-sizing tool. 0–15% (green): Normal — stock has plenty of room before becoming overextended, best new-entry zone. 15–30% (amber): Extended — consider waiting for a pullback toward the MA before initiating. > 30% (red): Very extended — entering here has poor risk-reward; wait for consolidation. A stock 50% above its 30W MA will consolidate for months before resuming.',
  },
  sector: {
    title: 'Sector',
    content: 'NSE sector classification, colour-coded by type. Pro tip: when 4–5 stocks in the same sector all move to Stage 2A within the same week, that is a sector rotation signal — a rising tide. Financials (blue), Tech/IT (violet), Healthcare (green), Industrials/Capital Goods (amber), Consumer (orange), Energy (yellow), Materials (stone), Real Estate (purple), Telecom (sky).',
  },
  wcs: {
    title: 'WCS — Weinstein Conviction Score (0–100)',
    content: 'Measures quality within a stage — not a filter, a gradient. Hover each cell for the exact point breakdown. Stage 2A weights: Volume surge (35pts, the #1 breakout signal) + Mansfield RS (30pts) + MA slope (20pts) + Minervini radar chips (15pts). Stage 2B weights: MA slope (30pts) + Mansfield RS (30pts) + 52W price position (20pts) + extension risk (10pts) + radar (10pts). Stage 1 weights: Mansfield RS turning positive (30pts) + proximity to resistance breakout (30pts) + MA flatness (20pts) + radar forming (20pts). Scores: 80–100 = Elite, 60–79 = Strong, 40–59 = Moderate, <40 = Marginal.',
  },
  radar: {
    title: 'Minervini Radar — Daily Detail',
    content: 'Four Minervini setup quality indicators computed from daily OHLCV. Informational only — they do not affect Weinstein stage classification. VCP: 20-day high-low depth (tighter = more compressed energy). VDU: Volume dry-up ratio (daily vol ÷ 50d avg; <0.5× = sellers exhausted). PIV: Distance from 10-day high (−5% to +2% = at the pivot, optimal entry zone). STACK: Daily MA alignment — Price > SMA50 > EMA150 > SMA200. Green = condition met. All four green on a Stage 2A = Weinstein and Minervini both agree.',
  },
  fundamentals: {
    title: 'Fundamental Context',
    content: 'EPS TTM = trailing 12-month net profit growth YoY. ↑↑ = accelerating (most recent quarter YoY > prior quarter YoY — Minervini growth hallmark). ROCE = Return on Capital Employed (capital efficiency). P/E = trailing price-to-earnings (context only). These do not affect stage classification — a Stage 2A stock with negative EPS is still Stage 2A. They help prioritize between two otherwise equal setups.',
  },
  returns: {
    title: 'Return Since Entry',
    content: 'Total return since entry_date (when the stock first qualified as Stage 2). Right number = today\'s 1-day move. Near 0%: Fresh setup — the move has barely started, ideal entry. 10–25%: First leg in progress — still actionable on pullbacks to 10W EMA. > 30%: Extended first leg — wait for new base formation. Negative total: Breakout is failing — watch for weekly close below 30W MA as the definitive Stage 2 exit signal.',
  },
};

// ─── Sector colouring ────────────────────────────────────────────────────────

function sectorStyle(sector: string | null): string {
  if (!sector) return 'text-slate-600 bg-slate-800/40 border-slate-700/40';
  const s = sector.toLowerCase();
  if (s.includes('tech') || s.includes('software') || s.includes('information'))
    return 'text-violet-400 bg-violet-900/25 border-violet-800/50';
  if (s.includes('financial') || s.includes('bank') || s.includes('insurance') || s.includes('capital market'))
    return 'text-blue-400 bg-blue-900/25 border-blue-800/50';
  if (s.includes('health') || s.includes('pharma') || s.includes('biotech') || s.includes('medical'))
    return 'text-emerald-400 bg-emerald-900/25 border-emerald-800/50';
  if (s.includes('consumer') || s.includes('retail') || s.includes('restaurant') || s.includes('apparel'))
    return 'text-orange-400 bg-orange-900/25 border-orange-800/50';
  if (s.includes('industrial') || s.includes('capital good') || s.includes('manufactur') || s.includes('construct') || s.includes('engineer'))
    return 'text-amber-400 bg-amber-900/25 border-amber-800/50';
  if (s.includes('energy') || s.includes('power') || s.includes('oil') || s.includes('gas') || s.includes('utility') || s.includes('utilities'))
    return 'text-yellow-400 bg-yellow-900/25 border-yellow-800/50';
  if (s.includes('material') || s.includes('metal') || s.includes('cement') || s.includes('chemical') || s.includes('mining'))
    return 'text-stone-400 bg-stone-900/25 border-stone-800/50';
  if (s.includes('real estate') || s.includes('realty') || s.includes('reit'))
    return 'text-purple-400 bg-purple-900/25 border-purple-800/50';
  if (s.includes('telecom') || s.includes('communication') || s.includes('media'))
    return 'text-sky-400 bg-sky-900/25 border-sky-800/50';
  return 'text-slate-400 bg-slate-800/40 border-slate-700/40';
}

function abbrevSector(sector: string | null): string {
  if (!sector) return '—';
  return sector
    .replace('Consumer Defensive', 'Cons. Def.')
    .replace('Consumer Cyclical', 'Cons. Cyc.')
    .replace('Financial Services', 'Financials')
    .replace('Basic Materials', 'Materials')
    .replace('Real Estate', 'Real Est.')
    .replace('Communication Services', 'Telecom')
    .replace('Capital Goods', 'Cap. Goods')
    .replace('Healthcare', 'Healthcare')
    .replace('Industrials', 'Industrials')
    .replace('Technology', 'Technology');
}

// ─── Cell Components ──────────────────────────────────────────────────────────

function WeinSteinStagePill({ subtype }: { subtype: string | null }) {
  if (!subtype) return null;
  const map: Record<string, { label: string; cls: string }> = {
    EARLY_STAGE_2:     { label: 'STAGE 2A — BUY', cls: 'bg-emerald-900/60 text-emerald-300 border-emerald-700/60' },
    LATE_STAGE_2:      { label: 'STAGE 2B — TREND', cls: 'bg-teal-900/60 text-teal-300 border-teal-700/60' },
    STAGE_1_BASING:    { label: 'STAGE 1 — BASING', cls: 'bg-blue-900/60 text-blue-300 border-blue-700/60' },
    STAGE_3_TOPPING:   { label: 'STAGE 3 — DIST.', cls: 'bg-yellow-900/50 text-yellow-300 border-yellow-700/50' },
    STAGE_4_DECLINING: { label: 'STAGE 4 — DECLINE', cls: 'bg-red-900/50 text-red-400 border-red-700/50' },
  };
  const cfg = map[subtype];
  if (!cfg) return <span className="text-slate-500 text-[9px]">{subtype}</span>;
  return (
    <span className={`inline-block text-[8px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap tracking-wide ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
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
      className={`w-2 h-2 rounded-full inline-block flex-shrink-0 ${on ? 'bg-emerald-400' : 'bg-red-500/50'}`} />
  );
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        {dot(aboveMa30w,      'Price > 30W MA')}
        {dot(slopePos,        '30W MA slope ≥ 0 (flat or rising)')}
        {dot(aboveEma10w,     'Price > 10W EMA')}
        {dot(aboveResistance, 'Price > Stage 1 resistance ceiling (breakout)')}
      </div>
      {slopeVal != null && (
        <div className={`text-[9px] tabular-nums ${
          slopeVal > 0.002 ? 'text-emerald-500' : slopeVal >= 0 ? 'text-slate-500' : 'text-red-500/70'
        }`}>
          slope {slopeVal >= 0 ? '+' : ''}{(slopeVal * 100).toFixed(2)}%/wk
        </div>
      )}
    </div>
  );
}

function WeeklyVolCell({ volRatio }: { volRatio: number | null }) {
  if (volRatio == null) return <span className="text-slate-600 text-xs">—</span>;
  const cls = volRatio >= 2.0 ? 'text-emerald-300 font-black'
            : volRatio >= 1.5 ? 'text-emerald-400 font-bold'
            : volRatio >= 1.0 ? 'text-slate-300'
            : 'text-slate-600';
  const label = volRatio >= 2.0 ? 'Strong' : volRatio >= 1.5 ? 'Confirmed' : volRatio >= 1.0 ? 'Normal' : 'Quiet';
  return (
    <div className="text-xs">
      <div className={cls}>{volRatio.toFixed(2)}×</div>
      <div className={`text-[9px] mt-0.5 ${cls}`}>{label}</div>
    </div>
  );
}

function WeeksCell({ weeks, entryDate, baseCount }: {
  weeks: number; entryDate: string | null; baseCount: number | null;
}) {
  const wkCls = weeks <= 4  ? 'text-emerald-400 font-bold'
              : weeks <= 20 ? 'text-amber-400'
              : 'text-slate-500';
  const baseCls = !baseCount ? '' : baseCount === 1 ? 'text-emerald-500' : baseCount === 2 ? 'text-amber-500' : 'text-slate-500';
  return (
    <div className="text-xs">
      <div className="flex items-center gap-1">
        <span className={wkCls}>{weeks}wk</span>
        {baseCount != null && <span className={`text-[8px] font-bold ${baseCls}`}>B{baseCount}</span>}
      </div>
      <div className="text-[9px] text-slate-600 mt-0.5">{fmtDate(entryDate)}</div>
    </div>
  );
}

function MansFieldRSCell({ mansfield, pct52w }: { mansfield: number | null; pct52w: number | null }) {
  const mrsCls = mansfield == null ? 'text-slate-600'
               : mansfield > 10    ? 'text-emerald-400 font-bold'
               : mansfield > 0     ? 'text-emerald-300'
               : mansfield > -10   ? 'text-amber-400'
               : 'text-red-400';
  const pct52cls = pct52w == null ? 'text-slate-600'
                 : pct52w >= 85   ? 'text-emerald-400 font-bold'
                 : pct52w >= 70   ? 'text-amber-400'
                 : 'text-slate-500';
  return (
    <div className="text-xs text-right space-y-0.5">
      {pct52w != null && <div className={pct52cls}>{pct52w}th %ile</div>}
      {mansfield != null && (
        <div className={`text-[10px] tabular-nums ${mrsCls}`}>
          MRS {mansfield >= 0 ? '+' : ''}{mansfield.toFixed(1)}
        </div>
      )}
    </div>
  );
}

function PricePositionCell({ pos }: { pos: number | null }) {
  if (pos == null) return <span className="text-slate-600 text-xs">—</span>;
  const cls = pos >= 75 ? 'text-emerald-400 font-semibold' : pos >= 50 ? 'text-amber-400' : 'text-red-400';
  const barCls = pos >= 75 ? 'bg-emerald-500' : pos >= 50 ? 'bg-amber-500' : 'bg-red-500';
  const label = pos >= 90 ? 'ATH zone' : pos >= 75 ? 'Near highs' : pos >= 50 ? 'Mid range' : 'Near lows';
  return (
    <div className="text-xs">
      <div className={cls}>{pos.toFixed(0)}%</div>
      <div className="mt-1 h-0.5 w-10 bg-slate-800 rounded-full overflow-hidden">
        <div className={`h-full ${barCls} rounded-full`} style={{ width: `${pos}%` }} />
      </div>
      <div className={`text-[9px] mt-0.5 ${cls}`}>{label}</div>
    </div>
  );
}

function MADistanceCell({ dist }: { dist: number | null }) {
  if (dist == null) return <span className="text-slate-600 text-xs">—</span>;
  const cls = dist < 0    ? 'text-red-400'
            : dist <= 15  ? 'text-emerald-400 font-semibold'
            : dist <= 30  ? 'text-amber-400'
            : 'text-red-400 font-bold';
  const label = dist < 0 ? 'Below' : dist <= 15 ? 'Normal' : dist <= 30 ? 'Extended' : 'V.Extended';
  return (
    <div className="text-xs">
      <div className={`tabular-nums ${cls}`}>{dist >= 0 ? '+' : ''}{dist.toFixed(1)}%</div>
      <div className={`text-[9px] mt-0.5 ${cls}`}>{label}</div>
    </div>
  );
}

function SectorCell({ sector }: { sector: string | null }) {
  return (
    <span className={`inline-block text-[8px] font-semibold px-1.5 py-0.5 rounded border whitespace-nowrap max-w-[90px] truncate ${sectorStyle(sector)}`}
      title={sector ?? ''}>
      {abbrevSector(sector)}
    </span>
  );
}

// Compact chips in the ticker card
function MinerviniChips({ vcpDepth, volRatio, pivotPct, isStacked }: {
  vcpDepth: number | null; volRatio: number | null;
  pivotPct: number | null; isStacked: boolean | null;
}) {
  type C = 'green' | 'yellow' | 'gray';
  const chip = (label: string, color: C, title: string) => {
    const cls: Record<C, string> = {
      green:  'bg-emerald-950 text-emerald-400 border-emerald-700/60',
      yellow: 'bg-amber-950  text-amber-400  border-amber-700/50',
      gray:   'bg-slate-900  text-slate-600  border-slate-700/40',
    };
    return (
      <span key={label} title={title}
        className={`text-[7px] font-bold px-1 py-[1px] rounded border cursor-help leading-tight ${cls[color]}`}>
        {label}
      </span>
    );
  };
  const vcpColor: C = vcpDepth == null ? 'gray' : vcpDepth <= 6 ? 'green' : vcpDepth <= 10 ? 'yellow' : 'gray';
  return (
    <div className="flex gap-0.5 flex-wrap mt-1">
      {chip(`VCP${vcpDepth != null ? ` ${vcpDepth.toFixed(0)}%` : ''}`, vcpColor,
        `VCP depth (20d range): ${vcpDepth?.toFixed(1) ?? '—'}% · ≤6% green, ≤10% yellow`)}
      {chip('VDU', volRatio != null && volRatio < 0.5 ? 'green' : 'gray',
        `Volume dry-up: ${volRatio?.toFixed(2) ?? '—'}× of 50d avg · green if <0.5×`)}
      {chip(`PIV${pivotPct != null ? ` ${pivotPct >= 0 ? '+' : ''}${pivotPct.toFixed(0)}%` : ''}`,
        pivotPct != null && pivotPct >= -5 && pivotPct <= 2 ? 'green' : 'gray',
        `Pivot: ${pivotPct?.toFixed(1) ?? '—'}% from 10d high · green if −5% to +2%`)}
      {chip('STACK', isStacked ? 'green' : 'gray',
        'Daily MA stack: Price>SMA50>EMA150>SMA200')}
    </div>
  );
}

// Detailed radar badges in the dedicated Radar column
function RadarCell({ vcpDepth, volRatio, pivotPct, isStacked }: {
  vcpDepth: number | null; volRatio: number | null;
  pivotPct: number | null; isStacked: boolean | null;
}) {
  const b = (text: string, on: boolean, partial: boolean, title: string) => (
    <span title={title} className={`text-[8px] font-bold px-1 py-0.5 rounded border cursor-help ${
      on ? 'bg-emerald-900/60 text-emerald-400 border-emerald-700/50'
      : partial ? 'bg-amber-900/40 text-amber-400 border-amber-700/40'
      : 'bg-slate-800/60 text-slate-600 border-slate-700/30'
    }`}>{text}</span>
  );
  const vcpG = (vcpDepth ?? 100) <= 6;
  const vcpY = !vcpG && (vcpDepth ?? 100) <= 10;
  const vdG  = (volRatio ?? 1) < 0.5;
  const vdY  = !vdG && (volRatio ?? 1) < 0.75;
  const pivG = pivotPct != null && pivotPct >= -5 && pivotPct <= 2;
  const pivY = !pivG && pivotPct != null && pivotPct >= -10;
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex gap-0.5">
        {b(`VCP ${vcpDepth != null ? vcpDepth.toFixed(1)+'%' : '—'}`, vcpG, vcpY,
          `VCP 20d range: ${vcpDepth?.toFixed(1) ?? '—'}% · ≤6%=tight · ≤10%=forming`)}
        {b(`VDU ${volRatio != null ? volRatio.toFixed(2)+'×' : '—'}`, vdG, vdY,
          `Daily vol/50d avg: ${volRatio?.toFixed(2) ?? '—'}× · <0.5×=exhausted · <0.75×=drying`)}
      </div>
      <div className="flex gap-0.5">
        {b(`PIV ${pivotPct != null ? (pivotPct>=0?'+':'')+pivotPct.toFixed(1)+'%' : '—'}`, pivG, pivY,
          `Pivot: ${pivotPct?.toFixed(1) ?? '—'}% from 10d high · −5% to +2%=buy zone`)}
        {b(isStacked ? 'STACK ✓' : 'STACK ✗', !!isStacked, false,
          'Daily: Price>SMA50>EMA150>SMA200')}
      </div>
    </div>
  );
}

function FundaCell({ eps, roce, accel, accelQtrs, pe }: {
  eps: number | null; roce: number | null;
  accel: boolean | null; accelQtrs: number | null; pe: number | null;
}) {
  if (eps == null && roce == null) return <span className="text-slate-600 text-xs">—</span>;
  const epsCls = eps == null ? 'text-slate-600'
               : eps > 0 ? (eps > 20 ? 'text-emerald-400 font-bold' : 'text-emerald-300')
               : 'text-amber-400';
  return (
    <div className="text-xs space-y-0.5">
      {eps != null && (
        <div className={epsCls}>
          EPS {eps >= 0 ? '+' : ''}{eps.toFixed(0)}%{accel ? ' ↑↑' : ''}
          {eps < 0 && <span className="ml-1 text-[8px] text-amber-500 font-bold">TURN</span>}
        </div>
      )}
      {roce != null && (
        <div className={roce > 15 ? 'text-emerald-400' : roce > 10 ? 'text-amber-400' : 'text-slate-500'}>
          {roce.toFixed(1)}% ROCE
        </div>
      )}
      {accelQtrs != null && accelQtrs > 0 && (
        <div className="text-[9px] text-emerald-600">{accelQtrs}Q↑</div>
      )}
      {pe != null && (
        <div className="text-[9px] text-slate-600">P/E {pe.toFixed(0)}×</div>
      )}
    </div>
  );
}

// ─── WCS breakdown + cell ────────────────────────────────────────────────────

interface BDRow { key: string; pts: number; max: number; label: string }
interface WCSBreakdown { stageName: string; rows: BDRow[]; total: number }

function computeWCSBreakdown(sig: Signal): WCSBreakdown {
  const stage  = sig.stage2_subtype || '';
  const vol    = sig.vol_5d_vs_50d_ratio ?? 0;
  const mrs    = sig.rs_63d_score ?? 0;
  const slope  = (sig.sma200_slope ?? 0) * 100;
  const pos52w = sig.price_52w_position ?? 50;
  const madist = sig.ema150_distance_pct ?? 0;

  let chips = 0;
  if ((sig.hl_depth_20d ?? 100) <= 6) chips++;
  if ((sig.vcp_volume_ratio ?? 1) < 0.5) chips++;
  if (sig.pivot_proximity_pct != null && sig.pivot_proximity_pct >= -5 && sig.pivot_proximity_pct <= 2) chips++;
  if (sig.rs_line_new_high) chips++;

  const R2A = [0, 4, 8, 12, 15];
  const R2B = [0, 3, 5,  8, 10];
  const R1  = [0, 5, 10, 15, 20];

  const fmtVol   = `${vol.toFixed(2)}× weekly vol`;
  const fmtMrs   = `MRS ${mrs >= 0 ? '+' : ''}${mrs.toFixed(1)}`;
  const fmtSlope = `slope ${slope >= 0 ? '+' : ''}${slope.toFixed(2)}%/wk`;
  const fmtPos   = `52W pos ${pos52w.toFixed(0)}%`;
  const fmtDist  = `+${madist.toFixed(1)}% above MA`;
  const fmtChips = `${chips}/4 radar chips`;

  if (stage === 'EARLY_STAGE_2') {
    const vp = vol >= 3.0 ? 35 : vol >= 2.5 ? 28 : vol >= 2.0 ? 20 : vol >= 1.75 ? 14 : vol >= 1.5 ? 8 : 0;
    const mp = mrs > 25 ? 30 : mrs > 15 ? 22 : mrs > 10 ? 15 : mrs > 5 ? 10 : mrs > 0 ? 5 : 0;
    const sp = slope > 0.5 ? 20 : slope > 0.3 ? 15 : slope > 0.1 ? 8 : slope >= 0 ? 3 : 0;
    const rp = R2A[chips];
    return { stageName: 'Stage 2A', total: Math.min(100, vp+mp+sp+rp), rows: [
      { key: 'Volume',    pts: vp, max: 35, label: fmtVol },
      { key: 'MRS',       pts: mp, max: 30, label: fmtMrs },
      { key: 'MA Slope',  pts: sp, max: 20, label: fmtSlope },
      { key: 'Radar',     pts: rp, max: 15, label: fmtChips },
    ]};
  }

  if (stage === 'LATE_STAGE_2') {
    const sp = slope > 0.5 ? 30 : slope > 0.3 ? 22 : slope > 0.1 ? 12 : slope >= 0 ? 5 : 0;
    const mp = mrs > 25 ? 30 : mrs > 15 ? 22 : mrs > 10 ? 15 : mrs > 5 ? 10 : mrs > 0 ? 5 : 0;
    const pp = pos52w >= 90 ? 20 : pos52w >= 75 ? 15 : pos52w >= 50 ? 8 : 0;
    const dp = madist <= 15 ? 10 : madist <= 25 ? 5 : madist <= 35 ? 2 : 0;
    const rp = R2B[chips];
    return { stageName: 'Stage 2B', total: Math.min(100, sp+mp+pp+dp+rp), rows: [
      { key: 'MA Slope',  pts: sp, max: 30, label: fmtSlope },
      { key: 'MRS',       pts: mp, max: 30, label: fmtMrs },
      { key: '52W Pos',   pts: pp, max: 20, label: fmtPos },
      { key: 'Extension', pts: dp, max: 10, label: fmtDist },
      { key: 'Radar',     pts: rp, max: 10, label: fmtChips },
    ]};
  }

  if (stage === 'STAGE_1_BASING') {
    const mp = mrs > 10 ? 30 : mrs > 5 ? 20 : mrs > 0 ? 12 : mrs > -5 ? 5 : 0;
    const pp = pos52w >= 85 ? 30 : pos52w >= 70 ? 20 : pos52w >= 55 ? 10 : 0;
    const absSlope = Math.abs(slope);
    const sp = absSlope <= 0.10 ? 20 : absSlope <= 0.30 ? 12 : absSlope <= 0.50 ? 5 : 0;
    const rp = R1[chips];
    return { stageName: 'Stage 1', total: Math.min(100, mp+pp+sp+rp), rows: [
      { key: 'MRS',       pts: mp, max: 30, label: fmtMrs },
      { key: '52W Pos',   pts: pp, max: 30, label: fmtPos },
      { key: 'MA Flat',   pts: sp, max: 20, label: fmtSlope },
      { key: 'Radar',     pts: rp, max: 20, label: fmtChips },
    ]};
  }

  return { stageName: '—', total: 0, rows: [] };
}

function WCSCell({ sig }: { sig: Signal }) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const score = sig.stage2_score;
  const bd    = computeWCSBreakdown(sig);

  const openTooltip = useCallback(() => {
    if (ref.current) setRect(ref.current.getBoundingClientRect());
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onScroll = () => close();
    window.addEventListener('scroll', onScroll, true);
    return () => window.removeEventListener('scroll', onScroll, true);
  }, [open, close]);

  const tipStyle = (): React.CSSProperties => {
    if (!rect) return {};
    const TW = 228;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = rect.left;
    if (left + TW > vw - 8) left = vw - TW - 8;
    if (left < 8) left = 8;
    const spaceBelow = vh - rect.bottom;
    const placeBelow = spaceBelow >= 210 || rect.top < 210;
    return placeBelow
      ? { position: 'fixed', top: rect.bottom + 4, left, width: TW, zIndex: 9999 }
      : { position: 'fixed', top: rect.top - 4, left, width: TW, zIndex: 9999, transform: 'translateY(-100%)' };
  };

  const scoreCls = score >= 80 ? 'text-emerald-400' : score >= 60 ? 'text-amber-400' : score >= 40 ? 'text-slate-400' : 'text-slate-600';
  const barCls   = score >= 80 ? 'bg-emerald-500'   : score >= 60 ? 'bg-amber-500'   : 'bg-slate-700';
  const label    = score >= 80 ? 'Elite' : score >= 60 ? 'Strong' : score >= 40 ? 'Moderate' : 'Marginal';

  return (
    <>
      <div ref={ref} className="text-xs cursor-help" onMouseEnter={openTooltip} onMouseLeave={close}>
        <div className="flex items-baseline gap-0.5">
          <span className={`text-base font-black tabular-nums ${scoreCls}`}>{score}</span>
          <span className="text-[9px] text-slate-700">/100</span>
        </div>
        <div className="mt-1 h-[3px] w-12 bg-slate-800 rounded-full overflow-hidden">
          <div className={`h-full ${barCls} rounded-full transition-all`} style={{ width: `${score}%` }} />
        </div>
        <div className={`text-[9px] mt-0.5 font-semibold ${scoreCls}`}>{label}</div>
      </div>

      {open && typeof document !== 'undefined' && createPortal(
        <div style={tipStyle()}
          className="bg-[#1c2133] border border-slate-600/70 rounded-xl shadow-2xl p-3 text-[9px] pointer-events-none select-none">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold text-white">WCS — {bd.stageName}</span>
            <span className={`text-[10px] font-black tabular-nums ${scoreCls}`}>{score}/100</span>
          </div>
          <div className="space-y-1.5">
            {bd.rows.map(r => {
              const pct = r.max > 0 ? r.pts / r.max : 0;
              const rowCls = pct >= 1 ? 'text-emerald-400' : pct >= 0.6 ? 'text-amber-400' : 'text-slate-500';
              return (
                <div key={r.key}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-slate-400 w-[72px] shrink-0">{r.key}</span>
                    <span className="text-slate-500 flex-1 text-right pr-2 truncate">{r.label}</span>
                    <span className={`tabular-nums font-bold w-10 text-right shrink-0 ${rowCls}`}>{r.pts}/{r.max}</span>
                  </div>
                  <div className="h-[2px] bg-slate-800 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${
                      pct >= 1 ? 'bg-emerald-500' : pct >= 0.6 ? 'bg-amber-500' : 'bg-slate-600'
                    }`} style={{ width: `${pct * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="border-t border-slate-700/60 mt-2.5 pt-2 flex items-center justify-between">
            <span className="text-slate-500">
              {label === 'Elite' ? '🟢 Highest conviction' : label === 'Strong' ? '🟡 Good setup' : label === 'Moderate' ? '⚪ Watch closely' : '⚫ Borderline'}
            </span>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// ─── Table header helpers ─────────────────────────────────────────────────────

function Th({ col, label, right, sticky, active, dir, onSort, tipKey }: {
  col: SortKey; label: string; right?: boolean; sticky?: boolean;
  active: boolean; dir: SortDir; onSort: (c: SortKey) => void; tipKey?: string;
}) {
  const tip = tipKey ? TIPS[tipKey] : null;
  return (
    <th onClick={() => onSort(col)}
      className={[
        'px-2 py-3 text-[10px] font-semibold uppercase tracking-wider cursor-pointer select-none whitespace-nowrap bg-[#161b22]',
        right ? 'text-right' : 'text-left',
        active ? 'text-white' : 'text-slate-500 hover:text-slate-300',
        sticky ? 'sticky left-0 z-30' : '',
      ].filter(Boolean).join(' ')}>
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

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, color, filterKey, currentFilter, onClick,
}: {
  label: string; value: string; sub?: string; color: string;
  filterKey?: FilterMode; currentFilter: FilterMode; onClick?: () => void;
}) {
  const isActive = filterKey != null && currentFilter === filterKey;
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={[
        'rounded-xl p-3 text-center w-full transition-all duration-150',
        onClick ? 'cursor-pointer' : 'cursor-default',
        isActive
          ? 'bg-slate-800 border border-emerald-600/50 ring-1 ring-emerald-600/20'
          : 'bg-slate-900 border border-slate-800 hover:border-slate-700',
      ].join(' ')}
    >
      <div className="text-[10px] text-slate-500 mb-0.5 leading-tight">{label}</div>
      <div className={`text-xl font-black tabular-nums ${color}`}>{value}</div>
      {sub && <div className="text-[9px] text-slate-600 mt-0.5">{sub}</div>}
    </button>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Stage2Page() {
  const [signals,      setSignals]      = useState<Signal[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState('');
  const [triggering,   setTriggering]   = useState<string | null>(null);
  const [trigMsg,      setTrigMsg]      = useState('');
  const [sortKey,      setSortKey]      = useState<SortKey>('stage2_subtype');
  const [sortDir,      setSortDir]      = useState<SortDir>('asc');
  const [filter,       setFilter]       = useState<FilterMode>('all');
  const [sectorFilter, setSectorFilter] = useState<string>('all');
  const [freshOnly,    setFreshOnly]    = useState(false);
  const [showHistory,  setShowHistory]  = useState(false);

  const loadData = useCallback(async () => {
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
  }, [showHistory]);

  useEffect(() => { loadData(); }, [loadData]);

  const dispatch = async (script: string) => {
    setTriggering(script); setTrigMsg('');
    try {
      const r = await fetch('/api/stage2-trigger', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script }),
      });
      const d = await r.json();
      const label = script === 'stage2_tracker' ? 'Return tracker'
                  : script === 'backfill_stage2' ? 'Backfill (7d)'
                  : 'Weinstein scan';
      setTrigMsg(d.ok ? `Dispatched: ${label} · results in ~20–30 min` : `Error: ${d.error}`);
    } catch { setTrigMsg('Network error'); }
    finally { setTriggering(null); }
  };

  // Deduplicate: one row per ticker (latest signal_date wins)
  const deduplicated = useMemo(() => {
    const map = new Map<string, Signal>();
    for (const sig of signals) {
      const ex = map.get(sig.ticker);
      if (!ex || sig.signal_date > ex.signal_date) map.set(sig.ticker, sig);
    }
    return Array.from(map.values());
  }, [signals]);

  const sectors = useMemo(() => {
    const s = new Set(deduplicated.map(s => s.sector).filter((x): x is string => !!x));
    return Array.from(s).sort();
  }, [deduplicated]);

  const wks = (s: Signal) => s.days_in_stage2 ?? 0;

  // Sector pre-filter
  const sectorFiltered = useMemo(() =>
    sectorFilter === 'all' ? deduplicated : deduplicated.filter(s => s.sector === sectorFilter)
  , [deduplicated, sectorFilter]);

  // Stat counts (always from full sector-filtered set, not mode-filtered)
  const earlyS2    = useMemo(() => sectorFiltered.filter(s => s.stage2_subtype === 'EARLY_STAGE_2').length, [sectorFiltered]);
  const lateS2     = useMemo(() => sectorFiltered.filter(s => s.stage2_subtype === 'LATE_STAGE_2').length, [sectorFiltered]);
  const stage1cnt  = useMemo(() => sectorFiltered.filter(s => s.stage2_subtype === 'STAGE_1_BASING').length, [sectorFiltered]);
  const primeCnt   = useMemo(() => sectorFiltered.filter(isPrime).length, [sectorFiltered]);
  const eliteCnt   = useMemo(() => sectorFiltered.filter(s => s.stage2_score >= 80).length, [sectorFiltered]);
  const goldenCnt  = useMemo(() => sectorFiltered.filter(isGoldenWindow).length, [sectorFiltered]);
  const rsLdrCnt   = useMemo(() => sectorFiltered.filter(isRsLeader).length, [sectorFiltered]);
  const avgReturn  = useMemo(() => {
    const vals = sectorFiltered
      .filter(s => ['EARLY_STAGE_2','LATE_STAGE_2'].includes(s.stage2_subtype || ''))
      .map(s => s.returns_since_breakout).filter((x): x is number => x != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }, [sectorFiltered]);

  // Mode filter → then optional fresh toggle
  const modeFiltered = useMemo(() => {
    let base = sectorFiltered;
    switch (filter) {
      case 'early_s2':      base = base.filter(s => s.stage2_subtype === 'EARLY_STAGE_2'); break;
      case 'late_s2':       base = base.filter(s => s.stage2_subtype === 'LATE_STAGE_2'); break;
      case 'stage1':        base = base.filter(s => s.stage2_subtype === 'STAGE_1_BASING'); break;
      case 'elite':         base = base.filter(s => s.stage2_score >= 80); break;
      case 'prime':         base = base.filter(isPrime); break;
      case 'golden_window': base = base.filter(isGoldenWindow); break;
      case 'rs_leaders':    base = base.filter(isRsLeader); break;
    }
    if (freshOnly) base = base.filter(s => wks(s) <= 4);
    return base;
  }, [sectorFiltered, filter, freshOnly]);

  // Sort
  const sorted = useMemo(() => [...modeFiltered].sort((a, b) => {
    const d = sortDir === 'desc' ? -1 : 1;
    if (sortKey === 'ticker') return d * a.ticker.localeCompare(b.ticker);
    if (sortKey === 'sector') return d * ((a.sector || '').localeCompare(b.sector || ''));
    if (sortKey === 'stage2_subtype') {
      const order: Record<string, number> = { EARLY_STAGE_2: 0, LATE_STAGE_2: 1, STAGE_1_BASING: 2, STAGE_3_TOPPING: 3, STAGE_4_DECLINING: 4 };
      return d * ((order[a.stage2_subtype || ''] ?? 5) - (order[b.stage2_subtype || ''] ?? 5));
    }
    if (sortKey === 'days_in_stage2') return d * (wks(a) - wks(b));
    const nf = sortDir === 'desc' ? -Infinity : Infinity;
    const va = (a[sortKey as keyof Signal] as number | null) ?? nf;
    const vb = (b[sortKey as keyof Signal] as number | null) ?? nf;
    return d * (Number(va) - Number(vb));
  }), [modeFiltered, sortKey, sortDir]);

  const onSort = (col: SortKey) => {
    if (sortKey === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(col); setSortDir('desc'); }
  };

  const toggleFilter = (f: FilterMode) => setFilter(cur => cur === f ? 'all' : f);

  const stockScansUrl  = (t: string) => `https://www.stockscans.in/charts/NSE:${t.replace(/\.NS$/i, '')}`;
  const tradingViewUrl = (t: string) => `https://in.tradingview.com/symbols/NSE-${t.replace(/\.NS$/i, '')}/`;

  // Row styling by stage
  const rowBg = (stage: string, lc: string) =>
    stage === 'EARLY_STAGE_2'  ? 'bg-emerald-950/20 hover:bg-emerald-950/35' :
    stage === 'LATE_STAGE_2'   ? 'bg-teal-950/15 hover:bg-teal-950/28' :
    stage === 'STAGE_1_BASING' ? 'bg-blue-950/10 hover:bg-blue-950/20' :
    lc    === 'WEAKENING'      ? 'bg-orange-950/15 hover:bg-orange-950/30' :
    'hover:bg-slate-800/20';

  const stkBg = (stage: string) =>
    stage === 'EARLY_STAGE_2'  ? '#030f07' :
    stage === 'LATE_STAGE_2'   ? '#020e0c' :
    stage === 'STAGE_1_BASING' ? '#030510' :
    '#0d1117';

  return (
    <div className="min-h-screen bg-[#0d1117] p-3 md:p-5">
      <div className="max-w-[2400px] mx-auto space-y-3">

        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <Link href="/" className="text-slate-600 hover:text-slate-300 transition-colors">
                <ArrowLeft className="w-4 h-4" />
              </Link>
              <Layers className="w-5 h-5 text-emerald-400" />
              <h1 className="text-lg font-black text-white tracking-tight">Stage 2 Scanner</h1>
              <span className="text-[9px] bg-emerald-950 text-emerald-500 border border-emerald-800/60 px-1.5 py-0.5 rounded font-bold tracking-wide">
                WEINSTEIN v4.0
              </span>
            </div>
            <p className="text-[11px] text-slate-600 ml-11">
              Weekly OHLCV · 30W MA · Mansfield RS · Minervini radar (informational)
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => dispatch('stage2_engine')} disabled={!!triggering}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-800 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold disabled:opacity-40 transition">
              <Layers className={`w-3.5 h-3.5 ${triggering === 'stage2_engine' ? 'animate-pulse' : ''}`} />
              Run Scan
            </button>
            <button onClick={() => dispatch('stage2_tracker')} disabled={!!triggering}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium disabled:opacity-40 transition">
              <RefreshCw className={`w-3.5 h-3.5 ${triggering === 'stage2_tracker' ? 'animate-spin' : ''}`} />
              Refresh Returns
            </button>
            <button onClick={() => dispatch('backfill_stage2')} disabled={!!triggering}
              className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-500 rounded-lg text-xs disabled:opacity-40 transition border border-slate-800">
              Seed 7d
            </button>
            <button onClick={loadData} disabled={loading}
              className="p-1.5 bg-slate-900 hover:bg-slate-800 text-slate-500 rounded-lg disabled:opacity-40 transition border border-slate-800">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* ── Messages ── */}
        {trigMsg && (
          <div className={`text-xs px-4 py-2.5 rounded-lg border ${
            trigMsg.startsWith('Dispatched')
              ? 'bg-emerald-950/50 border-emerald-800/50 text-emerald-400'
              : 'bg-red-950/50 border-red-800/50 text-red-400'
          }`}>{trigMsg}</div>
        )}
        {error && (
          <div className="flex items-center gap-2 bg-red-950/50 border border-red-800/50 rounded-lg p-3 text-red-400 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0" />{error}
          </div>
        )}

        {/* ── Stat cards (clickable) ── */}
        {deduplicated.length > 0 && (
          <div className="grid grid-cols-4 sm:grid-cols-4 md:grid-cols-7 gap-2">
            <StatCard label="Buy Signals"    value={earlyS2.toString()}  color="text-emerald-400"
              sub="Stage 2A"      filterKey="early_s2"      currentFilter={filter} onClick={() => toggleFilter('early_s2')} />
            <StatCard label="In Trend"       value={lateS2.toString()}   color="text-teal-400"
              sub="Stage 2B"      filterKey="late_s2"       currentFilter={filter} onClick={() => toggleFilter('late_s2')} />
            <StatCard label="Basing"         value={stage1cnt.toString()} color="text-blue-400"
              sub="Stage 1"       filterKey="stage1"        currentFilter={filter} onClick={() => toggleFilter('stage1')} />
            <StatCard label="Elite WCS"      value={eliteCnt.toString()} color="text-violet-400"
              sub="Score ≥ 80"    filterKey="elite"        currentFilter={filter} onClick={() => toggleFilter('elite')} />
            <StatCard label="Golden Window"  value={goldenCnt.toString()} color="text-amber-400"
              sub="2A · ≤4wk · RS>0" filterKey="golden_window" currentFilter={filter} onClick={() => toggleFilter('golden_window')} />
            <StatCard label="RS Leaders"     value={rsLdrCnt.toString()} color="text-cyan-400"
              sub="Mansfield RS >10" filterKey="rs_leaders" currentFilter={filter} onClick={() => toggleFilter('rs_leaders')} />
            <StatCard label="Avg Return"     value={avgReturn != null ? fmtPct(avgReturn) : '—'}
              color={retCls(avgReturn)} sub="Stage 2A+2B only"
              filterKey={undefined} currentFilter={filter} />
          </div>
        )}

        {/* ── Filter bar ── */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Stage tabs */}
          <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-0.5 gap-0.5">
            {([
              ['all',      'All'],
              ['early_s2', 'Stage 2A'],
              ['late_s2',  'Stage 2B'],
              ['stage1',   'Stage 1'],
            ] as [FilterMode, string][]).map(([v, l]) => (
              <button key={v} onClick={() => setFilter(v)}
                className={`px-3 py-1.5 text-xs rounded font-semibold transition whitespace-nowrap ${
                  filter === v
                    ? v === 'early_s2' ? 'bg-emerald-800 text-white'
                    : v === 'late_s2'  ? 'bg-teal-800 text-white'
                    : v === 'stage1'   ? 'bg-blue-800 text-white'
                    : 'bg-slate-700 text-white'
                    : 'text-slate-500 hover:text-white hover:bg-slate-800'
                }`}>{l}</button>
            ))}
          </div>

          {/* Quality filters */}
          <div className="flex gap-1.5">
            {([
              ['elite',         '★ Elite (80+)',    'border-violet-700/70 text-violet-300 bg-violet-950/40', 'border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-300'],
              ['golden_window', '◆ Golden Window',  'border-amber-700/70 text-amber-300 bg-amber-950/40',   'border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-300'],
              ['prime',         '⬡ Prime Radar',    'border-teal-700/70 text-teal-300 bg-teal-950/40',      'border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-300'],
              ['rs_leaders',    '↑ RS Leaders',     'border-cyan-700/70 text-cyan-300 bg-cyan-950/40',      'border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-300'],
            ] as [FilterMode, string, string, string][]).map(([v, l, activeCls, inactiveCls]) => (
              <button key={v} onClick={() => toggleFilter(v)}
                className={`px-2.5 py-1.5 text-xs rounded-lg border font-medium transition whitespace-nowrap ${
                  filter === v ? activeCls : inactiveCls
                }`}>{l}</button>
            ))}
          </div>

          {/* Divider */}
          <div className="w-px h-6 bg-slate-800 hidden sm:block" />

          {/* Toggles + sector + count */}
          <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer hover:text-slate-300 select-none transition">
            <input type="checkbox" checked={freshOnly} onChange={e => setFreshOnly(e.target.checked)}
              className="w-3 h-3 rounded accent-amber-500" />
            Fresh ≤4wk
          </label>

          {sectors.length > 0 && (
            <select value={sectorFilter} onChange={e => setSectorFilter(e.target.value)}
              className="bg-slate-900 border border-slate-800 text-slate-400 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-emerald-700 transition">
              <option value="all">All Sectors</option>
              {sectors.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}

          <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer hover:text-slate-400 select-none transition">
            <input type="checkbox" checked={showHistory} onChange={e => setShowHistory(e.target.checked)}
              className="w-3 h-3 rounded accent-slate-500" />
            90d History
          </label>

          <span className="text-slate-700 text-xs ml-auto">
            {sorted.length} shown · {deduplicated.length} total
          </span>
        </div>

        {/* Golden window explanation */}
        {filter === 'golden_window' && (
          <div className="bg-amber-950/30 border border-amber-800/40 rounded-lg px-4 py-2 text-xs text-amber-300/80">
            <span className="font-bold text-amber-300">Golden Window</span> — Stage 2A breakout, ≤ 4 weeks old, Mansfield RS positive.
            Fresh institutional breakout with market outperformance confirmed. Best risk-reward entry window.
          </div>
        )}
        {filter === 'elite' && (
          <div className="bg-violet-950/30 border border-violet-800/40 rounded-lg px-4 py-2 text-xs text-violet-300/80">
            <span className="font-bold text-violet-300">Elite WCS ≥ 80</span> — The top-scoring setups in the universe across all stage-specific dimensions.
            Stage 2A: strong breakout volume + outperforming RS + rising MA. Stage 2B: steep MA slope + RS leadership + near 52-week highs.
            Hover each WCS score for the exact point breakdown.
          </div>
        )}
        {filter === 'prime' && (
          <div className="bg-teal-950/30 border border-teal-800/40 rounded-lg px-4 py-2 text-xs text-teal-300/80">
            <span className="font-bold text-teal-300">Prime Radar</span> — Stage 2A or 2B with ≥ 3 of 4 Minervini radar chips green.
            VCP tight + volume dry-up + at pivot + daily MA stacked. Weinstein weekly stage confirmed, Minervini daily setup aligned.
          </div>
        )}

        {/* ── Table ── */}
        {loading ? (
          <div className="text-center py-20 text-slate-600 text-sm">Loading…</div>
        ) : sorted.length === 0 ? (
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-16 text-center">
            <Layers className="w-8 h-8 text-slate-700 mx-auto mb-3" />
            <p className="text-slate-400 font-semibold">No setups in this view</p>
            <p className="text-slate-600 text-xs mt-1">Try a different filter or run a fresh scan.</p>
            <div className="flex gap-3 justify-center mt-4">
              <button onClick={() => dispatch('backfill_stage2')} disabled={!!triggering}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium disabled:opacity-40">
                Seed 7 Days
              </button>
              <button onClick={() => dispatch('stage2_engine')} disabled={!!triggering}
                className="px-4 py-2 bg-emerald-800 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium disabled:opacity-40">
                Run Scan
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-slate-900/80 border border-slate-700/80 rounded-xl overflow-hidden">
            <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: 'min(820px, calc(100vh - 300px))' }}>
              <table className="w-full text-xs border-collapse" style={{ minWidth: '1760px' }}>
                <thead className="sticky top-0 z-20">
                  <tr className="bg-[#161b22] border-b-2 border-slate-700/80">
                    {/* 1 Stock */}
                    <Th col="ticker"               label="Stock"        sticky active={sortKey==='ticker'}               dir={sortDir} onSort={onSort} tipKey="ticker" />
                    {/* 2 Stage */}
                    <Th col="stage2_subtype"        label="Stage"               active={sortKey==='stage2_subtype'}        dir={sortDir} onSort={onSort} tipKey="stage2_subtype" />
                    {/* 3 WCS */}
                    <Th col="stage2_score"          label="WCS"                 active={sortKey==='stage2_score'}          dir={sortDir} onSort={onSort} tipKey="wcs" />
                    {/* 4 Conditions */}
                    <ThStatic label="Weinstein ×4" tipKey="wein_conditions" />
                    {/* 4 Weekly Vol */}
                    <Th col="vol_5d_vs_50d_ratio"  label="Wk Vol"              active={sortKey==='vol_5d_vs_50d_ratio'}   dir={sortDir} onSort={onSort} tipKey="weekly_vol" />
                    {/* 5 Weeks */}
                    <Th col="days_in_stage2"       label="Weeks"               active={sortKey==='days_in_stage2'}        dir={sortDir} onSort={onSort} tipKey="weeks_stage" />
                    {/* 6 Mansfield RS */}
                    <Th col="rs_52w_percentile"    label="Mansfield RS"  right  active={sortKey==='rs_52w_percentile'}    dir={sortDir} onSort={onSort} tipKey="mansfield_rs" />
                    {/* 7 52W Position */}
                    <Th col="price_52w_position"   label="52W Pos"             active={sortKey==='price_52w_position'}    dir={sortDir} onSort={onSort} tipKey="price_52w_pos" />
                    {/* 8 MA Distance */}
                    <Th col="ema150_distance_pct"  label="MA Dist"             active={sortKey==='ema150_distance_pct'}   dir={sortDir} onSort={onSort} tipKey="ma_distance" />
                    {/* 9 Sector */}
                    <Th col="sector"               label="Sector"              active={sortKey==='sector'}                dir={sortDir} onSort={onSort} tipKey="sector" />
                    {/* 10 Radar */}
                    <ThStatic label="Radar" tipKey="radar" />
                    {/* 11 Fundamentals */}
                    <Th col="ttm_eps_growth"       label="Funda"               active={sortKey==='ttm_eps_growth'}        dir={sortDir} onSort={onSort} tipKey="fundamentals" />
                    {/* 12 Return */}
                    <Th col="returns_since_breakout" label="Return"      right  active={sortKey==='returns_since_breakout'} dir={sortDir} onSort={onSort} tipKey="returns" />
                    {/* 13 Charts */}
                    <ThStatic label="Charts" right />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(sig => {
                    const stage = sig.stage2_subtype || '';
                    const lc    = sig.lifecycle_state || 'WATCHING';
                    const sym   = sig.ticker.replace(/\.NS$/i, '');
                    const bg    = rowBg(stage, lc);
                    const stk   = stkBg(stage);

                    return (
                      <tr key={sig.id} className={`border-b border-slate-800/40 transition-colors ${bg}`}>

                        {/* 1 — Stock (sticky) */}
                        <td className="px-3 py-2 sticky left-0 z-10 whitespace-nowrap" style={{ backgroundColor: stk }}>
                          <a href={stockScansUrl(sig.ticker)} target="_blank" rel="noopener noreferrer"
                            className="font-bold text-white hover:text-emerald-400 transition-colors text-sm">
                            {sym}
                          </a>
                          {sig.company_name && (
                            <div className="text-slate-500 text-[10px] truncate max-w-[140px] mt-0.5">
                              {sig.company_name}
                            </div>
                          )}
                          <MinerviniChips
                            vcpDepth={sig.hl_depth_20d}
                            volRatio={sig.vcp_volume_ratio}
                            pivotPct={sig.pivot_proximity_pct}
                            isStacked={sig.rs_line_new_high}
                          />
                          <div className="flex gap-1 mt-1 flex-wrap">
                            {sig.is_pead_confluence && (
                              <span title="Post-earnings drift confluencing with Stage 2"
                                className="text-[7px] font-bold bg-violet-950 text-violet-400 border border-violet-800/50 px-1 py-[1px] rounded cursor-help">
                                PEAD+S2
                              </span>
                            )}
                            {sig.is_reentry && (
                              <span title="Re-qualified after prior Stage 4 exit"
                                className="text-[7px] font-bold bg-purple-950 text-purple-400 border border-purple-800/50 px-1 py-[1px] rounded cursor-help">
                                REENTRY
                              </span>
                            )}
                          </div>
                        </td>

                        {/* 2 — Stage */}
                        <td className="px-2 py-2 whitespace-nowrap">
                          <WeinSteinStagePill subtype={sig.stage2_subtype} />
                        </td>

                        {/* 3 — WCS */}
                        <td className="px-2 py-2 whitespace-nowrap">
                          <WCSCell sig={sig} />
                        </td>

                        {/* 4 — Weinstein conditions */}
                        <td className="px-2 py-2 whitespace-nowrap">
                          <WeinConditionsCell
                            aboveMa30w={sig.above_50sma}
                            slopePos={sig.sma50_above_ema150}
                            aboveEma10w={sig.ema150_above_sma200}
                            aboveResistance={sig.above_200sma}
                            slopeVal={sig.sma200_slope}
                          />
                        </td>

                        {/* 4 — Weekly vol */}
                        <td className="px-2 py-2 whitespace-nowrap">
                          <WeeklyVolCell volRatio={sig.vol_5d_vs_50d_ratio} />
                        </td>

                        {/* 5 — Weeks */}
                        <td className="px-2 py-2 whitespace-nowrap">
                          <WeeksCell
                            weeks={wks(sig)}
                            entryDate={sig.entry_date || sig.signal_date}
                            baseCount={sig.base_count}
                          />
                        </td>

                        {/* 6 — Mansfield RS */}
                        <td className="px-2 py-2 text-right whitespace-nowrap">
                          <MansFieldRSCell mansfield={sig.rs_63d_score} pct52w={sig.rs_52w_percentile} />
                        </td>

                        {/* 7 — 52W position */}
                        <td className="px-2 py-2 whitespace-nowrap">
                          <PricePositionCell pos={sig.price_52w_position} />
                        </td>

                        {/* 8 — MA distance */}
                        <td className="px-2 py-2 whitespace-nowrap">
                          <MADistanceCell dist={sig.ema150_distance_pct} />
                        </td>

                        {/* 9 — Sector */}
                        <td className="px-2 py-2 whitespace-nowrap">
                          <SectorCell sector={sig.sector} />
                        </td>

                        {/* 10 — Radar */}
                        <td className="px-2 py-2 whitespace-nowrap">
                          <RadarCell
                            vcpDepth={sig.hl_depth_20d}
                            volRatio={sig.vcp_volume_ratio}
                            pivotPct={sig.pivot_proximity_pct}
                            isStacked={sig.rs_line_new_high}
                          />
                        </td>

                        {/* 11 — Fundamentals */}
                        <td className="px-2 py-2 whitespace-nowrap">
                          <FundaCell
                            eps={sig.ttm_eps_growth} roce={sig.roce}
                            accel={sig.eps_is_accelerating} accelQtrs={sig.eps_acceleration_quarters}
                            pe={sig.pe_ratio}
                          />
                        </td>

                        {/* 12 — Return */}
                        <td className="px-2 py-2 text-right whitespace-nowrap">
                          <div className={`font-semibold tabular-nums ${retCls(sig.returns_since_breakout)}`}>
                            {fmtPct(sig.returns_since_breakout)}
                          </div>
                          <div className={`text-[9px] mt-0.5 tabular-nums ${retCls(sig.daily_return)}`}>
                            {fmtPct(sig.daily_return)} 1d
                          </div>
                        </td>

                        {/* 13 — Charts */}
                        <td className="px-2 py-2 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1">
                            <a href={stockScansUrl(sig.ticker)} target="_blank" rel="noopener noreferrer"
                              title="StockScans weekly chart"
                              className="inline-flex items-center gap-0.5 text-[10px] text-slate-500 hover:text-emerald-400 px-1.5 py-0.5 rounded border border-slate-700/60 hover:border-emerald-700 transition font-medium">
                              <ExternalLink className="w-2.5 h-2.5" />SS
                            </a>
                            <a href={tradingViewUrl(sig.ticker)} target="_blank" rel="noopener noreferrer"
                              title="TradingView"
                              className="inline-flex items-center gap-0.5 text-[10px] text-slate-600 hover:text-sky-400 px-1.5 py-0.5 rounded border border-slate-700/60 hover:border-sky-700 transition">
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

            {/* Table footer */}
            <div className="px-4 py-2 border-t border-slate-800/80 flex flex-wrap justify-between items-center gap-2">
              <span className="text-[10px] text-slate-700">
                {sorted.length} setups · {deduplicated.length} unique · Pure Weinstein · Weekly OHLCV · Minervini = Radar only
              </span>
              <span className="text-[10px] text-slate-700">
                Hover column headers for methodology · Hover radar badges for values · Click stat cards to filter
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

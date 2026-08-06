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
  vcp_score: number | null;
  vcp_volume_ratio: number | null;
  vcp_adr_ratio: number | null;
  ttm_eps_growth: number | null;
  roce: number | null;
  eps_is_accelerating: boolean | null;
  eps_acceleration_quarters: number | null;
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
  | 'rs_63d_score' | 'ttm_eps_growth' | 'signal_date'
  | 'returns_since_breakout' | 'daily_return' | 'score_3d_delta';

type SortDir    = 'asc' | 'desc';
type FilterMode = 'all' | 'confirmed' | 'emerging' | 'early_stage2' | 'fresh' | 'strengthening';
type DateRange  = 'week' | 'month' | 'quarter';

const fmtPct = (v: number | null | undefined, dec = 1) =>
  v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(dec)}%`;

const fmtDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—';

const retCls = (v: number | null | undefined) =>
  v == null ? 'text-slate-500' :
  v > 15    ? 'text-emerald-300 font-bold' :
  v > 0     ? 'text-emerald-400' :
  v > -10   ? 'text-red-400' : 'text-red-500 font-bold';

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

function StagePill({ subtype }: { subtype: string | null }) {
  if (!subtype) return null;
  const cfg: Record<string, string> = {
    'EARLY STAGE 2': 'bg-emerald-900/40 text-emerald-300 border-emerald-700/50',
    'MID STAGE 2':   'bg-blue-900/40 text-blue-300 border-blue-700/50',
    'LATE STAGE 2':  'bg-orange-900/40 text-orange-300 border-orange-700/50',
  };
  const label: Record<string, string> = {
    'EARLY STAGE 2': 'EARLY S2',
    'MID STAGE 2':   'MID S2',
    'LATE STAGE 2':  'LATE S2',
  };
  return (
    <span className={`inline-block text-[8px] font-bold px-1 py-0.5 rounded border ${cfg[subtype] || 'bg-slate-800 text-slate-500 border-slate-700'}`}>
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

// 4-dot trend alignment cell (all 4 knockout conditions)
function TrendCell({
  above50, sma50AboveEma150, ema150AboveSma200, sma200Slope,
}: {
  above50: boolean | null;
  sma50AboveEma150: boolean | null;
  ema150AboveSma200: boolean | null;
  sma200Slope: number | null;
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

function PivotCell({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-slate-600">—</span>;
  const cls = (pct >= -5 && pct <= 2) ? 'text-emerald-400 font-bold'
            : (pct >= -10 && pct < -5) ? 'text-amber-400 font-medium'
            : pct > 2 ? 'text-red-400 font-bold'   // extended / chasing
            : 'text-slate-500';
  const label = (pct >= -5 && pct <= 2) ? 'In Zone'
              : (pct >= -10 && pct < -5) ? 'Near'
              : pct > 2 ? 'Extended'
              : 'Far';
  return (
    <div className="text-xs">
      <span className={cls}>{pct >= 0 ? '+' : ''}{pct.toFixed(1)}%</span>
      <div className={`text-[9px] mt-0.5 ${cls}`}>{label}</div>
    </div>
  );
}

function RSCell({ rs, pct63, pct52w }: { rs: string | null; pct63: number | null; pct52w: number | null }) {
  const cls = rs === 'Positive' ? 'text-emerald-400' : rs === 'Negative' ? 'text-red-400' : 'text-slate-400';
  const pct52cls = pct52w == null ? 'text-slate-600'
                 : pct52w >= 85 ? 'text-emerald-400 font-bold'
                 : pct52w >= 70 ? 'text-amber-400'
                 : 'text-slate-500';
  return (
    <div className="text-xs">
      {pct52w != null && <div className={pct52cls}>{pct52w}th %ile</div>}
      {pct63 != null && (
        <div className={`text-[9px] mt-0.5 ${cls}`}>
          63d: {pct63 >= 0 ? '+' : ''}{pct63.toFixed(1)}%
        </div>
      )}
    </div>
  );
}

function FundamentalsCell({
  eps, roce, accel, accelQtrs,
}: {
  eps: number | null; roce: number | null;
  accel: boolean | null; accelQtrs: number | null;
}) {
  if (eps == null && roce == null) return <span className="text-slate-600">—</span>;
  const epsCls = eps == null ? 'text-slate-600'
               : eps > 0 ? (eps > 20 ? 'text-emerald-400 font-bold' : 'text-emerald-300')
               : eps > -50 ? 'text-amber-400'  // turnaround: negative but improving
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
    </div>
  );
}

function ScoreBar({ score }: { score: number }) {
  const cls = score >= 85 ? 'bg-emerald-500'
            : score >= 70 ? 'bg-amber-500'
            : 'bg-slate-600';
  return (
    <div className="mt-1 h-1 w-14 bg-slate-800 rounded-full overflow-hidden">
      <div className={`h-full ${cls} rounded-full`} style={{ width: `${Math.min(100, score)}%` }} />
    </div>
  );
}

const TIPS: Record<string, { title: string; content: string }> = {
  ticker: {
    title: 'Stock',
    content: 'NSE ticker. Sub-badge shows Stage 2 phase (EARLY/MID/LATE) based on gap between 50 SMA and 200 SMA. EARLY = maximum upside, just crossed institutional threshold. LATE = extended run, bases are prone to failure — size down.',
  },
  lifecycle_state: {
    title: 'Lifecycle State',
    content: 'CONFIRMED (85+): all 4 trend knockout conditions met, all additive scores strong — active buy zone. SUSTAINED: CONFIRMED for 30+ days, proven multi-week leader. EMERGING (70-84): building base, add to watchlist. WATCHING (60-69): forming signals, not yet ready. WEAKENING: score dropped >12 pts in 5 days OR price below 50 SMA — tighten stops. EXITED: failed trend knockout or below 150 EMA — Stage 2 over.',
  },
  stage2_score: {
    title: 'Score (0-100)',
    content: 'Revised Weinstein+Minervini rubric. 5 dimensions: (1) Trend Alignment KNOCKOUT 30pts — Price>50SMA>150EMA>200SMA AND 200SMA slope>0; fails = immediate 0. (2) Fundamentals 20pts — EPS TTM>0 + accelerating + ROCE>15%. (3) Volatility Contraction 20pts — 20d H-L ≤5% AND volume <50% of 50d avg. (4) Pivot Proximity 15pts — within -5% to +2% of 10-day high. (5) Relative Strength 15pts — 52W rank ≥85 AND 63d RS ≥+10%. Score 85+ = CONFIRMED. 70-84 = EMERGING. <70 = PASS.',
  },
  score_3d_delta: {
    title: '3-Day Score Change',
    content: 'Score vs 3 trading days ago. UP = STRENGTHENING (rose 8+ pts): setup aligning, consider entering. DOWN = WEAKENING (dropped 8+ pts): signals deteriorating, trim or tighten stop.',
  },
  trend: {
    title: 'Trend Knockout (4 dots)',
    content: 'All 4 MUST be green for a stock to qualify. Left→Right: (1) Price > 50 SMA — intermediate trend up. (2) 50 SMA > 150 EMA — moving averages in proper Weinstein order. (3) 150 EMA > 200 SMA — long-term accelerating. (4) 200 SMA slope > 0 — the macro trend itself is rising; declining 200 SMA = Stage 4 distribution. If ANY dot is red, the stock failed the knockout and is NOT in the database.',
  },
  volatility: {
    title: 'Volatility Contraction',
    content: 'Minervini VCP v3.0: (1) 20-day H-L depth = (max_high - min_low) / close over 20 days. ≤5% + vol dry-up = 20 pts (textbook coil). ≤10% = 10 pts. >10% = choppy base, 0 pts. (2) Volume ratio = 5-day avg volume / 50-day avg volume. <0.5x = seller exhaustion confirmed. Both green = perfect Minervini setup.',
  },
  pivot: {
    title: 'Pivot Proximity',
    content: '(Close − 10-day High) / 10-day High × 100. Green "In Zone" = within −5% to +2% of the 10-day high — this is the coil, buy zone. Amber "Near" = −10% to −5%, still watchable. Red "Extended" = >+2%, chasing — expect to get shaken out on routine dips. Enter only in the In Zone range.',
  },
  rs: {
    title: 'Relative Strength',
    content: 'Dual-timeframe leadership filter. 52W percentile = where this stock ranks by 1-year return among all qualifying stocks in universe. 63d RS = % outperformance vs Nifty Total Market over 63 trading days. 15 pts: rank ≥85th AND 63d ≥+10% (dual leader). 7 pts: rank ≥70th AND 63d ≥+5%. 0 pts: lagging. Stocks scoring 15 pts here are true market leaders, not just short-term movers.',
  },
  fundamentals: {
    title: 'Fundamental Engine',
    content: 'EPS TTM = trailing 12-month net profit growth YoY. ↑↑ = accelerating (Q0 YoY > Q1 YoY — Minervini hallmark). ROCE = Return on Capital Employed. 20 pts: EPS>0 + accelerating + ROCE>15%. 10 pts: EPS>20% OR ROCE>15%. 5 pts: TURN — EPS is still negative but improving >30% YoY with acceleration (Medha turnaround tier for pre-profit growth companies). Pure technical setups still qualify via the other 4 dimensions.',
  },
  days_entry: {
    title: 'Days in Stage 2 + Entry',
    content: 'Days = consecutive days this stock has been above 150 EMA in its current Stage 2 run. Entry = date it first qualified. 0-15 days = Golden Window (best risk-reward, move has barely started). 15-45 = Established. 45+ = Extended (wait for new tight base before adding).',
  },
  returns_since_breakout: {
    title: 'Returns',
    content: 'Left = total return since entry date. Right = today\'s price change. Near 0% total return = fresh entry, move not started. Already 25%+ = first leg likely done, wait for new base. Negative total = breakout failing, watch for close below 150 EMA as exit signal.',
  },
};

function Th({ col, label, right, active, dir, onSort }: {
  col: SortKey; label: string; right?: boolean; active: boolean;
  dir: SortDir; onSort: (c: SortKey) => void;
}) {
  const tip = TIPS[col];
  return (
    <th
      onClick={() => onSort(col)}
      className={[
        'px-2 py-3 text-[10px] font-semibold uppercase tracking-wider cursor-pointer select-none whitespace-nowrap bg-[#161b22]',
        right ? 'text-right' : 'text-left',
        active ? 'text-white' : 'text-slate-500 hover:text-slate-300',
      ].join(' ')}
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

export default function Stage2Page() {
  const [signals,    setSignals]    = useState<Signal[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [triggering, setTriggering] = useState<string | null>(null);
  const [trigMsg,    setTrigMsg]    = useState('');
  const [sortKey,    setSortKey]    = useState<SortKey>('stage2_score');
  const [sortDir,    setSortDir]    = useState<SortDir>('desc');
  const [filter,     setFilter]     = useState<FilterMode>('all');
  const [dateRange,  setDateRange]  = useState<DateRange>('week');

  const loadData = async () => {
    setLoading(true); setError('');
    try {
      const [rawSigs, rawPerf] = await Promise.all([
        sb('stage2_signals?select=*&order=stage2_score.desc&limit=500'),
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

  useEffect(() => { loadData(); }, []);

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

  // Deduplicate: one row per ticker (latest signal_date wins)
  const deduplicated = useMemo(() => {
    const map = new Map<string, Signal>();
    for (const sig of signals) {
      const existing = map.get(sig.ticker);
      if (!existing || sig.signal_date > existing.signal_date) map.set(sig.ticker, sig);
    }
    return Array.from(map.values());
  }, [signals]);

  // Date filter
  const dateFiltered = useMemo(() => {
    const days = dateRange === 'week' ? 7 : dateRange === 'month' ? 30 : 90;
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
    return deduplicated.filter(s => new Date(s.signal_date) >= cutoff);
  }, [deduplicated, dateRange]);

  // Mode filter
  const modeFiltered = useMemo(() => {
    const daysLive = (s: Signal) =>
      s.days_in_stage2 ?? Math.floor(
        (Date.now() - new Date((s.entry_date || s.signal_date) + 'T00:00:00').getTime()) / 86400000
      );
    switch (filter) {
      case 'confirmed':   return dateFiltered.filter(s => s.stage2_score >= 85);
      case 'emerging':    return dateFiltered.filter(s => s.stage2_score >= 70 && s.stage2_score < 85);
      case 'early_stage2':return dateFiltered.filter(s => s.stage2_subtype === 'EARLY STAGE 2');
      case 'fresh':       return dateFiltered.filter(s => daysLive(s) <= 15);
      case 'strengthening':return dateFiltered.filter(s => s.score_trend === 'STRENGTHENING');
      default:            return dateFiltered;
    }
  }, [dateFiltered, filter]);

  // Sort
  const sorted = useMemo(() => {
    return [...modeFiltered].sort((a, b) => {
      const d = sortDir === 'desc' ? -1 : 1;
      if (sortKey === 'ticker')      return d * a.ticker.localeCompare(b.ticker);
      if (sortKey === 'signal_date') return d * a.signal_date.localeCompare(b.signal_date);
      if (sortKey === 'days_in_stage2') return d * a.signal_date.localeCompare(b.signal_date) * -1;
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
  const confirmed     = dateFiltered.filter(s => s.stage2_score >= 85).length;
  const sustained     = dateFiltered.filter(s => s.lifecycle_state === 'SUSTAINED').length;
  const emerging      = dateFiltered.filter(s => s.stage2_score >= 70 && s.stage2_score < 85).length;
  const earlys2       = dateFiltered.filter(s => s.stage2_subtype === 'EARLY STAGE 2').length;
  const strengthening = dateFiltered.filter(s => s.score_trend === 'STRENGTHENING').length;
  const avgReturn     = (() => {
    const v = dateFiltered.map(s => s.returns_since_breakout).filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  })();

  const stockScansUrl  = (t: string) => `https://www.stockscans.in/charts/NSE:${t.replace(/\.NS$/i, '')}`;
  const tradingViewUrl = (t: string) => `https://in.tradingview.com/symbols/NSE-${t.replace(/\.NS$/i, '')}/`;

  return (
    <div className="min-h-screen bg-[#0d1117] p-3 md:p-5">
      <div className="max-w-[1900px] mx-auto space-y-4">

        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Link href="/" className="text-slate-500 hover:text-slate-300"><ArrowLeft className="w-4 h-4" /></Link>
              <Layers className="w-5 h-5 text-blue-400" />
              <h1 className="text-lg font-black text-white">Early Stage 2 Intelligence Hub</h1>
              <span className="text-[10px] bg-blue-900/50 text-blue-400 border border-blue-700/40 px-1.5 py-0.5 rounded font-bold">v3.0</span>
            </div>
            <p className="text-xs text-slate-500 ml-11">
              Weinstein+Minervini Revised Rubric &middot; Knockout 30 + Funda 20 + VCP 20 + Pivot 15 + RS 15 &middot;
              CONFIRMED≥85 &middot; ~700 stock universe (N500+SC250+MC250) &middot; Click column to sort
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
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
            {[
              { l: 'Confirmed (85+)',   v: confirmed.toString(),     c: 'text-emerald-400' },
              { l: 'Sustained',         v: sustained.toString(),     c: 'text-cyan-400' },
              { l: 'Emerging (70-84)',  v: emerging.toString(),      c: 'text-amber-400' },
              { l: 'Early Stage 2',     v: earlys2.toString(),       c: 'text-emerald-300' },
              { l: 'Strengthening',     v: strengthening.toString(), c: 'text-blue-400' },
              { l: 'Avg Return',        v: fmtPct(avgReturn),        c: retCls(avgReturn) },
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
            { l: 'VCP / Volatility', v: '20', c: 'bg-violet-900/30 border-violet-700/30 text-violet-300' },
            { l: 'Pivot Proximity',  v: '15', c: 'bg-amber-900/30 border-amber-700/30 text-amber-300' },
            { l: 'Rel. Strength',    v: '15', c: 'bg-cyan-900/30 border-cyan-700/30 text-cyan-300' },
            { l: 'CONFIRMED ≥85',    v: '✓',  c: 'bg-emerald-900/40 border-emerald-700/40 text-emerald-400' },
            { l: 'EMERGING 70-84',   v: '~',  c: 'bg-amber-900/40 border-amber-700/40 text-amber-400' },
          ].map(b => (
            <span key={b.l} className={`inline-flex items-center gap-1 px-2 py-1 rounded border font-bold ${b.c}`}>
              <span className="opacity-60">{b.l}</span> {b.v}pts
            </span>
          ))}
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-1 gap-1">
            {([['week','This Week'],['month','Last Month'],['quarter','Last Quarter']] as [DateRange,string][]).map(([v,l]) => (
              <button key={v} onClick={() => setDateRange(v)}
                className={`px-3 py-1 text-xs rounded font-medium transition ${dateRange===v?'bg-indigo-600 text-white':'text-slate-400 hover:text-white'}`}>{l}</button>
            ))}
          </div>
          <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-1 gap-1 flex-wrap">
            {([
              ['all',          'All'],
              ['confirmed',    'Confirmed (85+)'],
              ['emerging',     'Emerging (70-84)'],
              ['early_stage2', 'Early Stage 2'],
              ['fresh',        'Fresh (≤15d)'],
              ['strengthening','Strengthening'],
            ] as [FilterMode,string][]).map(([v,l]) => (
              <button key={v} onClick={() => setFilter(v)}
                className={`px-3 py-1 text-xs rounded font-medium transition whitespace-nowrap ${filter===v?'bg-blue-600 text-white':'text-slate-400 hover:text-white'}`}>{l}</button>
            ))}
          </div>
          <span className="text-slate-600 text-xs">{sorted.length} setups &middot; {deduplicated.length} unique stocks</span>
        </div>

        {/* Table */}
        {loading ? (
          <div className="text-center py-20 text-slate-500 text-sm">Loading&hellip;</div>
        ) : sorted.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-16 text-center">
            <Layers className="w-8 h-8 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400 font-semibold">No Stage 2 setups in this range</p>
            <div className="flex gap-3 justify-center mt-4">
              <button onClick={() => dispatch('backfill_stage2')} disabled={!!triggering}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded text-xs font-medium disabled:opacity-50">Seed 7 Days</button>
              <button onClick={() => dispatch('stage2_engine')} disabled={!!triggering}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-medium disabled:opacity-50">Run Scan</button>
            </div>
          </div>
        ) : (
          <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
            <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: 'min(780px, calc(100vh - 340px))' }}>
              <table className="w-full text-xs border-collapse" style={{ minWidth: '1500px' }}>
                <thead className="sticky top-0 z-20">
                  <tr className="bg-[#161b22] border-b-2 border-slate-700">
                    <Th col="ticker"               label="Stock"      active={sortKey==='ticker'}               dir={sortDir} onSort={onSort} />
                    <ThStatic label="State"        tipKey="lifecycle_state" />
                    <Th col="stage2_score"         label="Score"      active={sortKey==='stage2_score'}         dir={sortDir} onSort={onSort} />
                    <Th col="score_3d_delta"       label="3d Δ"       active={sortKey==='score_3d_delta'}       dir={sortDir} onSort={onSort} />
                    <ThStatic label="Trend (4)"    tipKey="trend" />
                    <Th col="hl_depth_20d"         label="Volatility" active={sortKey==='hl_depth_20d'}         dir={sortDir} onSort={onSort} />
                    <Th col="pivot_proximity_pct"  label="Pivot"      active={sortKey==='pivot_proximity_pct'}  dir={sortDir} onSort={onSort} />
                    <Th col="rs_52w_percentile"    label="RS"         active={sortKey==='rs_52w_percentile'}    dir={sortDir} onSort={onSort} right />
                    <Th col="ttm_eps_growth"       label="Funda"      active={sortKey==='ttm_eps_growth'}       dir={sortDir} onSort={onSort} />
                    <Th col="days_in_stage2"       label="Days/Entry" active={sortKey==='days_in_stage2'}       dir={sortDir} onSort={onSort} />
                    <Th col="returns_since_breakout" label="Return"   active={sortKey==='returns_since_breakout'} dir={sortDir} onSort={onSort} right />
                    <ThStatic label="Charts" />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(sig => {
                    const s   = sig.stage2_score;
                    const lc  = sig.lifecycle_state || 'WATCHING';
                    const sym = sig.ticker.replace(/\.NS$/i, '');
                    const daysLive = sig.days_in_stage2 ?? Math.floor(
                      (Date.now() - new Date((sig.entry_date || sig.signal_date) + 'T00:00:00').getTime()) / 86400000
                    );
                    const rowBg = lc === 'SUSTAINED' ? 'bg-cyan-950/15 hover:bg-cyan-950/30'
                                : lc === 'CONFIRMED' ? 'bg-emerald-950/15 hover:bg-emerald-950/30'
                                : lc === 'EMERGING'  ? 'bg-amber-950/10 hover:bg-amber-950/20'
                                : lc === 'WEAKENING' ? 'bg-orange-950/15 hover:bg-orange-950/30'
                                : 'hover:bg-slate-800/20';
                    const stkBg = lc === 'SUSTAINED' ? '#051a1a'
                                : lc === 'CONFIRMED' ? '#0a1f12'
                                : lc === 'EMERGING'  ? '#1a1500'
                                : lc === 'WEAKENING' ? '#1a0d00' : '#0d1117';

                    return (
                      <tr key={sig.id} className={`border-b border-slate-800/50 transition-colors ${rowBg}`}>

                        {/* Stock */}
                        <td className="px-3 py-2 whitespace-nowrap">
                          <a href={stockScansUrl(sig.ticker)} target="_blank" rel="noopener noreferrer"
                            className="font-bold text-white hover:text-blue-400 transition-colors text-sm">{sym}</a>
                          {sig.company_name && (
                            <div className="text-slate-500 text-[10px] truncate max-w-[130px]">{sig.company_name}</div>
                          )}
                          <div className="flex gap-1 mt-0.5 flex-wrap">
                            <StagePill subtype={sig.stage2_subtype} />
                            {sig.is_pead_confluence && (
                              <span className="text-[8px] font-bold bg-violet-500/20 text-violet-400 border border-violet-500/30 px-1 py-0.5 rounded">PEAD+S2</span>
                            )}
                            {sig.is_reentry && (
                              <span className="text-[8px] font-bold bg-purple-500/20 text-purple-400 border border-purple-500/30 px-1 py-0.5 rounded">REENTRY</span>
                            )}
                            {sig.is_smart_money_divergence && (
                              <span className="text-[8px] font-bold bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 px-1 py-0.5 rounded">SMD</span>
                            )}
                          </div>
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

                        {/* Volatility */}
                        <td className="px-2 py-2 whitespace-nowrap">
                          <VolatilityCell hl={sig.hl_depth_20d} volRatio={sig.vol_5d_vs_50d_ratio} />
                        </td>

                        {/* Pivot Proximity */}
                        <td className="px-2 py-2 whitespace-nowrap">
                          <PivotCell pct={sig.pivot_proximity_pct} />
                        </td>

                        {/* RS */}
                        <td className="px-2 py-2 text-right whitespace-nowrap">
                          <RSCell rs={sig.rs_trend} pct63={sig.rs_63d_score} pct52w={sig.rs_52w_percentile} />
                        </td>

                        {/* Fundamentals */}
                        <td className="px-2 py-2 whitespace-nowrap">
                          <FundamentalsCell
                            eps={sig.ttm_eps_growth} roce={sig.roce}
                            accel={sig.eps_is_accelerating} accelQtrs={sig.eps_acceleration_quarters}
                          />
                        </td>

                        {/* Days + Entry */}
                        <td className="px-2 py-2 whitespace-nowrap">
                          <div>
                            {daysLive <= 15
                              ? <span className="text-emerald-400 font-bold text-xs">{daysLive}d</span>
                              : daysLive <= 45
                              ? <span className="text-amber-400 font-semibold text-xs">{daysLive}d</span>
                              : <span className="text-slate-400 text-xs">{daysLive}d</span>}
                            <div className="text-[9px] text-slate-600 mt-0.5">
                              {fmtDate(sig.entry_date || sig.signal_date)}
                            </div>
                          </div>
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

                        {/* Chart links */}
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
                {sorted.length} setups &middot; {deduplicated.length} unique &middot;
                v3.0 Weinstein+Minervini &middot; CONFIRMED≥85 &middot; ~700 universe
              </span>
              <span>Click column headers to sort &middot; SS=StockScans &middot; TV=TradingView</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

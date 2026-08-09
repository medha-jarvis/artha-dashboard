'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, RefreshCw, AlertCircle, ChevronUp, ChevronDown,
  ChevronRight, Activity, BarChart2, TrendingUp, Zap, Target,
  ExternalLink, Play, TrendingDown, AlertTriangle,
} from 'lucide-react';
import { InfoTooltip } from '../components/InfoTooltip';


const sb = (path: string) =>
  fetch(`/api/sb/${path}`, { cache: 'no-store' }).then(r => r.json());

interface Constituent { symbol: string; score?: number; stage?: string; }

interface SectorScore {
  id: string;
  sector_id: string;
  date: string;
  score: number;
  stage: string;
  confirmed_stage: string | null;
  stage_entry_date: string | null;
  days_in_current_stage: number | null;
  prev_stage: string | null;
  is_fresh_entry: boolean | null;
  distance_52w_high: number | null;
  rs_score: number | null;
  rs_vs_midcap: number | null;
  outperf_13w: number | null;
  outperf_26w: number | null;
  atr_ratio: number | null;
  breadth_pct: number | null;
  above_10sma_count: number | null;
  score_delta: number | null;
  vol_trend_pts: number | null;
  top_constituents: Constituent[] | null;
  sector_definitions: { name: string; slug: string; stockscans_id: string | null } | null;
}

interface HistoricalPoint { date: string; score: number; }
type SparklineMap = Record<string, HistoricalPoint[]>; // sector_id → last 8 scores

const ssUrl = (pciId: string | null | undefined) =>
  pciId ? `https://www.stockscans.in/charts/${pciId}` : 'https://www.stockscans.in/custom-index';

const STAGE_META: Record<string, {
  label: string; short: string;
  color: string; bg: string; border: string; dot: string;
}> = {
  'Stage 2A Early Inflection': {
    label: 'Stage 2A Early Inflection', short: '2A',
    color: 'text-emerald-300', bg: 'bg-emerald-500/15', border: 'border-emerald-500/50',
    dot: 'bg-emerald-400',
  },
  'Stage 2B Sustained Trend': {
    label: 'Stage 2B Sustained Trend', short: '2B',
    color: 'text-sky-300', bg: 'bg-sky-500/15', border: 'border-sky-500/40',
    dot: 'bg-sky-400',
  },
  'Stage 1 Consolidation': {
    label: 'Stage 1 Consolidation', short: 'S1',
    color: 'text-amber-300', bg: 'bg-amber-500/12', border: 'border-amber-500/35',
    dot: 'bg-amber-400',
  },
  'Stage 3 Distribution': {
    label: 'Stage 3 Distribution', short: 'S3',
    color: 'text-orange-400', bg: 'bg-orange-500/12', border: 'border-orange-500/40',
    dot: 'bg-orange-400',
  },
  'Stage 4 Downtrend': {
    label: 'Stage 4 Downtrend', short: 'S4',
    color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-700/30',
    dot: 'bg-red-500',
  },
  'Avoid / Weak': {
    label: 'Avoid / Weak', short: 'AV',
    color: 'text-slate-500', bg: 'bg-slate-800/40', border: 'border-slate-700/30',
    dot: 'bg-slate-600',
  },
};

const getStage = (stage: string) => STAGE_META[stage] ?? STAGE_META['Avoid / Weak'];

type SortKey   = 'score' | 'rs_score' | 'rs_vs_midcap' | 'breadth_pct' | 'distance_52w_high' | 'days_in_current_stage' | 'atr_ratio' | 'stage' | 'name' | 'above_10sma_count' | 'score_delta';
type SortDir   = 'asc' | 'desc';
type FilterKey = 'all' | 'Stage 2A Early Inflection' | 'Stage 2B Sustained Trend' | 'Stage 1 Consolidation' | 'Stage 3 Distribution' | 'Stage 4 Downtrend';

// ── Sparkline SVG (8-point mini chart) ───────────────────────────────────────
function Sparkline({ points }: { points: HistoricalPoint[] }) {
  if (points.length < 2) return <span className="text-slate-700 text-[10px]">—</span>;

  const W = 56, H = 20, PAD = 2;
  const scores = points.map(p => p.score);
  const minS = Math.min(...scores);
  const maxS = Math.max(...scores);
  const range = maxS - minS || 1;

  const xs = points.map((_, i) => PAD + (i / (points.length - 1)) * (W - PAD * 2));
  const ys = scores.map(s => PAD + (1 - (s - minS) / range) * (H - PAD * 2));

  const pathD = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');

  const last  = scores[scores.length - 1];
  const first = scores[0];
  const trend = last - first;
  const lineColor = trend > 0 ? '#34d399' : trend < 0 ? '#f87171' : '#64748b';

  return (
    <svg width={W} height={H} className="overflow-visible">
      <path d={pathD} fill="none" stroke={lineColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={xs[xs.length-1].toFixed(1)} cy={ys[ys.length-1].toFixed(1)} r="2" fill={lineColor} />
    </svg>
  );
}

// ── Score delta badge ─────────────────────────────────────────────────────────
function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta == null) return null;
  if (delta === 0) return <span className="text-[9px] text-slate-600 font-mono">→</span>;
  const up = delta > 0;
  return (
    <span className={`text-[9px] font-bold font-mono ${up ? 'text-emerald-400' : 'text-red-400'}`}>
      {up ? '↑' : '↓'}{Math.abs(delta)}
    </span>
  );
}

function DaysInStage({ days, isFresh, prevStage }: { days: number | null; isFresh: boolean | null; prevStage: string | null }) {
  if (days == null) return <span className="text-slate-700">—</span>;
  const color = days <= 14 ? 'text-emerald-400' : days <= 45 ? 'text-amber-400' : 'text-slate-500';
  const prev  = prevStage ? prevStage.replace('Stage ', 'S').replace(' Early Inflection','2A').replace(' Sustained Trend','2B').replace('1 Consolidation','1').replace('3 Distribution','3').replace('4 Downtrend','4').replace('Avoid / Weak','AV') : null;
  return (
    <div className="text-center">
      <div className={`font-mono text-xs font-bold ${color}`}>
        {isFresh && days <= 14 && <span className="mr-1">🆕</span>}{days}d
      </div>
      {prev && <div className="text-[9px] text-slate-600 mt-0.5">was {prev}</div>}
    </div>
  );
}

function ScoreGauge({ score }: { score: number }) {
  const pct   = Math.min(score, 100);
  const color = pct >= 80 ? 'text-emerald-300' : pct >= 65 ? 'text-sky-300' : pct >= 50 ? 'text-amber-300' : pct >= 35 ? 'text-orange-400' : 'text-red-400';
  const bar   = pct >= 80 ? 'bg-emerald-500'   : pct >= 65 ? 'bg-sky-500'   : pct >= 50 ? 'bg-amber-500'   : pct >= 35 ? 'bg-orange-500'    : 'bg-red-600';
  return (
    <div className="flex items-center gap-2 min-w-[100px]">
      <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${bar}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-sm font-black font-mono ${color} w-8 text-right`}>{score}</span>
    </div>
  );
}

function Th({ col, label, right, active, dir, onSort, info }:
  { col: SortKey; label: string; right?: boolean; active: boolean; dir: SortDir; onSort: (c: SortKey) => void; info?: string }) {
  return (
    <th onClick={() => onSort(col)}
      className={`px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider cursor-pointer select-none whitespace-nowrap
        ${right ? 'text-right' : 'text-left'} ${active ? 'text-white' : 'text-slate-500 hover:text-slate-300'}`}>
      <span className="inline-flex items-center gap-0.5">
        {label}{active && (dir === 'desc' ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />)}
        {info && <InfoTooltip content={info} title={label} />}
      </span>
    </th>
  );
}

function ConstituentDrawer({ constituents, count }: { constituents: Constituent[] | null; count: number | null }) {
  const [open, setOpen] = useState(false);
  const displayCount = count ?? constituents?.length ?? 0;
  if (!displayCount && !constituents?.length) return <span className="text-slate-700 text-xs">—</span>;

  return (
    <div>
      <button onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors">
        {displayCount > 0 && (
          <span className="px-1.5 py-0.5 bg-emerald-950/40 border border-emerald-800/30 rounded text-[10px] text-emerald-400 font-bold">
            {displayCount}
          </span>
        )}
        <span className="flex flex-wrap gap-1">
          {constituents?.slice(0, 3).map(c => (
            <span key={c.symbol} className="px-1.5 py-0.5 bg-slate-800 rounded text-[10px] text-slate-400 font-mono">
              {c.symbol.replace('.NS', '').replace('.BO', '')}
            </span>
          ))}
        </span>
        {constituents && constituents.length > 0 && (
          <ChevronRight className={`w-3 h-3 flex-shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
        )}
      </button>

      {open && constituents && (
        <div className="mt-2 ml-1 flex flex-wrap gap-1">
          {constituents.map(c => (
            <span key={c.symbol}
              className="px-2 py-0.5 bg-emerald-950/40 border border-emerald-800/30 rounded text-[10px] text-emerald-400 font-mono">
              {c.symbol.replace('.NS', '').replace('.BO', '')} ↑10W
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const STAGE_ORDER: Record<string, number> = {
  'Stage 2A Early Inflection': 5,
  'Stage 2B Sustained Trend':  4,
  'Stage 1 Consolidation':     3,
  'Stage 3 Distribution':      2,
  'Stage 4 Downtrend':         1,
  'Avoid / Weak':              0,
};

// ── Pre-breakout watchlist card ───────────────────────────────────────────────
function WatchlistSection({ rows }: { rows: SectorScore[] }) {
  const approaching = rows
    .filter(r => {
      const s = r.confirmed_stage || r.stage;
      return s === 'Stage 1 Consolidation' && r.score >= 45;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  if (!approaching.length) return null;

  return (
    <div className="bg-amber-950/20 border border-amber-700/25 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Target className="w-4 h-4 text-amber-400" />
        <span className="text-sm font-bold text-amber-300">Pre-Breakout Watchlist</span>
        <span className="text-[10px] text-amber-700 ml-1">Stage 1 sectors approaching Stage 2 — add to watchlist now</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {approaching.map(r => {
          const gap = 65 - r.score;
          return (
            <div key={r.id} className="bg-slate-900/60 border border-amber-800/20 rounded-lg p-3">
              <div className="text-xs font-semibold text-white truncate">{r.sector_definitions?.name}</div>
              <div className="flex items-center justify-between mt-1.5">
                <span className="font-mono text-sm font-black text-amber-300">{r.score}pt</span>
                <span className="text-[10px] text-slate-600">{gap}pt to S2</span>
              </div>
              <div className="mt-1.5 h-1 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-500/60 rounded-full"
                  style={{ width: `${(r.score / 65) * 100}%` }}
                />
              </div>
              {r.rs_score != null && (
                <div className={`text-[10px] mt-1 font-mono ${r.rs_score > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                  RS {r.rs_score >= 0 ? '+' : ''}{r.rs_score.toFixed(1)}%
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Exit alert banner ─────────────────────────────────────────────────────────
function ExitAlertBanner({ rows }: { rows: SectorScore[] }) {
  const exits = rows.filter(r => {
    const prev = r.prev_stage;
    const curr = r.confirmed_stage || r.stage;
    return (prev === 'Stage 2A Early Inflection' || prev === 'Stage 2B Sustained Trend')
      && (curr === 'Stage 3 Distribution' || curr === 'Stage 4 Downtrend')
      && r.is_fresh_entry;
  });

  if (!exits.length) return null;

  return (
    <div className="bg-orange-950/30 border border-orange-700/40 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="w-4 h-4 text-orange-400" />
        <span className="text-sm font-bold text-orange-300">Stage Exit Alert — Review Positions</span>
      </div>
      <div className="space-y-1.5">
        {exits.map(r => {
          const prev = r.prev_stage?.replace('Stage 2A Early Inflection','Stage 2A').replace('Stage 2B Sustained Trend','Stage 2B') ?? '';
          const curr = (r.confirmed_stage || r.stage).replace('Stage 3 Distribution','Stage 3').replace('Stage 4 Downtrend','Stage 4');
          return (
            <div key={r.id} className="flex items-center gap-3 text-xs">
              <span className="font-semibold text-white">{r.sector_definitions?.name}</span>
              <span className="text-slate-500">{prev} → <span className="text-orange-400 font-bold">{curr}</span></span>
              <span className="text-slate-600 font-mono">Score {r.score}/100{r.score_delta != null ? ` (${r.score_delta >= 0 ? '+' : ''}${r.score_delta})` : ''}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function SectorPulsePage() {
  const [data,        setData]        = useState<SectorScore[]>([]);
  const [sparklines,  setSparklines]  = useState<SparklineMap>({});
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [lastDate,    setLastDate]    = useState('');
  const [sortKey,     setSortKey]     = useState<SortKey>('score');
  const [sortDir,     setSortDir]     = useState<SortDir>('desc');
  const [filter,      setFilter]      = useState<FilterKey>('all');
  const [search,      setSearch]      = useState('');
  const [minScore,    setMinScore]    = useState<number>(0);
  const [triggering,  setTriggering]  = useState(false);
  const [trigMsg,     setTrigMsg]     = useState<string | null>(null);
  const [showExitOnly,setShowExitOnly]= useState(false);

  const today = new Date();

  const loadData = async () => {
    setLoading(true); setError('');
    try {
      const dateRes = await sb('daily_sector_scores?select=date&order=date.desc&limit=1');
      if (!dateRes?.length) { setData([]); setLoading(false); return; }
      const latest = dateRes[0].date;
      setLastDate(latest);

      // Main scores + sparkline history in parallel
      const [scores, history] = await Promise.all([
        sb(
          `daily_sector_scores?select=id,sector_id,date,score,stage,confirmed_stage,stage_entry_date,days_in_current_stage,prev_stage,is_fresh_entry,distance_52w_high,rs_score,rs_vs_midcap,outperf_13w,outperf_26w,atr_ratio,breadth_pct,above_10sma_count,score_delta,vol_trend_pts,top_constituents,sector_definitions(name,slug,stockscans_id)&date=eq.${latest}&order=score.desc`
        ),
        sb(
          `daily_sector_scores?select=date,score,sector_id&order=date.desc&limit=400`
        ),
      ]);

      setData(Array.isArray(scores) ? scores : []);

      // Build sparkline map: sector_id → last 8 points (oldest first)
      if (Array.isArray(history)) {
        const map: Record<string, HistoricalPoint[]> = {};
        for (const row of history) {
          if (!map[row.sector_id]) map[row.sector_id] = [];
          if (map[row.sector_id].length < 8) {
            map[row.sector_id].unshift({ date: row.date, score: row.score });
          }
        }
        setSparklines(map);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  };

  const runScan = async () => {
    setTriggering(true); setTrigMsg(null);
    try {
      const d = await fetch('/api/pulse-trigger', { method: 'POST' }).then(r => r.json());
      setTrigMsg(d.ok ? `✓ ${d.message}` : `✗ ${d.error}`);
    } catch (e: unknown) {
      setTrigMsg(`✗ ${e instanceof Error ? e.message : 'Request failed'}`);
    } finally {
      setTriggering(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const onSort = (col: SortKey) => {
    if (col === sortKey) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(col); setSortDir('desc'); }
  };

  const daysFromEntry = (row: SectorScore): number | null => {
    if (!row.stage_entry_date) return row.days_in_current_stage;
    const entry = new Date(row.stage_entry_date + 'T00:00:00');
    return Math.floor((today.getTime() - entry.getTime()) / 86400000);
  };

  const isFreshEntry = (row: SectorScore): boolean => {
    const d = daysFromEntry(row);
    return d != null && d <= 14;
  };

  const filtered = useMemo(() => {
    let rows = [...data];

    if (showExitOnly) {
      rows = rows.filter(r => {
        const prev = r.prev_stage;
        const curr = r.confirmed_stage || r.stage;
        return (prev === 'Stage 2A Early Inflection' || prev === 'Stage 2B Sustained Trend')
          && (curr === 'Stage 3 Distribution' || curr === 'Stage 4 Downtrend');
      });
    } else {
      if (filter !== 'all') rows = rows.filter(r => (r.confirmed_stage || r.stage) === filter);
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(r => (r.sector_definitions?.name || '').toLowerCase().includes(q));
    }
    if (minScore > 0) rows = rows.filter(r => r.score >= minScore);

    rows.sort((a, b) => {
      const d = sortDir === 'desc' ? -1 : 1;
      if (sortKey === 'stage') {
        return d * ((STAGE_ORDER[(a.confirmed_stage || a.stage)] ?? 0) - (STAGE_ORDER[(b.confirmed_stage || b.stage)] ?? 0));
      }
      if (sortKey === 'name') {
        return d * (a.sector_definitions?.name ?? '').localeCompare(b.sector_definitions?.name ?? '');
      }
      if (sortKey === 'above_10sma_count') {
        return d * ((a.above_10sma_count ?? -999) - (b.above_10sma_count ?? -999));
      }
      if (sortKey === 'days_in_current_stage') {
        const ad = daysFromEntry(a) ?? (sortDir === 'desc' ? -999 : 999);
        const bd = daysFromEntry(b) ?? (sortDir === 'desc' ? -999 : 999);
        return d * (ad - bd);
      }
      if (sortKey === 'score_delta') {
        return d * ((a.score_delta ?? -999) - (b.score_delta ?? -999));
      }
      const av = (a[sortKey as keyof SectorScore] as number | null) ?? (sortDir === 'desc' ? -999 : 999);
      const bv = (b[sortKey as keyof SectorScore] as number | null) ?? (sortDir === 'desc' ? -999 : 999);
      return d * (av - bv);
    });
    return rows;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, filter, search, minScore, sortKey, sortDir, showExitOnly]);

  const topSector    = data[0];
  const stage2aCount = data.filter(r => (r.confirmed_stage || r.stage) === 'Stage 2A Early Inflection').length;
  const stage2bCount = data.filter(r => (r.confirmed_stage || r.stage) === 'Stage 2B Sustained Trend').length;
  const exitCount    = data.filter(r => {
    const prev = r.prev_stage; const curr = r.confirmed_stage || r.stage;
    return (prev === 'Stage 2A Early Inflection' || prev === 'Stage 2B Sustained Trend')
      && (curr === 'Stage 3 Distribution' || curr === 'Stage 4 Downtrend') && r.is_fresh_entry;
  }).length;

  const fmtDate = (s: string) => new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });

  return (
    <div className="min-h-screen bg-[#070c14] text-white p-4 md:p-6">

      {/* Ambient */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/3 w-96 h-64 bg-emerald-600/6 rounded-full blur-3xl" />
        <div className="absolute top-0 right-1/4 w-72 h-48 bg-sky-600/5 rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-[1500px] mx-auto space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-slate-600 hover:text-slate-400 transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-xl font-black text-white flex items-center gap-2">
                <Activity className="w-5 h-5 text-emerald-400" />
                Sector Pulse
              </h1>
              <p className="text-xs text-slate-600 mt-0.5">
                Weinstein Stage Analysis · 100-pt Weekly Techno-Funda · Nifty 50 + Midcap 150 RS
                {lastDate && <span className="ml-2">· {fmtDate(lastDate)}</span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={runScan} disabled={triggering}
              title="Run scan now"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 hover:text-emerald-300 transition-colors disabled:opacity-40 border border-emerald-700/40 text-xs font-medium">
              <Play className={`w-3.5 h-3.5 ${triggering ? 'animate-pulse' : ''}`} />
              {triggering ? 'Dispatching…' : 'Run Scan'}
            </button>
            <button onClick={loadData} disabled={loading}
              className="p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors disabled:opacity-40 border border-slate-700/50">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {trigMsg && (
          <div className={`text-xs px-3 py-2 rounded-lg border ${trigMsg.startsWith('✓') ? 'bg-emerald-950/30 border-emerald-800/40 text-emerald-400' : 'bg-red-950/30 border-red-800/40 text-red-400'}`}>
            {trigMsg}
          </div>
        )}

        {/* Top Metrics Row */}
        {!loading && data.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              {
                icon: BarChart2, label: 'Monitored Sectors', value: data.length,
                sub: 'active today', color: 'text-slate-300', bg: 'bg-slate-800/50', border: 'border-slate-700/40',
              },
              {
                icon: Zap, label: 'Stage 2A Breakouts', value: stage2aCount,
                sub: 'Early Inflection', color: 'text-emerald-300', bg: 'bg-emerald-950/30', border: 'border-emerald-700/30',
              },
              {
                icon: TrendingUp, label: 'Stage 2B Trending', value: stage2bCount,
                sub: 'Sustained Momentum', color: 'text-sky-300', bg: 'bg-sky-950/30', border: 'border-sky-700/30',
              },
              exitCount > 0
                ? {
                    icon: TrendingDown, label: 'Stage Exit Alerts', value: exitCount,
                    sub: 'Review positions', color: 'text-orange-300', bg: 'bg-orange-950/20', border: 'border-orange-700/30',
                  }
                : {
                    icon: Target, label: 'Top Rotation', value: topSector?.sector_definitions?.name ?? '—',
                    sub: topSector ? `Score ${topSector.score}/100` : '', color: 'text-amber-300', bg: 'bg-amber-950/20', border: 'border-amber-700/25',
                  },
            ].map(m => {
              const Icon = m.icon;
              return (
                <div key={m.label} className={`${m.bg} border ${m.border} rounded-xl p-4`}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <Icon className={`w-3.5 h-3.5 ${m.color}`} />
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">{m.label}</span>
                  </div>
                  <div className={`text-2xl font-black ${m.color} leading-none truncate`}>{m.value}</div>
                  {m.sub && <div className="text-[10px] text-slate-600 mt-1">{m.sub}</div>}
                </div>
              );
            })}
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-red-400 bg-red-950/30 border border-red-800/40 rounded-xl p-3 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
          </div>
        )}

        {!loading && !error && data.length === 0 && (
          <div className="text-center py-24 text-slate-600">
            <Activity className="w-12 h-12 mx-auto mb-4 opacity-20" />
            <p className="text-sm font-medium">No sector scores yet.</p>
            <p className="text-xs mt-2 text-slate-700">
              Click <span className="text-emerald-600 font-medium">Run Scan</span> above to score all sectors now.
            </p>
          </div>
        )}

        {/* Exit alerts */}
        {data.length > 0 && <ExitAlertBanner rows={data} />}

        {/* Pre-breakout watchlist */}
        {data.length > 0 && <WatchlistSection rows={data} />}

        {/* Search + Filter chips */}
        {data.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="text"
                placeholder="Search sector…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="px-3 py-1.5 bg-slate-800/80 border border-slate-700/50 rounded-lg text-xs text-white placeholder-slate-600 focus:outline-none focus:border-slate-500 w-44"
              />
              {search && (
                <button onClick={() => setSearch('')} className="text-slate-500 hover:text-slate-300 text-xs">✕ clear</button>
              )}
              <div className="flex items-center gap-1.5 ml-2">
                <span className="text-[10px] text-slate-500 uppercase tracking-wider">Min Score</span>
                <input
                  type="number" min={0} max={100} step={5}
                  value={minScore || ''}
                  onChange={e => setMinScore(Number(e.target.value) || 0)}
                  placeholder="0"
                  className="w-14 px-2 py-1.5 bg-slate-800/80 border border-slate-700/50 rounded-lg text-xs text-white placeholder-slate-600 focus:outline-none focus:border-slate-500 text-center"
                />
                {minScore > 0 && (
                  <button onClick={() => setMinScore(0)} className="text-slate-500 hover:text-slate-300 text-xs">✕</button>
                )}
              </div>
              {exitCount > 0 && (
                <button onClick={() => setShowExitOnly(v => !v)}
                  className={`ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all
                    ${showExitOnly ? 'bg-orange-900/40 border-orange-700/50 text-orange-300' : 'bg-transparent border-orange-800/30 text-orange-600 hover:text-orange-400'}`}>
                  <AlertTriangle className="w-3 h-3" />
                  Exit alerts only ({exitCount})
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {(['all', 'Stage 2A Early Inflection', 'Stage 2B Sustained Trend', 'Stage 1 Consolidation', 'Stage 3 Distribution', 'Stage 4 Downtrend'] as const).map(f => {
                const count  = f === 'all' ? data.length : data.filter(r => (r.confirmed_stage || r.stage) === f).length;
                const meta   = f === 'all' ? null : getStage(f);
                const active = !showExitOnly && filter === f;
                return (
                  <button key={f} onClick={() => { setShowExitOnly(false); setFilter(f); }}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all whitespace-nowrap
                      ${active
                        ? (meta ? `${meta.bg} ${meta.color} ${meta.border}` : 'bg-slate-700 text-white border-slate-500')
                        : 'bg-transparent text-slate-500 border-slate-800 hover:border-slate-600 hover:text-slate-300'
                      }`}>
                    {f === 'all' ? `All (${count})` : `${meta?.short}: ${count}`}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Table */}
        {filtered.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-slate-800/60 shadow-xl">
            <table className="w-full text-sm">
              <thead className="bg-slate-900/90 border-b border-slate-800">
                <tr>
                  <Th col="name" label="Sector" active={sortKey === 'name'} dir={sortDir} onSort={onSort}
                    info="StockScans custom sector index — equal-weighted basket. Click any row to open live chart on StockScans." />
                  <Th col="score" label="Score" right active={sortKey === 'score'} dir={sortDir} onSort={onSort}
                    info="100-pt composite: Trend (30pt) + RS vs Nifty 50 (30pt) + Volatility/VCP gated on upslope (25pt) + Volume (10pt) + Breadth (5pt). ≥80=Stage 2A · 65–79=Stage 2B · 50–64=S1 · 35–49=S3 · <35=S4" />
                  <Th col="score_delta" label="Δ" right active={sortKey === 'score_delta'} dir={sortDir} onSort={onSort}
                    info="Score change vs prior scoring run. Positive = improving trend. Sort descending to find sectors with the most momentum." />
                  <th className="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">
                    8W Trend
                  </th>
                  <Th col="stage" label="Stage" active={sortKey === 'stage'} dir={sortDir} onSort={onSort}
                    info="Stage 2A (≥80): Trend + RS + VCP firing. Stage 2B (65–79): Strong trend, accumulate dips. S1 (50–64): Watchlist. Stage 3 (35–49): Distribution — review positions. Stage 4 (<35): Downtrend. ⟳ = pending 2-week confirmation." />
                  <Th col="rs_score" label="RS N50" right active={sortKey === 'rs_score'} dir={sortDir} onSort={onSort}
                    info="Mansfield RS vs Nifty 50 (52W). Positive = outperforming. Graduated scoring: >15%=15pt, >5%=10pt, >0%=5pt. Shows 13W and 26W outperformance below." />
                  <Th col="rs_vs_midcap" label="RS Mid150" right active={sortKey === 'rs_vs_midcap'} dir={sortDir} onSort={onSort}
                    info="Mansfield RS vs Nifty Midcap 150 (52W). For mid/small-cap sectors, this is the more relevant benchmark. A sector outperforming Nifty 50 but underperforming Midcap 150 is weaker rotation." />
                  <Th col="breadth_pct" label="Breadth" right active={sortKey === 'breadth_pct'} dir={sortDir} onSort={onSort}
                    info="% of stocks in sector above their 10W SMA. 70%+ = broad participation. Below 50% = narrow rally." />
                  <Th col="distance_52w_high" label="52W Hi" right active={sortKey === 'distance_52w_high'} dir={sortDir} onSort={onSort}
                    info="Distance from 52-week high. Near 0% = at or making new highs (bullish). -20% or worse = still recovering." />
                  <Th col="days_in_current_stage" label="In Stage" active={sortKey === 'days_in_current_stage'} dir={sortDir} onSort={onSort}
                    info="Days in current confirmed stage. 🆕 0–14d = golden entry window. Sort ascending for freshest entries." />
                  <Th col="atr_ratio" label="ATR / VCP" active={sortKey === 'atr_ratio'} dir={sortDir} onSort={onSort}
                    info="4W ATR ÷ 12W ATR. Only scores points when 40W SMA slope is positive (VCP in downtrends no longer credited). <0.60=Tight 🟢 · 0.60–0.70=Compressed 🟡 · >0.70=Normal." />
                  <Th col="above_10sma_count" label="Stks ↑10W" active={sortKey === 'above_10sma_count'} dir={sortDir} onSort={onSort}
                    info="Actual count of constituent stocks above their 10-week SMA. Click to expand names." />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/40">
                {filtered.map(row => {
                  const displayStage = row.confirmed_stage || row.stage;
                  const meta = getStage(displayStage);
                  const atr  = row.atr_ratio;
                  const atrLabel = atr == null ? '—' : atr < 0.60 ? '🟢 Tight' : atr < 0.70 ? '🟡 Compressed' : '⚪ Normal';
                  const atrColor = atr == null ? 'text-slate-600' : atr < 0.60 ? 'text-emerald-400' : atr < 0.70 ? 'text-amber-400' : 'text-slate-500';
                  const href = ssUrl(row.sector_definitions?.stockscans_id);
                  const dynDays   = daysFromEntry(row);
                  const dynFresh  = isFreshEntry(row);
                  const hasPending = row.stage !== (row.confirmed_stage || row.stage);
                  const isExit = (displayStage === 'Stage 3 Distribution' || displayStage === 'Stage 4 Downtrend');
                  const spark = sparklines[row.sector_id] ?? [];

                  return (
                    <tr key={row.id}
                      onClick={() => window.open(href, '_blank')}
                      className={`hover:bg-slate-800/30 transition-colors cursor-pointer group
                        ${row.score >= 80 ? 'bg-emerald-950/8' : ''}
                        ${isExit ? 'bg-orange-950/8' : ''}`}>

                      {/* Sector name */}
                      <td className="px-4 py-3.5 w-44">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${meta.dot}`} />
                          <span className="font-semibold text-white text-sm group-hover:text-emerald-300 transition-colors truncate max-w-[140px]">
                            {row.sector_definitions?.name ?? '—'}
                          </span>
                          <ExternalLink className="w-3 h-3 text-slate-700 group-hover:text-emerald-500 transition-colors flex-shrink-0" />
                        </div>
                      </td>

                      {/* Score + delta */}
                      <td className="px-3 py-3.5 w-36">
                        <ScoreGauge score={row.score} />
                      </td>

                      {/* Delta */}
                      <td className="px-3 py-3.5 text-right">
                        <DeltaBadge delta={row.score_delta} />
                      </td>

                      {/* Sparkline — 8-week trend */}
                      <td className="px-3 py-3.5">
                        <Sparkline points={spark} />
                      </td>

                      {/* Stage badge */}
                      <td className="px-3 py-3.5">
                        <div className="flex flex-col gap-0.5">
                          <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border whitespace-nowrap ${meta.bg} ${meta.border} ${meta.color}`}>
                            {meta.short}: {meta.label.split(' ').slice(2).join(' ')}
                          </span>
                          {hasPending && (
                            <div className="flex items-center gap-0.5">
                              <span className="text-[9px] text-amber-400 font-semibold px-1">
                                ⟳ → {getStage(row.stage).short} confirming
                              </span>
                              <InfoTooltip
                                title={`Upgrading to ${getStage(row.stage).short}`}
                                content={`Raw score ${row.score}/100 qualifies for ${getStage(row.stage).label} but requires 2 consecutive weekly scoring runs. Will confirm next run if score holds.`}
                              />
                            </div>
                          )}
                        </div>
                      </td>

                      {/* RS vs Nifty 50 */}
                      <td className="px-3 py-3.5 text-right">
                        <div className={`font-mono text-xs font-bold
                          ${row.rs_score == null ? 'text-slate-600'
                            : row.rs_score > 15  ? 'text-emerald-300'
                            : row.rs_score > 5   ? 'text-emerald-500'
                            : row.rs_score > 0   ? 'text-emerald-700'
                            : row.rs_score > -5  ? 'text-red-400'
                            : 'text-red-500'}`}>
                          {row.rs_score == null ? '—' : `${row.rs_score >= 0 ? '+' : ''}${row.rs_score.toFixed(1)}%`}
                        </div>
                        {(row.outperf_13w != null || row.outperf_26w != null) && (
                          <div className="text-[9px] text-slate-600 font-mono mt-0.5 space-x-1">
                            {row.outperf_13w != null && <span>13W:{row.outperf_13w >= 0 ? '+' : ''}{row.outperf_13w.toFixed(1)}</span>}
                            {row.outperf_26w != null && <span>26W:{row.outperf_26w >= 0 ? '+' : ''}{row.outperf_26w.toFixed(1)}</span>}
                          </div>
                        )}
                      </td>

                      {/* RS vs Midcap 150 */}
                      <td className={`px-3 py-3.5 text-right font-mono text-xs
                        ${row.rs_vs_midcap == null ? 'text-slate-600'
                          : row.rs_vs_midcap > 10  ? 'text-emerald-300 font-bold'
                          : row.rs_vs_midcap > 0   ? 'text-emerald-500'
                          : row.rs_vs_midcap > -5  ? 'text-red-400'
                          : 'text-red-500 font-bold'}`}>
                        {row.rs_vs_midcap == null ? '—' : `${row.rs_vs_midcap >= 0 ? '+' : ''}${row.rs_vs_midcap.toFixed(1)}%`}
                      </td>

                      {/* Breadth */}
                      <td className={`px-3 py-3.5 text-right font-mono text-xs
                        ${row.breadth_pct == null ? 'text-slate-600'
                          : row.breadth_pct >= 70 ? 'text-emerald-400 font-bold'
                          : row.breadth_pct >= 55 ? 'text-amber-400'
                          : 'text-red-400'}`}>
                        {row.breadth_pct == null ? '—' : `${row.breadth_pct.toFixed(0)}%`}
                      </td>

                      {/* 52W High distance */}
                      <td className={`px-3 py-3.5 text-right font-mono text-xs
                        ${row.distance_52w_high == null ? 'text-slate-600'
                          : row.distance_52w_high >= -5  ? 'text-emerald-400 font-bold'
                          : row.distance_52w_high >= -12 ? 'text-amber-400'
                          : 'text-slate-500'}`}>
                        {row.distance_52w_high == null ? '—' : `${row.distance_52w_high.toFixed(1)}%`}
                      </td>

                      {/* Days in Stage */}
                      <td className="px-3 py-3.5 text-center">
                        <DaysInStage days={dynDays} isFresh={dynFresh} prevStage={row.prev_stage} />
                      </td>

                      {/* ATR / VCP */}
                      <td className={`px-3 py-3.5 text-xs ${atrColor}`}>
                        <div>{atrLabel}</div>
                        {atr != null && <div className="text-[10px] text-slate-600 font-mono">{atr.toFixed(2)}</div>}
                        {row.vol_trend_pts != null && row.vol_trend_pts > 0 && (
                          <div className="text-[9px] text-blue-400 mt-0.5">vol ↑{row.vol_trend_pts}pt</div>
                        )}
                      </td>

                      {/* Stocks above 10W SMA — full count + expandable */}
                      <td className="px-3 py-3.5 max-w-[180px]" onClick={e => e.stopPropagation()}>
                        <ConstituentDrawer
                          constituents={row.top_constituents}
                          count={row.above_10sma_count}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer */}
        <p className="text-xs text-slate-800 text-center pb-4">
          Scoring v2: Trend 30pt · RS 30pt (graduated) · VCP 25pt (upslope-gated) · Volume 10pt · Breadth 5pt · Sources: yfinance · StockScans
        </p>
      </div>
    </div>
  );
}

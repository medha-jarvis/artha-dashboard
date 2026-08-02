'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, RefreshCw, AlertCircle, ChevronUp, ChevronDown,
  ChevronRight, Activity, BarChart2, TrendingUp, Zap, Target,
} from 'lucide-react';

const SB_URL = 'https://jljwgwftuqrabfyiucfl.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impsandnd2Z0dXFyYWJmeWl1Y2ZsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNTQyOTUsImV4cCI6MjA4NzkzMDI5NX0.eOa9XYyZGEM3S0Xvl95gx1wgmrQnPSV8Wh9JDxPu07M';

const sb = (path: string) =>
  fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    cache: 'no-store',
  }).then(r => r.json());

interface Constituent { symbol: string; score?: number; stage?: string; }

interface SectorScore {
  id: string;
  date: string;
  score: number;
  stage: string;
  distance_52w_high: number | null;
  rs_score: number | null;
  atr_ratio: number | null;
  breadth_pct: number | null;
  top_constituents: Constituent[] | null;
  sector_definitions: { name: string; slug: string; id?: string } | null;
}

// Stage config keyed on exact stage strings from engine.py
const STAGE_META: Record<string, {
  label: string; short: string;
  color: string; bg: string; border: string; dot: string; glow: string;
}> = {
  'Stage 2A Early Inflection': {
    label: 'Stage 2A Early Inflection', short: '2A',
    color: 'text-emerald-300', bg: 'bg-emerald-500/15', border: 'border-emerald-500/50',
    dot: 'bg-emerald-400', glow: 'shadow-emerald-500/10',
  },
  'Stage 2B Sustained Trend': {
    label: 'Stage 2B Sustained Trend', short: '2B',
    color: 'text-sky-300', bg: 'bg-sky-500/15', border: 'border-sky-500/40',
    dot: 'bg-sky-400', glow: 'shadow-sky-500/10',
  },
  'Stage 1 Consolidation': {
    label: 'Stage 1 Consolidation', short: 'S1',
    color: 'text-amber-300', bg: 'bg-amber-500/12', border: 'border-amber-500/35',
    dot: 'bg-amber-400', glow: '',
  },
  'Avoid / Weak': {
    label: 'Avoid / Weak', short: 'AV',
    color: 'text-slate-500', bg: 'bg-slate-800/40', border: 'border-slate-700/30',
    dot: 'bg-slate-600', glow: '',
  },
};

const getStage = (stage: string) =>
  STAGE_META[stage] ?? STAGE_META['Avoid / Weak'];

type SortKey   = 'score' | 'rs_score' | 'breadth_pct' | 'distance_52w_high';
type SortDir   = 'asc' | 'desc';
type FilterKey = 'all' | 'Stage 2A Early Inflection' | 'Stage 2B Sustained Trend' | 'Stage 1 Consolidation' | 'Avoid / Weak';

function ScoreGauge({ score }: { score: number }) {
  const pct   = Math.min(score, 100);
  const color = pct >= 80 ? 'text-emerald-300' : pct >= 65 ? 'text-sky-300' : pct >= 50 ? 'text-amber-300' : 'text-slate-500';
  const bar   = pct >= 80 ? 'bg-emerald-500'   : pct >= 65 ? 'bg-sky-500'   : pct >= 50 ? 'bg-amber-500'   : 'bg-slate-700';
  return (
    <div className="flex items-center gap-2 min-w-[100px]">
      <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${bar}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-sm font-black font-mono ${color} w-8 text-right`}>{score}</span>
    </div>
  );
}

function Th({ col, label, right, active, dir, onSort }:
  { col: SortKey; label: string; right?: boolean; active: boolean; dir: SortDir; onSort: (c: SortKey) => void }) {
  return (
    <th onClick={() => onSort(col)}
      className={`px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider cursor-pointer select-none whitespace-nowrap
        ${right ? 'text-right' : 'text-left'} ${active ? 'text-white' : 'text-slate-500 hover:text-slate-300'}`}>
      <span className="inline-flex items-center gap-0.5">
        {label}{active && (dir === 'desc' ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />)}
      </span>
    </th>
  );
}

function ConstituentDrawer({ constituents }: { constituents: Constituent[] | null }) {
  const [open, setOpen] = useState(false);
  if (!constituents?.length) return <span className="text-slate-700 text-xs">—</span>;

  return (
    <div>
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors">
        <span className="flex flex-wrap gap-1">
          {constituents.slice(0, 3).map(c => (
            <span key={c.symbol} className="px-1.5 py-0.5 bg-slate-800 rounded text-[10px] text-slate-400 font-mono">
              {c.symbol.replace('.NS', '')}
            </span>
          ))}
          {constituents.length > 3 && (
            <span className="text-[10px] text-slate-600">+{constituents.length - 3}</span>
          )}
        </span>
        <ChevronRight className={`w-3 h-3 flex-shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>

      {open && (
        <div className="mt-2 ml-1 flex flex-wrap gap-1">
          {constituents.map(c => (
            <span key={c.symbol}
              className="px-2 py-0.5 bg-emerald-950/40 border border-emerald-800/30 rounded text-[10px] text-emerald-400 font-mono">
              {c.symbol.replace('.NS', '')} ↑50SMA
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SectorPulsePage() {
  const [data,     setData]     = useState<SectorScore[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [lastDate, setLastDate] = useState('');
  const [sortKey,  setSortKey]  = useState<SortKey>('score');
  const [sortDir,  setSortDir]  = useState<SortDir>('desc');
  const [filter,   setFilter]   = useState<FilterKey>('all');

  const loadData = async () => {
    setLoading(true); setError('');
    try {
      const dateRes = await sb('daily_sector_scores?select=date&order=date.desc&limit=1');
      if (!dateRes?.length) { setData([]); setLoading(false); return; }
      const latest = dateRes[0].date;
      setLastDate(latest);

      const scores: SectorScore[] = await sb(
        `daily_sector_scores?select=id,date,score,stage,distance_52w_high,rs_score,atr_ratio,breadth_pct,top_constituents,sector_definitions(name,slug)&date=eq.${latest}&order=score.desc`
      );
      setData(Array.isArray(scores) ? scores : []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const onSort = (col: SortKey) => {
    if (col === sortKey) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(col); setSortDir('desc'); }
  };

  const filtered = useMemo(() => {
    let rows = [...data];
    if (filter !== 'all') rows = rows.filter(r => r.stage === filter);
    rows.sort((a, b) => {
      const av = (a[sortKey] ?? (sortDir === 'desc' ? -999 : 999)) as number;
      const bv = (b[sortKey] ?? (sortDir === 'desc' ? -999 : 999)) as number;
      return sortDir === 'desc' ? bv - av : av - bv;
    });
    return rows;
  }, [data, filter, sortKey, sortDir]);

  // Top metrics
  const topSector    = data[0];
  const stage2aCount = data.filter(r => r.stage === 'Stage 2A Early Inflection').length;
  const stage2bCount = data.filter(r => r.stage === 'Stage 2B Sustained Trend').length;
  const avgScore     = data.length ? Math.round(data.reduce((s, r) => s + r.score, 0) / data.length) : 0;

  const fmtDate = (s: string) => new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });

  return (
    <div className="min-h-screen bg-[#070c14] text-white p-4 md:p-6">

      {/* Ambient */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/3 w-96 h-64 bg-emerald-600/6 rounded-full blur-3xl" />
        <div className="absolute top-0 right-1/4 w-72 h-48 bg-sky-600/5 rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-[1400px] mx-auto space-y-5">

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
                Minervini 100-pt Techno-Funda Matrix · Equal-Weight Sector Index · Nifty 50 Benchmark
                {lastDate && <span className="ml-2">· {fmtDate(lastDate)}</span>}
              </p>
            </div>
          </div>
          <button onClick={loadData} disabled={loading}
            className="p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors disabled:opacity-40 border border-slate-700/50">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

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
              {
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
                  <div className={`text-2xl font-black ${m.color} leading-none`}>{m.value}</div>
                  {m.sub && <div className="text-[10px] text-slate-600 mt-1">{m.sub}</div>}
                </div>
              );
            })}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 text-red-400 bg-red-950/30 border border-red-800/40 rounded-xl p-3 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && data.length === 0 && (
          <div className="text-center py-24 text-slate-600">
            <Activity className="w-12 h-12 mx-auto mb-4 opacity-20" />
            <p className="text-sm font-medium">No sector scores yet.</p>
            <p className="text-xs mt-2 text-slate-700">
              Run <code className="text-slate-600 bg-slate-900 px-1.5 py-0.5 rounded">python3 engine.py</code> on the VPS to populate.
            </p>
          </div>
        )}

        {/* Filter chips */}
        {data.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {(['all', 'Stage 2A Early Inflection', 'Stage 2B Sustained Trend', 'Stage 1 Consolidation', 'Avoid / Weak'] as const).map(f => {
              const count  = f === 'all' ? data.length : data.filter(r => r.stage === f).length;
              const meta   = f === 'all' ? null : getStage(f);
              const active = filter === f;
              return (
                <button key={f} onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all whitespace-nowrap
                    ${active
                      ? (meta ? `${meta.bg} ${meta.color} ${meta.border}` : 'bg-slate-700 text-white border-slate-500')
                      : 'bg-transparent text-slate-500 border-slate-800 hover:border-slate-600 hover:text-slate-300'
                    }`}>
                  {f === 'all' ? `All Sectors (${count})` : `${meta?.short}: ${count}`}
                </button>
              );
            })}
            <span className="ml-auto text-xs text-slate-700 self-center">Avg score: {avgScore}/100</span>
          </div>
        )}

        {/* Table */}
        {filtered.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-slate-800/60 shadow-xl">
            <table className="w-full text-sm">
              <thead className="bg-slate-900/90 border-b border-slate-800">
                <tr>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500 w-48">Sector</th>
                  <Th col="score"             label="Score"       right active={sortKey === 'score'}             dir={sortDir} onSort={onSort} />
                  <th className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">Stage</th>
                  <Th col="rs_score"          label="RS vs N50"   right active={sortKey === 'rs_score'}          dir={sortDir} onSort={onSort} />
                  <Th col="breadth_pct"       label="Breadth"     right active={sortKey === 'breadth_pct'}       dir={sortDir} onSort={onSort} />
                  <Th col="distance_52w_high" label="52W High"    right active={sortKey === 'distance_52w_high'} dir={sortDir} onSort={onSort} />
                  <th className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">ATR Status</th>
                  <th className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">Above 50 SMA</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/40">
                {filtered.map(row => {
                  const meta = getStage(row.stage);
                  const atr  = row.atr_ratio;
                  const atrLabel = atr == null ? '—' : atr < 0.60 ? '🟢 Tight VCP' : atr < 0.75 ? '🟡 Compressed' : '⚪ Normal';
                  const atrColor = atr == null ? 'text-slate-600' : atr < 0.60 ? 'text-emerald-400' : atr < 0.75 ? 'text-amber-400' : 'text-slate-500';

                  return (
                    <tr key={row.id} className={`hover:bg-slate-800/25 transition-colors ${row.score >= 80 ? 'bg-emerald-950/8' : ''}`}>

                      {/* Sector name */}
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${meta.dot}`} />
                          <span className="font-semibold text-white text-sm">{row.sector_definitions?.name ?? '—'}</span>
                        </div>
                      </td>

                      {/* Score gauge */}
                      <td className="px-3 py-3.5 w-36">
                        <ScoreGauge score={row.score} />
                      </td>

                      {/* Stage badge */}
                      <td className="px-3 py-3.5">
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border whitespace-nowrap ${meta.bg} ${meta.border} ${meta.color}`}>
                          {meta.short}: {meta.label.split(' ').slice(2).join(' ')}
                        </span>
                      </td>

                      {/* RS vs Nifty 50 */}
                      <td className={`px-3 py-3.5 text-right font-mono text-xs
                        ${row.rs_score == null ? 'text-slate-600'
                          : row.rs_score > 10  ? 'text-emerald-300 font-bold'
                          : row.rs_score > 0   ? 'text-emerald-500'
                          : row.rs_score > -5  ? 'text-red-400'
                          : 'text-red-500 font-bold'}`}>
                        {row.rs_score == null ? '—' : `${row.rs_score >= 0 ? '+' : ''}${row.rs_score.toFixed(1)}%`}
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

                      {/* ATR */}
                      <td className={`px-3 py-3.5 text-xs ${atrColor}`}>
                        <div>{atrLabel}</div>
                        {atr != null && <div className="text-[10px] text-slate-600 font-mono">{atr.toFixed(2)}</div>}
                      </td>

                      {/* Constituents above 50 SMA */}
                      <td className="px-3 py-3.5 max-w-[200px]">
                        <ConstituentDrawer constituents={row.top_constituents} />
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
          Scoring: Trend 30pt · RS 30pt · VCP 25pt · Breadth 15pt · Sources: yfinance · StockScans custom indexes
        </p>
      </div>
    </div>
  );
}

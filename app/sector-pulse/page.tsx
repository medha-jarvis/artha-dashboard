'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, RefreshCw, AlertCircle, ChevronUp, ChevronDown,
  TrendingUp, Activity, Zap, Eye, BarChart2,
} from 'lucide-react';

const SB_URL = 'https://jljwgwftuqrabfyiucfl.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impsandnd2Z0dXFyYWJmeWl1Y2ZsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNTQyOTUsImV4cCI6MjA4NzkzMDI5NX0.eOa9XYyZGEM3S0Xvl95gx1wgmrQnPSV8Wh9JDxPu07M';

const sb = (path: string) =>
  fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    cache: 'no-store',
  }).then(r => r.json());

interface SectorScore {
  id: string;
  date: string;
  score: number;
  stage: string;
  distance_52w_high: number | null;
  rs_score: number | null;
  atr_ratio: number | null;
  breadth_pct: number | null;
  top_constituents: { symbol: string; score: number; stage: string }[] | null;
  sector_definitions: { name: string; slug: string } | null;
}

interface HistRow { date: string; score: number; stage: string; }

const STAGE_META: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  STAGE2_BREAKOUT: { label: 'Breakout',    color: 'text-emerald-300', bg: 'bg-emerald-500/20 border-emerald-500/40', dot: 'bg-emerald-400' },
  STAGE2_EARLY:    { label: 'Early Stage', color: 'text-sky-300',     bg: 'bg-sky-500/20 border-sky-500/40',         dot: 'bg-sky-400' },
  STAGE2_WATCH:    { label: 'Watch',       color: 'text-amber-300',   bg: 'bg-amber-500/20 border-amber-500/40',     dot: 'bg-amber-400' },
  BELOW_STAGE2:    { label: 'Below Stage', color: 'text-slate-500',   bg: 'bg-slate-800/40 border-slate-700/30',     dot: 'bg-slate-600' },
};

type SortKey = 'score' | 'rs_score' | 'breadth_pct' | 'distance_52w_high';
type SortDir = 'asc' | 'desc';
type FilterMode = 'all' | 'STAGE2_BREAKOUT' | 'STAGE2_EARLY' | 'STAGE2_WATCH' | 'BELOW_STAGE2';

function ScoreBar({ score }: { score: number }) {
  const pct = Math.min(score, 100);
  const color = pct >= 80 ? 'bg-emerald-500' : pct >= 65 ? 'bg-sky-500' : pct >= 50 ? 'bg-amber-500' : 'bg-slate-600';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono font-bold text-white w-7 text-right">{score}</span>
    </div>
  );
}

function MiniSparkline({ history }: { history: HistRow[] }) {
  if (!history || history.length < 2) return null;
  const scores = history.slice(-10).map(h => h.score);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min || 1;
  const W = 60, H = 20;
  const pts = scores.map((s, i) => {
    const x = (i / (scores.length - 1)) * W;
    const y = H - ((s - min) / range) * H;
    return `${x},${y}`;
  }).join(' ');
  const last = scores[scores.length - 1];
  const prev = scores[scores.length - 2];
  const color = last >= prev ? '#10b981' : '#ef4444';
  return (
    <svg width={W} height={H} className="opacity-70">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
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

export default function SectorPulsePage() {
  const [data, setData]       = useState<SectorScore[]>([]);
  const [history, setHistory] = useState<Record<string, HistRow[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [lastDate, setLastDate] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [filter, setFilter]   = useState<FilterMode>('all');

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      // Get most recent date
      const dateRes = await sb('daily_sector_scores?select=date&order=date.desc&limit=1');
      if (!dateRes?.length) { setData([]); setLoading(false); return; }
      const latest = dateRes[0].date;
      setLastDate(latest);

      const scores: SectorScore[] = await sb(
        `daily_sector_scores?select=id,date,score,stage,distance_52w_high,rs_score,atr_ratio,breadth_pct,top_constituents,sector_definitions(name,slug)&date=eq.${latest}&order=score.desc`
      );
      setData(scores || []);

      // Load 30-day history per sector
      const hist30: Record<string, HistRow[]> = {};
      await Promise.all((scores || []).map(async (s) => {
        const sid = s.id; // actually sector_id needed — use slug as key
        const slug = s.sector_definitions?.slug || '';
        const h = await sb(
          `daily_sector_scores?select=date,score,stage&sector_id=eq.${sid.split('-')[0]}&order=date.asc&limit=30`
        ).catch(() => []);
        hist30[slug] = h || [];
      }));
      setHistory(hist30);
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
      const av = a[sortKey] ?? -999;
      const bv = b[sortKey] ?? -999;
      return sortDir === 'desc' ? (bv as number) - (av as number) : (av as number) - (bv as number);
    });
    return rows;
  }, [data, filter, sortKey, sortDir]);

  const stageCounts = useMemo(() => {
    const c: Record<string, number> = {};
    data.forEach(r => { c[r.stage] = (c[r.stage] || 0) + 1; });
    return c;
  }, [data]);

  const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
  const fmtPct  = (v: number | null) => v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-slate-500 hover:text-slate-300 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-lg font-bold text-white flex items-center gap-2">
              <Activity className="w-5 h-5 text-emerald-400" />
              Sector Pulse
            </h1>
            <p className="text-xs text-slate-500">
              Minervini Stage 2 · 100-pt Techno-Funda Score
              {lastDate && <span className="ml-2 text-slate-600">as of {fmtDate(lastDate)}</span>}
            </p>
          </div>
        </div>
        <button onClick={loadData} disabled={loading}
          className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors disabled:opacity-40">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Summary chips */}
      <div className="flex flex-wrap gap-2 mb-6">
        {(['all', 'STAGE2_BREAKOUT', 'STAGE2_EARLY', 'STAGE2_WATCH', 'BELOW_STAGE2'] as const).map(f => {
          const count = f === 'all' ? data.length : stageCounts[f] || 0;
          const meta  = f === 'all' ? null : STAGE_META[f];
          const active = filter === f;
          return (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all
                ${active
                  ? (meta ? `${meta.bg} ${meta.color} border-current` : 'bg-slate-700 text-white border-slate-500')
                  : 'bg-slate-900 text-slate-500 border-slate-800 hover:border-slate-600 hover:text-slate-300'
                }`}>
              {f === 'all' ? `All (${count})` : `${meta?.label} (${count})`}
            </button>
          );
        })}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 text-red-400 bg-red-950/30 border border-red-800/40 rounded-lg p-3 mb-4 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
        </div>
      )}

      {/* No data state */}
      {!loading && !error && data.length === 0 && (
        <div className="text-center py-20 text-slate-600">
          <BarChart2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No sector scores yet.</p>
          <p className="text-xs mt-1">Run <code className="text-slate-500">python run.py</code> on the VPS to populate data.</p>
        </div>
      )}

      {/* Table */}
      {filtered.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-900/80 border-b border-slate-800">
              <tr>
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">Sector</th>
                <Th col="score"            label="Score"       right active={sortKey==='score'}            dir={sortDir} onSort={onSort} />
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">Stage</th>
                <Th col="rs_score"         label="RS"          right active={sortKey==='rs_score'}         dir={sortDir} onSort={onSort} />
                <Th col="breadth_pct"      label="Breadth"     right active={sortKey==='breadth_pct'}      dir={sortDir} onSort={onSort} />
                <Th col="distance_52w_high" label="52W High"   right active={sortKey==='distance_52w_high'} dir={sortDir} onSort={onSort} />
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">Top Stocks</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">Trend</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filtered.map((row) => {
                const meta = STAGE_META[row.stage] || STAGE_META['BELOW_STAGE2'];
                const slug = row.sector_definitions?.slug || '';
                const hist = history[slug] || [];
                const tops = row.top_constituents || [];
                return (
                  <tr key={row.id} className="hover:bg-slate-800/30 transition-colors">
                    {/* Sector name */}
                    <td className="px-3 py-3 font-medium text-white whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${meta.dot}`} />
                        {row.sector_definitions?.name || '—'}
                      </div>
                    </td>
                    {/* Score bar */}
                    <td className="px-3 py-3 w-28">
                      <ScoreBar score={row.score} />
                    </td>
                    {/* Stage badge */}
                    <td className="px-3 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${meta.bg} ${meta.color}`}>
                        {meta.label}
                      </span>
                    </td>
                    {/* RS */}
                    <td className={`px-3 py-3 text-right font-mono text-xs
                      ${row.rs_score == null ? 'text-slate-600'
                        : row.rs_score > 10 ? 'text-emerald-400 font-bold'
                        : row.rs_score > 0  ? 'text-emerald-500'
                        : 'text-red-400'}`}>
                      {row.rs_score == null ? '—' : `${row.rs_score >= 0 ? '+' : ''}${row.rs_score.toFixed(1)}`}
                    </td>
                    {/* Breadth */}
                    <td className={`px-3 py-3 text-right font-mono text-xs
                      ${row.breadth_pct == null ? 'text-slate-600'
                        : row.breadth_pct >= 70 ? 'text-emerald-400'
                        : row.breadth_pct >= 50 ? 'text-amber-400'
                        : 'text-red-400'}`}>
                      {row.breadth_pct == null ? '—' : `${row.breadth_pct.toFixed(0)}%`}
                    </td>
                    {/* 52W High dist */}
                    <td className={`px-3 py-3 text-right font-mono text-xs
                      ${row.distance_52w_high == null ? 'text-slate-600'
                        : row.distance_52w_high >= -5 ? 'text-emerald-400'
                        : row.distance_52w_high >= -15 ? 'text-amber-400'
                        : 'text-slate-500'}`}>
                      {fmtPct(row.distance_52w_high)}
                    </td>
                    {/* Top constituents */}
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        {tops.slice(0, 3).map(t => (
                          <span key={t.symbol}
                            className="px-1.5 py-0.5 bg-slate-800 rounded text-[10px] text-slate-400 font-mono">
                            {t.symbol.replace('.NS', '')}
                          </span>
                        ))}
                      </div>
                    </td>
                    {/* Sparkline */}
                    <td className="px-3 py-3">
                      <MiniSparkline history={hist} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer note */}
      <p className="mt-4 text-xs text-slate-700 text-center">
        Scores updated daily via VPS cron · Equal-weighted sector index · Sources: yfinance + StockScans
      </p>
    </div>
  );
}

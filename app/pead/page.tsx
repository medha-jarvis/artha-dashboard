'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Zap, RefreshCw, TrendingUp, TrendingDown, ChevronUp, ChevronDown, AlertCircle } from 'lucide-react';

// ── Supabase REST (anon key — public, safe to expose) ─────────────────────────
const SB_URL = 'https://jljwgwftuqrabfyiucfl.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impsandnd2Z0dXFyYWJmeWl1Y2ZsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNTQyOTUsImV4cCI6MjA4NzkzMDI5NX0.eOa9XYyZGEM3S0Xvl95gx1wgmrQnPSV8Wh9JDxPu07M';

const sb = (path: string) =>
  fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    cache: 'no-store',
  }).then(r => r.json());

// ── Types ─────────────────────────────────────────────────────────────────────
interface Signal {
  id: string;
  ticker: string;
  company_name: string | null;
  sector: string | null;
  signal_date: string;
  pead_score: number;
  yoy_profit_pct: number | null;
  yoy_revenue_pct: number | null;
  opm_expansion_bps: number | null;
  price_vs_ema200_pct: number | null;
  volume_multiplier: number | null;
  day_gap_pct: number | null;
  ttm_pe: number | null;
  trigger_path: 'A' | 'WATCH' | 'NONE';
  // Joined from drift_performance:
  returns_since_result?: number | null;
  daily_return?: number | null;
  t_1_return?: number | null;
  t_5_return?: number | null;
  t_20_return?: number | null;
  drift_updated_at?: string | null;
}

type SortCol = 'pead_score' | 'signal_date' | 'ttm_pe' | 'returns_since_result' | 'daily_return';
type SortDir = 'asc' | 'desc';
type DateRange = 'week' | 'prev_week' | 'month';
type ScoreFilter = 'all' | '50' | '70';

// ── Formatters ────────────────────────────────────────────────────────────────
const pct   = (v: number | null | undefined, dec = 2) =>
  v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(dec)}%`;
const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

const retColor = (v: number | null | undefined) =>
  v == null ? 'text-slate-500' :
  v >  10   ? 'text-emerald-400 font-bold' :
  v >   0   ? 'text-emerald-300' :
  v > -10   ? 'text-red-400' : 'text-red-500 font-bold';

const scoreColor = (s: number) =>
  s >= 70 ? 'text-emerald-400' :
  s >= 50 ? 'text-amber-400'  : 'text-slate-400';

const scoreBg = (s: number) =>
  s >= 70 ? 'bg-emerald-500/15 border border-emerald-500/30' :
  s >= 50 ? 'bg-amber-500/10 border border-amber-500/30'    : '';

const rowHighlight = (s: number) =>
  s >= 70 ? 'hover:bg-emerald-950/40' :
  s >= 50 ? 'hover:bg-amber-950/30'   : 'hover:bg-slate-800/30';

const pathBadge = (p: string) =>
  p === 'A'     ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
  p === 'WATCH' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                  'bg-slate-700/50 text-slate-500';

// ── Score Breakdown Tooltip ───────────────────────────────────────────────────
function ScoreBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="mb-1.5">
      <div className="flex justify-between text-[10px] mb-0.5">
        <span className="text-slate-400">{label}</span>
        <span className={color}>{value}/{max}</span>
      </div>
      <div className="h-1 bg-slate-700 rounded-full">
        <div className={`h-1 rounded-full ${color.includes('emerald') ? 'bg-emerald-500' : color.includes('amber') ? 'bg-amber-500' : 'bg-blue-500'}`}
          style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function ScoreTooltip({ sig }: { sig: Signal }) {
  const profitPts = sig.yoy_profit_pct == null ? 0 :
    sig.yoy_profit_pct > 100 ? 20 : sig.yoy_profit_pct > 50 ? 15 :
    sig.yoy_profit_pct > 30  ? 10 : sig.yoy_profit_pct > 0  ?  5 : 0;
  const revPts = sig.yoy_revenue_pct == null ? 0 :
    sig.yoy_revenue_pct > 25 ? 10 : sig.yoy_revenue_pct > 15 ? 5 : 0;
  const opmPts = sig.opm_expansion_bps == null ? 0 :
    sig.opm_expansion_bps > 300 ? 15 : sig.opm_expansion_bps > 200 ? 10 :
    sig.opm_expansion_bps > 100 ?  5 : 0;
  const emaPts = (sig.price_vs_ema200_pct ?? 0) > 0 ? 20 : 0;
  const volPts = sig.volume_multiplier == null ? 0 :
    sig.volume_multiplier > 5 ? 20 : sig.volume_multiplier > 3 ? 15 :
    sig.volume_multiplier > 2 ? 10 : sig.volume_multiplier > 1.5 ? 5 : 0;
  const gapPts = sig.day_gap_pct == null ? 0 :
    sig.day_gap_pct > 4 ? 15 : sig.day_gap_pct > 2 ? 8 : sig.day_gap_pct > 0 ? 3 : 0;

  return (
    <div className="w-48 bg-slate-900 border border-slate-700 rounded-xl p-3 shadow-2xl">
      <div className="text-xs font-bold text-white mb-2">Score Breakdown</div>
      <ScoreBar label={`Net Profit YoY ${sig.yoy_profit_pct != null ? pct(sig.yoy_profit_pct,1) : '—'}`}  value={profitPts} max={20} color="text-emerald-400" />
      <ScoreBar label={`Revenue YoY ${sig.yoy_revenue_pct != null ? pct(sig.yoy_revenue_pct,1) : '—'}`}    value={revPts}    max={10} color="text-blue-400" />
      <ScoreBar label={`OPM Exp ${sig.opm_expansion_bps != null ? `${sig.opm_expansion_bps.toFixed(0)}bps` : '—'}`} value={opmPts} max={15} color="text-violet-400" />
      <ScoreBar label={`vs EMA200 ${sig.price_vs_ema200_pct != null ? pct(sig.price_vs_ema200_pct,1) : '—'}`} value={emaPts} max={20} color="text-amber-400" />
      <ScoreBar label={`Volume ${sig.volume_multiplier != null ? `${sig.volume_multiplier.toFixed(1)}x` : '—'}`} value={volPts} max={20} color="text-emerald-400" />
      <ScoreBar label={`Day Gap ${sig.day_gap_pct != null ? pct(sig.day_gap_pct,1) : '—'}`} value={gapPts} max={15} color="text-amber-400" />
    </div>
  );
}

// ── Sort header ───────────────────────────────────────────────────────────────
function Th({ col, label, right, sortCol, sortDir, onSort }:
  { col: SortCol; label: string; right?: boolean; sortCol: SortCol; sortDir: SortDir; onSort: (c: SortCol) => void }) {
  const active = sortCol === col;
  return (
    <th
      onClick={() => onSort(col)}
      className={`px-3 py-3 text-[11px] font-semibold uppercase tracking-wider cursor-pointer select-none whitespace-nowrap
        ${right ? 'text-right' : 'text-left'}
        ${active ? 'text-white' : 'text-slate-500 hover:text-slate-300'}`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active ? (sortDir === 'desc' ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />) : null}
      </span>
    </th>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function PEADPage() {
  const [signals,    setSignals]    = useState<Signal[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [triggering, setTriggering] = useState(false);
  const [trigMsg,    setTrigMsg]    = useState('');
  const [sortCol,    setSortCol]    = useState<SortCol>('pead_score');
  const [sortDir,    setSortDir]    = useState<SortDir>('desc');
  const [range,      setRange]      = useState<DateRange>('week');
  const [scoreFilter,setScoreFilter]= useState<ScoreFilter>('all');
  const [hoverScore, setHoverScore] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true); setError('');
    try {
      const [rawSigs, rawDrift] = await Promise.all([
        sb('pead_signals?select=*&order=pead_score.desc&limit=500'),
        sb('drift_performance?select=*'),
      ]);
      if (!Array.isArray(rawSigs)) throw new Error('Bad response');

      const driftMap: Record<string, Record<string, unknown>> = {};
      (rawDrift || []).forEach((d: Record<string, unknown>) => {
        if (typeof d.signal_id === 'string') driftMap[d.signal_id] = d;
      });

      const joined: Signal[] = rawSigs.map((s: Signal) => ({
        ...s,
        returns_since_result: (driftMap[s.id]?.returns_since_result as number) ?? null,
        daily_return:         (driftMap[s.id]?.daily_return as number) ?? null,
        t_1_return:           (driftMap[s.id]?.t_1_return as number) ?? null,
        t_5_return:           (driftMap[s.id]?.t_5_return as number) ?? null,
        t_20_return:          (driftMap[s.id]?.t_20_return as number) ?? null,
        drift_updated_at:     (driftMap[s.id]?.updated_at as string) ?? null,
      }));
      setSignals(joined);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const runEngine = async (script: 'pead_engine' | 'drift_tracker' | 'backfill') => {
    setTriggering(true); setTrigMsg('');
    try {
      const r = await fetch('/api/proxy/pead/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script }),
      });
      const d = await r.json();
      setTrigMsg(d.ok
        ? `✓ ${script === 'backfill' ? 'Backfill' : script === 'drift_tracker' ? 'Drift tracker' : 'Engine'} dispatched — check back in 5 min`
        : `✗ ${d.error || 'Trigger failed'}`);
    } catch (e: unknown) {
      setTrigMsg(`✗ ${e instanceof Error ? e.message : 'Network error'}`);
    } finally {
      setTriggering(false);
    }
  };

  // ── Date range filter ────────────────────────────────────────────────────────
  const today = new Date();
  const dateFiltered = useMemo(() => {
    const now = new Date();
    const cutoff = new Date(now);
    const prevStart = new Date(now);

    if (range === 'week') {
      cutoff.setDate(cutoff.getDate() - 7);
      return signals.filter(s => new Date(s.signal_date) >= cutoff);
    } else if (range === 'prev_week') {
      cutoff.setDate(cutoff.getDate() - 14);
      prevStart.setDate(prevStart.getDate() - 7);
      return signals.filter(s => {
        const d = new Date(s.signal_date);
        return d >= cutoff && d < prevStart;
      });
    } else {
      cutoff.setDate(cutoff.getDate() - 30);
      return signals.filter(s => new Date(s.signal_date) >= cutoff);
    }
  }, [signals, range]);

  // ── Score filter ─────────────────────────────────────────────────────────────
  const scoreFiltered = useMemo(() => {
    if (scoreFilter === '70') return dateFiltered.filter(s => s.pead_score >= 70);
    if (scoreFilter === '50') return dateFiltered.filter(s => s.pead_score >= 50);
    return dateFiltered;
  }, [dateFiltered, scoreFilter]);

  // ── Sort ─────────────────────────────────────────────────────────────────────
  const sorted = useMemo(() => {
    return [...scoreFiltered].sort((a, b) => {
      const dir = sortDir === 'desc' ? -1 : 1;
      const va = (a[sortCol] as number | null) ?? (sortDir === 'desc' ? -Infinity : Infinity);
      const vb = (b[sortCol] as number | null) ?? (sortDir === 'desc' ? -Infinity : Infinity);
      if (sortCol === 'signal_date') return dir * a.signal_date.localeCompare(b.signal_date);
      return dir * ((va as number) - (vb as number));
    });
  }, [scoreFiltered, sortCol, sortDir]);

  const handleSort = (col: SortCol) => {
    if (sortCol === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortCol(col); setSortDir('desc'); }
  };

  // ── Stats ─────────────────────────────────────────────────────────────────────
  const pathACount  = scoreFiltered.filter(s => s.trigger_path === 'A').length;
  const watchCount  = scoreFiltered.filter(s => s.trigger_path === 'WATCH').length;
  const avgScore    = scoreFiltered.length
    ? Math.round(scoreFiltered.reduce((a, s) => a + s.pead_score, 0) / scoreFiltered.length) : 0;
  const avgReturn   = (() => {
    const vals = scoreFiltered.map(s => s.returns_since_result).filter((v): v is number => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  })();

  return (
    <div className="min-h-screen bg-slate-950 p-3 md:p-5">
      <div className="max-w-7xl mx-auto space-y-4">

        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Link href="/" className="text-slate-500 hover:text-slate-300 transition"><ArrowLeft className="w-4 h-4" /></Link>
              <h1 className="text-xl font-black text-white flex items-center gap-2">
                <Zap className="w-5 h-5 text-amber-400" />PEAD Candidates Dashboard
              </h1>
            </div>
            <p className="text-xs text-slate-500 ml-6">All earnings scored 0–100 · Path A ≥70 · WATCH 50–69 · Sorted by PEAD Score</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => runEngine('pead_engine')} disabled={triggering}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded text-xs font-semibold disabled:opacity-50 transition">
              <Zap className={`w-3.5 h-3.5 ${triggering ? 'animate-pulse' : ''}`} />
              {triggering ? 'Dispatching…' : 'Run Engine'}
            </button>
            <button onClick={() => runEngine('drift_tracker')} disabled={triggering}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white rounded text-xs font-medium disabled:opacity-50 transition">
              <RefreshCw className="w-3.5 h-3.5" />Refresh Returns
            </button>
            <button onClick={loadData} disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded text-xs font-medium disabled:opacity-50 transition">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh Data
            </button>
          </div>
        </div>

        {/* Trigger toast */}
        {trigMsg && (
          <div className={`text-xs px-4 py-2.5 rounded-lg border ${trigMsg.startsWith('✓') ? 'bg-emerald-900/30 border-emerald-700/40 text-emerald-300' : 'bg-red-900/30 border-red-700/40 text-red-300'}`}>
            {trigMsg}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 bg-red-900/30 border border-red-700/40 rounded-xl p-3 text-red-300 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0" />{error}
          </div>
        )}

        {/* Stats bar */}
        {signals.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: 'In View',    v: scoreFiltered.length.toString(),       accent: 'text-white' },
              { label: 'Path A (≥70)', v: pathACount.toString(),               accent: 'text-emerald-400' },
              { label: 'WATCH (≥50)', v: watchCount.toString(),                accent: 'text-amber-400' },
              { label: 'Avg Score',  v: avgScore.toString(),                   accent: scoreColor(avgScore) },
              { label: 'Avg Return', v: pct(avgReturn),                        accent: retColor(avgReturn) },
            ].map(s => (
              <div key={s.label} className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-center">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">{s.label}</div>
                <div className={`text-lg font-black ${s.accent}`}>{s.v}</div>
              </div>
            ))}
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Date range */}
          <div className="flex gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1">
            {([['week', 'This Week'], ['prev_week', 'Last Week'], ['month', 'Last Month']] as [DateRange, string][]).map(([v, l]) => (
              <button key={v} onClick={() => setRange(v)}
                className={`px-3 py-1 text-xs rounded font-medium transition ${range === v ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}>
                {l}
              </button>
            ))}
          </div>
          {/* Score filter */}
          <div className="flex gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1">
            {([['all', 'All'], ['50', 'Score ≥50'], ['70', 'Score ≥70']] as [ScoreFilter, string][]).map(([v, l]) => (
              <button key={v} onClick={() => setScoreFilter(v)}
                className={`px-3 py-1 text-xs rounded font-medium transition ${scoreFilter === v ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white'}`}>
                {l}
              </button>
            ))}
          </div>
          <span className="text-slate-600 text-xs">{sorted.length} companies</span>
        </div>

        {/* Table */}
        {loading ? (
          <div className="text-center py-20 text-slate-500 text-sm">Loading signals…</div>
        ) : sorted.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-16 text-center">
            <Zap className="w-8 h-8 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400 font-semibold">No signals in this range</p>
            <p className="text-slate-600 text-xs mt-1">Click "Run Engine" to trigger a scan, or "Backfill" for historical data</p>
            <button onClick={() => runEngine('backfill')} disabled={triggering}
              className="mt-4 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-xs font-medium disabled:opacity-50 transition">
              ↺ Backfill Last 7 Days
            </button>
          </div>
        ) : (
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: 'min(680px, calc(100vh - 280px))' }}>
              <table className="w-full text-xs border-collapse" style={{ minWidth: '900px' }}>
                <thead className="sticky top-0 z-20">
                  <tr className="border-b-2 border-slate-700 bg-slate-900">
                    <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 bg-slate-900 whitespace-nowrap sticky left-0 z-30">
                      Company
                    </th>
                    <Th col="pead_score"           label="PEAD Score"    sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                    <Th col="signal_date"           label="Result Date"   sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                    <Th col="ttm_pe"                label="TTM PE"  right sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                    <Th col="returns_since_result"  label="Returns %"right sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                    <Th col="daily_return"          label="Daily Ret %"right sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                    <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 bg-slate-900 whitespace-nowrap">Path</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(sig => (
                    <tr key={sig.id}
                      className={`border-b border-slate-800/60 transition-colors ${rowHighlight(sig.pead_score)} ${sig.pead_score >= 70 ? 'bg-emerald-950/10' : sig.pead_score >= 50 ? 'bg-amber-950/5' : ''}`}>

                      {/* Company */}
                      <td className="px-3 py-2.5 sticky left-0 bg-slate-900 z-10 whitespace-nowrap">
                        <div className="font-bold text-white text-sm">{sig.ticker.replace('.NS','')}</div>
                        <div className="text-slate-500 text-[10px] truncate max-w-[160px]">{sig.company_name || sig.sector || '—'}</div>
                      </td>

                      {/* PEAD Score with breakdown tooltip */}
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <div className="relative inline-block"
                          onMouseEnter={() => setHoverScore(sig.id)}
                          onMouseLeave={() => setHoverScore(null)}>
                          <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg ${scoreBg(sig.pead_score)}`}>
                            <span className={`text-base font-black ${scoreColor(sig.pead_score)}`}>{sig.pead_score}</span>
                          </div>
                          {hoverScore === sig.id && (
                            <div className="absolute left-0 top-8 z-50">
                              <ScoreTooltip sig={sig} />
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Result Date */}
                      <td className="px-3 py-2.5 text-slate-400 whitespace-nowrap">{fmtDate(sig.signal_date)}</td>

                      {/* TTM PE */}
                      <td className={`px-3 py-2.5 text-right whitespace-nowrap ${sig.ttm_pe && sig.ttm_pe > 60 ? 'text-amber-400' : 'text-slate-300'}`}>
                        {sig.ttm_pe ? sig.ttm_pe.toFixed(1) : '—'}
                      </td>

                      {/* Returns since result */}
                      <td className={`px-3 py-2.5 text-right whitespace-nowrap font-semibold ${retColor(sig.returns_since_result)}`}>
                        <div className="flex items-center justify-end gap-1">
                          {sig.returns_since_result != null && (
                            sig.returns_since_result >= 0
                              ? <TrendingUp className="w-3 h-3" />
                              : <TrendingDown className="w-3 h-3" />
                          )}
                          {pct(sig.returns_since_result)}
                        </div>
                      </td>

                      {/* Daily Return */}
                      <td className={`px-3 py-2.5 text-right whitespace-nowrap ${retColor(sig.daily_return)}`}>
                        {pct(sig.daily_return)}
                      </td>

                      {/* Path badge */}
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${pathBadge(sig.trigger_path)}`}>
                          {sig.trigger_path}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Table footer */}
            <div className="px-4 py-2 border-t border-slate-800 flex items-center justify-between text-[10px] text-slate-600">
              <span>{sorted.length} of {signals.length} signals · Hover score for breakdown</span>
              <span>Returns updated daily at 4:15 PM IST</span>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

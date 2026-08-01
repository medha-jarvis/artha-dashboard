'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, RefreshCw, AlertCircle, ChevronUp, ChevronDown, Layers, ExternalLink } from 'lucide-react';

// ── Supabase REST ─────────────────────────────────────────────────────────────
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
  stage2_score: number;
  days_in_stage2: number | null;
  ema150_distance_pct: number | null;
  volume_multiplier: number | null;
  rs_trend: string | null;
  ttm_eps_growth: number | null;
  roce: number | null;
  tier: 'CONFIRMED' | 'EMERGING' | 'NONE';
  is_pead_confluence: boolean;
  is_smart_money_divergence: boolean;
  returns_since_breakout?: number | null;
  daily_return?: number | null;
  t_5_return?: number | null;
  t_20_return?: number | null;
  t_60_return?: number | null;
}

type SortKey = 'stage2_score' | 'days_in_stage2' | 'ema150_distance_pct' | 'volume_multiplier' | 'returns_since_breakout' | 'daily_return' | 'signal_date';
type SortDir = 'asc' | 'desc';
type FilterMode = 'all' | 'high_conviction' | 'emerging' | 'pead_confluence' | 'fresh';
type DateRange  = 'week' | 'month' | 'quarter';

// ── Formatters ────────────────────────────────────────────────────────────────
const fmtPct = (v: number | null | undefined, dec = 1) =>
  v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(dec)}%`;
const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

const retCls = (v: number | null | undefined) =>
  v == null ? 'text-slate-500' :
  v >  15   ? 'text-emerald-300 font-bold' :
  v >   0   ? 'text-emerald-400' :
  v > -10   ? 'text-red-400' : 'text-red-500 font-bold';

// ── Freshness display ──────────────────────────────────────────────────────────
function FreshnessCell({ days }: { days: number | null }) {
  if (days == null) return <span className="text-slate-600">—</span>;
  if (days <= 15) return (
    <div>
      <span className="text-emerald-400 font-bold">🟢 {days}d</span>
      <div className="text-[9px] text-emerald-600">Golden Window</div>
    </div>
  );
  if (days <= 45) return (
    <div>
      <span className="text-amber-400 font-semibold">🟡 {days}d</span>
      <div className="text-[9px] text-amber-600">Established</div>
    </div>
  );
  return (
    <div>
      <span className="text-slate-400">{days}d</span>
      <div className="text-[9px] text-slate-600">Extended</div>
    </div>
  );
}

// ── EMA proximity display ──────────────────────────────────────────────────────
function EMACell({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-slate-600">—</span>;
  if (pct <= 10) return <span className="text-emerald-400 font-semibold">🟢 +{pct.toFixed(1)}%</span>;
  if (pct <= 15) return <span className="text-amber-400 font-medium">🟡 +{pct.toFixed(1)}%</span>;
  return <span className="text-red-400">🔴 +{pct.toFixed(1)}%</span>;
}

// ── RS Trend display ───────────────────────────────────────────────────────────
function RSCell({ rs }: { rs: string | null }) {
  if (!rs || rs === 'Flat')     return <span className="text-slate-400">→ Neutral</span>;
  if (rs === 'Positive')        return <span className="text-emerald-400 font-medium">📈 Outperforming</span>;
  return                               <span className="text-red-400">📉 Underperforming</span>;
}

// ── SOIC Fundamentals display ──────────────────────────────────────────────────
function SOICCell({ eps, roce }: { eps: number | null; roce: number | null }) {
  if (!eps && !roce) return <span className="text-slate-600">—</span>;
  return (
    <div className="text-xs space-y-0.5">
      {eps != null && (
        <div className={`font-medium ${eps > 20 ? 'text-emerald-400' : eps > 0 ? 'text-emerald-300' : 'text-red-400'}`}>
          EPS {eps >= 0 ? '+' : ''}{eps.toFixed(1)}%
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

// ── Sortable header ────────────────────────────────────────────────────────────
function Th({ col, label, right, active, dir, onSort }:
  { col: SortKey; label: string; right?: boolean; active: boolean; dir: SortDir; onSort: (c: SortKey) => void }) {
  return (
    <th onClick={() => onSort(col)}
      className={`px-2.5 py-3 text-[10px] font-semibold uppercase tracking-wider cursor-pointer select-none whitespace-nowrap
        ${right ? 'text-right' : 'text-left'}
        ${active ? 'text-white' : 'text-slate-500 hover:text-slate-300'}`}>
      <span className="inline-flex items-center gap-0.5">
        {label}
        {active && (dir === 'desc' ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />)}
      </span>
    </th>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
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
        sb('stage2_performance?select=signal_id,returns_since_breakout,daily_return,t_5_return,t_20_return,t_60_return'),
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
        t_60_return:            (pm[s.id]?.t_60_return as number) ?? null,
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
      const endpoint = script === 'backfill_stage2' ? '/api/stage2-trigger' : '/api/stage2-trigger';
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script: script === 'backfill_stage2' ? 'backfill_stage2' : script }),
      });
      const d = await r.json();
      const label = script === 'stage2_tracker' ? 'Return tracker' :
                    script === 'backfill_stage2' ? 'Backfill (7 days)' : 'Stage 2 scan';
      setTrigMsg(d.ok ? `✓ ${label} dispatched — takes 20–30 min` : `✗ ${d.error}`);
    } catch { setTrigMsg('✗ Network error'); }
    finally { setTriggering(null); }
  };

  // Date filter
  const dateFiltered = useMemo(() => {
    const now  = new Date();
    const days = dateRange === 'week' ? 7 : dateRange === 'month' ? 30 : 90;
    const cutoff = new Date(now); cutoff.setDate(cutoff.getDate() - days);
    return signals.filter(s => new Date(s.signal_date) >= cutoff);
  }, [signals, dateRange]);

  // Mode filter
  const modeFiltered = useMemo(() => {
    switch (filter) {
      case 'high_conviction':  return dateFiltered.filter(s => s.stage2_score >= 75);
      case 'emerging':         return dateFiltered.filter(s => s.stage2_score >= 55 && s.stage2_score < 75);
      case 'pead_confluence':  return dateFiltered.filter(s => s.is_pead_confluence);
      case 'fresh':            return dateFiltered.filter(s => (s.days_in_stage2 ?? 99) <= 15);
      default:                 return dateFiltered;
    }
  }, [dateFiltered, filter]);

  // Sort
  const sorted = useMemo(() => {
    return [...modeFiltered].sort((a, b) => {
      const d = sortDir === 'desc' ? -1 : 1;
      const va = (a[sortKey] as number | null) ?? (sortDir === 'desc' ? -Infinity : Infinity);
      const vb = (b[sortKey] as number | null) ?? (sortDir === 'desc' ? -Infinity : Infinity);
      if (sortKey === 'signal_date') return d * a.signal_date.localeCompare(b.signal_date);
      return d * ((va as number) - (vb as number));
    });
  }, [modeFiltered, sortKey, sortDir]);

  const onSort = (col: SortKey) => {
    if (sortKey === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(col); setSortDir('desc'); }
  };

  // Stats
  const confirmed    = dateFiltered.filter(s => s.stage2_score >= 75).length;
  const emerging     = dateFiltered.filter(s => s.stage2_score >= 55 && s.stage2_score < 75).length;
  const triplePlay   = dateFiltered.filter(s => s.is_pead_confluence).length;
  const fresh        = dateFiltered.filter(s => (s.days_in_stage2 ?? 99) <= 15).length;
  const smartMoney   = dateFiltered.filter(s => s.is_smart_money_divergence).length;
  const avgReturn    = (() => {
    const v = dateFiltered.map(s => s.returns_since_breakout).filter((v): v is number => v != null);
    return v.length ? v.reduce((a,b)=>a+b,0)/v.length : null;
  })();

  return (
    <div className="min-h-screen bg-[#0d1117] p-3 md:p-5">
      <div className="max-w-[1800px] mx-auto space-y-4">

        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Link href="/" className="text-slate-500 hover:text-slate-300"><ArrowLeft className="w-4 h-4" /></Link>
              <Layers className="w-5 h-5 text-blue-400" />
              <h1 className="text-lg font-black text-white">Early Stage 2 Intelligence Hub</h1>
            </div>
            <p className="text-xs text-slate-500 ml-11">
              Weinstein · Minervini · SOIC — 0–100 structural breakout score · NSE liquid universe · 5 PM IST daily
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => dispatch('stage2_engine')} disabled={!!triggering}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-semibold disabled:opacity-50 transition">
              <Layers className={`w-3.5 h-3.5 ${triggering === 'stage2_engine' ? 'animate-pulse' : ''}`} />
              ⚡ Run Stage 2 Scan
            </button>
            <button onClick={() => dispatch('stage2_tracker')} disabled={!!triggering}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded text-xs font-medium disabled:opacity-50 transition">
              <RefreshCw className={`w-3.5 h-3.5 ${triggering === 'stage2_tracker' ? 'animate-spin' : ''}`} />
              ↺ Refresh Returns
            </button>
            <button onClick={() => dispatch('backfill_stage2')} disabled={!!triggering}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs font-medium disabled:opacity-50 transition">
              ⏮️ Seed 7 Days
            </button>
            <button onClick={loadData} disabled={loading}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-400 rounded text-xs disabled:opacity-50 transition">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {trigMsg && (
          <div className={`text-xs px-4 py-2.5 rounded-lg border ${trigMsg.startsWith('✓') ? 'bg-emerald-900/30 border-emerald-700/40 text-emerald-300' : 'bg-red-900/30 border-red-700/40 text-red-300'}`}>
            {trigMsg}
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 bg-red-900/30 border border-red-700/40 rounded-lg p-3 text-red-300 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0" />{error}
          </div>
        )}

        {/* Stats */}
        {signals.length > 0 && (
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
            {[
              { l: '🟢 High Conv (≥75)', v: confirmed.toString(),  c: 'text-emerald-400' },
              { l: '🟡 Emerging (55–74)',v: emerging.toString(),   c: 'text-amber-400' },
              { l: '🔥 PEAD Confluence', v: triplePlay.toString(), c: 'text-violet-400' },
              { l: '⏳ Fresh (≤15d)',    v: fresh.toString(),      c: 'text-blue-400' },
              { l: '🧠 Smart Money',     v: smartMoney.toString(), c: 'text-cyan-400' },
              { l: 'Avg Return',         v: fmtPct(avgReturn),     c: retCls(avgReturn) },
            ].map(s => (
              <div key={s.l} className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-center">
                <div className="text-[10px] text-slate-500 mb-1 whitespace-nowrap">{s.l}</div>
                <div className={`text-lg font-black ${s.c}`}>{s.v}</div>
              </div>
            ))}
          </div>
        )}

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-1 gap-1">
            {([['week','This Week'],['month','Last Month'],['quarter','Last Quarter']] as [DateRange,string][]).map(([v,l])=>(
              <button key={v} onClick={()=>setDateRange(v)}
                className={`px-3 py-1 text-xs rounded font-medium transition ${dateRange===v?'bg-indigo-600 text-white':'text-slate-400 hover:text-white'}`}>{l}</button>
            ))}
          </div>
          <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-1 gap-1 flex-wrap">
            {([
              ['all',            '📋 All'],
              ['high_conviction','🟢 High Conviction (≥75)'],
              ['emerging',       '🟡 Emerging (55–74)'],
              ['pead_confluence','🔥 PEAD Confluence'],
              ['fresh',          '⏳ Fresh Breakouts (≤15d)'],
            ] as [FilterMode,string][]).map(([v,l])=>(
              <button key={v} onClick={()=>setFilter(v)}
                className={`px-3 py-1 text-xs rounded font-medium transition whitespace-nowrap ${filter===v?'bg-blue-600 text-white':'text-slate-400 hover:text-white'}`}>{l}</button>
            ))}
          </div>
          <span className="text-slate-600 text-xs">{sorted.length} setups</span>
        </div>

        {/* Table */}
        {loading ? (
          <div className="text-center py-20 text-slate-500 text-sm">Loading…</div>
        ) : sorted.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-16 text-center">
            <Layers className="w-8 h-8 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400 font-semibold">No Stage 2 setups in this range</p>
            <p className="text-slate-600 text-xs mt-1">Seed historical data or run a live scan to detect breakouts</p>
            <div className="flex gap-3 justify-center mt-4">
              <button onClick={() => dispatch('backfill_stage2')} disabled={!!triggering}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded text-xs font-medium disabled:opacity-50">
                ⏮️ Seed 7 Days
              </button>
              <button onClick={() => dispatch('stage2_engine')} disabled={!!triggering}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-medium disabled:opacity-50">
                ⚡ Run Scan
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
            <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: 'min(720px, calc(100vh - 290px))' }}>
              <table className="w-full text-xs border-collapse" style={{ minWidth: '1400px' }}>
                <thead className="sticky top-0 z-20">
                  <tr className="bg-[#161b22] border-b-2 border-slate-700">
                    <th className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400 bg-[#161b22] sticky left-0 z-30 whitespace-nowrap min-w-[160px]">
                      Ticker / Company
                    </th>
                    <Th col="stage2_score"        label="S2 Score"      active={sortKey==='stage2_score'}        dir={sortDir} onSort={onSort} />
                    <Th col="days_in_stage2"       label="Freshness"     active={sortKey==='days_in_stage2'}       dir={sortDir} onSort={onSort} />
                    <Th col="ema150_distance_pct"  label="Base Proximity" right active={sortKey==='ema150_distance_pct'}  dir={sortDir} onSort={onSort} />
                    <Th col="volume_multiplier"    label="Vol Spike"     active={sortKey==='volume_multiplier'}    dir={sortDir} onSort={onSort} />
                    <th className="px-2.5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">RS vs N500</th>
                    <th className="px-2.5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">SOIC Fundamentals</th>
                    <Th col="signal_date"          label="Date"          active={sortKey==='signal_date'}          dir={sortDir} onSort={onSort} />
                    <Th col="returns_since_breakout" label="Return %" right active={sortKey==='returns_since_breakout'} dir={sortDir} onSort={onSort} />
                    <Th col="daily_return"         label="Daily %" right   active={sortKey==='daily_return'}         dir={sortDir} onSort={onSort} />
                    <th className="px-2.5 py-3 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(sig => {
                    const s      = sig.stage2_score;
                    const rowBg  = s >= 75 ? 'bg-emerald-950/15 hover:bg-emerald-950/30' : s >= 55 ? 'bg-amber-950/10 hover:bg-amber-950/20' : 'hover:bg-slate-800/20';
                    const stkBg  = s >= 75 ? '#0a1f12' : s >= 55 ? '#1a1500' : '#0d1117';
                    const sym    = sig.ticker.replace('.NS','');
                    const scoreCls = s >= 75 ? 'text-emerald-400' : 'text-amber-400';

                    return (
                      <tr key={sig.id} className={`border-b border-slate-800/50 transition-colors ${rowBg}`}>
                        {/* Ticker + badges */}
                        <td className="px-3 py-2.5 sticky left-0 z-10 whitespace-nowrap" style={{ backgroundColor: stkBg }}>
                          <a href={`https://www.screener.in/company/${sym}/`} target="_blank" rel="noopener noreferrer"
                            className="font-bold text-white hover:text-blue-400 transition text-sm">{sym}</a>
                          {sig.company_name && (
                            <div className="text-slate-500 text-[10px] truncate max-w-[140px]">{sig.company_name}</div>
                          )}
                          <div className="flex gap-1 mt-0.5 flex-wrap">
                            {sig.is_pead_confluence && (
                              <span className="text-[9px] font-bold bg-violet-500/20 text-violet-400 border border-violet-500/30 px-1 py-0.5 rounded">
                                🔥 PEAD+S2
                              </span>
                            )}
                            {sig.is_smart_money_divergence && (
                              <span className="text-[9px] font-bold bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 px-1 py-0.5 rounded">
                                ⚡ DIVERGENCE
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Score */}
                        <td className="px-2.5 py-2.5 whitespace-nowrap">
                          <span className={`text-base font-black ${scoreCls}`}>{s}</span>
                          <div className="text-[9px] text-slate-600">{sig.tier}</div>
                        </td>

                        {/* Freshness */}
                        <td className="px-2.5 py-2.5 whitespace-nowrap">
                          <FreshnessCell days={sig.days_in_stage2} />
                        </td>

                        {/* Base Proximity */}
                        <td className="px-2.5 py-2.5 text-right whitespace-nowrap">
                          <EMACell pct={sig.ema150_distance_pct} />
                        </td>

                        {/* Volume */}
                        <td className={`px-2.5 py-2.5 whitespace-nowrap text-sm font-semibold ${sig.volume_multiplier == null ? 'text-slate-600' : sig.volume_multiplier >= 3 ? 'text-orange-400' : sig.volume_multiplier >= 2 ? 'text-amber-400' : 'text-slate-400'}`}>
                          {sig.volume_multiplier != null ? (sig.volume_multiplier >= 3 ? `🔥 ${sig.volume_multiplier.toFixed(1)}x` : `${sig.volume_multiplier.toFixed(1)}x`) : '—'}
                        </td>

                        {/* RS */}
                        <td className="px-2.5 py-2.5 whitespace-nowrap text-xs">
                          <RSCell rs={sig.rs_trend} />
                        </td>

                        {/* SOIC */}
                        <td className="px-2.5 py-2.5 whitespace-nowrap">
                          <SOICCell eps={sig.ttm_eps_growth} roce={sig.roce} />
                        </td>

                        {/* Date */}
                        <td className="px-2.5 py-2.5 text-slate-400 whitespace-nowrap">{fmtDate(sig.signal_date)}</td>

                        {/* Returns since breakout */}
                        <td className={`px-2.5 py-2.5 text-right whitespace-nowrap font-semibold ${retCls(sig.returns_since_breakout)}`}>
                          {fmtPct(sig.returns_since_breakout)}
                        </td>

                        {/* Daily */}
                        <td className={`px-2.5 py-2.5 text-right whitespace-nowrap ${retCls(sig.daily_return)}`}>
                          {fmtPct(sig.daily_return)}
                        </td>

                        {/* Quick actions */}
                        <td className="px-2.5 py-2.5 text-center whitespace-nowrap">
                          <a href={`https://in.tradingview.com/symbols/NSE-${sym}/`}
                            target="_blank" rel="noopener noreferrer"
                            title="Open in TradingView"
                            className="inline-flex items-center gap-0.5 text-[10px] text-slate-500 hover:text-blue-400 transition px-1.5 py-0.5 rounded border border-slate-700 hover:border-blue-500">
                            <ExternalLink className="w-2.5 h-2.5" />TV
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 border-t border-slate-800 flex justify-between text-[10px] text-slate-600">
              <span>{sorted.length} setups · 🔥 PEAD+S2 = Triple Play · ⚡ DIVERGENCE = Smart Money accumulation</span>
              <span>Scans 3:45 PM IST · Returns T+5/T+20/T+60 tracked</span>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

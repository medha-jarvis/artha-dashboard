'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, TrendingUp, TrendingDown, RefreshCw, AlertCircle, ChevronUp, ChevronDown, Layers } from 'lucide-react';

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
  // joined
  returns_since_breakout?: number | null;
  daily_return?: number | null;
  t_5_return?: number | null;
  t_20_return?: number | null;
  t_60_return?: number | null;
}

type SortKey = 'stage2_score' | 'days_in_stage2' | 'ema150_distance_pct' | 'volume_multiplier' | 'returns_since_breakout' | 'daily_return' | 'signal_date';
type SortDir = 'asc' | 'desc';
type FilterMode = 'all' | 'confirmed' | 'emerging' | 'triple_play' | 'smart_money';
type DateRange  = 'week' | 'month' | 'quarter';

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtPct = (v: number | null | undefined, dec = 1) =>
  v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(dec)}%`;
const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

const retCls = (v: number | null | undefined) =>
  v == null ? 'text-slate-500' :
  v >  15   ? 'text-emerald-300 font-bold' :
  v >   0   ? 'text-emerald-400' :
  v > -10   ? 'text-red-400' : 'text-red-500 font-bold';

const scoreCls = (s: number) =>
  s >= 75 ? 'text-emerald-400' : s >= 55 ? 'text-amber-400' : 'text-slate-500';

const tierBadge = (tier: string) =>
  tier === 'CONFIRMED' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
  tier === 'EMERGING'  ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30' :
                         'bg-slate-700/40 text-slate-500';

const rsTrendCls = (rs: string | null) =>
  rs === 'Positive' ? 'text-emerald-400' :
  rs === 'Negative' ? 'text-red-400' : 'text-slate-400';

// ── Sortable header ───────────────────────────────────────────────────────────
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
      const perfMap: Record<string, Record<string, unknown>> = {};
      (rawPerf || []).forEach((p: Record<string, unknown>) => {
        if (typeof p.signal_id === 'string') perfMap[p.signal_id] = p;
      });
      setSignals(rawSigs.map((s: Signal) => ({
        ...s,
        returns_since_breakout: (perfMap[s.id]?.returns_since_breakout as number) ?? null,
        daily_return:           (perfMap[s.id]?.daily_return as number) ?? null,
        t_5_return:             (perfMap[s.id]?.t_5_return as number) ?? null,
        t_20_return:            (perfMap[s.id]?.t_20_return as number) ?? null,
        t_60_return:            (perfMap[s.id]?.t_60_return as number) ?? null,
      })));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const dispatch = async (script: string) => {
    setTriggering(script); setTrigMsg('');
    try {
      const r = await fetch('/api/stage2-trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script }),
      });
      const d = await r.json();
      setTrigMsg(d.ok ? `✓ ${d.message} — check back in ~30 min` : `✗ ${d.error}`);
    } catch { setTrigMsg('✗ Network error'); }
    finally { setTriggering(null); }
  };

  // Date filter
  const dateFiltered = useMemo(() => {
    const now = new Date();
    const days = dateRange === 'week' ? 7 : dateRange === 'month' ? 30 : 90;
    const cutoff = new Date(now); cutoff.setDate(cutoff.getDate() - days);
    return signals.filter(s => new Date(s.signal_date) >= cutoff);
  }, [signals, dateRange]);

  // Mode filter
  const modeFiltered = useMemo(() => {
    switch (filter) {
      case 'confirmed':   return dateFiltered.filter(s => s.tier === 'CONFIRMED');
      case 'emerging':    return dateFiltered.filter(s => s.tier === 'EMERGING');
      case 'triple_play': return dateFiltered.filter(s => s.is_pead_confluence && s.tier !== 'NONE');
      case 'smart_money': return dateFiltered.filter(s => s.is_smart_money_divergence);
      default:            return dateFiltered.filter(s => s.tier !== 'NONE');
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
  const qualified   = dateFiltered.filter(s => s.tier !== 'NONE');
  const confirmed   = dateFiltered.filter(s => s.tier === 'CONFIRMED').length;
  const emerging    = dateFiltered.filter(s => s.tier === 'EMERGING').length;
  const triplePlay  = dateFiltered.filter(s => s.is_pead_confluence && s.tier !== 'NONE').length;
  const smartMoney  = dateFiltered.filter(s => s.is_smart_money_divergence).length;
  const avgReturn   = (() => {
    const v = qualified.map(s => s.returns_since_breakout).filter((v): v is number => v != null);
    return v.length ? v.reduce((a,b)=>a+b,0)/v.length : null;
  })();

  return (
    <div className="min-h-screen bg-[#0d1117] p-3 md:p-5">
      <div className="max-w-[1700px] mx-auto space-y-4">

        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Link href="/" className="text-slate-500 hover:text-slate-300"><ArrowLeft className="w-4 h-4" /></Link>
              <Layers className="w-5 h-5 text-blue-400" />
              <h1 className="text-lg font-black text-white">Stage 2 Intelligence Hub</h1>
            </div>
            <p className="text-xs text-slate-500 ml-11">
              Weinstein · Minervini · SOIC — quantitative Stage 2 breakout scanner · NSE liquid universe
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
            <button onClick={loadData} disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs font-medium disabled:opacity-50 transition">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh Data
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
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            {[
              { l: 'In Stage 2',       v: qualified.length.toString(),  c: 'text-white' },
              { l: '🟢 CONFIRMED (≥75)', v: confirmed.toString(),         c: 'text-emerald-400' },
              { l: '🟡 EMERGING (55–74)',v: emerging.toString(),          c: 'text-amber-400' },
              { l: '⭐ Triple Play',    v: triplePlay.toString(),         c: 'text-violet-400' },
              { l: '🧠 Smart Money',    v: smartMoney.toString(),         c: 'text-cyan-400' },
              { l: 'Avg Return',        v: fmtPct(avgReturn),             c: retCls(avgReturn) },
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
          {/* Date range */}
          <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-1 gap-1">
            {([['week','This Week'],['month','Last Month'],['quarter','Last Quarter']] as [DateRange,string][]).map(([v,l])=>(
              <button key={v} onClick={()=>setDateRange(v)}
                className={`px-3 py-1 text-xs rounded font-medium transition ${dateRange===v?'bg-indigo-600 text-white':'text-slate-400 hover:text-white'}`}>{l}</button>
            ))}
          </div>
          {/* Filter */}
          <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-1 gap-1 flex-wrap">
            {([
              ['all',         '📋 Stage 2 (All)'],
              ['confirmed',   '🟢 CONFIRMED (≥75)'],
              ['emerging',    '🟡 EMERGING (55–74)'],
              ['triple_play', '⭐ Triple Play'],
              ['smart_money', '🧠 Smart Money'],
            ] as [FilterMode,string][]).map(([v,l])=>(
              <button key={v} onClick={()=>setFilter(v)}
                className={`px-3 py-1 text-xs rounded font-medium transition whitespace-nowrap ${filter===v?'bg-blue-600 text-white':'text-slate-400 hover:text-white'}`}>{l}</button>
            ))}
          </div>
          <span className="text-slate-600 text-xs">{sorted.length} stocks</span>
        </div>

        {/* Table */}
        {loading ? (
          <div className="text-center py-20 text-slate-500 text-sm">Scanning…</div>
        ) : sorted.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-16 text-center">
            <Layers className="w-8 h-8 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400 font-semibold">No Stage 2 setups in this range</p>
            <p className="text-slate-600 text-xs mt-1">Run a scan to detect structural breakouts across the NSE universe</p>
            <button onClick={() => dispatch('stage2_engine')} disabled={!!triggering}
              className="mt-4 px-4 py-2 bg-blue-700 hover:bg-blue-600 text-white rounded text-xs font-medium disabled:opacity-50">
              ⚡ Run Stage 2 Scan
            </button>
          </div>
        ) : (
          <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
            <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: 'min(700px, calc(100vh - 290px))' }}>
              <table className="w-full text-xs border-collapse" style={{ minWidth: '1300px' }}>
                <thead className="sticky top-0 z-20">
                  <tr className="bg-[#161b22] border-b-2 border-slate-700">
                    <th className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400 bg-[#161b22] sticky left-0 z-30 whitespace-nowrap">Company</th>
                    <Th col="stage2_score"         label="S2 Score"      active={sortKey==='stage2_score'}         dir={sortDir} onSort={onSort} />
                    <Th col="days_in_stage2"        label="Days in S2"    active={sortKey==='days_in_stage2'}        dir={sortDir} onSort={onSort} />
                    <Th col="ema150_distance_pct"   label="EMA150 Dist"  right active={sortKey==='ema150_distance_pct'}   dir={sortDir} onSort={onSort} />
                    <Th col="volume_multiplier"     label="Vol Spike"    active={sortKey==='volume_multiplier'}     dir={sortDir} onSort={onSort} />
                    <th className="px-2.5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">RS vs N500</th>
                    <th className="px-2.5 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">EPS Gr%</th>
                    <th className="px-2.5 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">ROCE%</th>
                    <Th col="signal_date"           label="Date"          active={sortKey==='signal_date'}           dir={sortDir} onSort={onSort} />
                    <Th col="returns_since_breakout" label="Return %" right active={sortKey==='returns_since_breakout'} dir={sortDir} onSort={onSort} />
                    <Th col="daily_return"          label="Daily %" right  active={sortKey==='daily_return'}          dir={sortDir} onSort={onSort} />
                    <th className="px-2.5 py-3 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">Tier</th>
                    <th className="px-2.5 py-3 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(sig => {
                    const s = sig.stage2_score;
                    const rowBg = s >= 75 ? 'bg-emerald-950/15 hover:bg-emerald-950/30'
                                : s >= 55 ? 'bg-amber-950/10 hover:bg-amber-950/20'
                                : 'hover:bg-slate-800/20';
                    const stickyBg = s >= 75 ? '#0a1f12' : s >= 55 ? '#1a1500' : '#0d1117';

                    return (
                      <tr key={sig.id} className={`border-b border-slate-800/50 transition-colors ${rowBg}`}>
                        {/* Company */}
                        <td className="px-3 py-2.5 sticky left-0 z-10 whitespace-nowrap" style={{ backgroundColor: stickyBg }}>
                          <a href={`https://stockscans.in/stock/${sig.ticker.replace('.NS','')}`}
                            target="_blank" rel="noopener noreferrer"
                            className="font-bold text-white hover:text-blue-400 transition text-sm">
                            {sig.ticker.replace('.NS','')}
                          </a>
                          {sig.company_name && (
                            <div className="text-slate-500 text-[10px] truncate max-w-[140px]">{sig.company_name}</div>
                          )}
                          {sig.sector && (
                            <div className="text-slate-600 text-[9px] truncate max-w-[140px]">{sig.sector}</div>
                          )}
                        </td>

                        {/* Score */}
                        <td className="px-2.5 py-2.5 whitespace-nowrap">
                          <span className={`text-base font-black ${scoreCls(s)}`}>{s}</span>
                        </td>

                        {/* Days in S2 */}
                        <td className="px-2.5 py-2.5 whitespace-nowrap">
                          <span className={`text-sm font-semibold ${sig.days_in_stage2 == null ? 'text-slate-600' : sig.days_in_stage2 < 15 ? 'text-emerald-400' : sig.days_in_stage2 < 30 ? 'text-amber-400' : 'text-slate-400'}`}>
                            {sig.days_in_stage2 != null ? `${sig.days_in_stage2}d` : '—'}
                          </span>
                        </td>

                        {/* EMA150 distance */}
                        <td className={`px-2.5 py-2.5 text-right whitespace-nowrap text-sm font-medium ${sig.ema150_distance_pct == null ? 'text-slate-600' : sig.ema150_distance_pct <= 10 ? 'text-emerald-400' : sig.ema150_distance_pct <= 15 ? 'text-amber-400' : 'text-slate-400'}`}>
                          {sig.ema150_distance_pct != null ? `+${sig.ema150_distance_pct.toFixed(1)}%` : '—'}
                        </td>

                        {/* Volume */}
                        <td className={`px-2.5 py-2.5 whitespace-nowrap text-sm font-semibold ${sig.volume_multiplier == null ? 'text-slate-600' : sig.volume_multiplier >= 3 ? 'text-orange-400' : sig.volume_multiplier >= 2 ? 'text-amber-400' : 'text-slate-400'}`}>
                          {sig.volume_multiplier != null ? (sig.volume_multiplier >= 3 ? `🔥 ${sig.volume_multiplier.toFixed(1)}x` : `${sig.volume_multiplier.toFixed(1)}x`) : '—'}
                        </td>

                        {/* RS Trend */}
                        <td className={`px-2.5 py-2.5 whitespace-nowrap text-xs font-medium ${rsTrendCls(sig.rs_trend)}`}>
                          {sig.rs_trend === 'Positive' ? '↗ Positive' :
                           sig.rs_trend === 'Negative' ? '↘ Negative' : '→ Flat'}
                        </td>

                        {/* EPS Growth */}
                        <td className={`px-2.5 py-2.5 text-right whitespace-nowrap text-xs ${sig.ttm_eps_growth == null ? 'text-slate-600' : sig.ttm_eps_growth > 20 ? 'text-emerald-400 font-semibold' : sig.ttm_eps_growth > 0 ? 'text-emerald-300' : 'text-red-400'}`}>
                          {sig.ttm_eps_growth != null ? `${sig.ttm_eps_growth >= 0 ? '+' : ''}${sig.ttm_eps_growth.toFixed(1)}%` : '—'}
                        </td>

                        {/* ROCE */}
                        <td className={`px-2.5 py-2.5 text-right whitespace-nowrap text-xs ${sig.roce == null ? 'text-slate-600' : sig.roce > 15 ? 'text-emerald-400' : sig.roce > 10 ? 'text-amber-400' : 'text-slate-400'}`}>
                          {sig.roce != null ? `${sig.roce.toFixed(1)}%` : '—'}
                        </td>

                        {/* Date */}
                        <td className="px-2.5 py-2.5 text-slate-400 whitespace-nowrap">{fmtDate(sig.signal_date)}</td>

                        {/* Returns since breakout */}
                        <td className={`px-2.5 py-2.5 text-right whitespace-nowrap font-semibold ${retCls(sig.returns_since_breakout)}`}>
                          <div className="flex items-center justify-end gap-0.5">
                            {sig.returns_since_breakout != null && (
                              sig.returns_since_breakout >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />
                            )}
                            {fmtPct(sig.returns_since_breakout)}
                          </div>
                        </td>

                        {/* Daily return */}
                        <td className={`px-2.5 py-2.5 text-right whitespace-nowrap ${retCls(sig.daily_return)}`}>
                          {fmtPct(sig.daily_return)}
                        </td>

                        {/* Tier */}
                        <td className="px-2.5 py-2.5 text-center whitespace-nowrap">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${tierBadge(sig.tier)}`}>
                            {sig.tier === 'CONFIRMED' ? 'CONF.' : sig.tier}
                          </span>
                        </td>

                        {/* Flags */}
                        <td className="px-2.5 py-2.5 text-center whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1">
                            {sig.is_pead_confluence && (
                              <span title="PEAD Confluence — high-scoring earnings + Stage 2 breakout"
                                className="text-[10px] font-bold bg-violet-500/20 text-violet-400 border border-violet-500/30 px-1 py-0.5 rounded">
                                ⭐PEAD
                              </span>
                            )}
                            {sig.is_smart_money_divergence && (
                              <span title="Smart Money — weak EPS but volume surge, institutional accumulation"
                                className="text-[10px] font-bold bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 px-1 py-0.5 rounded">
                                🧠SMD
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 border-t border-slate-800 flex justify-between text-[10px] text-slate-600">
              <span>{sorted.length} setups · Ticker → StockScans · ⭐PEAD = earnings catalyst + S2 breakout</span>
              <span>Scans daily at 5 PM IST · Returns T+5/T+20/T+60 tracked automatically</span>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Zap, RefreshCw, AlertCircle, ChevronUp, ChevronDown } from 'lucide-react';
import { InfoTooltip } from '../components/InfoTooltip';

// ── Supabase REST (public anon key) ───────────────────────────────────────────
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
  returns_since_result?: number | null;
  daily_return?: number | null;
}

type SortKey = 'pead_score' | 'signal_date' | 'returns_since_result' | 'daily_return' | 'ttm_pe' | 'volume_multiplier';
type SortDir = 'asc' | 'desc';
type FilterMode = 'all' | 'path_a' | 'watch' | 'smart_money';
type DateRange = 'week' | 'prev_week' | 'month';

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (v: number | null | undefined, dec = 1, sign = false) =>
  v == null ? '—' : `${sign && v >= 0 ? '+' : ''}${v.toFixed(dec)}`;
const fmtPct = (v: number | null | undefined) => fmt(v, 1, true) !== '—' ? `${fmt(v, 1, true)}%` : '—';
const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

const retCls = (v: number | null | undefined) =>
  v == null ? 'text-slate-500' :
  v > 10    ? 'text-emerald-400 font-bold' :
  v > 0     ? 'text-emerald-300' :
  v > -10   ? 'text-red-400' : 'text-red-500 font-bold';

// ── Sortable header ───────────────────────────────────────────────────────────
function Th({ col, label, right, active, dir, onSort, info }:
  { col: SortKey; label: string; right?: boolean; active: boolean; dir: SortDir; onSort: (c: SortKey) => void; info?: string }) {
  return (
    <th
      onClick={() => onSort(col)}
      className={`px-2.5 py-3 text-[10px] font-semibold uppercase tracking-wider cursor-pointer select-none whitespace-nowrap
        ${right ? 'text-right' : 'text-left'}
        ${active ? 'text-white' : 'text-slate-500 hover:text-slate-300'}`}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        {active ? (dir === 'desc' ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />) : null}
        {info && <InfoTooltip content={info} title={label} />}
      </span>
    </th>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function PEADPage() {
  const [signals,    setSignals]    = useState<Signal[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [triggering, setTriggering] = useState<string | null>(null);
  const [trigMsg,    setTrigMsg]    = useState('');
  const [sortKey,    setSortKey]    = useState<SortKey>('pead_score');
  const [sortDir,    setSortDir]    = useState<SortDir>('desc');
  const [filter,     setFilter]     = useState<FilterMode>('all');
  const [dateRange,  setDateRange]  = useState<DateRange>('week');

  const loadData = async () => {
    setLoading(true); setError('');
    try {
      const [rawSigs, rawDrift] = await Promise.all([
        sb('pead_signals?select=*&order=pead_score.desc&limit=500'),
        sb('drift_performance?select=signal_id,returns_since_result,daily_return'),
      ]);
      if (!Array.isArray(rawSigs)) throw new Error('Unexpected response');
      const driftMap: Record<string, { returns_since_result: number | null; daily_return: number | null }> = {};
      (rawDrift || []).forEach((d: { signal_id: string; returns_since_result: number | null; daily_return: number | null }) => {
        driftMap[d.signal_id] = d;
      });
      setSignals(rawSigs.map((s: Signal) => ({
        ...s,
        returns_since_result: driftMap[s.id]?.returns_since_result ?? null,
        daily_return:         driftMap[s.id]?.daily_return ?? null,
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
      const r = await fetch('/api/pead-trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script }),
      });
      const d = await r.json();
      setTrigMsg(d.ok
        ? `✓ ${script === 'backfill' ? 'Backfill' : script === 'drift_tracker' ? 'Returns refresh' : 'Engine scan'} dispatched — check back in ~5 min`
        : `✗ ${d.error || 'Dispatch failed'}`);
    } catch { setTrigMsg('✗ Network error'); }
    finally { setTriggering(null); }
  };

  // Date filter
  const dateFiltered = useMemo(() => {
    const cutoff = new Date();
    if (dateRange === 'week')      cutoff.setDate(cutoff.getDate() - 7);
    else if (dateRange === 'prev_week') { /* handled below */ }
    else                           cutoff.setDate(cutoff.getDate() - 30);

    if (dateRange === 'prev_week') {
      const wStart = new Date(); wStart.setDate(wStart.getDate() - 14);
      const wEnd   = new Date(); wEnd.setDate(wEnd.getDate() - 7);
      return signals.filter(s => { const d = new Date(s.signal_date); return d >= wStart && d < wEnd; });
    }
    return signals.filter(s => new Date(s.signal_date) >= cutoff);
  }, [signals, dateRange]);

  // Mode filter
  const modeFiltered = useMemo(() => {
    switch (filter) {
      case 'path_a':     return dateFiltered.filter(s => s.pead_score >= 70);
      case 'watch':      return dateFiltered.filter(s => s.pead_score >= 50 && s.pead_score < 70);
      case 'smart_money':return dateFiltered.filter(s => s.pead_score < 40 && (s.returns_since_result ?? 0) > 8);
      default:           return dateFiltered;
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
  const pathA   = dateFiltered.filter(s => s.pead_score >= 70).length;
  const watches = dateFiltered.filter(s => s.pead_score >= 50 && s.pead_score < 70).length;
  const smartMo = dateFiltered.filter(s => s.pead_score < 40 && (s.returns_since_result ?? 0) > 8).length;
  const avgRet  = (() => {
    const v = dateFiltered.map(s => s.returns_since_result).filter((v): v is number => v != null);
    return v.length ? v.reduce((a,b)=>a+b,0)/v.length : null;
  })();

  return (
    <div className="min-h-screen bg-[#0d1117] p-3 md:p-5">
      <div className="max-w-[1600px] mx-auto space-y-4">

        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Link href="/" className="text-slate-500 hover:text-slate-300"><ArrowLeft className="w-4 h-4" /></Link>
              <Zap className="w-5 h-5 text-amber-400" />
              <h1 className="text-lg font-black text-white">PEAD Candidates Dashboard</h1>
            </div>
            <p className="text-xs text-slate-500 ml-11">All earnings scored 0–100 · Updated 9AM, 2:30PM, 4PM IST</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => dispatch('pead_engine')} disabled={!!triggering}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded text-xs font-semibold disabled:opacity-50 transition">
              <Zap className={`w-3.5 h-3.5 ${triggering === 'pead_engine' ? 'animate-pulse' : ''}`} />
              ⚡ Run Today's Scan
            </button>
            <button onClick={() => dispatch('drift_tracker')} disabled={!!triggering}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white rounded text-xs font-medium disabled:opacity-50 transition">
              <RefreshCw className={`w-3.5 h-3.5 ${triggering === 'drift_tracker' ? 'animate-spin' : ''}`} />
              ↺ Refresh Returns
            </button>
            <button onClick={() => dispatch('backfill')} disabled={!!triggering}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded text-xs font-medium disabled:opacity-50 transition">
              ⏮️ Seed Last 7 Days
            </button>
            <button onClick={loadData} disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs font-medium disabled:opacity-50 transition">
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

        {error && (
          <div className="flex items-center gap-2 bg-red-900/30 border border-red-700/40 rounded-lg p-3 text-red-300 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0" />{error}
          </div>
        )}

        {/* ── Stats bar ── */}
        {signals.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {[
              { l: 'Total',             v: dateFiltered.length.toString(), c: 'text-white' },
              { l: '🟢 Path A (≥70)',    v: pathA.toString(),              c: 'text-emerald-400' },
              { l: '🟡 Watch (50–69)',   v: watches.toString(),            c: 'text-amber-400' },
              { l: '⚡ Smart Money',     v: smartMo.toString(),            c: 'text-violet-400' },
              { l: 'Avg Return',         v: fmtPct(avgRet),                c: avgRet == null ? 'text-slate-500' : avgRet >= 0 ? 'text-emerald-400' : 'text-red-400' },
            ].map(s => (
              <div key={s.l} className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-center">
                <div className="text-[10px] text-slate-500 mb-1 whitespace-nowrap">{s.l}</div>
                <div className={`text-lg font-black ${s.c}`}>{s.v}</div>
              </div>
            ))}
          </div>
        )}

        {/* ── Controls ── */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Date range */}
          <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-1 gap-1">
            {([['week','This Week'],['prev_week','Last Week'],['month','Last 30d']] as [DateRange,string][]).map(([v,l])=>(
              <button key={v} onClick={()=>setDateRange(v)}
                className={`px-3 py-1 text-xs rounded font-medium transition ${dateRange===v?'bg-indigo-600 text-white':'text-slate-400 hover:text-white'}`}>{l}</button>
            ))}
          </div>

          {/* Filter pills */}
          <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-1 gap-1 flex-wrap">
            {([
              ['all',         '📋 All'],
              ['path_a',      '🟢 Path A (≥70)'],
              ['watch',       '🟡 Watch (50–69)'],
              ['smart_money', '⚡ Smart Money Divergence'],
            ] as [FilterMode,string][]).map(([v,l])=>(
              <button key={v} onClick={()=>setFilter(v)}
                className={`px-3 py-1 text-xs rounded font-medium transition whitespace-nowrap ${filter===v?'bg-amber-600 text-white':'text-slate-400 hover:text-white'}`}>{l}</button>
            ))}
          </div>

          <span className="text-slate-600 text-xs">{sorted.length} companies</span>
        </div>

        {/* ── Table ── */}
        {loading ? (
          <div className="text-center py-20 text-slate-500 text-sm">Loading…</div>
        ) : sorted.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-16 text-center">
            <Zap className="w-8 h-8 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400 font-semibold">No data in this range</p>
            <p className="text-slate-600 text-xs mt-1">Seed historical data or trigger today's scan</p>
            <button onClick={() => dispatch('backfill')} disabled={!!triggering}
              className="mt-4 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded text-xs font-medium disabled:opacity-50">
              ⏮️ Seed Last 7 Days
            </button>
          </div>
        ) : (
          <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
            <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: 'min(680px, calc(100vh - 290px))' }}>
              <table className="w-full text-xs border-collapse" style={{ minWidth: '1200px' }}>
                <thead className="sticky top-0 z-20">
                  <tr className="bg-[#161b22] border-b-2 border-slate-700">
                    {/* Company — sticky left */}
                    <th className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400 bg-[#161b22] sticky left-0 z-30 whitespace-nowrap">
                      Ticker / Company
                    </th>
                    <Th col="pead_score" label="PEAD Score" active={sortKey==='pead_score'} dir={sortDir} onSort={onSort}
                      info="Post-Earnings Announcement Drift score (0–100). Measures how strong and clean the earnings surprise was. High score = large positive surprise with low prior expectations, high institutional ownership, and strong revenue quality. Stocks with PEAD ≥ 70 historically continue drifting upward for 20–60 days after results." />
                    <th className="px-2.5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">
                      Fundamentals <InfoTooltip title="Fundamentals" content="Quick snapshot of financial health: Revenue growth (QoQ and YoY), Net Profit margin, and EPS trend. Green = improving, Red = deteriorating. Used to confirm the earnings surprise is backed by real business improvement, not one-time items." />
                    </th>
                    <th className="px-2.5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">
                      Trend (200 EMA) <InfoTooltip title="Trend (200 EMA)" content="Whether the stock price is above or below its 200-day Exponential Moving Average. Above = long-term uptrend (bull phase). Below = long-term downtrend (bear phase). PEAD signals in bull phase stocks have much higher follow-through rates." />
                    </th>
                    <Th col="volume_multiplier" label="Vol Spike" active={sortKey==='volume_multiplier'} dir={sortDir} onSort={onSort}
                      info="Today's volume divided by the 20-day average volume. A multiplier of 2.5x means today saw 2.5× the normal trading activity. High volume on earnings day confirms genuine institutional interest — not a retail-driven blip. Look for ≥1.5x for meaningful signals." />
                    <th className="px-2.5 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">
                      Day Gap <InfoTooltip title="Day Gap" content="The percentage gap-up (or gap-down) in price on the day results were announced. A +5% gap means the stock opened 5% higher than the previous close. Strong gaps (≥3%) on high volume are the classic PEAD trigger — the market is immediately re-pricing the stock upward." />
                    </th>
                    <Th col="signal_date" label="Result Date" active={sortKey==='signal_date'} dir={sortDir} onSort={onSort}
                      info="The date the quarterly earnings result was announced. PEAD drift is strongest in the first 45 days after results. Signals older than 45 days are shown dimmed — the primary drift window may have closed." />
                    <Th col="ttm_pe" label="TTM PE" right active={sortKey==='ttm_pe'} dir={sortDir} onSort={onSort}
                      info="Trailing Twelve Month Price-to-Earnings ratio. Share price divided by last 12 months of earnings per share. Lower PE = cheaper valuation. For PEAD, a high PE after strong results may mean the market has already priced in the growth — less room to run. Compare with sector median PE." />
                    <Th col="returns_since_result" label="Returns %" right active={sortKey==='returns_since_result'} dir={sortDir} onSort={onSort}
                      info="Total return of the stock from the result date to today. Measures how much the PEAD signal has already delivered. If this is already +15%, the easy money may be made. If it's still near 0%, the drift hasn't kicked in yet — potentially still a good entry." />
                    <Th col="daily_return" label="Daily Ret %" right active={sortKey==='daily_return'} dir={sortDir} onSort={onSort}
                      info="Today's price change as a percentage. Useful for spotting momentum continuation (stock up strongly today = active buying) vs exhaustion (stock flat or down after a big run-up)." />
                    <th className="px-2.5 py-3 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">
                      Tier <InfoTooltip title="Tier" content="Quality tier based on combined PEAD score + fundamental strength. CONFIRMED = PEAD ≥ 80 with improving fundamentals and strong volume. EMERGING = PEAD 70–80 or mixed signals. Higher tier = higher historical win rate for drift continuation." />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(sig => {
                    const s = sig.pead_score;
                    const rowBg = s >= 70 ? 'bg-emerald-950/15 hover:bg-emerald-950/30'
                                : s >= 50 ? 'bg-amber-950/10 hover:bg-amber-950/20'
                                : 'hover:bg-slate-800/30';
                    const scoreCls = s >= 70 ? 'text-emerald-400' : s >= 50 ? 'text-amber-400' : 'text-slate-400';
                    const scoreBg  = s >= 70 ? 'bg-emerald-500/20 border border-emerald-500/30'
                                   : s >= 50 ? 'bg-amber-500/15 border border-amber-500/30' : '';
                    const tierCls  = s >= 70 ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                                   : s >= 50 ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30' : 'bg-slate-700/40 text-slate-500';
                    const tierLbl  = s >= 70 ? 'PATH A' : s >= 50 ? 'WATCH' : 'NONE';

                    // Fundamentals cell
                    const fundParts = [
                      sig.yoy_profit_pct  != null ? `${sig.yoy_profit_pct >= 0 ? '+' : ''}${sig.yoy_profit_pct.toFixed(0)}%` : null,
                      sig.yoy_revenue_pct != null ? `${sig.yoy_revenue_pct >= 0 ? '+' : ''}${sig.yoy_revenue_pct.toFixed(0)}%` : null,
                      sig.opm_expansion_bps != null ? `${sig.opm_expansion_bps >= 0 ? '+' : ''}${sig.opm_expansion_bps.toFixed(0)}bps` : null,
                    ];
                    const fundStr = fundParts.filter(Boolean).join(' | ') || '—';

                    // EMA display
                    const ema = sig.price_vs_ema200_pct;
                    const emaStr = ema == null ? '—'
                      : ema >= 0 ? `🟢 +${ema.toFixed(1)}% above EMA`
                      :             `🔴 ${ema.toFixed(1)}% below EMA`;

                    // Volume
                    const vm  = sig.volume_multiplier;
                    const volStr = vm == null ? '—'
                      : vm >= 3 ? `🔥 ${vm.toFixed(1)}x` : `${vm.toFixed(1)}x`;

                    // Day gap
                    const gap = sig.day_gap_pct;
                    const gapStr = gap == null ? '—'
                      : gap > 0 ? `📈 +${gap.toFixed(1)}%` : `📉 ${gap.toFixed(1)}%`;

                    const sym = sig.ticker.replace('.NS','');
                    const stockscanUrl = `https://www.screener.in/company/${sym}/`;

                    return (
                      <tr key={sig.id} className={`border-b border-slate-800/50 transition-colors ${rowBg}`}>

                        {/* Company — sticky */}
                        <td className="px-3 py-2.5 sticky left-0 bg-[#0d1117] z-10 whitespace-nowrap"
                          style={{ backgroundColor: s >= 70 ? '#0a1f12' : s >= 50 ? '#1a1500' : '#0d1117' }}>
                          <a href={stockscanUrl} target="_blank" rel="noopener noreferrer"
                            className="font-bold text-white hover:text-blue-400 transition text-sm">
                            {sig.ticker.replace('.NS','')}
                          </a>
                          {(sig.company_name || sig.sector) && (
                            <div className="text-slate-500 text-[10px] truncate max-w-[150px]">
                              {sig.company_name || sig.sector}
                            </div>
                          )}
                        </td>

                        {/* PEAD Score */}
                        <td className="px-2.5 py-2.5 whitespace-nowrap">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-lg ${scoreBg}`}>
                            <span className={`text-base font-black ${scoreCls}`}>{s}</span>
                          </span>
                        </td>

                        {/* Fundamentals */}
                        <td className="px-2.5 py-2.5 whitespace-nowrap text-slate-300 font-mono text-[11px]">
                          {fundStr}
                        </td>

                        {/* Trend (200 EMA) */}
                        <td className={`px-2.5 py-2.5 whitespace-nowrap text-[11px] font-medium ${ema == null ? 'text-slate-600' : ema >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {emaStr}
                        </td>

                        {/* Volume */}
                        <td className={`px-2.5 py-2.5 whitespace-nowrap text-[11px] font-semibold ${vm == null ? 'text-slate-600' : vm >= 3 ? 'text-orange-400' : vm >= 2 ? 'text-amber-400' : 'text-slate-300'}`}>
                          {volStr}
                        </td>

                        {/* Day Gap */}
                        <td className={`px-2.5 py-2.5 text-right whitespace-nowrap text-[11px] font-medium ${gap == null ? 'text-slate-600' : gap > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {gapStr}
                        </td>

                        {/* Result Date */}
                        <td className="px-2.5 py-2.5 text-slate-400 whitespace-nowrap">{fmtDate(sig.signal_date)}</td>

                        {/* TTM PE */}
                        <td className={`px-2.5 py-2.5 text-right whitespace-nowrap ${sig.ttm_pe && sig.ttm_pe > 60 ? 'text-amber-400' : 'text-slate-300'}`}>
                          {sig.ttm_pe ? sig.ttm_pe.toFixed(1) : '—'}
                        </td>

                        {/* Returns since result */}
                        <td className={`px-2.5 py-2.5 text-right whitespace-nowrap font-semibold ${retCls(sig.returns_since_result)}`}>
                          {fmtPct(sig.returns_since_result)}
                        </td>

                        {/* Daily return */}
                        <td className={`px-2.5 py-2.5 text-right whitespace-nowrap ${retCls(sig.daily_return)}`}>
                          {fmtPct(sig.daily_return)}
                        </td>

                        {/* Tier */}
                        <td className="px-2.5 py-2.5 text-center whitespace-nowrap">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${tierCls}`}>{tierLbl}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 border-t border-slate-800 flex justify-between text-[10px] text-slate-600">
              <span>{sorted.length} of {signals.length} signals · Ticker links → Screener.in</span>
              <span>Returns refresh daily at 4 PM IST · Smart Money = Score &lt;40 &amp; Return &gt;+8%</span>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

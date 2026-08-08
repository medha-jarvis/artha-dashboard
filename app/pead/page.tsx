'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Zap, RefreshCw, AlertCircle, ChevronUp, ChevronDown, ExternalLink } from 'lucide-react';
import { InfoTooltip } from '../components/InfoTooltip';

const sb = (path: string) =>
  fetch(`/api/sb/${path}`, { cache: 'no-store' }).then(r => r.json());

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
  qoq_profit_pct: number | null;
  price_vs_ema200_pct: number | null;
  volume_multiplier: number | null;
  delivery_pct: number | null;
  day_gap_pct: number | null;
  ttm_pe: number | null;
  trigger_path: 'ACT' | 'WATCH' | 'NONE';
  is_hidden_catalyst: boolean;
  returns_since_result?: number | null;
  daily_return?: number | null;
}

type SortKey = 'pead_score' | 'signal_date' | 'returns_since_result' | 'daily_return' | 'ttm_pe' | 'volume_multiplier';
type SortDir = 'asc' | 'desc';
type FilterMode = 'all' | 'act' | 'watch' | 'smart_money' | 'high_delivery' | 'val_warning';
type DateRange = 'week' | 'prev_week' | 'month';

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt  = (v: number | null | undefined, dec = 1, sign = false) =>
  v == null ? '—' : `${sign && v >= 0 ? '+' : ''}${v.toFixed(dec)}`;
const fmtPct = (v: number | null | undefined) => {
  const s = fmt(v, 1, true);
  return s === '—' ? '—' : `${s}%`;
};
const fmtDate = (s: string) => {
  try {
    return new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  } catch { return s; }
};
const retCls = (v: number | null | undefined) =>
  v == null        ? 'text-slate-500'
  : v > 10         ? 'text-emerald-400 font-bold'
  : v > 0          ? 'text-emerald-300'
  : v > -10        ? 'text-red-400'
  :                  'text-red-500 font-bold';

// ── Sortable header ───────────────────────────────────────────────────────────
function Th({ col, label, right, active, dir, onSort, info }: {
  col: SortKey; label: string; right?: boolean; active: boolean;
  dir: SortDir; onSort: (c: SortKey) => void; info?: string;
}) {
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

// ── Main page ─────────────────────────────────────────────────────────────────
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
  const [scanCountdown, setScanCountdown] = useState<number | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [rawSigs, rawDrift] = await Promise.all([
        sb('pead_signals?select=*&order=pead_score.desc&limit=500'),
        sb('drift_performance?select=signal_id,returns_since_result,daily_return'),
      ]);
      if (!Array.isArray(rawSigs)) throw new Error('Unexpected API response');
      const driftMap: Record<string, { returns_since_result: number | null; daily_return: number | null }> = {};
      (Array.isArray(rawDrift) ? rawDrift : []).forEach((d: { signal_id: string; returns_since_result: number | null; daily_return: number | null }) => {
        driftMap[d.signal_id] = d;
      });
      setSignals(rawSigs.map((s: Signal) => ({
        ...s,
        returns_since_result: driftMap[s.id]?.returns_since_result ?? null,
        daily_return:         driftMap[s.id]?.daily_return ?? null,
      })));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Auto-refresh countdown after scan
  useEffect(() => {
    if (scanCountdown === null) return;
    if (scanCountdown <= 0) { loadData(); setScanCountdown(null); return; }
    const t = setTimeout(() => setScanCountdown(c => (c ?? 0) - 1), 1000);
    return () => clearTimeout(t);
  }, [scanCountdown, loadData]);

  const dispatch = useCallback(async (script: string) => {
    setTriggering(script); setTrigMsg('');
    try {
      const r = await fetch('/api/pead-trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script }),
      });
      const d = await r.json();
      if (d.ok) {
        if (script === 'pead_engine') setScanCountdown(90);
        setTrigMsg(
          script === 'pead_engine'     ? '⚡ Scan dispatched — auto-refreshing table in 90s' :
          script === 'drift_tracker'   ? '↺ Returns refresh dispatched — check back in ~2 min' :
          script === 'backfill'        ? '⏮️ Backfill dispatched — check back in ~5 min' :
          script === 'rescore_nulls'   ? '🔄 Re-score dispatched' :
          script === 'backfill_pead_v4'? '🔄 v4 Backfill dispatched — may take 10–15 min' :
          '✓ Dispatched'
        );
      } else {
        setTrigMsg(`✗ ${d.error || 'Dispatch failed'}`);
      }
    } catch { setTrigMsg('✗ Network error'); }
    finally   { setTriggering(null); }
  }, []);

  // ── Filters ────────────────────────────────────────────────────────────────
  const dateFiltered = useMemo(() => {
    if (dateRange === 'prev_week') {
      const s = new Date(); s.setDate(s.getDate() - 14);
      const e = new Date(); e.setDate(e.getDate() - 7);
      return signals.filter(sig => { const d = new Date(sig.signal_date); return d >= s && d < e; });
    }
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (dateRange === 'week' ? 7 : 30));
    return signals.filter(sig => new Date(sig.signal_date) >= cutoff);
  }, [signals, dateRange]);

  const modeFiltered = useMemo(() => {
    switch (filter) {
      case 'act':          return dateFiltered.filter(s => s.pead_score >= 70);
      case 'watch':        return dateFiltered.filter(s => s.pead_score >= 50 && s.pead_score < 70);
      case 'smart_money':  return dateFiltered.filter(s => s.is_hidden_catalyst);
      case 'high_delivery':return dateFiltered.filter(s => (s.delivery_pct ?? 0) >= 45);
      case 'val_warning':  return dateFiltered.filter(s => (s.ttm_pe ?? 0) > 80);
      default:             return dateFiltered;
    }
  }, [dateFiltered, filter]);

  const sorted = useMemo(() => {
    return [...modeFiltered].sort((a, b) => {
      const d  = sortDir === 'desc' ? -1 : 1;
      if (sortKey === 'signal_date') return d * a.signal_date.localeCompare(b.signal_date);
      const va = (a[sortKey] as number | null) ?? (sortDir === 'desc' ? -Infinity : Infinity);
      const vb = (b[sortKey] as number | null) ?? (sortDir === 'desc' ? -Infinity : Infinity);
      return d * (va - vb);
    });
  }, [modeFiltered, sortKey, sortDir]);

  const onSort = useCallback((col: SortKey) => {
    setSortKey(prev => {
      if (prev === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
      else { setSortDir('desc'); }
      return col;
    });
  }, []);

  // ── Stats ──────────────────────────────────────────────────────────────────
  const actCount  = dateFiltered.filter(s => s.pead_score >= 70).length;
  const watchCount= dateFiltered.filter(s => s.pead_score >= 50 && s.pead_score < 70).length;
  const smCount   = dateFiltered.filter(s => s.is_hidden_catalyst).length;
  const avgRet    = (() => {
    const v = dateFiltered.map(s => s.returns_since_result).filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  })();

  return (
    <div className="min-h-screen bg-[#0d1117] p-3 md:p-5">
      <div className="max-w-[1700px] mx-auto space-y-4">

        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Link href="/" className="text-slate-500 hover:text-slate-300"><ArrowLeft className="w-4 h-4" /></Link>
              <Zap className="w-5 h-5 text-amber-400" />
              <h1 className="text-lg font-black text-white">PEAD Candidates</h1>
            </div>
            <p className="text-xs text-slate-500 ml-11">
              7-component MECE score (0–100) · Scans at 3 PM &amp; 7 PM IST weekdays
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Primary: Scan Now */}
            <button
              onClick={() => dispatch('pead_engine')}
              disabled={!!triggering || scanCountdown !== null}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded text-xs font-semibold disabled:opacity-50 transition"
            >
              <Zap className={`w-3.5 h-3.5 ${triggering === 'pead_engine' ? 'animate-pulse' : ''}`} />
              {scanCountdown !== null ? `Refreshing in ${scanCountdown}s…` : '⚡ Scan Now'}
            </button>

            <button onClick={() => dispatch('drift_tracker')} disabled={!!triggering}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white rounded text-xs font-medium disabled:opacity-50 transition">
              <RefreshCw className={`w-3.5 h-3.5 ${triggering === 'drift_tracker' ? 'animate-spin' : ''}`} />
              ↺ Returns
            </button>

            <button onClick={() => dispatch('backfill')} disabled={!!triggering}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded text-xs font-medium disabled:opacity-50 transition">
              ⏮️ Backfill 7d
            </button>

            <button onClick={() => dispatch('backfill_pead_v4')} disabled={!!triggering}
              title="Re-score all historical records with v4 rubric"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-800 hover:bg-violet-700 text-white rounded text-xs font-medium disabled:opacity-50 transition">
              🔄 Re-score All
            </button>

            <button onClick={loadData} disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs font-medium disabled:opacity-50 transition">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* Toast */}
        {trigMsg && (
          <div className={`text-xs px-4 py-2.5 rounded-lg border
            ${trigMsg.startsWith('✗') ? 'bg-red-900/30 border-red-700/40 text-red-300' : 'bg-emerald-900/30 border-emerald-700/40 text-emerald-300'}`}>
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
            {([
              { l: 'Total',           v: dateFiltered.length.toString(), c: 'text-white' },
              { l: '🟢 ACT (≥70)',    v: actCount.toString(),            c: 'text-emerald-400' },
              { l: '🟡 Watch (50–69)',v: watchCount.toString(),           c: 'text-amber-400' },
              { l: '⚡ Smart Money',  v: smCount.toString(),              c: 'text-violet-400' },
              { l: 'Avg Return',      v: fmtPct(avgRet),                  c: avgRet == null ? 'text-slate-500' : avgRet >= 0 ? 'text-emerald-400' : 'text-red-400' },
            ] as { l: string; v: string; c: string }[]).map(s => (
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
            {(['week','prev_week','month'] as DateRange[]).map((v, i) => (
              <button key={v} onClick={() => setDateRange(v)}
                className={`px-3 py-1 text-xs rounded font-medium transition
                  ${dateRange === v ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}>
                {['This Week','Last Week','Last 30d'][i]}
              </button>
            ))}
          </div>

          {/* Filter pills */}
          <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-1 gap-1 flex-wrap">
            {([
              ['all',          '📋 All'],
              ['act',          '🟢 ACT (≥70)'],
              ['watch',        '🟡 Watch (50–69)'],
              ['smart_money',  '⚡ Smart Money'],
              ['high_delivery','📦 High Delivery'],
              ['val_warning',  '⚠️ PE Risk'],
            ] as [FilterMode, string][]).map(([v, l]) => (
              <button key={v} onClick={() => setFilter(v)}
                className={`px-3 py-1 text-xs rounded font-medium transition whitespace-nowrap
                  ${filter === v ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white'}`}>
                {l}
              </button>
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
            <p className="text-slate-600 text-xs mt-1">Trigger a scan or seed historical data</p>
            <button onClick={() => dispatch('pead_engine')} disabled={!!triggering}
              className="mt-4 px-4 py-2 bg-amber-700 hover:bg-amber-600 text-white rounded text-xs font-medium disabled:opacity-50">
              ⚡ Scan Now
            </button>
          </div>
        ) : (
          <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
            <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: 'min(680px, calc(100vh - 300px))' }}>
              <table className="w-full text-xs border-collapse" style={{ minWidth: '1300px' }}>
                <thead className="sticky top-0 z-20">
                  <tr className="bg-[#161b22] border-b-2 border-slate-700">

                    {/* Ticker — sticky left */}
                    <th className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400 bg-[#161b22] sticky left-0 z-30 whitespace-nowrap">
                      Ticker / Company
                    </th>

                    <Th col="pead_score" label="PEAD Score" active={sortKey==='pead_score'} dir={sortDir} onSort={onSort}
                      info="0–100 composite score evaluating earnings surprise, institutional delivery, and trend alignment." />

                    <th className="px-2.5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">
                      Fundamentals
                      <InfoTooltip title="Fundamentals" content="YoY Profit After Tax (PAT) growth, YoY Revenue growth, YoY OPM expansion in bps, and Sequential (QoQ) direction." />
                    </th>

                    <th className="px-2.5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">
                      Trend (200 EMA)
                      <InfoTooltip title="Trend (200 EMA)" content="Percentage distance of current closing price above or below the 200-day Exponential Moving Average." />
                    </th>

                    <Th col="volume_multiplier" label="Vol & Delivery" active={sortKey==='volume_multiplier'} dir={sortDir} onSort={onSort}
                      info="Volume multiplier vs 20-day SMA and % of shares taken as delivery overnight (Delivery % ≥45% confirms institutional buying)." />

                    <th className="px-2.5 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">
                      Intraday Gap
                      <InfoTooltip title="Intraday Gap" content="Intraday move from Open to Close on the day results were announced." />
                    </th>

                    <Th col="signal_date" label="Result Date" active={sortKey==='signal_date'} dir={sortDir} onSort={onSort}
                      info="Date the quarterly earnings result was announced. PEAD drift is strongest in the first 45 days after results." />

                    <Th col="ttm_pe" label="TTM PE" right active={sortKey==='ttm_pe'} dir={sortDir} onSort={onSort}
                      info="Trailing Twelve Months Price-to-Earnings ratio. High PE (>80) indicates elevated valuation risk." />

                    <Th col="returns_since_result" label="Returns %" right active={sortKey==='returns_since_result'} dir={sortDir} onSort={onSort}
                      info="Total percentage return of the stock since the earnings signal date." />

                    <Th col="daily_return" label="Daily Ret %" right active={sortKey==='daily_return'} dir={sortDir} onSort={onSort}
                      info="Stock price percentage change for the current trading day." />

                    <th className="px-2.5 py-3 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">
                      Tier
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(sig => {
                    const s       = sig.pead_score;
                    const rowBg   = s >= 70 ? 'bg-emerald-950/15 hover:bg-emerald-950/30'
                                  : s >= 50 ? 'bg-amber-950/10 hover:bg-amber-950/20'
                                  :           'hover:bg-slate-800/30';
                    const scoreCls = s >= 70 ? 'text-emerald-400' : s >= 50 ? 'text-amber-400' : 'text-slate-400';
                    const scoreBg  = s >= 70 ? 'bg-emerald-500/20 border border-emerald-500/30'
                                   : s >= 50 ? 'bg-amber-500/15 border border-amber-500/30' : '';
                    const tierCls  = s >= 70 ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                                   : s >= 50 ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                                   :           'bg-slate-700/40 text-slate-500';
                    const tierLbl  = s >= 70 ? 'ACT' : s >= 50 ? 'WATCH' : 'NONE';

                    const sym          = sig.ticker.replace('.NS', '');
                    const stockscanUrl = `https://stockscans.in/stock/${sym}`;
                    const screenerUrl  = `https://www.screener.in/company/${sym}/consolidated/`;
                    const tvUrl        = `https://www.tradingview.com/chart/?symbol=NSE:${sym}`;

                    // Fundamentals cell
                    const qoqArrow = sig.qoq_profit_pct == null ? '' : sig.qoq_profit_pct > 0 ? ' ↑' : ' ↓';
                    const fundParts = [
                      sig.yoy_profit_pct  != null ? `${sig.yoy_profit_pct  >= 0 ? '+' : ''}${sig.yoy_profit_pct.toFixed(0)}%P` : null,
                      sig.yoy_revenue_pct != null ? `${sig.yoy_revenue_pct >= 0 ? '+' : ''}${sig.yoy_revenue_pct.toFixed(0)}%R` : null,
                      sig.opm_expansion_bps != null ? `${sig.opm_expansion_bps >= 0 ? '+' : ''}${sig.opm_expansion_bps.toFixed(0)}bps` : null,
                    ].filter(Boolean);
                    const fundStr = fundParts.length ? fundParts.join(' | ') + qoqArrow : '—';

                    // EMA
                    const ema    = sig.price_vs_ema200_pct;
                    const emaStr = ema == null ? '—'
                      : ema >= 0 ? `🟢 +${ema.toFixed(1)}% above`
                      :             `🔴 ${ema.toFixed(1)}% below`;

                    // Vol & Delivery (merged)
                    const vm  = sig.volume_multiplier;
                    const del = sig.delivery_pct;
                    const volStr = vm == null ? '—' : vm >= 3 ? `🔥 ${vm.toFixed(1)}x` : `${vm.toFixed(1)}x`;
                    const delStr = del == null ? '' : del >= 45 ? ` · 📦 ${del.toFixed(0)}%` : ` · ${del.toFixed(0)}%`;

                    // Intraday gap
                    const gap    = sig.day_gap_pct;
                    const gapStr = gap == null ? '—' : gap > 0 ? `📈 +${gap.toFixed(1)}%` : `📉 ${gap.toFixed(1)}%`;

                    return (
                      <tr key={sig.id} className={`border-b border-slate-800/50 transition-colors ${rowBg}`}>

                        {/* Ticker / Company — sticky */}
                        <td className="px-3 py-2.5 sticky left-0 z-10 whitespace-nowrap"
                          style={{ backgroundColor: s >= 70 ? '#0a1f12' : s >= 50 ? '#1a1500' : '#0d1117' }}>
                          <div className="flex items-center gap-1.5">
                            <a href={stockscanUrl} target="_blank" rel="noopener noreferrer"
                              className="font-bold text-white hover:text-blue-400 transition text-sm">
                              {sym}
                            </a>
                            {sig.is_hidden_catalyst && (
                              <span title="Hidden Catalyst — smart money buying weak fundamentals" className="text-violet-400 text-[10px]">⚡</span>
                            )}
                            {/* Quick-action buttons */}
                            <a href={screenerUrl} target="_blank" rel="noopener noreferrer"
                              title="Screener.in" className="text-slate-600 hover:text-blue-400 transition">
                              <ExternalLink className="w-3 h-3" />
                            </a>
                            <a href={tvUrl} target="_blank" rel="noopener noreferrer"
                              title="TradingView" className="text-slate-600 hover:text-emerald-400 transition">
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                          {(sig.company_name || sig.sector) && (
                            <div className="text-slate-500 text-[10px] truncate max-w-[160px] mt-0.5">
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

                        {/* EMA Trend */}
                        <td className={`px-2.5 py-2.5 whitespace-nowrap text-[11px] font-medium
                          ${ema == null ? 'text-slate-600' : ema >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {emaStr}
                        </td>

                        {/* Vol & Delivery */}
                        <td className={`px-2.5 py-2.5 whitespace-nowrap text-[11px] font-semibold
                          ${vm == null ? 'text-slate-600' : vm >= 3 ? 'text-orange-400' : vm >= 2 ? 'text-amber-400' : 'text-slate-300'}`}>
                          {volStr}
                          <span className={`font-normal ${del != null && del >= 45 ? 'text-violet-400' : 'text-slate-500'}`}>
                            {delStr}
                          </span>
                        </td>

                        {/* Intraday Gap */}
                        <td className={`px-2.5 py-2.5 text-right whitespace-nowrap text-[11px] font-medium
                          ${gap == null ? 'text-slate-600' : gap > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {gapStr}
                        </td>

                        {/* Result Date */}
                        <td className="px-2.5 py-2.5 text-slate-400 whitespace-nowrap">
                          {fmtDate(sig.signal_date)}
                        </td>

                        {/* TTM PE */}
                        <td className={`px-2.5 py-2.5 text-right whitespace-nowrap
                          ${sig.ttm_pe && sig.ttm_pe > 80 ? 'text-red-400 font-semibold' : sig.ttm_pe && sig.ttm_pe > 50 ? 'text-amber-400' : 'text-slate-300'}`}>
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
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${tierCls}`}>
                            {tierLbl}
                          </span>
                        </td>

                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 border-t border-slate-800 flex justify-between text-[10px] text-slate-600">
              <span>{sorted.length} of {signals.length} signals · Ticker → StockScans · 📊 → Screener · 📈 → TradingView</span>
              <span>Returns updated daily 4 PM IST · ⚡ = Hidden Catalyst (smart money divergence)</span>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

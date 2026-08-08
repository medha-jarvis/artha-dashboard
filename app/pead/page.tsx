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
  market_cap: number | null;
  trigger_path: 'ACT' | 'WATCH' | 'NONE';
  is_hidden_catalyst: boolean;
  returns_since_result?: number | null;
  daily_return?: number | null;
}

type SortKey =
  | 'pead_score' | 'signal_date' | 'returns_since_result'
  | 'daily_return' | 'ttm_pe' | 'volume_multiplier' | 'market_cap';
type SortDir    = 'asc' | 'desc';
type FilterMode = 'all' | 'act' | 'watch' | 'smart_money' | 'high_delivery' | 'val_warning';
type McapFilter = 'all' | 'micro' | 'small' | 'large' | 'mega';
type DateRange  = 'week' | 'prev_week' | 'month';

// 1 Cr = 10_000_000 INR; yfinance marketCap is in INR
const CR = 10_000_000;

const fmtMcap = (v: number | null | undefined): string => {
  if (v == null) return '—';
  const cr = v / CR;
  if (cr >= 100_000)  return `₹${(cr / 100_000).toFixed(1)}L Cr`;
  if (cr >= 1_000)    return `₹${Math.round(cr / 1_000)}K Cr`;
  return `₹${Math.round(cr)} Cr`;
};

const fmtPct = (v: number | null | undefined): string => {
  if (v == null) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
};

const fmtDate = (s: string): string => {
  try {
    return new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  } catch { return s; }
};

const daysSince = (s: string): number => {
  try {
    return Math.max(0, Math.floor(
      (Date.now() - new Date(s + 'T00:00:00').getTime()) / 86_400_000
    ));
  } catch { return 0; }
};

const retCls = (v: number | null | undefined) =>
  v == null ? 'text-slate-500'
  : v > 10   ? 'text-emerald-400 font-bold'
  : v > 0    ? 'text-emerald-300'
  : v > -10  ? 'text-red-400'
  :             'text-red-500 font-bold';

// ── Sortable header ───────────────────────────────────────────────────────────
function Th({ col, label, right, active, dir, onSort, info }: {
  col: SortKey; label: string; right?: boolean; active: boolean;
  dir: SortDir; onSort: (c: SortKey) => void; info?: string;
}) {
  return (
    <th
      onClick={() => onSort(col)}
      className={`px-2.5 py-3 text-[10px] font-semibold uppercase tracking-wider cursor-pointer
        select-none whitespace-nowrap
        ${right ? 'text-right' : 'text-left'}
        ${active ? 'text-white' : 'text-slate-500 hover:text-slate-300'}`}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        {active
          ? dir === 'desc'
            ? <ChevronDown className="w-3 h-3" />
            : <ChevronUp   className="w-3 h-3" />
          : null}
        {info && <InfoTooltip content={info} title={label} />}
      </span>
    </th>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function PEADPage() {
  const [signals,       setSignals]       = useState<Signal[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState('');
  const [triggering,    setTriggering]    = useState<string | null>(null);
  const [trigMsg,       setTrigMsg]       = useState('');
  const [sortKey,       setSortKey]       = useState<SortKey>('pead_score');
  const [sortDir,       setSortDir]       = useState<SortDir>('desc');
  const [filter,        setFilter]        = useState<FilterMode>('all');
  const [mcapFilter,    setMcapFilter]    = useState<McapFilter>('all');
  const [dateRange,     setDateRange]     = useState<DateRange>('week');
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
      (Array.isArray(rawDrift) ? rawDrift : []).forEach((d: {
        signal_id: string; returns_since_result: number | null; daily_return: number | null;
      }) => { driftMap[d.signal_id] = d; });
      setSignals(rawSigs.map((s: Signal) => ({
        ...s,
        // ensure booleans are never null
        is_hidden_catalyst: Boolean(s.is_hidden_catalyst),
        // coerce numeric strings that might come from DB
        pead_score:  Number(s.pead_score)  || 0,
        ttm_pe:      s.ttm_pe    != null ? Number(s.ttm_pe)    : null,
        market_cap:  s.market_cap != null ? Number(s.market_cap): null,
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
    const t = setTimeout(() => setScanCountdown(c => Math.max(0, (c ?? 1) - 1)), 1000);
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
          script === 'pead_engine'      ? '⚡ Scan dispatched — auto-refreshing in 90s'
          : script === 'drift_tracker'  ? '↺ Returns refresh dispatched'
          : script === 'backfill'       ? '⏮️ Backfill dispatched'
          : script === 'backfill_pead_v4' ? '🔄 Full re-score dispatched (~10-15 min)'
          : '✓ Dispatched'
        );
      } else {
        setTrigMsg(`✗ ${d.error || 'Dispatch failed'}`);
      }
    } catch { setTrigMsg('✗ Network error'); }
    finally  { setTriggering(null); }
  }, []);

  const onSort = useCallback((col: SortKey) => {
    setSortKey(prev => {
      if (prev === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
      else              setSortDir('desc');
      return col;
    });
  }, []);

  // ── Filters ────────────────────────────────────────────────────────────────
  const dateFiltered = useMemo(() => {
    if (dateRange === 'prev_week') {
      const s = new Date(); s.setDate(s.getDate() - 14);
      const e = new Date(); e.setDate(e.getDate() - 7);
      return signals.filter(sig => {
        const d = new Date(sig.signal_date); return d >= s && d < e;
      });
    }
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (dateRange === 'week' ? 7 : 30));
    return signals.filter(sig => new Date(sig.signal_date) >= cutoff);
  }, [signals, dateRange]);

  const signalFiltered = useMemo(() => {
    switch (filter) {
      case 'act':          return dateFiltered.filter(s => s.pead_score >= 70);
      case 'watch':        return dateFiltered.filter(s => s.pead_score >= 50 && s.pead_score < 70);
      case 'smart_money':  return dateFiltered.filter(s => s.is_hidden_catalyst);
      case 'high_delivery':return dateFiltered.filter(s => (s.delivery_pct ?? 0) >= 45);
      case 'val_warning':  return dateFiltered.filter(s => (s.ttm_pe ?? 0) > 80);
      default:             return dateFiltered;
    }
  }, [dateFiltered, filter]);

  const mcapFiltered = useMemo(() => {
    if (mcapFilter === 'all') return signalFiltered;
    return signalFiltered.filter(s => {
      const cr = s.market_cap != null ? s.market_cap / CR : null;
      if (cr == null) return false;
      if (mcapFilter === 'micro')  return cr < 1_000;
      if (mcapFilter === 'small')  return cr >= 1_000   && cr < 30_000;
      if (mcapFilter === 'large')  return cr >= 30_000  && cr < 1_00_000;
      if (mcapFilter === 'mega')   return cr >= 1_00_000;
      return true;
    });
  }, [signalFiltered, mcapFilter]);

  const sorted = useMemo(() => {
    return [...mcapFiltered].sort((a, b) => {
      const d = sortDir === 'desc' ? -1 : 1;
      if (sortKey === 'signal_date') {
        return d * (a.signal_date || '').localeCompare(b.signal_date || '');
      }
      const va = (a[sortKey] as number | null) ?? (sortDir === 'desc' ? -Infinity : Infinity);
      const vb = (b[sortKey] as number | null) ?? (sortDir === 'desc' ? -Infinity : Infinity);
      return d * (va - vb);
    });
  }, [mcapFiltered, sortKey, sortDir]);

  // ── Stats ──────────────────────────────────────────────────────────────────
  const actCount   = dateFiltered.filter(s => s.pead_score >= 70).length;
  const watchCount = dateFiltered.filter(s => s.pead_score >= 50 && s.pead_score < 70).length;
  const smCount    = dateFiltered.filter(s => s.is_hidden_catalyst).length;
  const avgScore   = (() => {
    const v = dateFiltered.map(s => s.pead_score).filter(x => x != null);
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
  })();
  const hitRate = (() => {
    const tracked = dateFiltered.filter(s => s.returns_since_result != null);
    if (!tracked.length) return null;
    const hits = tracked.filter(s => (s.returns_since_result ?? 0) > 0).length;
    return Math.round((hits / tracked.length) * 100);
  })();
  const avgRet = (() => {
    const v = dateFiltered.map(s => s.returns_since_result).filter((x): x is number => x != null);
    return v.length ? +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : null;
  })();

  return (
    <div className="min-h-screen bg-[#0d1117] p-3 md:p-5">
      <div className="max-w-[1800px] mx-auto space-y-4">

        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Link href="/" className="text-slate-500 hover:text-slate-300">
                <ArrowLeft className="w-4 h-4" />
              </Link>
              <Zap className="w-5 h-5 text-amber-400" />
              <h1 className="text-lg font-black text-white">PEAD Candidates</h1>
            </div>
            <p className="text-xs text-slate-500 ml-11">
              7-component MECE score (0–100) · 3 PM &amp; 7 PM IST weekdays
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => dispatch('pead_engine')}
              disabled={!!triggering || scanCountdown !== null}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-500
                text-white rounded text-xs font-semibold disabled:opacity-50 transition"
            >
              <Zap className={`w-3.5 h-3.5 ${triggering === 'pead_engine' ? 'animate-pulse' : ''}`} />
              {scanCountdown !== null ? `Refreshing in ${scanCountdown}s…` : '⚡ Scan Now'}
            </button>
            <button onClick={() => dispatch('drift_tracker')} disabled={!!triggering}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-700 hover:bg-blue-600
                text-white rounded text-xs font-medium disabled:opacity-50 transition">
              <RefreshCw className={`w-3.5 h-3.5 ${triggering === 'drift_tracker' ? 'animate-spin' : ''}`} />
              ↺ Returns
            </button>
            <button onClick={() => dispatch('backfill')} disabled={!!triggering}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600
                text-white rounded text-xs font-medium disabled:opacity-50 transition">
              ⏮️ Backfill 7d
            </button>
            <button onClick={() => dispatch('backfill_pead_v4')} disabled={!!triggering}
              title="Re-score all historical records with v4 rubric + market cap"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-800 hover:bg-violet-700
                text-white rounded text-xs font-medium disabled:opacity-50 transition">
              🔄 Re-score All
            </button>
            <button onClick={loadData} disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700
                text-slate-300 rounded text-xs font-medium disabled:opacity-50 transition">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* Toasts */}
        {trigMsg && (
          <div className={`text-xs px-4 py-2.5 rounded-lg border
            ${trigMsg.startsWith('✗')
              ? 'bg-red-900/30 border-red-700/40 text-red-300'
              : 'bg-emerald-900/30 border-emerald-700/40 text-emerald-300'}`}>
            {trigMsg}
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 bg-red-900/30 border border-red-700/40
            rounded-lg p-3 text-red-300 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0" />{error}
          </div>
        )}

        {/* ── Stats bar ── */}
        {signals.length > 0 && (
          <div className="grid grid-cols-3 md:grid-cols-7 gap-2">
            {([
              { l: 'Total',         v: dateFiltered.length.toString(),                    c: 'text-white' },
              { l: '🟢 ACT (≥70)',  v: actCount.toString(),                               c: 'text-emerald-400' },
              { l: '🟡 Watch',      v: watchCount.toString(),                             c: 'text-amber-400' },
              { l: '⚡ Smart Money',v: smCount.toString(),                                c: 'text-violet-400' },
              { l: 'Avg Score',     v: avgScore != null ? avgScore.toString() : '—',      c: 'text-slate-300' },
              { l: 'Hit Rate',      v: hitRate  != null ? `${hitRate}%` : '—',            c: hitRate != null && hitRate >= 50 ? 'text-emerald-400' : 'text-red-400' },
              { l: 'Avg Return',    v: avgRet   != null ? fmtPct(avgRet) : '—',           c: avgRet != null && avgRet >= 0 ? 'text-emerald-400' : 'text-red-400' },
            ] as { l: string; v: string; c: string }[]).map(s => (
              <div key={s.l} className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-center">
                <div className="text-[9px] text-slate-500 mb-1 whitespace-nowrap">{s.l}</div>
                <div className={`text-base font-black ${s.c}`}>{s.v}</div>
              </div>
            ))}
          </div>
        )}

        {/* ── Controls ── */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Date range */}
          <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-1 gap-1">
            {(['week', 'prev_week', 'month'] as DateRange[]).map((v, i) => (
              <button key={v} onClick={() => setDateRange(v)}
                className={`px-3 py-1 text-xs rounded font-medium transition
                  ${dateRange === v ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}>
                {['This Week', 'Last Week', 'Last 30d'][i]}
              </button>
            ))}
          </div>

          {/* Signal quality filter pills */}
          <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-1 gap-1 flex-wrap">
            {([
              ['all',          '📋 All'],
              ['act',          '🟢 ACT (≥70)'],
              ['watch',        '🟡 Watch'],
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

          {/* Market cap filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-slate-500 whitespace-nowrap">Mkt Cap:</span>
            <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-1 gap-1">
              {([
                ['all',   'All'],
                ['micro', '<1K Cr'],
                ['small', '1K–30K'],
                ['large', '30K–1L'],
                ['mega',  '>1L Cr'],
              ] as [McapFilter, string][]).map(([v, l]) => (
                <button key={v} onClick={() => setMcapFilter(v)}
                  className={`px-2.5 py-1 text-xs rounded font-medium transition whitespace-nowrap
                    ${mcapFilter === v ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}>
                  {l}
                </button>
              ))}
            </div>
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
            <p className="text-slate-600 text-xs mt-1">Trigger a scan or widen the date range</p>
            <button onClick={() => dispatch('pead_engine')} disabled={!!triggering}
              className="mt-4 px-4 py-2 bg-amber-700 hover:bg-amber-600 text-white
                rounded text-xs font-medium disabled:opacity-50">
              ⚡ Scan Now
            </button>
          </div>
        ) : (
          <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
            <div className="overflow-x-auto overflow-y-auto"
              style={{ maxHeight: 'min(700px, calc(100vh - 300px))' }}>
              <table className="w-full text-xs border-collapse" style={{ minWidth: '1500px' }}>
                <thead className="sticky top-0 z-20">
                  <tr className="bg-[#161b22] border-b-2 border-slate-700">

                    <th className="px-3 py-3 text-left text-[10px] font-semibold uppercase
                      tracking-wider text-slate-400 bg-[#161b22] sticky left-0 z-30 whitespace-nowrap">
                      Ticker / Company
                    </th>

                    <Th col="pead_score" label="Score" active={sortKey === 'pead_score'}
                      dir={sortDir} onSort={onSort}
                      info="0–100 composite score evaluating earnings surprise, institutional delivery, and trend alignment." />

                    <th className="px-2.5 py-3 text-left text-[10px] font-semibold uppercase
                      tracking-wider text-slate-500 whitespace-nowrap">
                      Fundamentals
                      <InfoTooltip title="Fundamentals"
                        content="YoY Profit After Tax (PAT) growth, YoY Revenue growth, YoY OPM expansion in bps, and Sequential (QoQ) direction." />
                    </th>

                    <th className="px-2.5 py-3 text-left text-[10px] font-semibold uppercase
                      tracking-wider text-slate-500 whitespace-nowrap">
                      Trend (EMA200)
                      <InfoTooltip title="Trend (200 EMA)"
                        content="Percentage distance of current closing price above or below the 200-day Exponential Moving Average." />
                    </th>

                    <Th col="volume_multiplier" label="Vol & Delivery"
                      active={sortKey === 'volume_multiplier'} dir={sortDir} onSort={onSort}
                      info="Volume multiplier vs 20-day SMA and % of shares taken as delivery overnight (Delivery % ≥45% confirms institutional buying)." />

                    <th className="px-2.5 py-3 text-right text-[10px] font-semibold uppercase
                      tracking-wider text-slate-500 whitespace-nowrap">
                      Intraday Gap
                      <InfoTooltip title="Intraday Gap"
                        content="Intraday move from Open to Close on the day results were announced." />
                    </th>

                    <th className="px-2.5 py-3 text-center text-[10px] font-semibold uppercase
                      tracking-wider text-slate-500 whitespace-nowrap">
                      Days
                      <InfoTooltip title="Days Since Result"
                        content="Days elapsed since the earnings result was announced. PEAD drift is strongest in the first 45 days — signals beyond 45 days have lower follow-through probability." />
                    </th>

                    <Th col="signal_date" label="Result Date"
                      active={sortKey === 'signal_date'} dir={sortDir} onSort={onSort}
                      info="Date the quarterly earnings result was announced." />

                    <Th col="market_cap" label="Mkt Cap" right
                      active={sortKey === 'market_cap'} dir={sortDir} onSort={onSort}
                      info="Market capitalisation in Indian Rupees (Crores). Smaller companies often have higher PEAD drift magnitude; large caps have higher reliability." />

                    <Th col="ttm_pe" label="TTM PE" right
                      active={sortKey === 'ttm_pe'} dir={sortDir} onSort={onSort}
                      info="Trailing Twelve Months Price-to-Earnings ratio. High PE (>80) indicates elevated valuation risk." />

                    <Th col="returns_since_result" label="Return %" right
                      active={sortKey === 'returns_since_result'} dir={sortDir} onSort={onSort}
                      info="Total percentage return of the stock since the earnings signal date." />

                    <Th col="daily_return" label="1D %" right
                      active={sortKey === 'daily_return'} dir={sortDir} onSort={onSort}
                      info="Stock price percentage change for the current trading day." />

                    <th className="px-2.5 py-3 text-center text-[10px] font-semibold uppercase
                      tracking-wider text-slate-500 whitespace-nowrap">
                      Tier
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(sig => {
                    // Defensive rendering — skip rows that would crash
                    if (!sig || !sig.id) return null;

                    try {
                      const s        = Number(sig.pead_score) || 0;
                      const sym      = (sig.ticker || '').replace(/\.NS$/i, '');
                      const days     = daysSince(sig.signal_date || '');

                      const rowBg   = s >= 70
                        ? 'bg-emerald-950/15 hover:bg-emerald-950/30'
                        : s >= 50
                          ? 'bg-amber-950/10 hover:bg-amber-950/20'
                          : 'hover:bg-slate-800/30';
                      const scoreCls = s >= 70 ? 'text-emerald-400' : s >= 50 ? 'text-amber-400' : 'text-slate-400';
                      const scoreBg  = s >= 70
                        ? 'bg-emerald-500/20 border border-emerald-500/30'
                        : s >= 50
                          ? 'bg-amber-500/15 border border-amber-500/30'
                          : '';
                      const tierCls  = s >= 70
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                        : s >= 50
                          ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                          : 'bg-slate-700/40 text-slate-500';
                      const tierLbl  = s >= 70 ? 'ACT' : s >= 50 ? 'WATCH' : 'NONE';

                      // Links
                      const stockscanUrl = `https://www.stockscans.in/charts/NSE:${sym}`;
                      const screenerUrl  = `https://www.screener.in/company/${sym}/consolidated/`;
                      const tvUrl        = `https://www.tradingview.com/chart/?symbol=NSE:${sym}`;

                      // Fundamentals cell
                      const qoqArrow = sig.qoq_profit_pct == null
                        ? ''
                        : sig.qoq_profit_pct > 0 ? ' ↑QoQ' : ' ↓QoQ';
                      const fundParts = [
                        sig.yoy_profit_pct    != null
                          ? `${sig.yoy_profit_pct    >= 0 ? '+' : ''}${Number(sig.yoy_profit_pct).toFixed(0)}%P`
                          : null,
                        sig.yoy_revenue_pct   != null
                          ? `${sig.yoy_revenue_pct   >= 0 ? '+' : ''}${Number(sig.yoy_revenue_pct).toFixed(0)}%R`
                          : null,
                        sig.opm_expansion_bps != null
                          ? `${sig.opm_expansion_bps >= 0 ? '+' : ''}${Number(sig.opm_expansion_bps).toFixed(0)}bps`
                          : null,
                      ].filter(Boolean);
                      const fundStr = fundParts.length ? fundParts.join(' | ') + qoqArrow : '—';

                      // EMA
                      const ema    = sig.price_vs_ema200_pct;
                      const emaStr = ema == null
                        ? '—'
                        : ema >= 0
                          ? `🟢 +${Number(ema).toFixed(1)}%`
                          : `🔴 ${Number(ema).toFixed(1)}%`;

                      // Vol & Delivery
                      const vm     = sig.volume_multiplier;
                      const del    = sig.delivery_pct;
                      const volStr = vm == null
                        ? '—'
                        : Number(vm) >= 3 ? `🔥 ${Number(vm).toFixed(1)}x` : `${Number(vm).toFixed(1)}x`;
                      const delStr = del == null
                        ? ''
                        : Number(del) >= 45
                          ? ` · 📦 ${Number(del).toFixed(0)}%`
                          : ` · ${Number(del).toFixed(0)}%`;

                      // Intraday gap
                      const gap    = sig.day_gap_pct;
                      const gapStr = gap == null
                        ? '—'
                        : Number(gap) > 0
                          ? `📈 +${Number(gap).toFixed(1)}%`
                          : `📉 ${Number(gap).toFixed(1)}%`;

                      // Days colour
                      const daysCls = days <= 15
                        ? 'text-emerald-400 font-semibold'
                        : days <= 45
                          ? 'text-amber-400'
                          : 'text-slate-500';

                      const stickyBg = s >= 70 ? '#0a1f12' : s >= 50 ? '#1a1500' : '#0d1117';

                      return (
                        <tr key={sig.id}
                          className={`border-b border-slate-800/50 transition-colors ${rowBg}`}>

                          {/* Ticker / Company — sticky */}
                          <td className="px-3 py-2.5 sticky left-0 z-10 whitespace-nowrap"
                            style={{ backgroundColor: stickyBg }}>
                            <div className="flex items-center gap-1.5">
                              <a href={stockscanUrl} target="_blank" rel="noopener noreferrer"
                                className="font-bold text-white hover:text-blue-400 transition text-sm">
                                {sym}
                              </a>
                              {sig.is_hidden_catalyst && (
                                <span title="Hidden Catalyst — smart money buying weak fundamentals"
                                  className="text-violet-400 text-[10px]">⚡</span>
                              )}
                              <a href={screenerUrl} target="_blank" rel="noopener noreferrer"
                                title="Screener.in — financials"
                                className="text-slate-600 hover:text-sky-400 transition">
                                <ExternalLink className="w-3 h-3" />
                              </a>
                              <a href={tvUrl} target="_blank" rel="noopener noreferrer"
                                title="TradingView — chart"
                                className="text-slate-600 hover:text-emerald-400 transition">
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
                            ${vm == null
                              ? 'text-slate-600'
                              : Number(vm) >= 3
                                ? 'text-orange-400'
                                : Number(vm) >= 2 ? 'text-amber-400' : 'text-slate-300'}`}>
                            {volStr}
                            <span className={`font-normal
                              ${del != null && Number(del) >= 45 ? 'text-violet-400' : 'text-slate-500'}`}>
                              {delStr}
                            </span>
                          </td>

                          {/* Intraday Gap */}
                          <td className={`px-2.5 py-2.5 text-right whitespace-nowrap text-[11px] font-medium
                            ${gap == null ? 'text-slate-600' : Number(gap) > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {gapStr}
                          </td>

                          {/* Days Since Result */}
                          <td className={`px-2.5 py-2.5 text-center whitespace-nowrap text-[11px] ${daysCls}`}>
                            {days}d
                          </td>

                          {/* Result Date */}
                          <td className="px-2.5 py-2.5 text-slate-400 whitespace-nowrap text-[11px]">
                            {fmtDate(sig.signal_date)}
                          </td>

                          {/* Market Cap */}
                          <td className="px-2.5 py-2.5 text-right whitespace-nowrap text-slate-300 text-[11px]">
                            {fmtMcap(sig.market_cap)}
                          </td>

                          {/* TTM PE */}
                          <td className={`px-2.5 py-2.5 text-right whitespace-nowrap text-[11px]
                            ${sig.ttm_pe && Number(sig.ttm_pe) > 80
                              ? 'text-red-400 font-semibold'
                              : sig.ttm_pe && Number(sig.ttm_pe) > 50
                                ? 'text-amber-400'
                                : 'text-slate-300'}`}>
                            {sig.ttm_pe ? Number(sig.ttm_pe).toFixed(1) : '—'}
                          </td>

                          {/* Returns since result */}
                          <td className={`px-2.5 py-2.5 text-right whitespace-nowrap font-semibold
                            ${retCls(sig.returns_since_result)}`}>
                            {fmtPct(sig.returns_since_result)}
                          </td>

                          {/* Daily return */}
                          <td className={`px-2.5 py-2.5 text-right whitespace-nowrap
                            ${retCls(sig.daily_return)}`}>
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
                    } catch {
                      // Skip any row that fails to render rather than crash the whole table
                      return null;
                    }
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 border-t border-slate-800 flex justify-between text-[10px] text-slate-600">
              <span>
                {sorted.length} of {signals.length} signals ·
                Ticker → StockScans · 📊 → Screener · 📈 → TradingView
              </span>
              <span>
                Days: 🟢 ≤15 fresh · 🟡 16–45 active · grey {'>'} 45 stale ·
                ⚡ Hidden Catalyst
              </span>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

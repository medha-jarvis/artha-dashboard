'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, RefreshCw, AlertCircle, TrendingUp, TrendingDown,
  ChevronUp, ChevronDown, Crown, Search,
} from 'lucide-react';

const SB_URL = 'https://jljwgwftuqrabfyiucfl.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impsandnd2Z0dXFyYWJmeWl1Y2ZsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNTQyOTUsImV4cCI6MjA4NzkzMDI5NX0.eOa9XYyZGEM3S0Xvl95gx1wgmrQnPSV8Wh9JDxPu07M';
const sb = (p: string) =>
  fetch(`${SB_URL}/rest/v1/${p}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    cache: 'no-store',
  }).then(r => r.json());

interface Signal {
  id: string;
  ticker: string;
  client_name: string;
  deal_type: 'BULK' | 'BLOCK';
  transaction_type: 'BUY' | 'SELL';
  signal_date: string;
  net_quantity: number;
  avg_price: number;
  trade_value_cr: number;
  created_at: string;
}

type SortKey = 'signal_date' | 'trade_value_cr' | 'ticker' | 'client_name' | 'avg_price' | 'net_quantity';
type SortDir = 'asc' | 'desc';
type FilterType = 'all' | 'buy' | 'sell' | 'bulk' | 'block';

const fmtDate  = (s: string) => new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
const fmtQty   = (n: number) => n >= 1_00_000 ? `${(n / 1_00_000).toFixed(1)}L` : n >= 1_000 ? `${(n / 1_000).toFixed(0)}K` : String(n);
const fmtPrice = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
const fmtCr    = (n: number) => n >= 100 ? `₹${(n / 100).toFixed(1)}K Cr` : n >= 1 ? `₹${n.toFixed(1)} Cr` : `₹${(n * 100).toFixed(0)}L`;

function Th({ col, label, right, active, dir, onSort }: {
  col: SortKey; label: string; right?: boolean; active: boolean; dir: SortDir;
  onSort: (c: SortKey) => void;
}) {
  return (
    <th onClick={() => onSort(col)}
      className={`px-3 py-3 text-[10px] font-semibold uppercase tracking-wider cursor-pointer select-none whitespace-nowrap
        ${right ? 'text-right' : 'text-left'} ${active ? 'text-white' : 'text-slate-500 hover:text-slate-300'}`}>
      <span className="inline-flex items-center gap-0.5">
        {label}
        {active && (dir === 'desc' ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />)}
      </span>
    </th>
  );
}

export default function SuperInvestorPage() {
  const [signals,    setSignals]    = useState<Signal[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [sortKey,    setSortKey]    = useState<SortKey>('signal_date');
  const [sortDir,    setSortDir]    = useState<SortDir>('desc');
  const [filter,     setFilter]     = useState<FilterType>('all');
  const [search,     setSearch]     = useState('');
  const [triggering, setTriggering] = useState(false);
  const [msg,        setMsg]        = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const r = await sb('super_investor_signals?select=*&order=signal_date.desc,trade_value_cr.desc&limit=1000');
      if (!Array.isArray(r)) throw new Error(JSON.stringify(r));
      setSignals(r);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const dispatch = async () => {
    setTriggering(true); setMsg('');
    try {
      const r = await fetch('/api/super-investor-trigger', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      });
      const d = await r.json();
      setMsg(d.ok ? `✓ ${d.message}` : `✗ ${d.error}`);
    } catch { setMsg('✗ Network error'); }
    finally { setTriggering(false); }
  };

  const filtered = useMemo(() => {
    let rows = signals;
    if (filter === 'buy')   rows = rows.filter(r => r.transaction_type === 'BUY');
    if (filter === 'sell')  rows = rows.filter(r => r.transaction_type === 'SELL');
    if (filter === 'bulk')  rows = rows.filter(r => r.deal_type === 'BULK');
    if (filter === 'block') rows = rows.filter(r => r.deal_type === 'BLOCK');
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(r =>
        r.ticker.toLowerCase().includes(q) ||
        r.client_name.toLowerCase().includes(q)
      );
    }
    return rows;
  }, [signals, filter, search]);

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    const d = sortDir === 'desc' ? -1 : 1;
    if (sortKey === 'signal_date') return d * a.signal_date.localeCompare(b.signal_date);
    if (sortKey === 'ticker')      return d * a.ticker.localeCompare(b.ticker);
    if (sortKey === 'client_name') return d * a.client_name.localeCompare(b.client_name);
    const va = a[sortKey] ?? -Infinity, vb = b[sortKey] ?? -Infinity;
    return d * (va - vb);
  }), [filtered, sortKey, sortDir]);

  const onSort = (col: SortKey) => {
    if (sortKey === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(col); setSortDir('desc'); }
  };

  // Summary stats
  const totalBuyVal  = signals.filter(s => s.transaction_type === 'BUY').reduce((a, b) => a + b.trade_value_cr, 0);
  const totalSellVal = signals.filter(s => s.transaction_type === 'SELL').reduce((a, b) => a + b.trade_value_cr, 0);
  const uniqueStocks = new Set(signals.map(s => s.ticker)).size;
  const uniqueInv    = new Set(signals.map(s => s.client_name)).size;
  const buys         = signals.filter(s => s.transaction_type === 'BUY').length;
  const sells        = signals.filter(s => s.transaction_type === 'SELL').length;

  return (
    <div className="min-h-screen bg-[#070c14] text-white">

      {/* Ambient gradient */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-yellow-600/6 rounded-full blur-3xl" />
        <div className="absolute top-1/3 right-0 w-64 h-64 bg-amber-600/5 rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-[1920px] mx-auto px-3 md:px-6 pt-5 pb-10 space-y-5">

        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <Link href="/" className="inline-flex items-center gap-1.5 text-slate-500 hover:text-slate-300 text-xs mb-3 transition">
              <ArrowLeft className="w-3 h-3" /> Confluence Hub
            </Link>
            <div className="flex items-center gap-3">
              <Crown className="w-5 h-5 text-yellow-400" />
              <h1 className="text-2xl md:text-3xl font-black tracking-tight text-white">Super Investor Flow</h1>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-400 border border-yellow-500/25">
                NSE Bulk · Block
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              Curated smart money — Parikh family · Kacholia · Rare Enterprises · Goldman · Nalanda · White Oak and more
            </p>
          </div>

          <button onClick={dispatch} disabled={triggering}
            className="flex items-center gap-1.5 px-3 py-2 bg-yellow-700/60 hover:bg-yellow-600/70 text-white rounded-lg text-xs font-semibold disabled:opacity-40 transition mt-8">
            {triggering ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Crown className="w-3 h-3" />}
            Run Engine
          </button>
        </div>

        {/* ── Status message ── */}
        {msg && (
          <div className={`text-xs px-4 py-2 rounded-lg border backdrop-blur-sm ${msg.startsWith('✓') ? 'bg-emerald-900/30 border-emerald-700/40 text-emerald-300' : 'bg-red-900/30 border-red-700/40 text-red-300'}`}>
            {msg}
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 bg-red-900/20 border border-red-700/30 rounded-xl p-3 text-red-300 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}

        {/* ── Stats bar ── */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5">
          {[
            { label: 'Total Signals', val: loading ? '…' : String(signals.length),  color: 'text-white',        border: 'border-slate-700/40', bg: 'bg-white/[0.03]' },
            { label: 'Stocks',        val: loading ? '…' : String(uniqueStocks),     color: 'text-yellow-400',   border: 'border-yellow-500/25', bg: 'bg-yellow-500/6' },
            { label: 'Investors',     val: loading ? '…' : String(uniqueInv),        color: 'text-amber-400',    border: 'border-amber-500/25',  bg: 'bg-amber-500/6' },
            { label: '🟢 Buys',       val: loading ? '…' : String(buys),             color: 'text-emerald-400',  border: 'border-emerald-500/25',bg: 'bg-emerald-500/6' },
            { label: '🔴 Sells',      val: loading ? '…' : String(sells),            color: 'text-red-400',      border: 'border-red-500/25',    bg: 'bg-red-500/6' },
            { label: 'Net Flow',
              val: loading ? '…' : (totalBuyVal - totalSellVal >= 0 ? '+' : '') + fmtCr(totalBuyVal - totalSellVal),
              color: totalBuyVal >= totalSellVal ? 'text-emerald-400' : 'text-red-400',
              border: 'border-slate-700/40', bg: 'bg-white/[0.03]' },
          ].map(s => (
            <div key={s.label} className={`px-3 py-2.5 rounded-xl border ${s.border} ${s.bg} backdrop-blur-sm`}>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">{s.label}</div>
              <div className={`text-lg font-black ${s.color}`}>{s.val}</div>
            </div>
          ))}
        </div>

        {/* ── Filters + Search ── */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            {([
              ['all',   'All'],
              ['buy',   '🟢 BUY only'],
              ['sell',  '🔴 SELL only'],
              ['bulk',  'Bulk Deals'],
              ['block', 'Block Deals'],
            ] as [FilterType, string][]).map(([v, l]) => (
              <button key={v} onClick={() => setFilter(v)}
                className={`px-2.5 py-1 text-[11px] rounded-full font-medium whitespace-nowrap transition-all
                  ${filter === v
                    ? 'bg-white/15 text-white border border-white/20'
                    : 'bg-white/[0.03] text-slate-500 border border-white/5 hover:text-slate-300 hover:bg-white/8'}`}>
                {l}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative ml-auto">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500" />
            <input
              type="text"
              placeholder="Search stock or investor…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-7 pr-3 py-1.5 bg-white/[0.04] border border-white/8 rounded-lg text-xs text-white placeholder-slate-600 focus:outline-none focus:border-yellow-500/40 w-52"
            />
          </div>

          <button onClick={load} disabled={loading}
            className="p-1.5 bg-white/5 hover:bg-white/10 border border-slate-700/50 rounded-lg disabled:opacity-40 transition">
            <RefreshCw className={`w-3.5 h-3.5 text-slate-400 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* ── Table ── */}
        {loading ? (
          <div className="flex items-center justify-center py-16 gap-3 text-slate-500">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span className="text-sm">Loading super investor flow…</span>
          </div>
        ) : sorted.length === 0 ? (
          <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-14 text-center">
            <div className="text-4xl mb-3">🏦</div>
            <p className="text-slate-400 font-semibold">No super investor trades found</p>
            <p className="text-slate-600 text-xs mt-1">
              {signals.length === 0
                ? 'Run the engine or wait for first market-day cron (7 PM IST Mon-Fri)'
                : 'Try changing the filter or search term'}
            </p>
          </div>
        ) : (
          <div className="bg-white/[0.025] border border-white/8 rounded-2xl overflow-hidden backdrop-blur-sm">
            <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: 'calc(100vh - 340px)', minHeight: '300px' }}>
              <table className="w-full text-xs border-collapse" style={{ minWidth: '900px' }}>
                <thead className="sticky top-0 z-20">
                  <tr className="bg-[#0a1018] border-b border-white/8">
                    <Th col="signal_date"  label="Date"        active={sortKey === 'signal_date'}  dir={sortDir} onSort={onSort} />
                    <Th col="ticker"       label="Ticker"      active={sortKey === 'ticker'}       dir={sortDir} onSort={onSort} />
                    <Th col="client_name"  label="Investor"    active={sortKey === 'client_name'}  dir={sortDir} onSort={onSort} />
                    <th className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">Type</th>
                    <th className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">Deal</th>
                    <Th col="net_quantity"  label="Quantity"   right active={sortKey === 'net_quantity'}  dir={sortDir} onSort={onSort} />
                    <Th col="avg_price"    label="Avg Price"   right active={sortKey === 'avg_price'}    dir={sortDir} onSort={onSort} />
                    <Th col="trade_value_cr" label="Value"     right active={sortKey === 'trade_value_cr'} dir={sortDir} onSort={onSort} />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((row, i) => {
                    const isBuy = row.transaction_type === 'BUY';
                    return (
                      <tr key={`${row.ticker}-${row.client_name}-${row.signal_date}-${i}`}
                        className={`border-b border-white/4 transition-colors ${isBuy ? 'hover:bg-emerald-950/15' : 'hover:bg-red-950/15'}`}>

                        {/* Date */}
                        <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap text-[11px]">
                          {fmtDate(row.signal_date)}
                        </td>

                        {/* Ticker */}
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <a href={`https://www.screener.in/company/${row.ticker}/`}
                            target="_blank" rel="noopener noreferrer"
                            className="font-black text-white hover:text-yellow-400 transition text-sm">
                            {row.ticker}
                          </a>
                        </td>

                        {/* Investor */}
                        <td className="px-3 py-2.5">
                          <div className="text-[11px] text-slate-300 font-medium max-w-[220px] leading-tight">
                            {row.client_name.length > 35
                              ? row.client_name.slice(0, 35) + '…'
                              : row.client_name}
                          </div>
                        </td>

                        {/* Type */}
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border
                            ${isBuy
                              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25'
                              : 'bg-red-500/15 text-red-300 border-red-500/25'}`}>
                            {isBuy
                              ? <TrendingUp className="w-2.5 h-2.5" />
                              : <TrendingDown className="w-2.5 h-2.5" />}
                            {row.transaction_type}
                          </span>
                        </td>

                        {/* Deal type */}
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border
                            ${row.deal_type === 'BULK'
                              ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                              : 'bg-purple-500/10 text-purple-400 border-purple-500/20'}`}>
                            {row.deal_type}
                          </span>
                        </td>

                        {/* Quantity */}
                        <td className="px-3 py-2.5 text-right whitespace-nowrap">
                          <span className="text-slate-300 font-semibold">{fmtQty(row.net_quantity)}</span>
                        </td>

                        {/* Avg Price */}
                        <td className="px-3 py-2.5 text-right whitespace-nowrap">
                          <span className="text-slate-300">{fmtPrice(row.avg_price)}</span>
                        </td>

                        {/* Value */}
                        <td className="px-3 py-2.5 text-right whitespace-nowrap">
                          <span className={`font-black text-sm ${isBuy ? 'text-emerald-400' : 'text-red-400'}`}>
                            {fmtCr(row.trade_value_cr)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Footer */}
            <div className="px-4 py-2.5 border-t border-white/5 flex flex-wrap justify-between items-center gap-2 text-[10px] text-slate-600">
              <span>
                {sorted.length} of {signals.length} trades
                · Buy ₹{fmtCr(totalBuyVal)} · Sell ₹{fmtCr(totalSellVal)}
              </span>
              <span>Bulk/Block deals · HFT blacklisted · Min ₹5 Cr · VPS cron 7 PM IST Mon-Fri</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

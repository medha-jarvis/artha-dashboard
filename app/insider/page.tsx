'use client';
import { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, RefreshCw, AlertCircle, TrendingUp, TrendingDown,
  ChevronUp, ChevronDown, Clock, Zap, BarChart2, Archive,
} from 'lucide-react';
import { InfoTooltip } from '../components/InfoTooltip';

const sb = (p: string) => fetch(`/api/sb/${p}`, { cache: 'no-store' }).then(r => r.json());

// ── Types ────────────────────────────────────────────────────────────────────────
interface PromoterSignal {
  id: string; ticker: string; company_name: string | null;
  submission_date: string; quarter_label: string | null;
  promoter_pct: number | null; promoter_pct_prev: number | null;
  promoter_delta: number | null; pledge_pct: number | null;
  pledge_delta: number | null; has_pledge_data: boolean;
  conviction_score: number; tier: string; signal_type: string;
  noise_flags: string | null; ema150_distance_pct: number | null;
  actual_return_3m: number | null; actual_return_1y: number | null;
}
interface BulkSignal {
  id: string; ticker: string; company_name: string | null;
  signal_date: string; client_name: string; transaction_type: string;
  trade_value_cr: number | null; match_type: string | null;
  conviction_score: number; tier: string; noise_flags: string | null;
  actual_return_3m: number | null;
}
interface PitSignal {
  id: string; ticker: string; company_name: string | null;
  acquirer_name: string; transaction_type: 'BUY' | 'SELL'; signal_date: string;
  insider_score: number; trade_value_in_cr: number | null;
  ema150_distance_pct: number | null; cluster_trade_flag: boolean; tier: string;
}

type TabId = 'live' | 'trend' | 'pit';

// ── Helpers ──────────────────────────────────────────────────────────────────────
function relDate(s: string): string {
  const d = Math.floor((Date.now() - new Date(s + 'T00:00:00Z').getTime()) / 86400000);
  if (d === 0) return 'today';
  if (d === 1) return '1d ago';
  if (d < 7)  return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  return `${Math.floor(d / 30)}mo ago`;
}
function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
function fmtCr(v: number | null) { return v != null ? `₹${v.toFixed(1)}Cr` : '—'; }
function fmtPct(v: number | null, plus = true) {
  if (v == null) return '—';
  return `${plus && v > 0 ? '+' : ''}${v.toFixed(2)}%`;
}
function retCls(v: number | null) {
  if (v == null) return 'text-slate-500';
  return v >= 15 ? 'text-emerald-400 font-semibold' : v >= 0 ? 'text-emerald-500' : 'text-red-400';
}
function emaCls(v: number | null) {
  if (v == null) return 'text-slate-600';
  return v < 0 ? 'text-red-400' : v <= 10 ? 'text-emerald-400' : 'text-amber-400';
}
function tierBadge(tier: string, small = false) {
  const sz = small ? 'text-[9px] px-1 py-0.5' : 'text-[10px] px-1.5 py-0.5';
  if (tier === 'HIGH CONVICTION') return `${sz} bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded font-bold`;
  if (tier === 'NOTABLE')         return `${sz} bg-amber-500/15 text-amber-400 border border-amber-500/30 rounded font-bold`;
  if (tier === 'BEARISH')         return `${sz} bg-red-500/15 text-red-400 border border-red-500/30 rounded`;
  return `${sz} bg-slate-700/40 text-slate-500 rounded`;
}

const SIGNAL_TYPE_META: Record<string, { label: string; color: string; icon: string }> = {
  ACCUMULATION:       { label: 'STAKE UP',     color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30', icon: '▲' },
  DISTRIBUTION:       { label: 'STAKE DOWN',   color: 'bg-red-500/20 text-red-400 border-red-500/30',             icon: '▼' },
  PLEDGE_ALARM:       { label: 'PLEDGE ALARM', color: 'bg-red-600/25 text-red-300 border-red-600/40',             icon: '⚠' },
  PLEDGE_CLEAR:       { label: 'PLEDGE CLEAR', color: 'bg-emerald-600/20 text-emerald-300 border-emerald-500/30', icon: '✓' },
  PLEDGE_INVOCATION:  { label: 'PLEDGE INVOK', color: 'bg-red-700/30 text-red-300 border-red-700/50',             icon: '!' },
  BULK_BUY:           { label: 'BULK BUY',     color: 'bg-blue-500/20 text-blue-400 border-blue-500/30',          icon: '↑' },
  BULK_SELL:          { label: 'BULK SELL',    color: 'bg-orange-500/20 text-orange-400 border-orange-500/30',    icon: '↓' },
};

function SignalBadge({ type }: { type: string }) {
  const m = SIGNAL_TYPE_META[type] || { label: type, color: 'bg-slate-700/40 text-slate-400 border-slate-600/30', icon: '·' };
  return <span className={`inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded border ${m.color}`}>{m.icon} {m.label}</span>;
}

function NoiseFlags({ flags }: { flags: string | null }) {
  if (!flags) return null;
  const list = flags.split('|').filter(f => f !== 'FIRST_SIGNAL');
  if (!list.length) return null;
  return (
    <div className="flex flex-wrap gap-0.5 mt-0.5">
      {list.map(f => <span key={f} className="text-[8px] bg-slate-800 text-slate-500 px-1 py-0.5 rounded">{f.replace(/_/g, ' ')}</span>)}
    </div>
  );
}

// ── Summary Cards ────────────────────────────────────────────────────────────────
function SummaryCards({ buys, sells, pledgeAlerts, highConv }: { buys: number; sells: number; pledgeAlerts: number; highConv: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
      {[
        { l: '🟢 BUY Signals (30d)', v: buys,        c: 'text-emerald-400' },
        { l: '🔴 SELL Signals (30d)', v: sells,       c: 'text-red-400' },
        { l: '⚠ Pledge Alerts',      v: pledgeAlerts, c: 'text-red-300' },
        { l: '🔥 High Conviction',   v: highConv,     c: 'text-amber-400' },
      ].map(s => (
        <div key={s.l} className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-center">
          <div className="text-[10px] text-slate-500 mb-1 whitespace-nowrap">{s.l}</div>
          <div className={`text-xl font-black ${s.c}`}>{s.v}</div>
        </div>
      ))}
    </div>
  );
}

// ── Tab 1: Live Signals ──────────────────────────────────────────────────────────
function LiveSignalsTab() {
  const [shp, setShp]   = useState<PromoterSignal[]>([]);
  const [bulk, setBulk] = useState<BulkSignal[]>([]);
  const [loading, setL] = useState(true);
  const [error, setE]   = useState('');
  const [triggering, setT] = useState(false);
  const [msg, setM]     = useState('');
  const [countdown, setC] = useState(0);
  const cdRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = async () => {
    setL(true); setE('');
    try {
      const cutoff90 = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
      const cutoff30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const [shpRes, bulkRes] = await Promise.all([
        sb(`promoter_signals?select=*&conviction_score=gte.50&submission_date=gte.${cutoff90}&order=submission_date.desc,conviction_score.desc&limit=200`),
        sb(`promoter_bulk_signals?select=*&signal_date=gte.${cutoff30}&order=signal_date.desc,conviction_score.desc&limit=100`),
      ]);
      setShp(Array.isArray(shpRes) ? shpRes : []);
      setBulk(Array.isArray(bulkRes) ? bulkRes : []);
    } catch (e: unknown) { setE(e instanceof Error ? e.message : 'Failed'); }
    finally { setL(false); }
  };

  useEffect(() => { load(); return () => { if (cdRef.current) clearInterval(cdRef.current); }; }, []);

  const dispatch = async () => {
    setT(true); setM('');
    if (cdRef.current) { clearInterval(cdRef.current); setC(0); }
    try {
      const r = await fetch('/api/promoter-intel-trigger', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const d = await r.json();
      if (d.ok) {
        setM(`✓ Engine launched (PID ${d.pid}) — auto-refreshing in ~5m`);
        let secs = 300; setC(secs);
        cdRef.current = setInterval(() => {
          secs--; setC(secs);
          if (secs <= 0) { clearInterval(cdRef.current!); cdRef.current = null; setC(0); load(); }
        }, 1000);
      } else { setM(`✗ ${d.error}`); }
    } catch { setM('✗ Network error'); }
    finally { setT(false); }
  };

  // Blended feed sorted by date desc
  type BlendedRow = { id: string; ticker: string; company: string | null; date: string; signalType: string; amount: string; delta: string | null; pledge: string | null; score: number; tier: string; flags: string | null; ret3m: number | null; source: 'SHP' | 'BULK'; };
  const blended: BlendedRow[] = useMemo(() => {
    const shpRows: BlendedRow[] = shp.map(s => ({
      id: s.id, ticker: s.ticker, company: s.company_name, date: s.submission_date,
      signalType: s.signal_type, amount: s.promoter_delta != null ? fmtPct(s.promoter_delta) : '—',
      delta: s.promoter_delta != null ? fmtPct(s.promoter_delta) : null,
      pledge: s.pledge_pct != null ? `${s.pledge_pct.toFixed(1)}%` : null,
      score: s.conviction_score, tier: s.tier, flags: s.noise_flags,
      ret3m: s.actual_return_3m, source: 'SHP',
    }));
    const bulkRows: BlendedRow[] = bulk.map(b => ({
      id: b.id, ticker: b.ticker, company: b.company_name, date: b.signal_date,
      signalType: b.transaction_type === 'BUY' ? 'BULK_BUY' : 'BULK_SELL',
      amount: fmtCr(b.trade_value_cr), delta: null,
      pledge: null, score: b.conviction_score, tier: b.tier, flags: b.noise_flags,
      ret3m: b.actual_return_3m, source: 'BULK',
    }));
    return [...shpRows, ...bulkRows].sort((a, b) => b.date.localeCompare(a.date));
  }, [shp, bulk]);

  const buys     = bulk.filter(b => b.transaction_type === 'BUY').length + shp.filter(s => s.signal_type === 'ACCUMULATION').length;
  const sells    = bulk.filter(b => b.transaction_type === 'SELL').length + shp.filter(s => s.signal_type === 'DISTRIBUTION').length;
  const alerts   = shp.filter(s => s.signal_type === 'PLEDGE_ALARM' || s.signal_type === 'PLEDGE_INVOCATION').length;
  const highConv = blended.filter(r => r.tier === 'HIGH CONVICTION').length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">Blended feed: SHP stake changes + promoter bulk deals · Last 90 days</p>
        <div className="flex gap-2">
          <button onClick={dispatch} disabled={triggering || countdown > 0}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-700 hover:bg-violet-600 text-white rounded text-xs font-semibold disabled:opacity-50 transition">
            {countdown > 0
              ? <><Clock className="w-3 h-3 animate-pulse" />{Math.floor(countdown / 60)}m{countdown % 60}s</>
              : <><Zap className={`w-3 h-3 ${triggering ? 'animate-pulse' : ''}`} />Run Engine</>}
          </button>
          <button onClick={load} disabled={loading}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {msg && <div className={`text-xs px-4 py-2.5 rounded-lg border ${msg.startsWith('✓') ? 'bg-emerald-900/30 border-emerald-700/40 text-emerald-300' : 'bg-red-900/30 border-red-700/40 text-red-300'}`}>{msg}</div>}
      {error && <div className="flex items-center gap-2 bg-red-900/30 border border-red-700/40 rounded-lg p-3 text-red-300 text-xs"><AlertCircle className="w-4 h-4 shrink-0" />{error}</div>}

      {!loading && <SummaryCards buys={buys} sells={sells} pledgeAlerts={alerts} highConv={highConv} />}

      {loading ? <div className="text-center py-20 text-slate-500 text-sm">Loading…</div>
        : blended.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-16 text-center">
            <Zap className="w-8 h-8 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400 font-semibold">No signals yet</p>
            <p className="text-slate-500 text-xs mt-1">Run the engine or wait for 7:30 PM IST cron · Run seeder for 5y history</p>
            <button onClick={dispatch} disabled={triggering} className="mt-4 px-4 py-2 bg-violet-700 hover:bg-violet-600 text-white rounded text-xs font-semibold transition">⚡ Run Engine</button>
          </div>
        ) : (
          <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
            <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: 'min(680px,calc(100vh-320px))' }}>
              <table className="w-full text-xs border-collapse" style={{ minWidth: '820px' }}>
                <thead className="sticky top-0 z-20">
                  <tr className="bg-[#161b22] border-b-2 border-slate-700">
                    <th className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400 sticky left-0 bg-[#161b22] z-30">Ticker</th>
                    <th className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">Signal</th>
                    <th className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">Date</th>
                    <th className="px-3 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      Amount / Delta <InfoTooltip title="Amount / Delta" content="For SHP signals: the change in promoter holding %. For bulk deals: trade value in ₹Cr." />
                    </th>
                    <th className="px-3 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      Pledge % <InfoTooltip title="Pledge %" content="Current % of promoter shares pledged as collateral. High pledge (>30%) is a risk flag. Falling pledge is bullish." />
                    </th>
                    <th className="px-3 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">Score</th>
                    <th className="px-3 py-3 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-500">Tier</th>
                    <th className="px-3 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      3m Return <InfoTooltip title="3-Month Return" content="Actual return from signal date +3 months. Validates track record. Blank = signal too recent." />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {blended.map(row => {
                    const isBuy = row.signalType === 'ACCUMULATION' || row.signalType === 'BULK_BUY';
                    const isAlarm = row.signalType === 'PLEDGE_ALARM' || row.signalType === 'PLEDGE_INVOCATION';
                    const rowBg = row.score >= 75
                      ? (isBuy && !isAlarm ? 'bg-emerald-950/15 hover:bg-emerald-950/30' : 'bg-red-950/15 hover:bg-red-950/30')
                      : 'hover:bg-slate-800/20';
                    const stkBg = row.score >= 75 ? (isBuy && !isAlarm ? '#0a1f12' : '#1a0505') : '#0d1117';
                    return (
                      <tr key={`${row.source}-${row.id}`} className={`border-b border-slate-800/50 transition-colors ${rowBg}`}>
                        <td className="px-3 py-2.5 sticky left-0 z-10 whitespace-nowrap" style={{ backgroundColor: stkBg }}>
                          <a href={`https://www.screener.in/company/${row.ticker}/`} target="_blank" rel="noopener noreferrer"
                            className="font-bold text-white hover:text-blue-400 text-sm transition">{row.ticker}</a>
                          {row.company && <div className="text-slate-500 text-[9px] truncate max-w-[110px]">{row.company}</div>}
                          <div className="text-[9px] text-slate-600">{row.source}</div>
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <SignalBadge type={row.signalType} />
                          <NoiseFlags flags={row.flags} />
                        </td>
                        <td className="px-3 py-2.5 text-slate-400 whitespace-nowrap">
                          <span className="font-medium">{relDate(row.date)}</span>
                          <div className="text-[9px] text-slate-600">{fmtDate(row.date)}</div>
                        </td>
                        <td className={`px-3 py-2.5 text-right whitespace-nowrap font-semibold ${isBuy ? 'text-emerald-400' : 'text-red-400'}`}>{row.amount}</td>
                        <td className={`px-3 py-2.5 text-right whitespace-nowrap ${row.pledge ? 'text-slate-300' : 'text-slate-600'}`}>{row.pledge ?? '—'}</td>
                        <td className={`px-3 py-2.5 text-right whitespace-nowrap text-base font-black ${row.score >= 75 ? 'text-emerald-400' : row.score >= 50 ? 'text-amber-400' : 'text-slate-400'}`}>{row.score}</td>
                        <td className="px-3 py-2.5 text-center whitespace-nowrap"><span className={tierBadge(row.tier)}>{row.tier === 'HIGH CONVICTION' ? 'HIGH CONV' : row.tier}</span></td>
                        <td className={`px-3 py-2.5 text-right whitespace-nowrap ${retCls(row.ret3m)}`}>{fmtPct(row.ret3m)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 border-t border-slate-800 flex justify-between text-[10px] text-slate-600">
              <span>{blended.length} signals ({shp.length} SHP + {bulk.length} bulk)</span>
              <span>NSE SHP + Bulk Deals · Runs 7:30 PM IST weekdays</span>
            </div>
          </div>
        )}
    </div>
  );
}

// ── Tab 2: Promoter Trend ────────────────────────────────────────────────────────
function PromoterTrendTab() {
  const [data, setData] = useState<PromoterSignal[]>([]);
  const [loading, setL] = useState(true);
  const [error, setE]   = useState('');

  useEffect(() => {
    (async () => {
      setL(true); setE('');
      try {
        const r = await sb('promoter_signals?select=ticker,company_name,submission_date,quarter_label,promoter_pct,promoter_delta,pledge_pct,conviction_score,tier,signal_type,noise_flags,actual_return_3m&order=ticker.asc,submission_date.desc&limit=2000');
        setData(Array.isArray(r) ? r : []);
      } catch (e: unknown) { setE(e instanceof Error ? e.message : 'Failed'); }
      finally { setL(false); }
    })();
  }, []);

  // Group by ticker, keep last 4 quarters
  const byTicker = useMemo(() => {
    const map = new Map<string, PromoterSignal[]>();
    for (const row of data) {
      const arr = map.get(row.ticker) || [];
      arr.push(row);
      map.set(row.ticker, arr);
    }
    // Sort each ticker's entries by date desc, keep 4
    const result: Array<{ ticker: string; company: string | null; rows: PromoterSignal[] }> = [];
    for (const [ticker, rows] of map.entries()) {
      rows.sort((a, b) => b.submission_date.localeCompare(a.submission_date));
      result.push({ ticker, company: rows[0]?.company_name ?? null, rows: rows.slice(0, 4) });
    }
    // Sort by latest conviction score desc
    result.sort((a, b) => (b.rows[0]?.conviction_score ?? 0) - (a.rows[0]?.conviction_score ?? 0));
    return result;
  }, [data]);

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">4-quarter accumulation/distribution patterns per ticker · Sorted by latest conviction score</p>
      {error && <div className="flex items-center gap-2 bg-red-900/30 border border-red-700/40 rounded-lg p-3 text-red-300 text-xs"><AlertCircle className="w-4 h-4 shrink-0" />{error}</div>}
      {loading ? <div className="text-center py-20 text-slate-500 text-sm">Loading…</div>
        : byTicker.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-16 text-center">
            <BarChart2 className="w-8 h-8 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400 font-semibold">No trend data yet</p>
            <p className="text-slate-500 text-xs mt-1">Run the 5-year seeder to populate historical data</p>
          </div>
        ) : (
          <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
            <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: 'min(680px,calc(100vh-280px))' }}>
              <table className="w-full text-xs border-collapse" style={{ minWidth: '760px' }}>
                <thead className="sticky top-0 z-20">
                  <tr className="bg-[#161b22] border-b-2 border-slate-700">
                    <th className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400 sticky left-0 bg-[#161b22] z-30">Ticker</th>
                    {['Latest', 'Q-1', 'Q-2', 'Q-3'].map(q => (
                      <th key={q} className="px-3 py-3 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-500">{q}</th>
                    ))}
                    <th className="px-3 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">Latest Score</th>
                    <th className="px-3 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">Pledge %</th>
                    <th className="px-3 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">3m Ret</th>
                  </tr>
                </thead>
                <tbody>
                  {byTicker.map(({ ticker, company, rows }) => {
                    const latest = rows[0];
                    const trend = rows.slice(0, 4);
                    return (
                      <tr key={ticker} className="border-b border-slate-800/50 hover:bg-slate-800/20 transition-colors">
                        <td className="px-3 py-2.5 sticky left-0 bg-[#0d1117] z-10 whitespace-nowrap">
                          <a href={`https://www.screener.in/company/${ticker}/`} target="_blank" rel="noopener noreferrer"
                            className="font-bold text-white hover:text-blue-400 text-sm transition">{ticker}</a>
                          {company && <div className="text-slate-500 text-[9px] truncate max-w-[100px]">{company}</div>}
                        </td>
                        {[0, 1, 2, 3].map(i => {
                          const r = trend[i];
                          if (!r) return <td key={i} className="px-3 py-2.5 text-center text-slate-700">—</td>;
                          const delta = r.promoter_delta;
                          const isUp  = delta != null && delta > 0;
                          const isDown = delta != null && delta < 0;
                          return (
                            <td key={i} className="px-3 py-2.5 text-center whitespace-nowrap">
                              <div className="flex flex-col items-center gap-0.5">
                                <span className={`text-[10px] font-semibold flex items-center gap-0.5 ${isUp ? 'text-emerald-400' : isDown ? 'text-red-400' : 'text-slate-500'}`}>
                                  {isUp ? <TrendingUp className="w-3 h-3" /> : isDown ? <TrendingDown className="w-3 h-3" /> : null}
                                  {delta != null ? fmtPct(delta) : '—'}
                                </span>
                                <span className="text-[8px] text-slate-600">{r.quarter_label ?? fmtDate(r.submission_date)}</span>
                              </div>
                            </td>
                          );
                        })}
                        <td className={`px-3 py-2.5 text-right whitespace-nowrap font-black text-sm ${latest.conviction_score >= 75 ? 'text-emerald-400' : latest.conviction_score >= 50 ? 'text-amber-400' : 'text-slate-400'}`}>
                          {latest.conviction_score}
                        </td>
                        <td className={`px-3 py-2.5 text-right whitespace-nowrap ${latest.pledge_pct != null && latest.pledge_pct > 30 ? 'text-red-400' : 'text-slate-400'}`}>
                          {latest.pledge_pct != null ? `${latest.pledge_pct.toFixed(1)}%` : '—'}
                        </td>
                        <td className={`px-3 py-2.5 text-right whitespace-nowrap ${retCls(latest.actual_return_3m)}`}>
                          {fmtPct(latest.actual_return_3m)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 border-t border-slate-800 text-[10px] text-slate-600">
              {byTicker.length} tickers · {data.length} total SHP signals · Pledge &gt;30% = risk flag
            </div>
          </div>
        )}
    </div>
  );
}

// ── Tab 3: Historical PIT ────────────────────────────────────────────────────────
function HistoricalPitTab() {
  const [sigs, setS]    = useState<PitSignal[]>([]);
  const [loading, setL] = useState(true);
  const [error, setE]   = useState('');

  useEffect(() => {
    (async () => {
      setL(true); setE('');
      try {
        const r = await sb('insider_signals?select=*&order=insider_score.desc&limit=500');
        setS(Array.isArray(r) ? r : []);
      } catch (e: unknown) { setE(e instanceof Error ? e.message : 'Failed'); }
      finally { setL(false); }
    })();
  }, []);

  const maxDate = sigs.length > 0 ? sigs.reduce((m, s) => s.signal_date > m ? s.signal_date : m, sigs[0].signal_date) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2.5 bg-amber-900/20 border border-amber-700/40 rounded-lg p-3">
        <Clock className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <div className="text-xs text-amber-200">
          <span className="font-semibold text-amber-300">Archived — NSE PIT API frozen since Apr 30, 2026</span>
          {' '}(XBRL migration). Last record: {maxDate ? fmtDate(maxDate) : '—'}. Use <span className="font-semibold">Live Signals</span> tab for current data.
        </div>
      </div>

      {error && <div className="flex items-center gap-2 bg-red-900/30 border border-red-700/40 rounded-lg p-3 text-red-300 text-xs"><AlertCircle className="w-4 h-4 shrink-0" />{error}</div>}

      {loading ? <div className="text-center py-20 text-slate-500 text-sm">Loading…</div>
        : sigs.length === 0 ? <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center text-slate-500 text-sm">No archived signals</div>
        : (
          <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
            <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: 'min(620px,calc(100vh-320px))' }}>
              <table className="w-full text-xs border-collapse" style={{ minWidth: '760px' }}>
                <thead className="sticky top-0 z-20">
                  <tr className="bg-[#161b22] border-b-2 border-slate-700">
                    <th className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400 sticky left-0 bg-[#161b22] z-30">Ticker</th>
                    <th className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">Type</th>
                    <th className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">Date</th>
                    <th className="px-3 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">Score</th>
                    <th className="px-3 py-3 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-500">Tier</th>
                    <th className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">Acquirer</th>
                    <th className="px-3 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">Value</th>
                    <th className="px-3 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">EMA150</th>
                  </tr>
                </thead>
                <tbody>
                  {sigs.map(s => {
                    const isBuy = s.transaction_type === 'BUY';
                    return (
                      <tr key={s.id} className="border-b border-slate-800/50 hover:bg-slate-800/20 transition-colors opacity-80">
                        <td className="px-3 py-2.5 sticky left-0 bg-[#0d1117] z-10 whitespace-nowrap">
                          <span className="font-bold text-slate-300 text-sm">{s.ticker}</span>
                          {s.company_name && <div className="text-slate-600 text-[9px] truncate max-w-[110px]">{s.company_name}</div>}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <span className={`text-xs font-bold flex items-center gap-1 ${isBuy ? 'text-emerald-500' : 'text-red-500'}`}>
                            {isBuy ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}{s.transaction_type}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{fmtDate(s.signal_date)}</td>
                        <td className={`px-3 py-2.5 text-right whitespace-nowrap font-black text-sm ${s.insider_score >= 75 ? 'text-emerald-500' : s.insider_score >= 50 ? 'text-amber-500' : 'text-slate-500'}`}>{s.insider_score}</td>
                        <td className="px-3 py-2.5 text-center"><span className={tierBadge(s.tier, true)}>{s.tier === 'HIGH CONVICTION' ? 'HIGH CONV' : s.tier}</span></td>
                        <td className="px-3 py-2.5 text-slate-400 truncate max-w-[150px]">{s.acquirer_name}</td>
                        <td className="px-3 py-2.5 text-right text-slate-400 whitespace-nowrap">{fmtCr(s.trade_value_in_cr)}</td>
                        <td className={`px-3 py-2.5 text-right whitespace-nowrap ${emaCls(s.ema150_distance_pct)}`}>{fmtPct(s.ema150_distance_pct)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 border-t border-slate-800 text-[10px] text-slate-600">
              {sigs.length} archived PIT signals · Source: NSE corporates-pit (frozen Apr 30, 2026)
            </div>
          </div>
        )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────────
const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'live',  label: 'Live Signals',    icon: <Zap className="w-3.5 h-3.5" /> },
  { id: 'trend', label: 'Promoter Trend',  icon: <BarChart2 className="w-3.5 h-3.5" /> },
  { id: 'pit',   label: 'Historical PIT',  icon: <Archive className="w-3.5 h-3.5" /> },
];

export default function InsiderPage() {
  const [tab, setTab] = useState<TabId>('live');

  return (
    <div className="min-h-screen bg-[#0d1117] p-3 md:p-5">
      <div className="max-w-6xl mx-auto space-y-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Link href="/" className="text-slate-500 hover:text-slate-300"><ArrowLeft className="w-4 h-4" /></Link>
              <Zap className="w-5 h-5 text-violet-400" />
              <h1 className="text-lg font-black text-white">Promoter Intelligence Center</h1>
            </div>
            <p className="text-xs text-slate-500 ml-11">
              NSE SHP stake changes + promoter bulk deals · Dual-stream · 7:30 PM IST weekdays
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-1 gap-1 w-fit">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded font-medium transition ${tab === t.id ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'}`}>
              {t.icon}{t.label}
              {t.id === 'pit' && <span className="text-[8px] bg-amber-700/40 text-amber-400 px-1 rounded ml-0.5">ARCHIVED</span>}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {tab === 'live'  && <LiveSignalsTab />}
        {tab === 'trend' && <PromoterTrendTab />}
        {tab === 'pit'   && <HistoricalPitTab />}
      </div>
    </div>
  );
}

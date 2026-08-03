'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, TrendingUp, TrendingDown, AlertCircle, Eye, BarChart2, Info } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, BarChart, Bar, Cell,
} from 'recharts';


const sb = (p: string) =>
  fetch(`/api/sb/${p}`, { cache: 'no-store' }).then(r => r.json());

interface Signal {
  id: string;
  ticker: string;
  company_name: string | null;
  acquirer_name: string;
  transaction_type: 'BUY' | 'SELL';
  signal_date: string;
  insider_score: number;
  trade_value_in_cr: number | null;
  equity_pct_traded: number | null;
  ema150_distance_pct: number | null;
  cluster_trade_flag: boolean;
  tier: string;
  promoter_historical_6m_return: number | null;
  actual_return_3m: number | null;
  actual_return_6m: number | null;
  actual_return_1y: number | null;
}

interface ReturnData {
  base_price: number | null;
  return_30d: number | null;
  return_90d: number | null;
  return_180d: number | null;
  return_current: number | null;
  chart_data: { date: string; price: number | null }[];
}

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr + 'T00:00:00Z').getTime()) / 86400000);
}

function fmtDate(s: string) {
  return new Date(s + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
}

// Mirrors insider_engine.py v2 scoring: Magnitude 20 + Credibility 60 + Context 20 = 100
function computeBreakdown(s: Signal, allAcquirerSignals: Signal[]) {
  const cr  = s.trade_value_in_cr ?? 0;
  const ep  = s.equity_pct_traded ?? null;
  const ema = s.ema150_distance_pct ?? null;
  const tx  = s.transaction_type;

  // Magnitude: 20pts
  let mag = 6, magReason = `₹${cr.toFixed(1)}Cr — below ₹1Cr threshold`;
  if (cr > 5 || (ep && ep > 1)) {
    mag = 20;
    magReason = cr > 5
      ? `₹${cr.toFixed(1)}Cr trade — above ₹5Cr high-conviction threshold`
      : `${ep?.toFixed(3)}% of free float — above 1% threshold`;
  } else if (cr > 1 || (ep && ep > 0.5)) {
    mag = 13;
    magReason = `₹${cr.toFixed(1)}Cr trade — moderate size (₹1–5Cr range)`;
  }

  // Credibility: 60pts — based on actual past returns (3m/6m/1y) across all trades by this acquirer
  const past = allAcquirerSignals.filter(h => h.id !== s.id);
  const r3   = past.map(h => h.actual_return_3m).filter((v): v is number => v !== null);
  const r6   = past.map(h => h.actual_return_6m).filter((v): v is number => v !== null);
  const r1y  = past.map(h => h.actual_return_1y).filter((v): v is number => v !== null);
  const m    = tx === 'BUY' ? 1 : -1;

  function credPts(vals: number[], neutral: number, thresholds: [number, number][]): number {
    if (vals.length === 0) return neutral;
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length * m;
    for (const [thresh, pts] of thresholds) { if (avg >= thresh) return pts; }
    return 0;
  }

  const s3   = credPts(r3,  10, [[15, 20], [8, 12], [0, 5]]);   // 20pt max
  const s6   = credPts(r6,  12, [[25, 25], [12, 15], [0, 6]]);  // 25pt max
  const s1y  = credPts(r1y,  8, [[40, 15], [20, 9], [0, 4]]);   // 15pt max
  const cred = s3 + s6 + s1y;

  let credReason: string;
  if (past.length === 0) {
    credReason = 'No prior signals from this acquirer — neutral (30/60)';
  } else if (r3.length === 0 && r6.length === 0) {
    credReason = `${past.length} prior signal(s) — returns pending (signals < 3 months old)`;
  } else {
    const avg6str = r6.length ? `avg 6m: ${(r6.reduce((a,b)=>a+b,0)/r6.length*m).toFixed(1)}%` : '';
    credReason = `${past.length} prior signal(s) across all stocks${avg6str ? ', ' + avg6str : ''}`;
  }
  const neutralCred = 30;
  const finalCred = past.length === 0 ? neutralCred : cred;

  // Context: 20pts
  let ctx = 0, ctxReason = 'EMA-150 data unavailable at time of signal';
  if (ema !== null) {
    if (tx === 'BUY') {
      if (ema <= 10)      { ctx = 20; ctxReason = `+${ema.toFixed(1)}% above EMA-150 — ideal buy zone (≤10%)`; }
      else if (ema <= 20) { ctx = 10; ctxReason = `+${ema.toFixed(1)}% above EMA-150 — acceptable buy zone (10–20%)`; }
      else                { ctx =  0; ctxReason = `+${ema.toFixed(1)}% above EMA-150 — extended, not ideal for buys`; }
    } else {
      if (ema >= 20)      { ctx = 20; ctxReason = `+${ema.toFixed(1)}% above EMA-150 — ideal sell zone (≥20%)`; }
      else if (ema >= 10) { ctx = 10; ctxReason = `+${ema.toFixed(1)}% above EMA-150 — acceptable sell zone`; }
      else                { ctx =  0; ctxReason = `+${ema.toFixed(1)}% above EMA-150 — near base, poor sell context`; }
    }
  }

  return [
    { label: 'Magnitude',   score: mag,        max: 20, reason: magReason,   color: mag === 20 ? '#10b981' : mag === 13 ? '#f59e0b' : '#475569' },
    { label: 'Credibility', score: finalCred,   max: 60, reason: credReason,  color: finalCred >= 45 ? '#10b981' : finalCred >= 25 ? '#f59e0b' : '#475569' },
    { label: 'Context',     score: ctx,         max: 20, reason: ctxReason,   color: ctx === 20 ? '#10b981' : ctx >= 10 ? '#f59e0b' : '#475569' },
  ];
}

const ReturnBadge = ({ val, size = 'sm' }: { val: number | null; size?: 'sm' | 'lg' }) => {
  if (val === null) return <span className="text-slate-600 text-xs">—</span>;
  const pos = val >= 0;
  const cls = size === 'lg' ? 'text-base font-black' : 'text-xs font-bold';
  return <span className={`${cls} ${pos ? 'text-emerald-400' : 'text-red-400'}`}>{pos ? '+' : ''}{val.toFixed(1)}%</span>;
};

export default function EvidencePage() {
  const { id } = useParams<{ id: string }>();
  const [signal, setSignal] = useState<Signal | null>(null);
  const [returns, setReturns] = useState<ReturnData | null>(null);
  const [history, setHistory] = useState<Signal[]>([]);
  const [histReturns, setHistReturns] = useState<Record<string, ReturnData>>({});
  const [tierSigs, setTierSigs] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const sigData = await sb(`insider_signals?select=*&id=eq.${id}&limit=1`);
        if (!Array.isArray(sigData) || !sigData[0]) throw new Error('Signal not found');
        const sig: Signal = sigData[0];
        setSignal(sig);

        const [histData, tierData] = await Promise.all([
          // Search by acquirer name across ALL tickers — promoters trade multiple group stocks
          sb(`insider_signals?select=*&acquirer_name=eq.${encodeURIComponent(sig.acquirer_name)}&order=signal_date.desc&limit=30`),
          sb(`insider_signals?select=*&tier=eq.${encodeURIComponent(sig.tier)}&order=insider_score.desc&limit=300`),
        ]);
        const hist: Signal[] = Array.isArray(histData) ? histData.filter((h: Signal) => h.id !== sig.id) : [];
        setHistory(hist);
        setTierSigs(Array.isArray(tierData) ? tierData : []);

        if (daysSince(sig.signal_date) >= 7) {
          fetch(`/api/insider-returns?ticker=${sig.ticker}&date=${sig.signal_date}`)
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (d && !d.error) setReturns(d); })
            .catch(() => {});
        }

        const fetchable = hist.filter(h => daysSince(h.signal_date) >= 30).slice(0, 8);
        if (fetchable.length > 0) {
          Promise.all(
            fetchable.map(h =>
              fetch(`/api/insider-returns?ticker=${h.ticker}&date=${h.signal_date}`)
                .then(r => r.ok ? r.json() : null)
                .then(d => ({ id: h.id, data: d }))
                .catch(() => ({ id: h.id, data: null }))
            )
          ).then(results => {
            const map: Record<string, ReturnData> = {};
            for (const { id: hid, data } of results) {
              if (hid && data && !data.error) map[hid] = data;
            }
            setHistReturns(map);
          });
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load evidence');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) return (
    <div className="min-h-screen bg-[#0d1117] flex items-center justify-center">
      <p className="text-slate-500 text-sm animate-pulse">Loading evidence…</p>
    </div>
  );
  if (error || !signal) return (
    <div className="min-h-screen bg-[#0d1117] flex items-center justify-center flex-col gap-4">
      <AlertCircle className="w-8 h-8 text-red-400" />
      <p className="text-red-400 text-sm">{error || 'Signal not found'}</p>
      <Link href="/insider" className="text-slate-400 hover:text-white text-xs">← Back to Insider Intelligence</Link>
    </div>
  );

  const breakdown = computeBreakdown(signal, history);
  const isBuy = signal.transaction_type === 'BUY';
  const tierCls = signal.tier === 'HIGH CONVICTION'
    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
    : signal.tier === 'NOTABLE'
      ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
      : 'bg-slate-700/40 text-slate-500 border border-slate-700/30';
  const scoreCls = signal.insider_score >= 75 ? 'text-emerald-400' : signal.insider_score >= 50 ? 'text-amber-400' : 'text-slate-400';

  const normalizedChart = returns?.chart_data
    .filter(d => d.price != null)
    .map(d => ({
      date: d.date,
      index: returns.base_price ? parseFloat(((d.price as number) / returns.base_price * 100).toFixed(2)) : null,
    })) || [];

  const buySigs = tierSigs.filter(s => s.transaction_type === 'BUY').length;
  const sellSigs = tierSigs.filter(s => s.transaction_type === 'SELL').length;
  const avgScore = tierSigs.length ? Math.round(tierSigs.reduce((s, r) => s + r.insider_score, 0) / tierSigs.length) : 0;
  const clusterCount = tierSigs.filter(s => s.cluster_trade_flag).length;
  const oldSigs = tierSigs.filter(s => daysSince(s.signal_date) >= 180);

  const scoreRanges = [
    { label: '90-100', count: tierSigs.filter(s => s.insider_score >= 90).length, fill: '#10b981' },
    { label: '80-89', count: tierSigs.filter(s => s.insider_score >= 80 && s.insider_score < 90).length, fill: '#34d399' },
    { label: '75-79', count: tierSigs.filter(s => s.insider_score >= 75 && s.insider_score < 80).length, fill: '#6ee7b7' },
    { label: '50-74', count: tierSigs.filter(s => s.insider_score >= 50 && s.insider_score < 75).length, fill: '#f59e0b' },
  ].filter(r => r.count > 0);

  const recentHighConv = tierSigs.slice(0, 10);

  return (
    <div className="min-h-screen bg-[#0d1117] p-3 md:p-5">
      <div className="max-w-4xl mx-auto space-y-5">

        {/* Nav */}
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Link href="/insider" className="hover:text-slate-300 flex items-center gap-1"><ArrowLeft className="w-3.5 h-3.5"/> Insider Intelligence</Link>
          <span>/</span>
          <Eye className="w-3.5 h-3.5 text-violet-400"/>
          <span className="text-slate-400">Tier Evidence</span>
        </div>

        {/* Signal card */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-sm font-bold flex items-center gap-1 ${isBuy ? 'text-emerald-400' : 'text-red-400'}`}>
              {isBuy ? <TrendingUp className="w-4 h-4"/> : <TrendingDown className="w-4 h-4"/>}
              {signal.transaction_type}
            </span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${tierCls}`}>
              {signal.tier === 'HIGH CONVICTION' ? 'HIGH CONVICTION' : signal.tier}
            </span>
            <span className="text-slate-600 text-xs">·</span>
            <span className={`text-xl font-black ${scoreCls}`}>{signal.insider_score}</span>
            <span className="text-slate-600 text-xs">/100</span>
          </div>
          <div>
            <a href={`https://www.screener.in/company/${signal.ticker}/`} target="_blank" rel="noopener noreferrer"
              className="text-3xl font-black text-white hover:text-blue-400 transition">{signal.ticker}</a>
            {signal.company_name && <p className="text-slate-400 text-sm mt-0.5">{signal.company_name}</p>}
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
            <span><span className="text-slate-600">Acquirer</span> <span className="text-slate-300">{signal.acquirer_name}</span></span>
            <span><span className="text-slate-600">Date</span> <span className="text-slate-300">{fmtDate(signal.signal_date)}</span></span>
            {signal.trade_value_in_cr != null && <span><span className="text-slate-600">Value</span> <span className="text-slate-300">₹{signal.trade_value_in_cr.toFixed(1)} Cr</span></span>}
            {signal.equity_pct_traded != null && <span><span className="text-slate-600">% Equity</span> <span className="text-slate-300">{signal.equity_pct_traded.toFixed(3)}%</span></span>}
            {signal.ema150_distance_pct != null && <span><span className="text-slate-600">EMA-150 Dist</span> <span className={signal.ema150_distance_pct <= 10 ? 'text-emerald-400' : 'text-amber-400'}>+{signal.ema150_distance_pct.toFixed(1)}%</span></span>}
            {signal.cluster_trade_flag && <span className="text-violet-400 font-semibold">🔗 Cluster Trade</span>}
          </div>
        </div>

        {/* Score Anatomy */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-5">
          <div className="flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-violet-400"/>
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300">Score Anatomy — Why {signal.tier}?</h2>
          </div>
          <div className="space-y-5">
            {breakdown.map(({ label, score, max, reason, color }) => (
              <div key={label}>
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className="text-sm font-semibold text-white">{label}</span>
                  <span className="text-sm font-black text-white">{score} <span className="text-slate-600 font-normal text-xs">/ {max}</span></span>
                </div>
                <div className="h-3 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${(score / max) * 100}%`, backgroundColor: color }}
                  />
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5">{reason}</p>
              </div>
            ))}
          </div>
          <div className="border-t border-slate-800 pt-4 flex items-center gap-3 flex-wrap">
            <div className="flex items-baseline gap-1.5">
              <span className="text-slate-500 text-sm">Total:</span>
              <span className={`text-2xl font-black ${scoreCls}`}>{signal.insider_score}/100</span>
            </div>
            <span className={`text-xs font-bold px-2.5 py-1 rounded border ${tierCls}`}>{signal.tier}</span>
            <span className="text-[11px] text-slate-600">HIGH CONVICTION ≥75 · NOTABLE 50–74 · NOISE &lt;50</span>
          </div>
        </div>

        {/* Price Performance */}
        {returns && normalizedChart.length > 5 && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300">Price Performance Since Signal</h2>
              <div className="flex gap-4 text-xs">
                {returns.return_30d !== null && <div className="text-center"><div className="text-slate-600 mb-0.5">30d</div><ReturnBadge val={returns.return_30d} size="lg"/></div>}
                {returns.return_90d !== null && <div className="text-center"><div className="text-slate-600 mb-0.5">90d</div><ReturnBadge val={returns.return_90d} size="lg"/></div>}
                {returns.return_180d !== null && <div className="text-center"><div className="text-slate-600 mb-0.5">6m</div><ReturnBadge val={returns.return_180d} size="lg"/></div>}
                <div className="text-center"><div className="text-slate-600 mb-0.5">Now</div><ReturnBadge val={returns.return_current} size="lg"/></div>
              </div>
            </div>
            <p className="text-[11px] text-slate-600">
              Index = 100 on signal date ({fmtDate(signal.signal_date)}, base ₹{returns.base_price?.toFixed(0)})
            </p>
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={normalizedChart} margin={{ top: 5, right: 8, left: -24, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b"/>
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#64748b' }}
                    tickFormatter={v => { const d = new Date(v + 'T00:00:00Z'); return `${d.getDate()}/${d.getMonth()+1}`; }}
                    interval="preserveStartEnd"/>
                  <YAxis tick={{ fontSize: 9, fill: '#64748b' }} domain={['auto', 'auto']}
                    tickFormatter={v => v.toFixed(0)}/>
                  <Tooltip
                    contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, fontSize: 11 }}
                    formatter={(v: number) => [`${(v - 100).toFixed(1)}% return`, 'vs Signal']}
                    labelFormatter={l => fmtDate(l as string)}/>
                  <ReferenceLine y={100} stroke="#475569" strokeDasharray="5 3"/>
                  <Line dataKey="index" stroke={isBuy ? '#10b981' : '#f87171'} dot={false} strokeWidth={1.5}/>
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
        {daysSince(signal.signal_date) < 7 && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center gap-3 text-xs text-slate-500">
            <Info className="w-4 h-4 text-slate-600 shrink-0"/>
            Price performance chart will appear after 7 days from signal date.
          </div>
        )}

        {/* Acquirer Track Record */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300">Acquirer Track Record</h2>
            <p className="text-[11px] text-slate-500 mt-1">{signal.acquirer_name} · all signals across all stocks in DB (drives credibility score)</p>
          </div>
          {history.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-slate-500 text-sm">No prior signals from this acquirer in {signal.ticker}.</p>
              <p className="text-slate-600 text-[11px] mt-1">No prior signals from this acquirer — credibility neutral (30/60). Returns accumulate from future trades.</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto -mx-1">
                <table className="w-full text-xs border-collapse" style={{ minWidth: 560 }}>
                  <thead>
                    <tr className="border-b border-slate-800">
                      {['Date', 'Stock', 'Type', '₹Cr', 'Score', 'Tier', '30d', '90d', '6m', 'Current'].map(h => (
                        <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {history.map(h => {
                      const hr = histReturns[h.id];
                      const hBuy = h.transaction_type === 'BUY';
                      const hTierCls = h.tier === 'HIGH CONVICTION' ? 'text-emerald-400' : h.tier === 'NOTABLE' ? 'text-amber-400' : 'text-slate-500';
                      const hScoreCls = h.insider_score >= 75 ? 'text-emerald-400' : h.insider_score >= 50 ? 'text-amber-400' : 'text-slate-400';
                      return (
                        <tr key={h.id} className="border-b border-slate-800/40 hover:bg-slate-800/20 transition-colors">
                          <td className="px-3 py-2.5 text-slate-400 whitespace-nowrap">{fmtDate(h.signal_date)}</td>
                          <td className="px-3 py-2.5 font-bold text-slate-200 whitespace-nowrap">{h.ticker}</td>
                          <td className={`px-3 py-2.5 font-bold whitespace-nowrap ${hBuy ? 'text-emerald-400' : 'text-red-400'}`}>{h.transaction_type}</td>
                          <td className="px-3 py-2.5 text-slate-300 whitespace-nowrap">{h.trade_value_in_cr != null ? `₹${h.trade_value_in_cr.toFixed(1)}` : '—'}</td>
                          <td className={`px-3 py-2.5 font-black whitespace-nowrap ${hScoreCls}`}>{h.insider_score}</td>
                          <td className={`px-3 py-2.5 text-[10px] font-bold whitespace-nowrap ${hTierCls}`}>{h.tier === 'HIGH CONVICTION' ? 'HIGH CONV.' : h.tier}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap"><ReturnBadge val={hr?.return_30d ?? null}/></td>
                          <td className="px-3 py-2.5 whitespace-nowrap"><ReturnBadge val={hr?.return_90d ?? null}/></td>
                          <td className="px-3 py-2.5 whitespace-nowrap"><ReturnBadge val={hr?.return_180d ?? null}/></td>
                          <td className="px-3 py-2.5 whitespace-nowrap"><ReturnBadge val={hr?.return_current ?? null}/></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {Object.keys(histReturns).length === 0 && history.every(h => daysSince(h.signal_date) < 30) && (
                <p className="text-[11px] text-slate-600 italic flex items-center gap-1.5">
                  <Info className="w-3 h-3 shrink-0"/> Return data available 30+ days after each signal date.
                </p>
              )}
            </>
          )}
        </div>

        {/* Tier Aggregate Analysis */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-5">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300">{signal.tier} — Tier Intelligence</h2>
            <p className="text-[11px] text-slate-500 mt-1">All signals in this tier across the database</p>
          </div>

          <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
            {[
              { l: 'Total Signals', v: tierSigs.length, c: 'text-white' },
              { l: 'BUY', v: buySigs, c: 'text-emerald-400' },
              { l: 'SELL', v: sellSigs, c: 'text-red-400' },
              { l: 'Cluster', v: clusterCount, c: 'text-violet-400' },
              { l: 'Avg Score', v: avgScore, c: 'text-amber-400' },
              { l: '≥6m Old', v: oldSigs.length, c: 'text-slate-300' },
            ].map(stat => (
              <div key={stat.l} className="bg-slate-800/50 rounded-lg p-3 text-center">
                <div className="text-[9px] text-slate-500 mb-1 uppercase tracking-wide">{stat.l}</div>
                <div className={`text-xl font-black ${stat.c}`}>{stat.v}</div>
              </div>
            ))}
          </div>

          {/* Score distribution */}
          {scoreRanges.length > 0 && (
            <div>
              <p className="text-[11px] text-slate-500 mb-2 uppercase tracking-wide font-semibold">Score Distribution</p>
              <div style={{ height: 160 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={scoreRanges} margin={{ top: 5, right: 8, left: -28, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b"/>
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }}/>
                    <YAxis tick={{ fontSize: 9, fill: '#64748b' }}/>
                    <Tooltip
                      contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, fontSize: 11 }}
                      formatter={(v: number) => [v, 'Signals']}/>
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {scoreRanges.map((r, i) => <Cell key={i} fill={r.fill}/>)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Recent high-scoring signals in tier */}
          {recentHighConv.length > 0 && (
            <div>
              <p className="text-[11px] text-slate-500 mb-2 uppercase tracking-wide font-semibold">Recent Signals in This Tier</p>
              <div className="overflow-x-auto -mx-1">
                <table className="w-full text-xs border-collapse" style={{ minWidth: 420 }}>
                  <thead>
                    <tr className="border-b border-slate-800">
                      {['Ticker', 'Type', 'Date', 'Score', '₹Cr', 'Cluster'].map(h => (
                        <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {recentHighConv.map(t => (
                      <tr key={t.id} className="border-b border-slate-800/40 hover:bg-slate-800/20 transition-colors">
                        <td className="px-3 py-2 whitespace-nowrap">
                          <Link href={`/insider/${t.id}`} className="font-bold text-white hover:text-blue-400 transition">{t.ticker}</Link>
                        </td>
                        <td className={`px-3 py-2 font-bold whitespace-nowrap ${t.transaction_type === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>{t.transaction_type}</td>
                        <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{fmtDate(t.signal_date)}</td>
                        <td className={`px-3 py-2 font-black whitespace-nowrap ${t.insider_score >= 75 ? 'text-emerald-400' : 'text-amber-400'}`}>{t.insider_score}</td>
                        <td className="px-3 py-2 text-slate-300 whitespace-nowrap">{t.trade_value_in_cr != null ? `₹${t.trade_value_in_cr.toFixed(1)}` : '—'}</td>
                        <td className="px-3 py-2 text-center whitespace-nowrap">{t.cluster_trade_flag ? <span className="text-violet-400 text-[10px] font-bold">🔗</span> : <span className="text-slate-700">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="border-t border-slate-800 pt-3 space-y-1">
            <p className="text-[11px] text-slate-600">
              Scoring: Magnitude (30pt) · Credibility (40pt) · Technical Context (30pt).
              Credibility (60pt max) is based on actual 3m/6m/1y returns from all prior signals by this acquirer across all stocks. It accumulates over time.
            </p>
            {oldSigs.length === 0 && (
              <p className="text-[11px] text-slate-600 flex items-center gap-1.5">
                <Info className="w-3 h-3 shrink-0"/> No signals are 6m old yet — aggregate win-rate stats will appear once the database matures.
              </p>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

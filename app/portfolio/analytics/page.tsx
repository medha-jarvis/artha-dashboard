'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts';
import { ArrowLeft, RefreshCw } from 'lucide-react';

interface AnnualReturn {
  year: number;
  portfolioReturn: number;
  sensexReturn: number | null;
  nifty500Return: number | null;
  midcapReturn: number | null;
  smallcapReturn: number | null;
  alpha: number;
}

interface IndexRow {
  name: string;
  twrr: number | null;
  terminalValueL: number | null;
  twrr2020: number | null;
}

const pct = (v: number | null) =>
  v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;

export default function AnalyticsPage() {
  const [annual,  setAnnual]  = useState<AnnualReturn[]>([]);
  const [indexes, setIndexes] = useState<IndexRow[]>([]);
  const [updated, setUpdated] = useState('');
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const r = await fetch('/api/proxy/db/portfolio/analytics');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setAnnual(d.annualReturns ?? []);
      setIndexes(d.indexComparison ?? []);
      setUpdated(d.lastUpdated ?? '');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const gainColor = (v: number | null) =>
    v == null ? 'text-slate-400' : v >= 0 ? 'text-emerald-400' : 'text-red-400';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-6">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Link href="/portfolio" className="text-slate-400 hover:text-white transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-xl font-bold">Portfolio Analytics</h1>
              {updated && <p className="text-xs text-slate-500">Updated: {updated}</p>}
            </div>
          </div>
          <button onClick={load} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-xs font-medium disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {error && <div className="text-red-400 text-sm bg-red-900/20 border border-red-800 rounded-lg p-3">{error}</div>}

        {/* Index Comparison Table */}
        {indexes.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">TWRR vs Indices (inception)</h2>
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Index</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">TWRR (inception)</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">TWRR (since 2020)</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Terminal Value (₹1L)</th>
                  </tr>
                </thead>
                <tbody>
                  {indexes.map((idx, i) => (
                    <tr key={idx.name} className={`border-b border-slate-800/50 hover:bg-slate-800/30 ${i % 2 === 0 ? '' : 'bg-slate-900/50'}`}>
                      <td className="px-4 py-3 font-medium text-white">{idx.name}</td>
                      <td className={`px-4 py-3 text-right font-medium ${gainColor(idx.twrr)}`}>{pct(idx.twrr)}</td>
                      <td className={`px-4 py-3 text-right font-medium ${gainColor(idx.twrr2020)}`}>{pct(idx.twrr2020)}</td>
                      <td className="px-4 py-3 text-right text-slate-300">
                        {idx.terminalValueL ? `₹${idx.terminalValueL.toFixed(0)}L` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Annual Returns Chart */}
        {annual.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">Annual Returns vs Benchmarks</h2>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={annual} margin={{ top: 5, right: 10, left: 0, bottom: 5 }} barCategoryGap="20%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="year" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                  <YAxis tickFormatter={v => `${v}%`} tick={{ fontSize: 11, fill: '#94a3b8' }} width={45} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                    formatter={(v: number) => [`${v.toFixed(1)}%`]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
                  <ReferenceLine y={0} stroke="#475569" />
                  <Bar dataKey="portfolioReturn" name="Portfolio" radius={[2,2,0,0]}>
                    {annual.map((row) => (
                      <Cell key={row.year} fill={row.portfolioReturn >= 0 ? '#10b981' : '#f87171'} />
                    ))}
                  </Bar>
                  <Bar dataKey="sensexReturn"   name="Sensex"   fill="#3b82f6" radius={[2,2,0,0]} />
                  <Bar dataKey="nifty500Return" name="Nifty 500" fill="#8b5cf6" radius={[2,2,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Annual Alpha Table */}
        {annual.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">Year-by-Year Alpha vs Sensex</h2>
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-800">
                      {['Year','Portfolio','Sensex','N500','Midcap','Alpha'].map(h => (
                        <th key={h} className={`px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider ${h==='Year'?'text-left':'text-right'}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...annual].reverse().map((r, i) => (
                      <tr key={r.year} className={`border-b border-slate-800/50 hover:bg-slate-800/30 ${i % 2 === 0 ? '' : 'bg-slate-900/50'}`}>
                        <td className="px-4 py-3 font-medium text-white">{r.year}</td>
                        <td className={`px-4 py-3 text-right font-semibold ${gainColor(r.portfolioReturn)}`}>{pct(r.portfolioReturn)}</td>
                        <td className={`px-4 py-3 text-right ${gainColor(r.sensexReturn)}`}>{pct(r.sensexReturn)}</td>
                        <td className={`px-4 py-3 text-right ${gainColor(r.nifty500Return)}`}>{pct(r.nifty500Return)}</td>
                        <td className={`px-4 py-3 text-right ${gainColor(r.midcapReturn)}`}>{pct(r.midcapReturn)}</td>
                        <td className={`px-4 py-3 text-right font-bold ${gainColor(r.alpha)}`}>{pct(r.alpha)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-20 text-slate-500">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading…
          </div>
        )}
      </div>
    </div>
  );
}

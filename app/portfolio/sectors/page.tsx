'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, RefreshCw } from 'lucide-react';

interface SectorRow {
  sector: string;
  value: number;
  invested: number;
  gainLoss: number;
  gainPct: number;
  portfolioPct: number;
  holdingCount: number;
  holdings: string[];
  avgIrr: number;
}

interface McapRow {
  category: string;
  value: number;
  invested: number;
  gainLoss: number;
  gainPct: number;
  portfolioPct: number;
  count: number;
}

const nfmt = (v: number) =>
  v >= 1e7 ? `₹${(v / 1e7).toFixed(2)}Cr`
  : v >= 1e5 ? `₹${(v / 1e5).toFixed(1)}L`
  : `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

const pct = (v: number | null) =>
  v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;

export default function SectorsPage() {
  const [sectors, setSectors] = useState<SectorRow[]>([]);
  const [mcap,    setMcap]    = useState<McapRow[]>([]);
  const [updated, setUpdated] = useState('');
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const r = await fetch('/api/proxy/db/portfolio/sectors');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setSectors(d.sectorAggregates ?? []);
      setMcap(d.mcapAggregates ?? []);
      setUpdated(d.lastUpdated ?? '');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const gainColor = (v: number) => v >= 0 ? 'text-emerald-400' : 'text-red-400';

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
              <h1 className="text-xl font-bold">Sector Allocation</h1>
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

        {/* Market Cap Breakdown */}
        {mcap.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">Market Cap Breakdown</h2>
            <div className="grid grid-cols-3 gap-3">
              {mcap.map(m => (
                <div key={m.category} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                  <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">{m.category}</div>
                  <div className="text-lg font-bold text-white">{nfmt(m.value)}</div>
                  <div className={`text-sm font-semibold ${gainColor(m.gainPct)}`}>{pct(m.gainPct)}</div>
                  <div className="text-xs text-slate-400 mt-1">{m.portfolioPct.toFixed(1)}% of portfolio · {m.count} stocks</div>
                  {/* Bar */}
                  <div className="mt-2 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${m.portfolioPct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Sector Table */}
        {sectors.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">By Sector</h2>
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-800">
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Sector</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Value</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Gain</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Ret%</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Wt%</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Avg IRR</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Holdings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sectors.map((s, i) => (
                      <tr key={s.sector} className={`border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors ${i % 2 === 0 ? '' : 'bg-slate-900/50'}`}>
                        <td className="px-4 py-3 font-medium text-white">{s.sector}</td>
                        <td className="px-4 py-3 text-right text-slate-300">{nfmt(s.value)}</td>
                        <td className={`px-4 py-3 text-right font-medium ${gainColor(s.gainLoss)}`}>{s.gainLoss >= 0 ? '+' : ''}{nfmt(s.gainLoss)}</td>
                        <td className={`px-4 py-3 text-right font-semibold ${gainColor(s.gainPct)}`}>{pct(s.gainPct)}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                              <div className="h-full bg-blue-500 rounded-full" style={{ width: `${s.portfolioPct}%` }} />
                            </div>
                            <span className="text-slate-300 text-xs w-9 text-right">{s.portfolioPct.toFixed(1)}%</span>
                          </div>
                        </td>
                        <td className={`px-4 py-3 text-right font-medium ${gainColor(s.avgIrr)}`}>{pct(s.avgIrr)}</td>
                        <td className="px-4 py-3 text-left text-xs text-slate-400">{s.holdings.join(', ')}</td>
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

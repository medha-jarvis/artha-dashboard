'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, RefreshCw, CheckCircle, Clock, Plus } from 'lucide-react';

const sb = (path: string) =>
  fetch(`/api/sb/${path}`, { cache: 'no-store' }).then(r => r.json());

interface WatchlistRow {
  id: string;
  ticker: string;
  company_name: string | null;
  source: string | null;
  is_active: boolean;
  backfill_done: boolean;
  last_doc_date: string | null;
}

const fmtDate = (s: string | null | undefined) => {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
};

function SourceBadge({ source }: { source: string | null }) {
  const map: Record<string, string> = {
    PORTFOLIO:   'bg-blue-500/20 text-blue-300 border-blue-500/30',
    MANUAL:      'bg-violet-500/20 text-violet-300 border-violet-500/30',
    VALUE_CHAIN: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  };
  const cls = map[source ?? ''] ?? 'bg-slate-700/50 text-slate-400 border-slate-600/30';
  return (
    <span className={`inline-flex px-1.5 py-0.5 rounded-full text-[9px] font-bold border ${cls}`}>
      {source ?? 'UNKNOWN'}
    </span>
  );
}

export default function AlphaStocksPage() {
  const [stocks,   setStocks]   = useState<WatchlistRow[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [ticker,   setTicker]   = useState('');
  const [company,  setCompany]  = useState('');
  const [adding,   setAdding]   = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const loadStocks = async () => {
    setLoading(true); setError('');
    try {
      const data = await sb('alpha_watchlist?select=*&is_active=eq.true&order=ticker.asc');
      setStocks(Array.isArray(data) ? data : []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadStocks(); }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticker.trim()) return;
    setAdding(true); setFeedback(null);
    try {
      const res = await fetch('/api/alpha-stocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: ticker.trim().toUpperCase(), company_name: company.trim() || null }),
      });
      const d = await res.json();
      if (d.success) {
        setFeedback({ ok: true, msg: `${ticker.toUpperCase()} added to watchlist` });
        setTicker(''); setCompany('');
        await loadStocks();
      } else {
        setFeedback({ ok: false, msg: d.error ?? 'Failed to add' });
      }
    } catch (e: unknown) {
      setFeedback({ ok: false, msg: e instanceof Error ? e.message : 'Network error' });
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0d1117] p-3 md:p-5">
      <div className="max-w-[1200px] mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Link href="/alpha" className="text-slate-500 hover:text-slate-300">
                <ArrowLeft className="w-4 h-4" />
              </Link>
              <h1 className="text-lg font-black text-white">Stock Watchlist</h1>
            </div>
            <p className="text-xs text-slate-500 ml-6">Alpha Engine tracked universe</p>
          </div>
          <button onClick={loadStocks} disabled={loading}
            className="p-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded text-slate-400 disabled:opacity-50 transition">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-700/40 rounded-lg px-4 py-2.5 text-red-300 text-xs">
            {error}
          </div>
        )}

        {/* Add Stock */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <h2 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
            <Plus className="w-4 h-4 text-purple-400" />
            Add Stock
          </h2>
          <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={ticker}
              onChange={e => setTicker(e.target.value)}
              placeholder="Ticker (e.g. KECIL)"
              className="flex-1 bg-slate-800 border border-slate-700 hover:border-slate-600 focus:border-purple-500 rounded px-3 py-2 text-sm text-white placeholder-slate-500 outline-none transition"
              required
            />
            <input
              type="text"
              value={company}
              onChange={e => setCompany(e.target.value)}
              placeholder="Company name (optional)"
              className="flex-1 bg-slate-800 border border-slate-700 hover:border-slate-600 focus:border-purple-500 rounded px-3 py-2 text-sm text-white placeholder-slate-500 outline-none transition"
            />
            <button type="submit" disabled={adding || !ticker.trim()}
              className="flex items-center gap-1.5 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded text-sm font-semibold disabled:opacity-50 transition whitespace-nowrap">
              {adding ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Add
            </button>
          </form>
          {feedback && (
            <div className={`mt-2.5 text-xs px-3 py-2 rounded-lg border ${feedback.ok ? 'bg-emerald-900/30 border-emerald-700/40 text-emerald-300' : 'bg-red-900/30 border-red-700/40 text-red-300'}`}>
              {feedback.ok ? '✓' : '✗'} {feedback.msg}
            </div>
          )}
        </div>

        {/* Watchlist Table */}
        {loading ? (
          <div className="text-center py-16 text-slate-500 text-sm">Loading…</div>
        ) : stocks.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center">
            <p className="text-slate-500 text-sm font-medium">No active stocks in watchlist</p>
            <p className="text-slate-600 text-xs mt-1">Add stocks above to start tracking concall intelligence</p>
          </div>
        ) : (
          <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-[#161b22] border-b border-slate-700">
                    <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">Ticker</th>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">Company</th>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">Source</th>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">Last Doc</th>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">Backfill</th>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {stocks.map(s => (
                    <tr key={s.id} className="border-b border-slate-800/60 hover:bg-slate-800/20 transition-colors">
                      <td className="px-4 py-3">
                        <span className="font-black text-white text-sm">{s.ticker}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-400 max-w-[200px] truncate">
                        {s.company_name ?? <span className="text-slate-700">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <SourceBadge source={s.source} />
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-[11px]">
                        {fmtDate(s.last_doc_date)}
                      </td>
                      <td className="px-4 py-3">
                        {s.backfill_done ? (
                          <span className="flex items-center gap-1 text-emerald-400 text-[11px] font-semibold">
                            <CheckCircle className="w-3.5 h-3.5" /> Done
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-amber-400 text-[11px]">
                            <Clock className="w-3.5 h-3.5 animate-pulse" /> Pending
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <a href={`https://www.screener.in/company/${s.ticker}/`}
                          target="_blank" rel="noopener noreferrer"
                          className="text-[10px] text-slate-500 hover:text-blue-400 transition px-1.5 py-0.5 rounded border border-slate-700 hover:border-blue-500">
                          Screener ↗
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 border-t border-slate-800 text-[10px] text-slate-600">
              {stocks.length} active stocks · PORTFOLIO = auto-synced from holdings · MANUAL = added here
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, RefreshCw, CheckCircle, Clock, Plus, X } from 'lucide-react';

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

const SOURCE_STYLE: Record<string, string> = {
  PORTFOLIO:   'bg-blue-500/15 text-blue-300 border-blue-500/30',
  MANUAL:      'bg-violet-500/15 text-violet-300 border-violet-500/30',
  VALUE_CHAIN: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
};

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
        body: JSON.stringify({
          ticker: ticker.trim().toUpperCase(),
          company_name: company.trim() || null,
        }),
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

  const portfolio = stocks.filter(s => s.source === 'PORTFOLIO');
  const manual    = stocks.filter(s => s.source !== 'PORTFOLIO');

  return (
    <div className="min-h-screen bg-[#0d1117] p-3 md:p-5">
      <div className="max-w-3xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Link href="/alpha" className="text-slate-500 hover:text-white p-1">
              <ArrowLeft className="w-4 h-4"/>
            </Link>
            <div>
              <h1 className="text-base font-black text-white">Stock Watchlist</h1>
              <p className="text-[11px] text-slate-500">{stocks.length} active · Alpha Engine tracked universe</p>
            </div>
          </div>
          <button onClick={loadStocks} disabled={loading}
            className="p-1.5 bg-slate-900 border border-slate-700 rounded-lg text-slate-400 disabled:opacity-50 hover:text-white transition-colors">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}/>
          </button>
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-700/40 rounded-xl px-4 py-3 text-red-300 text-sm flex items-center gap-2">
            <X className="w-4 h-4 shrink-0"/> {error}
          </div>
        )}

        {/* Add Stock form */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <h2 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
            <Plus className="w-4 h-4 text-violet-400"/> Add to Watchlist
          </h2>
          <form onSubmit={handleAdd} className="space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={ticker}
                onChange={e => setTicker(e.target.value.toUpperCase())}
                placeholder="NSE ticker (e.g. KECIL)"
                className="flex-1 bg-slate-800 border border-slate-700 focus:border-violet-500 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition-colors uppercase"
                required
              />
              <input
                type="text"
                value={company}
                onChange={e => setCompany(e.target.value)}
                placeholder="Company name (optional)"
                className="flex-1 bg-slate-800 border border-slate-700 focus:border-violet-500 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition-colors hidden sm:block"
              />
            </div>
            {/* Show company field on mobile below */}
            <input
              type="text"
              value={company}
              onChange={e => setCompany(e.target.value)}
              placeholder="Company name (optional)"
              className="sm:hidden w-full bg-slate-800 border border-slate-700 focus:border-violet-500 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition-colors"
            />
            <button
              type="submit"
              disabled={adding || !ticker.trim()}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-violet-600 hover:bg-violet-500
                text-white rounded-xl text-sm font-semibold disabled:opacity-50 transition-colors active:scale-[0.98]"
            >
              {adding ? <><RefreshCw className="w-3.5 h-3.5 animate-spin"/>Adding…</> : <><Plus className="w-3.5 h-3.5"/>Add Stock</>}
            </button>
          </form>
          {feedback && (
            <div className={`mt-2.5 text-xs px-3 py-2 rounded-xl border flex items-center gap-2 ${
              feedback.ok
                ? 'bg-emerald-900/25 border-emerald-700/40 text-emerald-300'
                : 'bg-red-900/25 border-red-700/40 text-red-300'
            }`}>
              {feedback.ok ? '✓' : '✗'} {feedback.msg}
            </div>
          )}
        </div>

        {/* Stock list */}
        {loading ? (
          <div className="text-center py-12 text-slate-500 text-sm">Loading…</div>
        ) : stocks.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center">
            <p className="text-slate-500 text-sm font-medium">No active stocks</p>
            <p className="text-slate-600 text-xs mt-1">Add stocks above to start tracking</p>
          </div>
        ) : (
          <div className="space-y-4">
            {[{ label: 'Portfolio', items: portfolio }, { label: 'Watchlist Additions', items: manual }]
              .filter(g => g.items.length > 0)
              .map(group => (
                <div key={group.label}>
                  <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2 px-1">
                    {group.label} ({group.items.length})
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {group.items.map(s => (
                      <div key={s.id} className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 hover:border-slate-700 transition-colors">
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <div className="min-w-0">
                            <span className="font-black text-white text-base leading-none">{s.ticker}</span>
                            {s.company_name && (
                              <p className="text-[11px] text-slate-500 mt-0.5 truncate">{s.company_name}</p>
                            )}
                          </div>
                          <span className={`shrink-0 text-[9px] px-1.5 py-0.5 rounded border font-bold ${SOURCE_STYLE[s.source ?? ''] ?? 'bg-slate-700/50 text-slate-400 border-slate-600/30'}`}>
                            {s.source ?? 'UNKNOWN'}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-[11px]">
                          <span className="text-slate-600">Last doc:</span>
                          <span className="text-slate-400">{fmtDate(s.last_doc_date)}</span>
                          <span className="ml-auto">
                            {s.backfill_done
                              ? <span className="flex items-center gap-1 text-emerald-400"><CheckCircle className="w-3 h-3"/> Backfilled</span>
                              : <span className="flex items-center gap-1 text-slate-600"><Clock className="w-3 h-3"/> Pending</span>}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}

        <p className="text-[10px] text-slate-700 text-center pb-2">
          PORTFOLIO = synced from holdings · MANUAL = added here · VALUE_CHAIN = sector peers
        </p>
      </div>
    </div>
  );
}

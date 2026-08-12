'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, RefreshCw, CheckCircle, Clock, Download, Circle, Play, Loader2, FileText } from 'lucide-react';

interface WatchRow {
  ticker: string;
  company_name: string | null;
  source: string;
  is_active: boolean;
  last_doc_date: string | null;
  docs_ingested: number | null;
  docs_evaluated: number | null;
  ingestion_complete: boolean | null;
  eval_complete: boolean | null;
}

const VPS = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://31.97.227.135:5000/api';
const sb = (p: string) =>
  fetch(`/api/sb/${p}`, { cache: 'no-store' }).then(r => r.json()).catch(() => []);

function StatusBadge({ w }: { w: WatchRow }) {
  // Trust eval_complete flag directly — don't cross-check with eval row counts
  if (w.eval_complete)
    return <span className="flex items-center gap-1 text-emerald-400"><CheckCircle className="w-3 h-3"/>Evaluated</span>;
  if (w.ingestion_complete && (w.docs_ingested ?? 0) > 0)
    return <span className="flex items-center gap-1 text-amber-400"><Clock className="w-3 h-3"/>Eval pending</span>;
  if (!w.ingestion_complete && (w.docs_ingested ?? 0) > 0)
    return <span className="flex items-center gap-1 text-blue-400"><Download className="w-3 h-3"/>Ingesting</span>;
  if ((w.docs_ingested ?? 0) === 0 && w.ingestion_complete)
    return <span className="flex items-center gap-1 text-slate-500"><Circle className="w-3 h-3"/>No docs yet</span>;
  return <span className="flex items-center gap-1 text-slate-600"><Circle className="w-3 h-3"/>Queued</span>;
}

export default function AlphaStatusPage() {
  const [watchlist, setWatchlist]   = useState<WatchRow[]>([]);
  const [loading, setLoading]       = useState(true);
  const [evalRunning, setEvalRunning] = useState(false);
  const [runningTicker, setRunningTicker] = useState<string | null>(null);
  const [statusMsg, setStatusMsg]   = useState('');
  const [lastLog, setLastLog]       = useState('');

  const load = async () => {
    setLoading(true);
    const wl = await sb('alpha_watchlist?select=ticker,company_name,source,is_active,last_doc_date,docs_ingested,docs_evaluated,ingestion_complete,eval_complete&is_active=eq.true&order=ticker.asc');
    setWatchlist(Array.isArray(wl) ? wl : []);
    setLoading(false);
  };

  const checkEvalStatus = useCallback(async () => {
    try {
      const r = await fetch(`${VPS}/alpha/eval-status`, { cache: 'no-store' });
      const d = await r.json();
      setEvalRunning(d.running);
      if (d.last_log) setLastLog(d.last_log);
      // Poll while running
      if (d.running) setTimeout(checkEvalStatus, 5000);
      else { setRunningTicker(null); load(); }
    } catch {}
  }, []);

  useEffect(() => { load(); checkEvalStatus(); }, []);

  const triggerEval = async (ticker?: string) => {
    if (evalRunning) return;
    setEvalRunning(true);
    setRunningTicker(ticker || 'ALL');
    setStatusMsg('');
    try {
      const r = await fetch(`${VPS}/trigger/alpha-eval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ticker ? { ticker } : {}),
      });
      const d = await r.json();
      if (!d.ok) {
        setStatusMsg(`Error: ${d.error}`);
        setEvalRunning(false);
        setRunningTicker(null);
        return;
      }
      setStatusMsg(`Started: ${d.message}`);
      setTimeout(checkEvalStatus, 3000);
    } catch (e: any) {
      setStatusMsg(`Error: ${e.message}`);
      setEvalRunning(false);
      setRunningTicker(null);
    }
  };

  const totalDocs  = watchlist.reduce((a, w) => a + (w.docs_ingested ?? 0), 0);
  const evalDone   = watchlist.filter(w => w.eval_complete).length;
  const evalPending = watchlist.filter(w => w.ingestion_complete && !w.eval_complete && (w.docs_ingested ?? 0) > 0).length;

  return (
    <div className="min-h-screen bg-[#0d1117] p-3 md:p-5">
      <div className="max-w-4xl mx-auto space-y-5">

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/alpha" className="text-slate-500 hover:text-white"><ArrowLeft className="w-4 h-4"/></Link>
            <div>
              <h1 className="text-lg font-black text-white">Alpha Engine Status</h1>
              <p className="text-xs text-slate-500">Ingestion → Evaluation pipeline · Manual LLM mode</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/alpha/docs"
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-slate-700 rounded-lg text-slate-400 hover:text-white hover:border-slate-500 transition-colors"
            >
              <FileText className="w-3 h-3"/> Doc Library
            </Link>
            <button onClick={load} className="text-xs text-slate-500 hover:text-white border border-slate-800 rounded-lg p-1.5">
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`}/>
            </button>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Stocks Tracked',   val: watchlist.length, color: 'text-violet-300' },
            { label: 'Docs Ingested',    val: totalDocs,        color: 'text-blue-300' },
            { label: 'Stocks Evaluated', val: evalDone,         color: 'text-emerald-300' },
            { label: 'Eval Pending',     val: evalPending,      color: 'text-amber-300' },
          ].map(s => (
            <div key={s.label} className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-center">
              <div className={`text-2xl font-black ${s.color}`}>{loading ? '…' : s.val}</div>
              <div className="text-[10px] text-slate-500 mt-1 uppercase tracking-wide">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Manual trigger panel */}
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-white">Manual LLM Evaluation</p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Evals only on new docs since last run · No auto-cron · Each run costs ~$0.50–2 depending on doc count
              </p>
            </div>
            <button
              onClick={() => triggerEval()}
              disabled={evalRunning}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold
                bg-violet-600 hover:bg-violet-500 disabled:bg-slate-700 disabled:text-slate-500
                text-white transition-colors"
            >
              {evalRunning && runningTicker === 'ALL'
                ? <><Loader2 className="w-3 h-3 animate-spin"/>Running…</>
                : <><Play className="w-3 h-3"/>Run All Pending</>}
            </button>
          </div>
          {statusMsg && (
            <p className="text-xs text-emerald-400 bg-emerald-500/10 rounded-lg px-3 py-2">{statusMsg}</p>
          )}
          {evalRunning && (
            <p className="text-xs text-amber-400 animate-pulse">
              ⏳ Eval running for {runningTicker} — this takes several minutes. Page auto-refreshes when done.
            </p>
          )}
          {lastLog && (
            <pre className="text-[10px] text-slate-500 bg-black/30 rounded p-2 overflow-x-auto max-h-24">{lastLog}</pre>
          )}
        </div>

        {/* Pipeline legend */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
          <div className="flex flex-wrap gap-4 text-xs">
            <span className="flex items-center gap-1.5 text-slate-600"><Circle className="w-3 h-3"/>Queued</span>
            <span className="flex items-center gap-1.5 text-blue-400"><Download className="w-3 h-3"/>Ingesting</span>
            <span className="flex items-center gap-1.5 text-amber-400"><Clock className="w-3 h-3"/>Eval pending</span>
            <span className="flex items-center gap-1.5 text-emerald-400"><CheckCircle className="w-3 h-3"/>Evaluated</span>
          </div>
          <p className="text-[10px] text-slate-600 mt-2">Ingest: auto every 15 min (no LLM cost) · Eval: manual only</p>
        </div>

        {/* Per-stock table */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-left bg-slate-800/40">
                <th className="px-4 py-2.5 text-slate-500 font-semibold">Ticker</th>
                <th className="px-4 py-2.5 text-slate-500 font-semibold hidden sm:table-cell">Source</th>
                <th className="px-4 py-2.5 text-slate-500 font-semibold text-right">Docs</th>
                <th className="px-4 py-2.5 text-slate-500 font-semibold text-right hidden sm:table-cell">Evaluated</th>
                <th className="px-4 py-2.5 text-slate-500 font-semibold hidden md:table-cell">Last Doc</th>
                <th className="px-4 py-2.5 text-slate-500 font-semibold">Status</th>
                <th className="px-4 py-2.5 text-slate-500 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="text-center py-8 text-slate-600">Loading…</td></tr>
              ) : watchlist.map(w => (
                <tr key={w.ticker} className="border-b border-slate-800/50 hover:bg-white/2">
                  <td className="px-4 py-2.5 font-bold text-white">{w.ticker}</td>
                  <td className="px-4 py-2.5 hidden sm:table-cell">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                      w.source === 'PORTFOLIO' ? 'bg-blue-500/20 text-blue-400' :
                      w.source === 'VALUE_CHAIN' ? 'bg-amber-500/20 text-amber-400' :
                      'bg-violet-500/20 text-violet-400'
                    }`}>{w.source}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-300">{w.docs_ingested ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right text-slate-300 hidden sm:table-cell">{w.docs_evaluated ?? '—'}</td>
                  <td className="px-4 py-2.5 hidden md:table-cell text-slate-500">{w.last_doc_date || '—'}</td>
                  <td className="px-4 py-2.5"><StatusBadge w={w}/></td>
                  <td className="px-4 py-2.5">
                    <button
                      onClick={() => triggerEval(w.ticker)}
                      disabled={evalRunning || !w.ingestion_complete}
                      title={!w.ingestion_complete ? 'Ingestion not complete' : 'Run eval for this ticker'}
                      className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold
                        bg-slate-800 hover:bg-violet-600/30 hover:text-violet-300
                        disabled:opacity-30 disabled:cursor-not-allowed
                        text-slate-400 transition-colors"
                    >
                      {evalRunning && runningTicker === w.ticker
                        ? <Loader2 className="w-2.5 h-2.5 animate-spin"/>
                        : <Play className="w-2.5 h-2.5"/>}
                      {evalRunning && runningTicker === w.ticker ? 'Running' : 'Run'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  );
}

'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, RefreshCw, CheckCircle, Clock, Download, Circle,
  Play, Loader2, FileText, Zap,
} from 'lucide-react';

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

type StatusKey = 'evaluated' | 'eval_pending' | 'ingesting' | 'no_docs' | 'queued';

function getStatus(w: WatchRow): StatusKey {
  if (w.eval_complete) return 'evaluated';
  if (w.ingestion_complete && (w.docs_ingested ?? 0) > 0) return 'eval_pending';
  if (!w.ingestion_complete && (w.docs_ingested ?? 0) > 0) return 'ingesting';
  if ((w.docs_ingested ?? 0) === 0 && w.ingestion_complete) return 'no_docs';
  return 'queued';
}

const STATUS_CONFIG: Record<StatusKey, { label: string; icon: React.ComponentType<any>; cls: string; dot: string }> = {
  evaluated:    { label: 'Evaluated',    icon: CheckCircle, cls: 'text-emerald-400', dot: 'bg-emerald-400' },
  eval_pending: { label: 'Eval pending', icon: Clock,       cls: 'text-amber-400',   dot: 'bg-amber-400'   },
  ingesting:    { label: 'Ingesting',    icon: Download,    cls: 'text-blue-400',    dot: 'bg-blue-400'    },
  no_docs:      { label: 'No docs',      icon: Circle,      cls: 'text-slate-500',   dot: 'bg-slate-600'   },
  queued:       { label: 'Queued',       icon: Circle,      cls: 'text-slate-600',   dot: 'bg-slate-700'   },
};

function fmtDate(s: string | null) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function SourceChip({ source }: { source: string }) {
  const map: Record<string, string> = {
    PORTFOLIO:   'bg-blue-500/15 text-blue-300 border-blue-500/30',
    MANUAL:      'bg-violet-500/15 text-violet-300 border-violet-500/30',
    VALUE_CHAIN: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  };
  return (
    <span className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold border ${map[source] ?? 'bg-slate-700/50 text-slate-400 border-slate-600/30'}`}>
      {source}
    </span>
  );
}

export default function AlphaStatusPage() {
  const [watchlist, setWatchlist]       = useState<WatchRow[]>([]);
  const [loading, setLoading]           = useState(true);
  const [evalRunning, setEvalRunning]   = useState(false);
  const [runningTicker, setRunningTicker] = useState<string | null>(null);
  const [statusMsg, setStatusMsg]       = useState('');
  const [lastLog, setLastLog]           = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const wl = await sb(
      'alpha_watchlist?select=ticker,company_name,source,is_active,last_doc_date,docs_ingested,docs_evaluated,ingestion_complete,eval_complete&is_active=eq.true&order=ticker.asc'
    );
    setWatchlist(Array.isArray(wl) ? wl : []);
    setLoading(false);
  }, []);

  const checkEvalStatus = useCallback(async () => {
    try {
      const r = await fetch(`${VPS}/alpha/eval-status`, { cache: 'no-store' });
      const d = await r.json();
      setEvalRunning(d.running);
      if (d.last_log) setLastLog(d.last_log);
      if (d.running) setTimeout(checkEvalStatus, 5000);
      else { setRunningTicker(null); load(); }
    } catch {}
  }, [load]);

  useEffect(() => { load(); checkEvalStatus(); }, [load, checkEvalStatus]);

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
      if (!d.ok) { setStatusMsg(`Error: ${d.error}`); setEvalRunning(false); setRunningTicker(null); return; }
      setStatusMsg(`Started: ${d.message}`);
      setTimeout(checkEvalStatus, 3000);
    } catch (e: any) {
      setStatusMsg(`Error: ${e.message}`);
      setEvalRunning(false);
      setRunningTicker(null);
    }
  };

  const totalDocs   = watchlist.reduce((a, w) => a + (w.docs_ingested ?? 0), 0);
  const evalDone    = watchlist.filter(w => w.eval_complete).length;
  const evalPending = watchlist.filter(w => w.ingestion_complete && !w.eval_complete && (w.docs_ingested ?? 0) > 0).length;

  return (
    <div className="min-h-screen bg-[#0d1117] p-3 md:p-5">
      <div className="max-w-4xl mx-auto space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <Link href="/alpha" className="text-slate-500 hover:text-white p-1">
              <ArrowLeft className="w-4 h-4"/>
            </Link>
            <div>
              <h1 className="text-base font-black text-white">Pipeline Status</h1>
              <p className="text-[11px] text-slate-500">Ingest auto · Eval manual only</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/alpha/docs"
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-slate-700 rounded-lg text-slate-400 hover:text-white hover:border-slate-500 transition-colors">
              <FileText className="w-3 h-3"/> Docs
            </Link>
            <button onClick={load} className="p-1.5 border border-slate-800 rounded-lg text-slate-500 hover:text-white">
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`}/>
            </button>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: 'Tracked',  val: watchlist.length, color: 'text-slate-200' },
            { label: 'Docs',     val: totalDocs,        color: 'text-blue-300' },
            { label: 'Evalled',  val: evalDone,         color: 'text-emerald-300' },
            { label: 'Pending',  val: evalPending,      color: 'text-amber-300' },
          ].map(s => (
            <div key={s.label} className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-center">
              <div className={`text-xl font-black ${s.color}`}>{loading ? '…' : s.val}</div>
              <div className="text-[10px] text-slate-500 mt-0.5 leading-tight">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Eval trigger panel */}
        <div className="bg-slate-900 border border-slate-700/60 rounded-xl p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-white">Manual LLM Evaluation</p>
              <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                Costs ~$0.50–2 per run · No auto-cron · Only runs on docs since last eval
              </p>
            </div>
            <button
              onClick={() => triggerEval()}
              disabled={evalRunning}
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold
                bg-violet-600 hover:bg-violet-500 disabled:bg-slate-700 disabled:text-slate-500
                text-white transition-colors shrink-0 w-full sm:w-auto"
            >
              {evalRunning && runningTicker === 'ALL'
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin"/>Running…</>
                : <><Play className="w-3.5 h-3.5"/>Run All Pending</>}
            </button>
          </div>
          {statusMsg && (
            <div className="text-xs bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 rounded-lg px-3 py-2">
              {statusMsg}
            </div>
          )}
          {evalRunning && (
            <div className="flex items-center gap-2 text-xs text-amber-400">
              <Loader2 className="w-3 h-3 animate-spin"/>
              Running for {runningTicker} — takes a few minutes, page auto-refreshes when done
            </div>
          )}
          {lastLog && (
            <pre className="text-[10px] text-slate-500 bg-black/30 rounded p-2 overflow-x-auto max-h-20 leading-relaxed">{lastLog}</pre>
          )}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-3 px-1">
          {(Object.keys(STATUS_CONFIG) as StatusKey[]).map(k => {
            const cfg = STATUS_CONFIG[k];
            return (
              <span key={k} className="flex items-center gap-1.5 text-[11px]">
                <span className={`w-2 h-2 rounded-full ${cfg.dot}`}/>
                <span className={cfg.cls}>{cfg.label}</span>
              </span>
            );
          })}
        </div>

        {/* Per-stock list — cards on mobile, table on md+ */}
        {loading ? (
          <div className="flex items-center justify-center py-12 gap-2 text-slate-600">
            <Loader2 className="w-4 h-4 animate-spin"/> Loading…
          </div>
        ) : (
          <>
            {/* Mobile cards (hidden on md+) */}
            <div className="md:hidden space-y-2">
              {watchlist.map(w => {
                const sk = getStatus(w);
                const cfg = STATUS_CONFIG[sk];
                const Icon = cfg.icon;
                return (
                  <div key={w.ticker} className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-black text-white text-base">{w.ticker}</span>
                        <SourceChip source={w.source}/>
                      </div>
                      <Icon className={`w-4 h-4 ${cfg.cls}`}/>
                    </div>
                    {w.company_name && (
                      <p className="text-[11px] text-slate-500 mb-2 truncate">{w.company_name}</p>
                    )}
                    <div className="flex items-center gap-3 text-[11px] text-slate-400 mb-3">
                      <span><span className="text-slate-600">Docs:</span> {w.docs_ingested ?? '—'}</span>
                      <span><span className="text-slate-600">Evalled:</span> {w.docs_evaluated ?? '—'}</span>
                      <span><span className="text-slate-600">Last:</span> {fmtDate(w.last_doc_date)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`flex items-center gap-1 text-[11px] font-semibold ${cfg.cls}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`}/>
                        {cfg.label}
                      </span>
                      <button
                        onClick={() => triggerEval(w.ticker)}
                        disabled={evalRunning || !w.ingestion_complete}
                        className="ml-auto flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold
                          bg-slate-800 hover:bg-violet-600/25 hover:text-violet-300
                          disabled:opacity-30 disabled:cursor-not-allowed text-slate-400 transition-colors border border-slate-700 hover:border-violet-500/40"
                      >
                        {evalRunning && runningTicker === w.ticker
                          ? <><Loader2 className="w-3 h-3 animate-spin"/>Running</>
                          : <><Play className="w-3 h-3"/>Eval</>}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop table (hidden on mobile) */}
            <div className="hidden md:block bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-800/30 text-left">
                    <th className="px-4 py-2.5 text-slate-500 font-semibold">Ticker</th>
                    <th className="px-4 py-2.5 text-slate-500 font-semibold">Source</th>
                    <th className="px-4 py-2.5 text-slate-500 font-semibold text-right">Docs</th>
                    <th className="px-4 py-2.5 text-slate-500 font-semibold text-right">Evalled</th>
                    <th className="px-4 py-2.5 text-slate-500 font-semibold">Last Doc</th>
                    <th className="px-4 py-2.5 text-slate-500 font-semibold">Status</th>
                    <th className="px-4 py-2.5 text-slate-500 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {watchlist.map(w => {
                    const sk = getStatus(w);
                    const cfg = STATUS_CONFIG[sk];
                    const Icon = cfg.icon;
                    return (
                      <tr key={w.ticker} className="border-b border-slate-800/40 hover:bg-white/[0.02]">
                        <td className="px-4 py-2.5">
                          <span className="font-black text-white">{w.ticker}</span>
                          {w.company_name && <span className="block text-[10px] text-slate-600 truncate max-w-[120px]">{w.company_name}</span>}
                        </td>
                        <td className="px-4 py-2.5"><SourceChip source={w.source}/></td>
                        <td className="px-4 py-2.5 text-right text-slate-300">{w.docs_ingested ?? '—'}</td>
                        <td className="px-4 py-2.5 text-right text-slate-300">{w.docs_evaluated ?? '—'}</td>
                        <td className="px-4 py-2.5 text-slate-500">{fmtDate(w.last_doc_date)}</td>
                        <td className="px-4 py-2.5">
                          <span className={`flex items-center gap-1.5 ${cfg.cls}`}>
                            <Icon className="w-3 h-3"/>
                            {cfg.label}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <button
                            onClick={() => triggerEval(w.ticker)}
                            disabled={evalRunning || !w.ingestion_complete}
                            title={!w.ingestion_complete ? 'Ingestion not complete' : 'Run LLM eval for this ticker'}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-semibold
                              bg-slate-800 hover:bg-violet-600/25 hover:text-violet-300
                              disabled:opacity-30 disabled:cursor-not-allowed
                              text-slate-400 transition-colors border border-slate-700/50"
                          >
                            {evalRunning && runningTicker === w.ticker
                              ? <><Loader2 className="w-2.5 h-2.5 animate-spin"/>Running</>
                              : <><Play className="w-2.5 h-2.5"/>Run Eval</>}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        <p className="text-[10px] text-slate-700 text-center pb-2">
          Ingest: cron every 15 min Mon–Fri 9–4pm · Eval: manual only to control LLM cost
        </p>
      </div>
    </div>
  );
}

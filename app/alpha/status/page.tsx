'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, RefreshCw, CheckCircle, Clock, Circle } from 'lucide-react';

interface WatchRow { ticker:string; company_name:string|null; source:string; is_active:boolean; backfill_done:boolean; last_doc_date:string|null; }

const sb = (p:string) => fetch(`/api/sb/${p}`,{cache:'no-store'}).then(r=>r.json()).catch(()=>[]);

export default function AlphaStatusPage() {
  const [watchlist,  setWatchlist]  = useState<WatchRow[]>([]);
  const [docCounts,  setDocCounts]  = useState<Record<string,number>>({});
  const [evalCounts, setEvalCounts] = useState<Record<string,number>>({});
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [wl, docs, evals] = await Promise.all([
      sb('alpha_watchlist?select=ticker,company_name,source,is_active,backfill_done,last_doc_date&is_active=eq.true&order=ticker.asc'),
      sb('alpha_transcripts?select=ticker&limit=2000'),
      sb('alpha_evaluations?select=ticker&limit=5000'),
    ]);
    setWatchlist(Array.isArray(wl)?wl:[]);

    const dc: Record<string,number> = {};
    (Array.isArray(docs)?docs:[]).forEach((r:any) => { dc[r.ticker]=(dc[r.ticker]||0)+1; });
    setDocCounts(dc);

    const ec: Record<string,number> = {};
    (Array.isArray(evals)?evals:[]).forEach((r:any) => { ec[r.ticker]=(ec[r.ticker]||0)+1; });
    setEvalCounts(ec);

    setLoading(false);
  };
  useEffect(()=>{load();},[]);

  const totalDocs  = Object.values(docCounts).reduce((a,b)=>a+b,0);
  const totalEvals = Object.values(evalCounts).reduce((a,b)=>a+b,0);
  const activeStocks = watchlist.length;
  const evalledStocks = watchlist.filter(w=>evalCounts[w.ticker]>0).length;

  return (
    <div className="min-h-screen bg-[#0d1117] p-3 md:p-5">
      <div className="max-w-4xl mx-auto space-y-5">

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/alpha" className="text-slate-500 hover:text-white"><ArrowLeft className="w-4 h-4"/></Link>
            <div>
              <h1 className="text-lg font-black text-white">Alpha Engine Status</h1>
              <p className="text-xs text-slate-500">Backfill progress and pipeline health</p>
            </div>
          </div>
          <button onClick={load} className="text-xs text-slate-500 hover:text-white border border-slate-800 rounded-lg p-1.5">
            <RefreshCw className={`w-3 h-3 ${loading?'animate-spin':''}`}/>
          </button>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            {label:'Stocks Tracked',val:activeStocks,color:'text-violet-300'},
            {label:'Transcripts Indexed',val:totalDocs,color:'text-blue-300'},
            {label:'Evaluations Done',val:totalEvals,color:'text-emerald-300'},
            {label:'Stocks with Evals',val:evalledStocks,color:'text-amber-300'},
          ].map(s=>(
            <div key={s.label} className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-center">
              <div className={`text-2xl font-black ${s.color}`}>{loading?'…':s.val}</div>
              <div className="text-[10px] text-slate-500 mt-1 uppercase tracking-wide">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Backfill note */}
        <div className="bg-slate-900 border border-amber-800/30 rounded-xl px-4 py-3 text-xs text-amber-400/70">
          ⏱ Backfill runs every 15 min during market hours (9:15–3:30 IST weekdays) · ~10 docs evaluated per run · Full backfill estimated 2–3 days
        </div>

        {/* Per-stock table */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-slate-800 text-left bg-slate-800/40">
              <th className="px-4 py-2.5 text-slate-500 font-semibold">Ticker</th>
              <th className="px-4 py-2.5 text-slate-500 font-semibold hidden sm:table-cell">Source</th>
              <th className="px-4 py-2.5 text-slate-500 font-semibold text-right">Docs</th>
              <th className="px-4 py-2.5 text-slate-500 font-semibold text-right">Evals</th>
              <th className="px-4 py-2.5 text-slate-500 font-semibold hidden md:table-cell">Last Doc</th>
              <th className="px-4 py-2.5 text-slate-500 font-semibold">Status</th>
            </tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="text-center py-8 text-slate-600">Loading…</td></tr>
              ) : watchlist.map(w=>{
                const docs  = docCounts[w.ticker]  || 0;
                const evals = evalCounts[w.ticker] || 0;
                const status = evals>0?'active': docs>0?'pending':'queued';
                return (
                  <tr key={w.ticker} className="border-b border-slate-800/50 hover:bg-white/2">
                    <td className="px-4 py-2.5 font-bold text-white">{w.ticker}</td>
                    <td className="px-4 py-2.5 hidden sm:table-cell">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${w.source==='PORTFOLIO'?'bg-blue-500/20 text-blue-400':w.source==='VALUE_CHAIN'?'bg-amber-500/20 text-amber-400':'bg-violet-500/20 text-violet-400'}`}>
                        {w.source}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-300">{docs||'—'}</td>
                    <td className="px-4 py-2.5 text-right text-slate-300">{evals||'—'}</td>
                    <td className="px-4 py-2.5 hidden md:table-cell text-slate-500">{w.last_doc_date||'—'}</td>
                    <td className="px-4 py-2.5">
                      {status==='active'  && <span className="flex items-center gap-1 text-emerald-400"><CheckCircle className="w-3 h-3"/>Active</span>}
                      {status==='pending' && <span className="flex items-center gap-1 text-amber-400"><Clock className="w-3 h-3"/>Pending eval</span>}
                      {status==='queued'  && <span className="flex items-center gap-1 text-slate-600"><Circle className="w-3 h-3"/>Queued</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  );
}

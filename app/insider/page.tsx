'use client';
import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Eye, RefreshCw, AlertCircle, TrendingUp, TrendingDown, ChevronUp, ChevronDown } from 'lucide-react';

const SB_URL = 'https://jljwgwftuqrabfyiucfl.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impsandnd2Z0dXFyYWJmeWl1Y2ZsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNTQyOTUsImV4cCI6MjA4NzkzMDI5NX0.eOa9XYyZGEM3S0Xvl95gx1wgmrQnPSV8Wh9JDxPu07M';
const sb = (p: string) => fetch(`${SB_URL}/rest/v1/${p}`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }, cache: 'no-store' }).then(r => r.json());

interface Signal { id: string; ticker: string; company_name: string|null; acquirer_name: string; transaction_type: 'BUY'|'SELL'; signal_date: string; insider_score: number; trade_value_in_cr: number|null; equity_pct_traded: number|null; ema150_distance_pct: number|null; cluster_trade_flag: boolean; tier: string; }
type SortKey = 'insider_score'|'signal_date'|'trade_value_in_cr';
type SortDir = 'asc'|'desc';
type Filter  = 'all'|'buy'|'sell'|'cluster'|'high';

function Th({ col, label, right, active, dir, onSort }: { col: SortKey; label: string; right?: boolean; active: boolean; dir: SortDir; onSort: (c: SortKey) => void }) {
  return <th onClick={() => onSort(col)} className={`px-3 py-3 text-[10px] font-semibold uppercase tracking-wider cursor-pointer select-none whitespace-nowrap ${right?'text-right':'text-left'} ${active?'text-white':'text-slate-500 hover:text-slate-300'}`}><span className="inline-flex items-center gap-0.5">{label}{active&&(dir==='desc'?<ChevronDown className="w-3 h-3"/>:<ChevronUp className="w-3 h-3"/>)}</span></th>;
}

export default function InsiderPage() {
  const [sigs,setS] = useState<Signal[]>([]);
  const [loading,setL] = useState(true);
  const [error,setE] = useState('');
  const [sortKey,setSK] = useState<SortKey>('insider_score');
  const [sortDir,setSD] = useState<SortDir>('desc');
  const [filter,setF] = useState<Filter>('all');
  const [triggering,setT] = useState(false);
  const [msg,setM] = useState('');

  const load = async () => { setL(true); setE('');
    try {
      const r = await sb('insider_signals?select=*&order=insider_score.desc&limit=500');
      if (!Array.isArray(r)) throw new Error('Bad response');
      setS(r);
    } catch(e:unknown) { setE(e instanceof Error?e.message:'Failed'); }
    finally { setL(false); }
  };
  useEffect(()=>{load();},[]);

  const dispatch = async () => { setT(true); setM('');
    try {
      const r = await fetch('/api/insider-trigger',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})});
      const d = await r.json();
      setM(d.ok?`✓ ${d.message}`:`✗ ${d.error}`);
    } catch { setM('✗ Network error'); }
    finally { setT(false); }
  };

  const filtered = useMemo(()=>{
    if (filter==='buy')     return sigs.filter(s=>s.transaction_type==='BUY');
    if (filter==='sell')    return sigs.filter(s=>s.transaction_type==='SELL');
    if (filter==='cluster') return sigs.filter(s=>s.cluster_trade_flag);
    if (filter==='high')    return sigs.filter(s=>s.insider_score>=75);
    return sigs;
  },[sigs,filter]);

  const sorted = useMemo(()=>[...filtered].sort((a,b)=>{
    const d=sortDir==='desc'?-1:1;
    if(sortKey==='signal_date') return d*a.signal_date.localeCompare(b.signal_date);
    const va=(a[sortKey] as number|null)??-Infinity, vb=(b[sortKey] as number|null)??-Infinity;
    return d*(va-vb);
  }),[filtered,sortKey,sortDir]);

  const onSort=(c:SortKey)=>{if(sortKey===c)setSD(d=>d==='desc'?'asc':'desc');else{setSK(c);setSD('desc');}};
  const buys=sigs.filter(s=>s.transaction_type==='BUY').length;
  const sells=sigs.filter(s=>s.transaction_type==='SELL').length;
  const hc=sigs.filter(s=>s.insider_score>=75).length;
  const clusters=sigs.filter(s=>s.cluster_trade_flag).length;
  const fmtDate=(s:string)=>new Date(s).toLocaleDateString('en-IN',{day:'numeric',month:'short'});

  return (
    <div className="min-h-screen bg-[#0d1117] p-3 md:p-5">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1"><Link href="/" className="text-slate-500 hover:text-slate-300"><ArrowLeft className="w-4 h-4"/></Link><Eye className="w-5 h-5 text-violet-400"/><h1 className="text-lg font-black text-white">Insider Intelligence</h1></div>
            <p className="text-xs text-slate-500 ml-11">NSE PIT disclosures — Promoters & Directors · Open-market trades only · 6 PM IST daily</p>
          </div>
          <div className="flex gap-2">
            <button onClick={dispatch} disabled={triggering} className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-700 hover:bg-violet-600 text-white rounded text-xs font-semibold disabled:opacity-50 transition"><Eye className={`w-3.5 h-3.5 ${triggering?'animate-pulse':''}`}/>⚡ Run Engine</button>
            <button onClick={load} disabled={loading} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs disabled:opacity-50"><RefreshCw className={`w-3.5 h-3.5 ${loading?'animate-spin':''}`}/></button>
          </div>
        </div>
        {msg&&<div className={`text-xs px-4 py-2.5 rounded-lg border ${msg.startsWith('✓')?'bg-emerald-900/30 border-emerald-700/40 text-emerald-300':'bg-red-900/30 border-red-700/40 text-red-300'}`}>{msg}</div>}
        {error&&<div className="flex items-center gap-2 bg-red-900/30 border border-red-700/40 rounded-lg p-3 text-red-300 text-xs"><AlertCircle className="w-4 h-4 shrink-0"/>{error}</div>}
        {sigs.length>0&&<div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {[{l:'🟢 BUY Signals',v:buys,c:'text-emerald-400'},{l:'🔴 SELL Signals',v:sells,c:'text-red-400'},{l:'🎯 High Conv (≥75)',v:hc,c:'text-violet-400'},{l:'🔗 Cluster Trades',v:clusters,c:'text-amber-400'}].map(s=>(
            <div key={s.l} className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-center"><div className="text-[10px] text-slate-500 mb-1 whitespace-nowrap">{s.l}</div><div className={`text-lg font-black ${s.c}`}>{s.v}</div></div>
          ))}
        </div>}
        <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-1 gap-1 w-fit">
          {([['all','All'],['buy','🟢 BUY'],['sell','🔴 SELL'],['high','🎯 High Conv'],['cluster','🔗 Cluster']] as [Filter,string][]).map(([v,l])=>(
            <button key={v} onClick={()=>setF(v)} className={`px-3 py-1 text-xs rounded font-medium transition ${filter===v?'bg-violet-600 text-white':'text-slate-400 hover:text-white'}`}>{l}</button>
          ))}
        </div>
        {loading?<div className="text-center py-20 text-slate-500 text-sm">Loading…</div>:sorted.length===0?<div className="bg-slate-900 border border-slate-800 rounded-xl p-16 text-center"><Eye className="w-8 h-8 text-slate-600 mx-auto mb-3"/><p className="text-slate-400 font-semibold">No insider signals yet</p><p className="text-slate-600 text-xs mt-1">Engine runs automatically at 6 PM IST · Hit "Run Engine" to fetch now</p><button onClick={dispatch} disabled={triggering} className="mt-4 px-4 py-2 bg-violet-700 text-white rounded text-xs font-medium">⚡ Run Engine</button></div>:(
          <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
            <div className="overflow-x-auto overflow-y-auto" style={{maxHeight:'min(680px,calc(100vh-280px))'}}>
              <table className="w-full text-xs border-collapse" style={{minWidth:'900px'}}>
                <thead className="sticky top-0 z-20">
                  <tr className="bg-[#161b22] border-b-2 border-slate-700">
                    <th className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400 bg-[#161b22] sticky left-0 z-30 whitespace-nowrap">Ticker / Company</th>
                    <th className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">Type</th>
                    <Th col="insider_score" label="Score" active={sortKey==='insider_score'} dir={sortDir} onSort={onSort} right/>
                    <th className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">Acquirer</th>
                    <Th col="trade_value_in_cr" label="Value" active={sortKey==='trade_value_in_cr'} dir={sortDir} onSort={onSort} right/>
                    <th className="px-3 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">% Equity</th>
                    <th className="px-3 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">EMA150 Dist</th>
                    <th className="px-3 py-3 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">Cluster</th>
                    <th className="px-3 py-3 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">Tier</th>
                    <Th col="signal_date" label="Date" active={sortKey==='signal_date'} dir={sortDir} onSort={onSort}/>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(s=>{
                    const isBuy=s.transaction_type==='BUY';
                    const rowBg=s.insider_score>=75?(isBuy?'bg-emerald-950/15 hover:bg-emerald-950/30':'bg-red-950/15 hover:bg-red-950/30'):'hover:bg-slate-800/20';
                    const stkBg=s.insider_score>=75?(isBuy?'#0a1f12':'#1a0505'):'#0d1117';
                    const scoreCls=s.insider_score>=75?'text-emerald-400 font-bold':s.insider_score>=50?'text-amber-400':'text-slate-400';
                    const tierCls=s.tier==='HIGH CONVICTION'?'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30':s.tier==='NOTABLE'?'bg-amber-500/15 text-amber-400 border border-amber-500/30':'bg-slate-700/40 text-slate-500';
                    return (
                      <tr key={s.id} className={`border-b border-slate-800/50 transition-colors ${rowBg}`}>
                        <td className="px-3 py-2.5 sticky left-0 z-10 whitespace-nowrap" style={{backgroundColor:stkBg}}>
                          <a href={`https://www.screener.in/company/${s.ticker}/`} target="_blank" rel="noopener noreferrer" className="font-bold text-white hover:text-blue-400 transition text-sm">{s.ticker}</a>
                          {s.company_name&&<div className="text-slate-500 text-[10px] truncate max-w-[130px]">{s.company_name}</div>}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <span className={`text-xs font-bold flex items-center gap-1 ${isBuy?'text-emerald-400':'text-red-400'}`}>{isBuy?<TrendingUp className="w-3 h-3"/>:<TrendingDown className="w-3 h-3"/>}{s.transaction_type}</span>
                        </td>
                        <td className={`px-3 py-2.5 text-right whitespace-nowrap text-base font-black ${scoreCls}`}>{s.insider_score}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-slate-300 truncate max-w-[160px]">{s.acquirer_name}</td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap text-slate-300 font-medium">{s.trade_value_in_cr!=null?`₹${s.trade_value_in_cr.toFixed(1)}Cr`:'—'}</td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap text-slate-400">{s.equity_pct_traded!=null?`${s.equity_pct_traded.toFixed(3)}%`:'—'}</td>
                        <td className={`px-3 py-2.5 text-right whitespace-nowrap ${s.ema150_distance_pct==null?'text-slate-600':s.ema150_distance_pct<=10?'text-emerald-400':'text-amber-400'}`}>{s.ema150_distance_pct!=null?`+${s.ema150_distance_pct.toFixed(1)}%`:'—'}</td>
                        <td className="px-3 py-2.5 text-center whitespace-nowrap">{s.cluster_trade_flag?<span className="text-[10px] font-bold bg-violet-500/20 text-violet-400 border border-violet-500/30 px-1.5 py-0.5 rounded">🔗 YES</span>:<span className="text-slate-700">—</span>}</td>
                        <td className="px-3 py-2.5 text-center whitespace-nowrap"><span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${tierCls}`}>{s.tier==='HIGH CONVICTION'?'HIGH CONV.':s.tier}</span></td>
                        <td className="px-3 py-2.5 text-slate-400 whitespace-nowrap">{fmtDate(s.signal_date)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 border-t border-slate-800 flex justify-between text-[10px] text-slate-600">
              <span>{sorted.length} signals · 🔗 Cluster = ≥3 insiders same direction within 14 days</span>
              <span>Source: NSE PIT disclosures · Runs 6 PM IST</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

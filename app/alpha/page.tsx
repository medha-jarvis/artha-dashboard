'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import { Brain, Send, Loader2, ChevronDown, ChevronRight, RefreshCw, Activity } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────
interface Profile { ticker:string; composite_score:number; composite_trend:string|null; guidance_trend:string|null; order_book_health:string|null; evasiveness_3q_avg:number|null; last_quarter:string|null; quarters_tracked:number; alert_count_90d:number|null; }
interface EvalRow { ticker:string; uc_number:number; uc_name:string; result_json:Record<string,any>; triggered:boolean; quarter:string; fiscal_year:string; }
interface CredRow  { ticker:string; credibility_score:number; promises_kept:number; promises_total:number; quarters_tracked:number; trend:string|null; }

const sb = (p:string) => fetch(`/api/sb/${p}`,{cache:'no-store'}).then(r=>r.json()).catch(()=>[]);

// ── Score helpers ──────────────────────────────────────────────────────────
const TIER = (s:number) => s>=85?{label:'High Conviction',color:'text-emerald-300'}:s>=70?{label:'Positive',color:'text-emerald-400'}:s>=55?{label:'Stable',color:'text-slate-300'}:s>=40?{label:'Cautious',color:'text-amber-400'}:{label:'Concerning',color:'text-red-400'};
const SCORE_BG = (s:number) => s>=70?'bg-emerald-500/15 border-emerald-500/25':s>=55?'bg-slate-700/30 border-slate-600/30':s>=40?'bg-amber-500/15 border-amber-500/25':'bg-red-500/15 border-red-500/25';

// ── UC metadata ────────────────────────────────────────────────────────────
const UC_SHORT: Record<number,string> = {
  1:'Guidance',2:'Evasiveness',3:'Risk Phrases',4:'Capex',5:'Working Capital',
  6:'Cost Pass-Through',7:'Sector Echo',8:'Legal',9:'KMP Exit',10:'Revenue Mix',
  11:'Order Inflow',12:'Market Share',13:'Credibility',14:'Churn Risk',
  15:'R&D Pipeline',16:'Financial Stress',17:'ESG/Labour',18:'Subsidiary',19:'PLI',20:'Analyst Probing',
};
const UC_SEVERITY = (n:number) => [1,8,9].includes(n)?'red':[2,5,12,14,16].includes(n)?'amber':'blue';

function extractInsight(uc:number, rj:Record<string,any>): string {
  if (!rj) return '—';
  switch(uc) {
    case 1: return `${rj.guidance_direction||'?'}: ${(rj.delta_summary||'').slice(0,130)}`;
    case 2: return `Score ${rj.evasiveness_score}/10. Dodged: ${(rj.dodged_topics||[]).slice(0,3).join(', ')||'—'}`;
    case 3: return `${(rj.new_risk_phrases||[]).length} new risk phrase(s) added`;
    case 5: return `${rj.wc_trend||'—'}. ${(rj.management_statement||'').slice(0,120)}`;
    case 7: { const e=rj.sector_echoes?.[0]; return e?`"${(e.quote||'').slice(0,100)}" → ${e.target_sector}` : '—'; }
    case 8: return `${rj.severity||''} ${(rj.legal_issues||[]).join(', ')||'—'}`.trim();
    case 9: return (rj.suspicious_exits||[]).map((x:any)=>x.name||x).join(', ')||'—';
    case 11: return `Order trend: ${rj.order_trend||'—'}${rj.book_value_cr?`. Book ₹${rj.book_value_cr}Cr`:''}`;
    case 12: return `${rj.market_position||''} ${(rj.competitive_threats||[]).slice(0,2).join(', ')}`.trim()||'—';
    case 20: { const t=rj.high_probe_topics?.[0]; return t?`${t.distinct_analysts_count} analysts probed "${t.topic}"${t.analyst_skepticism_detected?' (skeptical)':''}` : '—'; }
    default: { const s=JSON.stringify(rj); return s.length>150?s.slice(0,147)+'…':s; }
  }
}

// ── Ask Alpha ──────────────────────────────────────────────────────────────
const SUGGESTED = [
  'Which stocks show evasiveness trending up?',
  'Compare IT companies on deal pipeline tone',
  'What has management said about order inflows?',
  'Which managements have highest credibility scores?',
];

function AskAlpha() {
  const [query, setQuery]   = useState('');
  const [msgs,  setMsgs]    = useState<{role:'user'|'assistant';text:string}[]>([]);
  const [hist,  setHist]    = useState<string[]>([]);
  const [busy,  setBusy]    = useState(false);
  const [phase, setPhase]   = useState('');
  const bottom = useRef<HTMLDivElement>(null);

  const ask = useCallback(async (q:string) => {
    if (!q.trim() || busy) return;
    const msg = q.trim();
    setMsgs(m=>[...m,{role:'user',text:msg}]);
    setHist(h=>[...h,msg]);
    setQuery('');
    setBusy(true);
    setPhase('Analyzing question…');
    setMsgs(m=>[...m,{role:'assistant',text:''}]);

    let answer = '';
    try {
      const res = await fetch('/api/alpha-ask',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({query:msg, history:hist}),
      });
      if (!res.ok) { const e=await res.json(); throw new Error(e.error||'Error'); }
      setPhase('Streaming answer…');
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      while(true) {
        const {done,value} = await reader.read();
        if(done) break;
        answer += dec.decode(value,{stream:true});
        setMsgs(m=>{const n=[...m];n[n.length-1]={role:'assistant',text:answer};return n;});
      }
      setHist(h=>[...h,answer]);
    } catch(e:any) {
      setMsgs(m=>{const n=[...m];n[n.length-1]={role:'assistant',text:`⚠️ ${e.message}`};return n;});
    } finally { setBusy(false); setPhase(''); setTimeout(()=>bottom.current?.scrollIntoView({behavior:'smooth'}),80); }
  },[busy,hist]);

  return (
    <div className="bg-slate-900 border border-violet-700/40 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-violet-400"/>
          <span className="text-sm font-bold text-violet-200">Ask Alpha</span>
          <span className="text-[10px] text-slate-600 ml-1">DeepSeek V4 Pro · RAG over concalls + intelligence DB</span>
        </div>
        {msgs.length>0 && <button onClick={()=>{setMsgs([]);setHist([]);}} className="text-[10px] text-slate-600 hover:text-slate-400">Clear</button>}
      </div>

      {msgs.length===0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {SUGGESTED.map(s=>(
            <button key={s} onClick={()=>ask(s)} className="text-xs px-3 py-1.5 rounded-full bg-slate-800 border border-slate-700 text-slate-400 hover:border-violet-600 hover:text-violet-300 transition-colors">{s}</button>
          ))}
        </div>
      )}

      {msgs.length>0 && (
        <div className="space-y-3 mb-4 max-h-[420px] overflow-y-auto pr-1 custom-scroll">
          {msgs.map((m,i)=>(
            <div key={i} className={m.role==='user'?'flex justify-end':''}>
              {m.role==='user'
                ? <div className="bg-violet-600/20 border border-violet-600/30 rounded-xl px-4 py-2.5 max-w-[80%]"><p className="text-sm text-violet-100">{m.text}</p></div>
                : <div className="bg-slate-800/70 rounded-xl px-4 py-3 text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">
                    {m.text || <span className="flex items-center gap-2 text-slate-500"><Loader2 className="w-3 h-3 animate-spin"/>{phase||'Thinking…'}</span>}
                  </div>
              }
            </div>
          ))}
          <div ref={bottom}/>
        </div>
      )}

      <form onSubmit={e=>{e.preventDefault();ask(query);}} className="flex gap-2">
        <input value={query} onChange={e=>setQuery(e.target.value)} disabled={busy}
          placeholder="Ask anything about your portfolio companies…"
          className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-600 disabled:opacity-50"/>
        <button type="submit" disabled={busy||!query.trim()} className="px-4 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 rounded-xl transition-colors">
          {busy?<Loader2 className="w-4 h-4 animate-spin text-white"/>:<Send className="w-4 h-4 text-white"/>}
        </button>
      </form>
    </div>
  );
}

// ── Intelligence Feed (per-stock) ─────────────────────────────────────────
function StockCard({profile, evals}:{profile:Profile; evals:EvalRow[]}) {
  const [open, setOpen] = useState(false);
  const t = TIER(profile.composite_score);
  const triggered = evals.filter(e=>e.triggered);
  const notable   = evals.filter(e=>!e.triggered && [11,7,20].includes(e.uc_number) && Object.keys(e.result_json||{}).length>0);
  const all = [...triggered, ...notable].slice(0,8);

  return (
    <div className={`border rounded-xl overflow-hidden ${SCORE_BG(profile.composite_score)}`}>
      <button onClick={()=>setOpen(o=>!o)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors">
        <span className="text-xs font-black text-slate-400 w-20 shrink-0">{profile.ticker}</span>
        <span className={`text-xl font-black ${t.color} w-10 shrink-0`}>{profile.composite_score||'—'}</span>
        <span className={`text-xs font-semibold ${t.color} shrink-0`}>{t.label}</span>
        {profile.composite_trend==='IMPROVING' && <span className="text-[10px] text-emerald-400 shrink-0">↑ improving</span>}
        {profile.composite_trend==='DECLINING'  && <span className="text-[10px] text-red-400 shrink-0">↓ declining</span>}
        {profile.last_quarter && <span className="text-[10px] text-slate-600 ml-auto shrink-0 hidden sm:block">{profile.last_quarter}</span>}
        {triggered.length>0 && <span className="text-[10px] bg-red-500/20 text-red-400 border border-red-500/30 rounded-full px-2 py-0.5 shrink-0">{triggered.length} alert{triggered.length!==1?'s':''}</span>}
        {open?<ChevronDown className="w-3 h-3 text-slate-600 shrink-0"/>:<ChevronRight className="w-3 h-3 text-slate-600 shrink-0"/>}
      </button>

      {open && (
        <div className="border-t border-white/10 px-4 py-3 space-y-2">
          {profile.guidance_trend && <div className="text-[11px] text-slate-500">Guidance: <span className="text-slate-300">{profile.guidance_trend}</span></div>}
          {all.length===0 && <p className="text-xs text-slate-600">No significant findings for this stock yet.</p>}
          {all.map((e,i)=>{
            const sev = UC_SEVERITY(e.uc_number);
            const clr = sev==='red'?'border-red-500/40 bg-red-500/10 text-red-300':sev==='amber'?'border-amber-500/40 bg-amber-500/10 text-amber-300':'border-blue-500/40 bg-blue-500/10 text-blue-300';
            const insight = extractInsight(e.uc_number, e.result_json||{});
            return (
              <div key={i} className={`rounded-lg border px-3 py-2 ${clr}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${sev==='red'?'bg-red-500/20':sev==='amber'?'bg-amber-500/20':'bg-blue-500/20'}`}>
                    {e.triggered?'🔴':'📡'} {UC_SHORT[e.uc_number]||`UC-${e.uc_number}`}
                  </span>
                  <span className="text-[10px] text-slate-600 ml-auto">{e.quarter} {e.fiscal_year}</span>
                </div>
                <p className="text-xs leading-relaxed text-slate-300">{insight}</p>
              </div>
            );
          })}
          <Link href={`/portfolio/company/${profile.ticker}`} className="text-[10px] text-violet-500 hover:text-violet-300 block mt-1">Full deep dive →</Link>
        </div>
      )}
    </div>
  );
}

// ── Main ────────────────────────────────────────────────────────────────────
export default function AlphaPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [evals,    setEvals]    = useState<EvalRow[]>([]);
  const [creds,    setCreds]    = useState<CredRow[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [tab,      setTab]      = useState<'feed'|'credibility'>('feed');

  const load = async () => {
    setLoading(true);
    const [rawP, rawE, rawC, rawWl] = await Promise.all([
      sb('alpha_intelligence_profiles?select=*&composite_score=gt.0&order=composite_score.desc&limit=60'),
      sb('alpha_evaluations?select=ticker,uc_number,uc_name,result_json,triggered,quarter,fiscal_year&order=created_at.desc&limit=500'),
      sb('alpha_management_credibility?select=*&order=credibility_score.desc'),
      sb('alpha_watchlist?select=ticker&is_active=eq.true'),
    ]);
    const watchlistSet = new Set<string>((Array.isArray(rawWl)?rawWl:[]).map((w:any)=>w.ticker));
    setProfiles((Array.isArray(rawP)?rawP:[]).filter((p:any)=>watchlistSet.has(p.ticker)));
    setEvals((Array.isArray(rawE)?rawE:[]).filter((e:any)=>watchlistSet.has(e.ticker)));
    setCreds(Array.isArray(rawC)?rawC:[]);
    setLoading(false);
  };
  useEffect(()=>{load();},[]);

  const evalsByTicker = evals.reduce((acc,e)=>{
    (acc[e.ticker]=acc[e.ticker]||[]).push(e); return acc;
  }, {} as Record<string,EvalRow[]>);

  const allZeroCred = creds.every(c=>c.credibility_score===0&&c.promises_total===0);

  return (
    <div className="min-h-screen bg-[#0d1117] p-3 md:p-5">
      <div className="max-w-5xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Brain className="w-6 h-6 text-violet-400"/>
            <div>
              <h1 className="text-lg font-black text-white">Alpha Engine</h1>
              <p className="text-xs text-slate-500">Concall Intelligence · 24 dimensions per transcript</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/alpha/status" className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 border border-slate-800 rounded-lg px-3 py-1.5">
              <Activity className="w-3 h-3"/>Status
            </Link>
            <Link href="/alpha/stocks" className="text-xs text-violet-400 hover:text-violet-300 border border-violet-800/50 rounded-lg px-3 py-1.5">+ Add Stock</Link>
            <button onClick={load} className="text-xs text-slate-500 hover:text-white border border-slate-800 rounded-lg p-1.5">
              <RefreshCw className={`w-3 h-3 ${loading?'animate-spin':''}`}/>
            </button>
          </div>
        </div>

        {/* Ask Alpha */}
        <AskAlpha/>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-slate-800 pb-0">
          {(['feed','credibility'] as const).map(t=>(
            <button key={t} onClick={()=>setTab(t)}
              className={`px-4 py-2 text-xs font-semibold rounded-t border-b-2 transition-colors ${tab===t?'border-violet-500 text-violet-300':'border-transparent text-slate-500 hover:text-slate-300'}`}>
              {t==='feed'?'Intelligence Feed':'Management Credibility'}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-center py-16 text-slate-600 text-sm">Loading intelligence data…</div>
        ) : tab==='feed' ? (
          <div className="space-y-2">
            {profiles.length===0 ? (
              <div className="text-center py-12 bg-slate-900 border border-slate-800 rounded-xl">
                <p className="text-slate-500 text-sm">No intelligence data yet.</p>
                <p className="text-slate-600 text-xs mt-1">Backfill is running every 15 min. <Link href="/alpha/status" className="text-violet-500 hover:underline">Check status →</Link></p>
              </div>
            ) : profiles.map(p=>(
              <StockCard key={p.ticker} profile={p} evals={evalsByTicker[p.ticker]||[]}/>
            ))}
          </div>
        ) : (
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            {allZeroCred ? (
              <div className="text-center py-12 text-slate-600 text-sm">
                <p>Credibility tracking starts after 2+ concalls are evaluated per stock.</p>
                <p className="text-xs mt-1 text-slate-700">Backfill in progress.</p>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead><tr className="border-b border-slate-800 text-left">
                  <th className="px-4 py-2.5 text-slate-500 font-semibold">Rank</th>
                  <th className="px-4 py-2.5 text-slate-500 font-semibold">Ticker</th>
                  <th className="px-4 py-2.5 text-slate-500 font-semibold">Credibility</th>
                  <th className="px-4 py-2.5 text-slate-500 font-semibold">Promises</th>
                  <th className="px-4 py-2.5 text-slate-500 font-semibold">Trend</th>
                  <th className="px-4 py-2.5 text-slate-500 font-semibold">Qtrs</th>
                </tr></thead>
                <tbody>
                  {creds.filter(c=>c.quarters_tracked>0||c.credibility_score>0).map((c,i)=>{
                    const sc=c.credibility_score;
                    const clr=sc>=80?'text-emerald-400':sc>=60?'text-amber-400':'text-red-400';
                    return <tr key={c.ticker} className="border-b border-slate-800/50 hover:bg-white/2">
                      <td className="px-4 py-2.5 text-slate-600">#{i+1}</td>
                      <td className="px-4 py-2.5 font-bold text-white">{c.ticker}</td>
                      <td className="px-4 py-2.5">
                        <span className={`text-base font-black ${clr}`}>{sc}</span>
                        <span className="text-slate-600 ml-1">/100</span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-400">{c.promises_kept}/{c.promises_total}</td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[10px] font-semibold ${c.trend==='IMPROVING'?'text-emerald-400':c.trend==='DETERIORATING'?'text-red-400':'text-slate-500'}`}>{c.trend||'—'}</span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-500">{c.quarters_tracked}Q</td>
                    </tr>;
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

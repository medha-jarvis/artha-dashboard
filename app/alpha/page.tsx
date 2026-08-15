'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import {
  Brain, Send, Loader2, RefreshCw, Activity, FileText, TrendingUp,
  TrendingDown, Minus, AlertTriangle, ChevronRight, BookOpen, Users,
  Zap, Search, Filter, BarChart2, ArrowUpRight,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────
interface Profile {
  ticker: string; composite_score: number; composite_trend: string | null;
  guidance_trend: string | null; order_book_health: string | null;
  evasiveness_3q_avg: number | null; last_quarter: string | null;
  quarters_tracked: number; alert_count_90d: number | null;
}
interface EvalRow {
  ticker: string; uc_number: number; uc_name: string;
  result_json: Record<string, any>; triggered: boolean;
  quarter: string; fiscal_year: string;
}
interface CredRow {
  ticker: string; credibility_score: number; promises_kept: number;
  promises_total: number; quarters_tracked: number; trend: string | null;
}
interface WatchRow { ticker: string; docs_ingested: number | null; }

const sb = (p: string) => fetch(`/api/sb/${p}`, { cache: 'no-store' }).then(r => r.json()).catch(() => []);

// ── Helpers ──────────────────────────────────────────────────────────────────
const TIER = (s: number) =>
  s >= 85 ? { label: 'High Conviction', ring: 'ring-emerald-500/60', bg: 'bg-emerald-500/10', text: 'text-emerald-300' } :
  s >= 70 ? { label: 'Positive',        ring: 'ring-emerald-500/30', bg: 'bg-emerald-500/8',  text: 'text-emerald-400' } :
  s >= 55 ? { label: 'Stable',          ring: 'ring-slate-600/40',   bg: 'bg-slate-800/60',   text: 'text-slate-300'   } :
  s >= 40 ? { label: 'Cautious',        ring: 'ring-amber-500/40',   bg: 'bg-amber-500/8',    text: 'text-amber-400'   } :
            { label: 'Concerning',      ring: 'ring-red-500/40',     bg: 'bg-red-500/8',      text: 'text-red-400'     };

const UC_SHORT: Record<number, string> = {
  1:'Guidance', 2:'Evasiveness', 3:'Risk Phrases', 4:'Capex', 5:'Working Capital',
  6:'Pass-Through', 7:'Sector Echo', 8:'Legal', 9:'KMP Exit', 10:'Revenue Mix',
  11:'Order Inflow', 12:'Market Share', 13:'Credibility', 14:'Churn Risk',
  15:'R&D', 16:'Financial Stress', 17:'ESG', 18:'Subsidiary', 19:'PLI', 20:'Analyst Probe',
};
const UC_SEV = (n: number) => [1, 8, 9].includes(n) ? 'red' : [2, 5, 12, 14, 16].includes(n) ? 'amber' : 'blue';

function extractInsight(uc: number, rj: Record<string, any>): string {
  if (!rj) return '—';
  switch (uc) {
    case 1:  return `${rj.guidance_direction || '?'}: ${(rj.delta_summary || '').slice(0, 120)}`;
    case 2:  return `Score ${rj.evasiveness_score}/10. Dodged: ${(rj.dodged_topics || []).slice(0, 3).join(', ') || '—'}`;
    case 3:  return `${(rj.new_risk_phrases || []).length} new risk phrase(s)`;
    case 5:  return `${rj.wc_trend || '—'}. ${(rj.management_statement || '').slice(0, 100)}`;
    case 7:  { const e = rj.sector_echoes?.[0]; return e ? `"${(e.quote || '').slice(0, 90)}" → ${e.target_sector}` : '—'; }
    case 8:  return `${rj.severity || ''} ${(rj.legal_issues || []).join(', ') || '—'}`.trim();
    case 9:  return (rj.suspicious_exits || []).map((x: any) => x.name || x).join(', ') || '—';
    case 11: return `${rj.order_trend || '—'}${rj.book_value_cr ? ` · Book ₹${rj.book_value_cr}Cr` : ''}`;
    case 20: { const t = rj.high_probe_topics?.[0]; return t ? `${t.distinct_analysts_count} analysts probed "${t.topic}"` : '—'; }
    default: { const s = JSON.stringify(rj); return s.length > 120 ? s.slice(0, 117) + '…' : s; }
  }
}

// ── Ask Alpha ────────────────────────────────────────────────────────────────
const SUGGESTED = [
  'Which stocks show evasiveness trending up?',
  'Compare IT companies on deal pipeline tone',
  'What are T&D stocks saying about order inflows?',
  'Which managements have highest credibility scores?',
];

function AskAlpha() {
  const [query, setQuery] = useState('');
  const [msgs,  setMsgs]  = useState<{ role: 'user' | 'assistant'; text: string }[]>([]);
  const [hist,  setHist]  = useState<string[]>([]);
  const [busy,  setBusy]  = useState(false);
  const [phase, setPhase] = useState('');
  const bottom = useRef<HTMLDivElement>(null);

  const ask = useCallback(async (q: string) => {
    if (!q.trim() || busy) return;
    const msg = q.trim();
    setMsgs(m => [...m, { role: 'user', text: msg }]);
    setHist(h => [...h, msg]);
    setQuery('');
    setBusy(true);
    setPhase('Planning query…');
    setMsgs(m => [...m, { role: 'assistant', text: '' }]);
    let answer = '';
    try {
      const res = await fetch('/api/alpha-ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: msg, history: hist }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Error'); }
      setPhase('Synthesizing…');
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        answer += dec.decode(value, { stream: true });
        setMsgs(m => { const n = [...m]; n[n.length - 1] = { role: 'assistant', text: answer }; return n; });
      }
      setHist(h => [...h, answer]);
    } catch (e: any) {
      setMsgs(m => { const n = [...m]; n[n.length - 1] = { role: 'assistant', text: `⚠ ${e.message}` }; return n; });
    } finally {
      setBusy(false); setPhase('');
      setTimeout(() => bottom.current?.scrollIntoView({ behavior: 'smooth' }), 80);
    }
  }, [busy, hist]);

  return (
    <div className="flex flex-col h-full">
      {msgs.length === 0 && (
        <div className="flex-1 flex flex-col justify-center">
          <p className="text-slate-500 text-xs mb-3">Try asking:</p>
          <div className="flex flex-col gap-2">
            {SUGGESTED.map(s => (
              <button key={s} onClick={() => ask(s)}
                className="text-left text-xs px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700/60
                  text-slate-400 hover:border-violet-600/50 hover:text-violet-300 hover:bg-violet-500/5 transition-all">
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
      {msgs.length > 0 && (
        <div className="flex-1 overflow-y-auto space-y-3 mb-3 pr-1 min-h-0">
          {msgs.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
              {m.role === 'user'
                ? <div className="bg-violet-600/20 border border-violet-600/30 rounded-xl px-4 py-2.5 max-w-[85%]">
                    <p className="text-sm text-violet-100">{m.text}</p>
                  </div>
                : <div className="bg-slate-800/60 rounded-xl px-4 py-3 text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">
                    {m.text || <span className="flex items-center gap-2 text-slate-500"><Loader2 className="w-3 h-3 animate-spin"/>{phase || 'Thinking…'}</span>}
                  </div>
              }
            </div>
          ))}
          <div ref={bottom}/>
        </div>
      )}
      <form onSubmit={e => { e.preventDefault(); ask(query); }} className="flex gap-2 mt-auto">
        <input value={query} onChange={e => setQuery(e.target.value)} disabled={busy}
          placeholder="Ask anything about your portfolio companies…"
          className="flex-1 bg-slate-800/80 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white
            placeholder-slate-500 focus:outline-none focus:border-violet-600 disabled:opacity-50"/>
        <button type="submit" disabled={busy || !query.trim()}
          className="px-4 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 rounded-xl transition-colors shrink-0">
          {busy ? <Loader2 className="w-4 h-4 animate-spin text-white"/> : <Send className="w-4 h-4 text-white"/>}
        </button>
      </form>
      {msgs.length > 0 && (
        <button onClick={() => { setMsgs([]); setHist([]); }}
          className="text-[10px] text-slate-600 hover:text-slate-400 mt-2 text-center w-full">
          Clear conversation
        </button>
      )}
    </div>
  );
}

// ── Stock Card ────────────────────────────────────────────────────────────────
function StockCard({ profile, evals }: { profile: Profile; evals: EvalRow[] }) {
  const t = TIER(profile.composite_score || 0);
  const triggered = evals.filter(e => e.triggered);
  const notable = evals.filter(e => !e.triggered && [11, 7, 1, 20, 13].includes(e.uc_number) && Object.keys(e.result_json || {}).length > 0);
  const items = [...triggered, ...notable].slice(0, 6);
  const [open, setOpen] = useState(false);

  const TrendIcon = profile.composite_trend === 'IMPROVING' ? TrendingUp :
                    profile.composite_trend === 'DECLINING'  ? TrendingDown : Minus;
  const trendClr = profile.composite_trend === 'IMPROVING' ? 'text-emerald-400' :
                   profile.composite_trend === 'DECLINING'  ? 'text-red-400' : 'text-slate-600';

  return (
    <div className={`rounded-xl border overflow-hidden transition-all ${t.bg} ${open ? 'ring-1 ' + t.ring : 'border-slate-800 hover:border-slate-700'}`}>
      {/* Header row */}
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left">
        {/* Score badge */}
        <div className={`shrink-0 w-10 h-10 rounded-lg flex items-center justify-center font-black text-sm ${t.text} bg-black/20`}>
          {profile.composite_score || '—'}
        </div>
        {/* Ticker + meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-black text-white text-sm">{profile.ticker}</span>
            <span className={`text-[10px] font-semibold ${t.text}`}>{t.label}</span>
            {triggered.length > 0 && (
              <span className="flex items-center gap-0.5 text-[10px] bg-red-500/20 text-red-400 border border-red-500/20 rounded-full px-2 py-0.5">
                <AlertTriangle className="w-2.5 h-2.5"/> {triggered.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            {profile.last_quarter && <span className="text-[10px] text-slate-500">{profile.last_quarter}</span>}
            {profile.evasiveness_3q_avg != null && (
              <span className="text-[10px] text-slate-600">Evasive {profile.evasiveness_3q_avg}/10</span>
            )}
            {profile.quarters_tracked > 0 && (
              <span className="text-[10px] text-slate-600">{profile.quarters_tracked}Q tracked</span>
            )}
          </div>
        </div>
        {/* Trend */}
        <TrendIcon className={`w-4 h-4 shrink-0 ${trendClr}`}/>
        <ChevronRight className={`w-3.5 h-3.5 text-slate-600 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}/>
      </button>

      {/* Expanded detail */}
      {open && (
        <div className="border-t border-white/8 px-4 pb-4 pt-3 space-y-2">
          {items.length === 0
            ? <p className="text-xs text-slate-600">No significant signals found yet.</p>
            : items.map((e, i) => {
                const sev = UC_SEV(e.uc_number);
                const clr = sev === 'red'   ? 'border-red-500/30   bg-red-500/8   text-red-300' :
                            sev === 'amber' ? 'border-amber-500/30 bg-amber-500/8 text-amber-300' :
                                             'border-blue-500/30  bg-blue-500/8  text-blue-300';
                return (
                  <div key={i} className={`rounded-lg border px-3 py-2 ${clr}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-bold">
                        {e.triggered ? '🔴' : '📡'} {UC_SHORT[e.uc_number] || `UC-${e.uc_number}`}
                      </span>
                      <span className="text-[10px] text-slate-500 ml-auto">{e.quarter} {e.fiscal_year}</span>
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed">{extractInsight(e.uc_number, e.result_json || {})}</p>
                  </div>
                );
              })
          }
          <Link href={`/portfolio/company/${profile.ticker}`}
            className="flex items-center gap-1 text-[11px] text-violet-500 hover:text-violet-300 mt-1 w-fit">
            Deep dive <ArrowUpRight className="w-3 h-3"/>
          </Link>
        </div>
      )}
    </div>
  );
}

// ── Credibility Table ─────────────────────────────────────────────────────────
function CredibilityTable({ creds }: { creds: CredRow[] }) {
  const filled = creds.filter(c => c.quarters_tracked > 0 || c.credibility_score > 0);
  if (filled.length === 0) {
    return (
      <div className="text-center py-14 text-slate-600 text-sm">
        <Users className="w-8 h-8 mx-auto mb-3 opacity-30"/>
        <p>Credibility tracking builds after 2+ evaluated concalls per stock.</p>
        <p className="text-xs mt-1 text-slate-700">Run evaluations to populate this leaderboard.</p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-800 text-left">
            <th className="px-4 py-3 text-slate-500 font-semibold">#</th>
            <th className="px-4 py-3 text-slate-500 font-semibold">Ticker</th>
            <th className="px-4 py-3 text-slate-500 font-semibold">Score</th>
            <th className="px-4 py-3 text-slate-500 font-semibold">Promises</th>
            <th className="px-4 py-3 text-slate-500 font-semibold">Trend</th>
            <th className="px-4 py-3 text-slate-500 font-semibold">Qtrs</th>
          </tr>
        </thead>
        <tbody>
          {filled.map((c, i) => {
            const sc = c.credibility_score;
            const clr = sc >= 80 ? 'text-emerald-400' : sc >= 60 ? 'text-amber-400' : 'text-red-400';
            const bar = sc >= 80 ? 'bg-emerald-500' : sc >= 60 ? 'bg-amber-500' : 'bg-red-500';
            return (
              <tr key={c.ticker} className="border-b border-slate-800/40 hover:bg-white/2">
                <td className="px-4 py-3 text-slate-600">#{i + 1}</td>
                <td className="px-4 py-3 font-bold text-white">{c.ticker}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${bar}`} style={{ width: `${sc}%` }}/>
                    </div>
                    <span className={`font-black ${clr}`}>{sc}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-400">{c.promises_kept}/{c.promises_total}</td>
                <td className="px-4 py-3">
                  <span className={`text-[10px] font-semibold ${c.trend === 'IMPROVING' ? 'text-emerald-400' : c.trend === 'DETERIORATING' ? 'text-red-400' : 'text-slate-500'}`}>
                    {c.trend === 'IMPROVING' ? '↑ Improving' : c.trend === 'DETERIORATING' ? '↓ Deteriorating' : '→ Stable'}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-500">{c.quarters_tracked}Q</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
type Tab = 'intelligence' | 'ask' | 'credibility';

export default function AlphaPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [evals,    setEvals]    = useState<EvalRow[]>([]);
  const [creds,    setCreds]    = useState<CredRow[]>([]);
  const [watchlist, setWatchlist] = useState<WatchRow[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [tab,      setTab]      = useState<Tab>('intelligence');
  const [search,   setSearch]   = useState('');
  const [alertOnly, setAlertOnly] = useState(false);

  const load = async () => {
    setLoading(true);
    const [rawP, rawE, rawC, rawWl] = await Promise.all([
      sb('alpha_intelligence_profiles?select=*&composite_score=gt.0&order=composite_score.desc&limit=60'),
      sb('alpha_evaluations?select=ticker,uc_number,uc_name,result_json,triggered,quarter,fiscal_year&order=created_at.desc&limit=500'),
      sb('alpha_management_credibility?select=*&order=credibility_score.desc'),
      sb('alpha_watchlist?select=ticker,docs_ingested&is_active=eq.true'),
    ]);
    const watchlistSet = new Set<string>((Array.isArray(rawWl) ? rawWl : []).map((w: any) => w.ticker));
    setProfiles((Array.isArray(rawP) ? rawP : []).filter((p: any) => watchlistSet.has(p.ticker)));
    setEvals((Array.isArray(rawE) ? rawE : []).filter((e: any) => watchlistSet.has(e.ticker)));
    setCreds(Array.isArray(rawC) ? rawC : []);
    setWatchlist(Array.isArray(rawWl) ? rawWl : []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const evalsByTicker = evals.reduce((acc, e) => {
    (acc[e.ticker] = acc[e.ticker] || []).push(e); return acc;
  }, {} as Record<string, EvalRow[]>);

  const totalDocs   = watchlist.reduce((a, w) => a + (w.docs_ingested ?? 0), 0);
  const alertCount  = evals.filter(e => e.triggered).length;
  const evalledCount = profiles.length;

  const filteredProfiles = profiles.filter(p => {
    if (alertOnly && !(evalsByTicker[p.ticker] || []).some(e => e.triggered)) return false;
    if (search && !p.ticker.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const TABS: { id: Tab; label: string; icon: any; count?: number }[] = [
    { id: 'intelligence', label: 'Intelligence', icon: BarChart2,  count: evalledCount },
    { id: 'ask',          label: 'Ask Alpha',    icon: Brain },
    { id: 'credibility',  label: 'Credibility',  icon: Users },
  ];

  return (
    <div className="min-h-screen bg-[#0d1117]">
      {/* ── Top nav ─────────────────────────────────────────────────────────── */}
      <div className="border-b border-slate-800/60 bg-[#0d1117]/90 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-violet-600/20 border border-violet-500/30 flex items-center justify-center">
              <Brain className="w-4 h-4 text-violet-400"/>
            </div>
            <div>
              <span className="text-sm font-black text-white">Alpha Engine</span>
              <span className="text-[10px] text-slate-500 ml-2 hidden sm:inline">Concall Intelligence</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Link href="/alpha/docs"
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-800 text-slate-400 hover:text-white hover:border-slate-600 transition-colors">
              <FileText className="w-3 h-3"/> Docs
            </Link>
            <Link href="/alpha/status"
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-800 text-slate-400 hover:text-white hover:border-slate-600 transition-colors">
              <Activity className="w-3 h-3"/> Status
            </Link>
            <Link href="/alpha/stocks"
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-violet-600/20 border border-violet-500/30 text-violet-300 hover:bg-violet-600/30 transition-colors">
              + Stock
            </Link>
            <button onClick={load}
              className="p-1.5 rounded-lg border border-slate-800 text-slate-500 hover:text-white transition-colors">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}/>
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-5 space-y-5">

        {/* ── Stats bar ───────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { icon: BookOpen,      label: 'Docs Ingested', val: loading ? '…' : totalDocs,    color: 'text-blue-300',   hint: 'across all tracked stocks' },
            { icon: BarChart2,     label: 'Stocks Evalled', val: loading ? '…' : evalledCount, color: 'text-violet-300', hint: 'with intelligence profiles' },
            { icon: AlertTriangle, label: 'Alerts Total',  val: loading ? '…' : alertCount,   color: 'text-amber-300',  hint: 'triggered signals' },
            { icon: Users,         label: 'Tracked',       val: loading ? '…' : watchlist.length, color: 'text-slate-300', hint: 'stocks on watchlist' },
          ].map(s => (
            <div key={s.label} className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex items-center gap-3">
              <s.icon className={`w-5 h-5 shrink-0 ${s.color} opacity-70`}/>
              <div>
                <div className={`text-xl font-black ${s.color}`}>{s.val}</div>
                <div className="text-[10px] text-slate-500">{s.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* ── Tab bar ─────────────────────────────────────────────────────────── */}
        <div className="flex gap-1 bg-slate-900/60 border border-slate-800 rounded-xl p-1">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold transition-all ${
                tab === t.id
                  ? 'bg-violet-600 text-white shadow-lg shadow-violet-900/40'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}>
              <t.icon className="w-3.5 h-3.5"/>
              {t.label}
              {t.count != null && t.count > 0 && (
                <span className={`text-[10px] rounded-full px-1.5 py-0.5 ${tab === t.id ? 'bg-white/20' : 'bg-slate-700 text-slate-400'}`}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── Tab: Intelligence ────────────────────────────────────────────────── */}
        {tab === 'intelligence' && (
          <div className="space-y-4">
            {/* Filters */}
            <div className="flex gap-2 items-center">
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500"/>
                <input
                  value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Filter by ticker…"
                  className="w-full pl-9 pr-3 py-2 bg-slate-900/60 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-violet-500"/>
              </div>
              <button onClick={() => setAlertOnly(a => !a)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${
                  alertOnly
                    ? 'bg-red-500/20 border-red-500/40 text-red-300'
                    : 'border-slate-800 text-slate-400 hover:border-slate-600 hover:text-white'
                }`}>
                <Filter className="w-3 h-3"/>
                Alerts only
              </button>
              {(search || alertOnly) && (
                <button onClick={() => { setSearch(''); setAlertOnly(false); }}
                  className="text-xs text-slate-500 hover:text-white px-2">✕ Clear</button>
              )}
              <span className="text-xs text-slate-600 ml-auto">
                {filteredProfiles.length} stock{filteredProfiles.length !== 1 ? 's' : ''}
              </span>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-16 gap-2 text-slate-600">
                <Loader2 className="w-4 h-4 animate-spin"/> Loading intelligence…
              </div>
            ) : filteredProfiles.length === 0 ? (
              <div className="text-center py-16 bg-slate-900/40 border border-slate-800 rounded-xl">
                <Zap className="w-8 h-8 mx-auto mb-3 text-slate-700"/>
                {profiles.length === 0
                  ? <>
                      <p className="text-slate-500 text-sm">No intelligence data yet.</p>
                      <p className="text-slate-600 text-xs mt-1">
                        Ingest runs every 15 min. <Link href="/alpha/status" className="text-violet-500 hover:underline">Check status →</Link>
                      </p>
                    </>
                  : <p className="text-slate-500 text-sm">No stocks match your filter.</p>
                }
              </div>
            ) : (
              <div className="grid gap-2">
                {filteredProfiles.map(p => (
                  <StockCard key={p.ticker} profile={p} evals={evalsByTicker[p.ticker] || []}/>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Tab: Ask Alpha ───────────────────────────────────────────────────── */}
        {tab === 'ask' && (
          <div className="bg-slate-900/60 border border-violet-700/30 rounded-2xl p-5" style={{ minHeight: '520px', display: 'flex', flexDirection: 'column' }}>
            <div className="flex items-center gap-2 mb-4 shrink-0">
              <Brain className="w-4 h-4 text-violet-400"/>
              <span className="text-sm font-bold text-violet-200">Ask Alpha</span>
              <span className="text-[10px] text-slate-600 ml-1">DeepSeek V4 Pro · RAG over concalls + signals DB</span>
            </div>
            <AskAlpha/>
          </div>
        )}

        {/* ── Tab: Credibility ─────────────────────────────────────────────────── */}
        {tab === 'credibility' && (
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-white">Management Credibility</p>
                <p className="text-[11px] text-slate-500 mt-0.5">Tracks promise vs. delivery across quarters per UC-13</p>
              </div>
            </div>
            <CredibilityTable creds={creds}/>
          </div>
        )}

      </div>
    </div>
  );
}

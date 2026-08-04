'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { ArrowLeft, RefreshCw, Brain, TrendingUp, TrendingDown, Minus, Send, Loader2 } from 'lucide-react';

const sb = (path: string) =>
  fetch(`/api/sb/${path}`, { cache: 'no-store' }).then(r => r.json());

// ── Types ─────────────────────────────────────────────────────────────────────
interface EvalRow {
  id: string;
  transcript_id: string;
  ticker: string;
  quarter: string;
  fiscal_year: string;
  uc_number: number;
  uc_name: string;
  result_json: Record<string, unknown>;
  triggered: boolean;
  score: number;
  signal_type?: string;
  announce_date?: string;
}

interface CredibilityRow {
  ticker: string;
  credibility_score: number;
  promises_kept: number;
  promises_total: number;
  quarters_tracked: number;
  trend: string | null;
}

interface ProfileRow {
  ticker: string;
  composite_score: number;
  composite_trend: string | null;
  evasiveness_3q_avg: number | null;
  guidance_trend: string | null;
  order_book_health: string | null;
  last_transcript_date: string | null;
  last_quarter: string | null;
  quarters_tracked: number;
  alert_count_90d: number | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtDate = (s: string | null | undefined) => {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
};

const scoreCls = (v: number) =>
  v >= 80 ? 'text-emerald-400' : v >= 60 ? 'text-amber-400' : 'text-red-400';

const scoreBg = (v: number) =>
  v >= 80 ? 'bg-emerald-500/15 border-emerald-500/30' : v >= 60 ? 'bg-amber-500/15 border-amber-500/30' : 'bg-red-500/15 border-red-500/30';

function SignalChip({ type }: { type?: string }) {
  if (!type) return null;
  const map: Record<string, string> = {
    POSITIVE: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    NEUTRAL:  'bg-slate-700/50 text-slate-400 border-slate-600/30',
    NEGATIVE: 'bg-red-500/20 text-red-300 border-red-500/30',
    ALERT:    'bg-orange-500/20 text-orange-300 border-orange-500/30',
  };
  const cls = map[type] ?? 'bg-slate-700/50 text-slate-400 border-slate-600/30';
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold border ${cls}`}>
      {type}
    </span>
  );
}

function TrendChip({ trend }: { trend: string | null | undefined }) {
  if (!trend) return <span className="text-slate-600 text-[11px]">—</span>;
  const up   = trend === 'IMPROVING' || trend === 'UP';
  const down = trend === 'DECLINING' || trend === 'DOWN';
  if (up)   return <span className="inline-flex items-center gap-0.5 text-emerald-400 text-[10px] font-semibold"><TrendingUp className="w-3 h-3"/>{trend}</span>;
  if (down) return <span className="inline-flex items-center gap-0.5 text-red-400 text-[10px] font-semibold"><TrendingDown className="w-3 h-3"/>{trend}</span>;
  return           <span className="inline-flex items-center gap-0.5 text-slate-400 text-[10px]"><Minus className="w-3 h-3"/>{trend}</span>;
}

// ── Ask Alpha Component ───────────────────────────────────────────────────────
const SUGGESTED = [
  'Which stocks show evasiveness trending up?',
  'Compare IT companies on deal pipeline tone',
  'Which managements have highest credibility?',
  'Value chain signals in EMS sector this quarter',
];

function AskAlpha() {
  const [query,    setQuery]    = useState('');
  const [history,  setHistory]  = useState<string[]>([]);
  const [messages, setMessages] = useState<{role:'user'|'assistant'; text:string}[]>([]);
  const [thinking, setThinking] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const ask = async (q: string) => {
    if (!q.trim() || thinking) return;
    const userMsg = q.trim();
    setMessages(m => [...m, { role: 'user', text: userMsg }]);
    setHistory(h => [...h, userMsg]);
    setQuery('');
    setThinking(true);
    let answer = '';
    setMessages(m => [...m, { role: 'assistant', text: '' }]);
    try {
      const res = await fetch('/api/alpha-ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: userMsg, history }),
      });
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        answer += dec.decode(value, { stream: true });
        setMessages(m => { const n = [...m]; n[n.length-1] = { role: 'assistant', text: answer }; return n; });
      }
      setHistory(h => [...h, answer]);
    } catch (e: any) {
      setMessages(m => { const n = [...m]; n[n.length-1] = { role: 'assistant', text: `Error: ${e.message}` }; return n; });
    } finally {
      setThinking(false);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }
  };

  return (
    <div className="bg-slate-900 border border-violet-700/40 rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <Brain className="w-5 h-5 text-violet-400" />
        <h2 className="text-sm font-bold text-violet-300">Ask Alpha</h2>
        <span className="text-[10px] text-slate-600 ml-1">Powered by DeepSeek V4 Pro</span>
      </div>

      {messages.length === 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {SUGGESTED.map(s => (
            <button key={s} onClick={() => ask(s)}
              className="text-xs px-3 py-1.5 rounded-full bg-slate-800 border border-slate-700 text-slate-400 hover:border-violet-600 hover:text-violet-300 transition-colors">
              {s}
            </button>
          ))}
        </div>
      )}

      {messages.length > 0 && (
        <div className="space-y-3 mb-4 max-h-96 overflow-y-auto pr-1">
          {messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
              {m.role === 'user' ? (
                <div className="bg-violet-600/20 border border-violet-600/30 rounded-xl px-4 py-2.5 max-w-[80%]">
                  <p className="text-sm text-violet-100">{m.text}</p>
                </div>
              ) : (
                <div className="bg-slate-800/60 rounded-xl px-4 py-3 text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">
                  {m.text || <span className="flex items-center gap-2 text-slate-500"><Loader2 className="w-3 h-3 animate-spin"/>Thinking…</span>}
                </div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}

      <form onSubmit={e => { e.preventDefault(); ask(query); }} className="flex gap-2">
        <input
          value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Ask anything about your portfolio companies…"
          className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-600"
        />
        <button type="submit" disabled={thinking || !query.trim()}
          className="px-4 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 rounded-xl transition-colors">
          {thinking ? <Loader2 className="w-4 h-4 animate-spin text-white" /> : <Send className="w-4 h-4 text-white" />}
        </button>
      </form>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function AlphaPage() {
  const [evals,         setEvals]        = useState<EvalRow[]>([]);
  const [creds,         setCreds]        = useState<CredibilityRow[]>([]);
  const [profiles,      setProfiles]     = useState<ProfileRow[]>([]);
  const [loading,       setLoading]      = useState(true);
  const [error,         setError]        = useState('');

  const loadData = async () => {
    setLoading(true); setError('');
    try {
      const [rawEvals, rawCreds, rawProfiles] = await Promise.all([
        sb('alpha_evaluations?select=*&triggered=eq.true&order=score.desc&limit=50'),
        sb('alpha_management_credibility?select=*&order=credibility_score.desc'),
        sb('alpha_intelligence_profiles?select=*&order=composite_score.desc'),
      ]);
      setEvals(Array.isArray(rawEvals) ? rawEvals : []);
      setCreds(Array.isArray(rawCreds) ? rawCreds : []);
      setProfiles(Array.isArray(rawProfiles) ? rawProfiles : []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const allZeroCred = creds.length > 0 && creds.every(c => c.credibility_score === 0 && c.promises_total === 0);

  return (
    <div className="min-h-screen bg-[#0d1117] p-3 md:p-5">
      <div className="max-w-[1600px] mx-auto space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Link href="/" className="text-slate-500 hover:text-slate-300"><ArrowLeft className="w-4 h-4" /></Link>
              <Brain className="w-5 h-5 text-purple-400" />
              <h1 className="text-lg font-black text-white">Alpha Engine</h1>
              <span className="text-[10px] text-slate-500 font-semibold tracking-widest uppercase ml-1">Concall Intelligence</span>
            </div>
            <p className="text-xs text-slate-500 ml-11">
              Management credibility · Use-case evaluation · Intelligence profiling
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/alpha/stocks"
              className="px-3 py-1.5 bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/30 text-purple-300 rounded text-xs font-semibold transition">
              Stock Management →
            </Link>
            <button onClick={loadData} disabled={loading}
              className="p-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded text-slate-400 disabled:opacity-50 transition">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-700/40 rounded-lg px-4 py-2.5 text-red-300 text-xs">
            {error}
          </div>
        )}

        {/* ── Ask Alpha ── */}
        <AskAlpha />

        {loading ? (
          <div className="text-center py-24 text-slate-500 text-sm">Loading…</div>
        ) : (
          <>
            {/* ── Section A: Intelligence Feed ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-white">Intelligence Feed</h2>
                <span className="text-[10px] text-purple-400 font-semibold px-2 py-0.5 bg-purple-500/15 border border-purple-500/25 rounded-full">
                  {evals.length} triggered
                </span>
              </div>

              {evals.length === 0 ? (
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-10 text-center">
                  <Brain className="w-7 h-7 text-slate-700 mx-auto mb-3" />
                  <p className="text-slate-500 text-sm font-medium">No triggered evaluations yet</p>
                  <p className="text-slate-600 text-xs mt-1">Run the Alpha Engine after ingesting concall transcripts</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {evals.map(ev => (
                    <div key={ev.id}
                      className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl p-4 transition-colors">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-black text-white bg-purple-500/20 border border-purple-500/30 px-2 py-0.5 rounded">
                            {ev.ticker}
                          </span>
                          <span className="text-[10px] text-slate-500">{ev.quarter} {ev.fiscal_year}</span>
                        </div>
                        <SignalChip type={ev.signal_type} />
                      </div>
                      <p className="text-xs text-slate-300 font-medium leading-snug mb-2">
                        {ev.uc_name || `UC-${ev.uc_number}`}
                      </p>
                      <div className="flex items-center justify-between">
                        <span className={`text-sm font-black ${scoreCls(ev.score ?? 0)}`}>
                          {ev.score ?? 0}
                        </span>
                        <span className="text-[10px] text-slate-600">{fmtDate(ev.announce_date)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── Section B: Management Credibility Leaderboard ── */}
            <div className="space-y-3">
              <h2 className="text-sm font-bold text-white">Management Credibility Leaderboard</h2>

              {creds.length === 0 || allZeroCred ? (
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
                  <p className="text-slate-500 text-sm font-medium">Backfill in progress — check back after first run</p>
                  <p className="text-slate-600 text-xs mt-1">Credibility scores populate after 2+ quarters of promise tracking</p>
                </div>
              ) : (
                <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-[#161b22] border-b border-slate-700">
                          <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500 w-12">Rank</th>
                          <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">Ticker</th>
                          <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">Score</th>
                          <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">Promises Kept</th>
                          <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">Trend</th>
                          <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">Quarters</th>
                        </tr>
                      </thead>
                      <tbody>
                        {creds.map((c, i) => (
                          <tr key={c.ticker} className="border-b border-slate-800/60 hover:bg-slate-800/20 transition-colors">
                            <td className="px-4 py-3 text-slate-600 font-mono text-[11px]">#{i + 1}</td>
                            <td className="px-4 py-3">
                              <span className="font-bold text-white text-xs">{c.ticker}</span>
                            </td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-black border ${scoreBg(c.credibility_score)} ${scoreCls(c.credibility_score)}`}>
                                {c.credibility_score}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-slate-300">
                              {c.promises_kept ?? 0} / {c.promises_total ?? 0}
                            </td>
                            <td className="px-4 py-3">
                              <TrendChip trend={c.trend} />
                            </td>
                            <td className="px-4 py-3 text-slate-500 text-[11px]">{c.quarters_tracked ?? 0}Q</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* ── Section C: Intelligence Scores ── */}
            <div className="space-y-3">
              <h2 className="text-sm font-bold text-white">Intelligence Scores</h2>

              {profiles.length === 0 ? (
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
                  <p className="text-slate-500 text-sm font-medium">No intelligence profiles yet</p>
                  <p className="text-slate-600 text-xs mt-1">Profiles build after concall evaluations are processed</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {profiles.map(p => (
                    <div key={p.ticker}
                      className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl p-4 transition-colors">
                      <div className="flex items-start justify-between mb-3">
                        <span className="font-black text-white text-sm">{p.ticker}</span>
                        <TrendChip trend={p.composite_trend} />
                      </div>
                      <div className={`text-3xl font-black mb-1 ${scoreCls(p.composite_score ?? 0)}`}>
                        {p.composite_score ?? 0}
                      </div>
                      <div className="text-[10px] text-slate-600 mb-3">composite score</div>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-500">{p.last_quarter ?? '—'}</span>
                        <span className="text-slate-600">{p.quarters_tracked ?? 0}Q tracked</span>
                      </div>
                      {p.alert_count_90d != null && p.alert_count_90d > 0 && (
                        <div className="mt-2 text-[10px] text-orange-400 font-semibold">
                          ⚠ {p.alert_count_90d} alert{p.alert_count_90d !== 1 ? 's' : ''} (90d)
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* Footer */}
        <div className="text-[10px] text-slate-700 pt-2">
          Alpha Engine · Concall Intelligence · Management Credibility · UC Evaluation
        </div>

      </div>
    </div>
  );
}

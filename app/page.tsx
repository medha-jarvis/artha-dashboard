'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { RefreshCw, Zap, Layers, Eye, AlertCircle, ChevronUp, ChevronDown, TrendingUp, TrendingDown, BarChart2, Target, BookOpen, Wallet } from 'lucide-react';

// ── Supabase REST ─────────────────────────────────────────────────────────────
const SB_URL = 'https://jljwgwftuqrabfyiucfl.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impsandnd2Z0dXFyYWJmeWl1Y2ZsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNTQyOTUsImV4cCI6MjA4NzkzMDI5NX0.eOa9XYyZGEM3S0Xvl95gx1wgmrQnPSV8Wh9JDxPu07M';
const sb = (path: string) =>
  fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    cache: 'no-store',
  }).then(r => r.json());

const CUTOFF_DAYS = 45;
const cutoffDate = () => {
  const d = new Date(); d.setDate(d.getDate() - CUTOFF_DAYS);
  return d.toISOString().slice(0, 10);
};

// ── Types ─────────────────────────────────────────────────────────────────────
interface PeadRow   { ticker: string; pead_score: number; trigger_path: string; signal_date: string; returns_since_result?: number | null; }
interface Stage2Row { ticker: string; stage2_score: number; tier: string; days_in_stage2: number | null; signal_date: string; returns_since_breakout?: number | null; }
interface InsiderRow{ ticker: string; company_name: string | null; insider_score: number; transaction_type: string; acquirer_name: string; trade_value_in_cr: number | null; promoter_historical_6m_return: number | null; tier: string; signal_date: string; }

interface Trinity {
  ticker: string;
  company_name: string | null;
  pead_score:       number | null;
  pead_path:        string | null;
  pead_date:        string | null;
  stage2_score:     number | null;
  stage2_days:      number | null;
  stage2_date:      string | null;
  insider_score:    number | null;
  insider_type:     string | null;
  insider_acquirer: string | null;
  insider_value_cr: number | null;
  insider_hit_rate: number | null;
  signals_count:    number;
  earliest_date:    string;
  ttm_return:       number | null;  // best available return from performance tables
}

// ── Badge System ──────────────────────────────────────────────────────────────
interface Badge { emoji: string; label: string; priority: number; cls: string; rowCls: string; stickyBg: string; }

function getBadge(row: Trinity): Badge {
  const hasPEAD    = row.pead_score != null;
  const hasS2      = row.stage2_score != null;
  const hasIns     = row.insider_score != null;
  const isBuy      = row.insider_type === 'BUY';
  const isSell     = row.insider_type === 'SELL';

  // 🔥 TRIPLE PLAY — all 3 + insider is BUY
  if (hasPEAD && hasS2 && hasIns && isBuy)
    return { emoji: '🔥', label: 'TRIPLE PLAY', priority: 4,
      cls:     'bg-orange-500/30 text-orange-200 border border-orange-400/50',
      rowCls:  'bg-orange-950/20 hover:bg-orange-950/35',
      stickyBg:'#1a0e00' };

  // ⚠️ SMART MONEY EXIT — (PEAD or Stage2) + insider SELL
  if ((hasPEAD || hasS2) && hasIns && isSell)
    return { emoji: '⚠️', label: 'SMART MONEY EXIT', priority: 3,
      cls:     'bg-red-500/25 text-red-200 border border-red-400/40',
      rowCls:  'bg-red-950/20 hover:bg-red-950/35',
      stickyBg:'#1a0505' };

  // ⚡ EARNINGS TURNAROUND — PEAD + insider BUY (no Stage 2)
  if (hasPEAD && hasIns && isBuy && !hasS2)
    return { emoji: '⚡', label: 'EARNINGS TURNAROUND', priority: 2,
      cls:     'bg-amber-500/20 text-amber-200 border border-amber-400/30',
      rowCls:  'bg-amber-950/15 hover:bg-amber-950/25',
      stickyBg:'#170f00' };

  // 🚀 HIDDEN CATALYST — Stage2 + insider BUY (no PEAD)
  if (hasS2 && hasIns && isBuy && !hasPEAD)
    return { emoji: '🚀', label: 'HIDDEN CATALYST', priority: 1,
      cls:     'bg-blue-500/20 text-blue-200 border border-blue-400/30',
      rowCls:  'bg-blue-950/15 hover:bg-blue-950/25',
      stickyBg:'#00091a' };

  // All 3 but insider SELL + all 3 combos not caught above
  if (hasPEAD && hasS2 && hasIns && isSell)
    return { emoji: '⚠️', label: 'SMART MONEY EXIT', priority: 3,
      cls:     'bg-red-500/25 text-red-200 border border-red-400/40',
      rowCls:  'bg-red-950/20 hover:bg-red-950/35',
      stickyBg:'#1a0505' };

  return { emoji: '🔗', label: 'DUAL SIGNAL', priority: 0,
    cls:     'bg-slate-700/40 text-slate-400 border border-slate-600/30',
    rowCls:  'hover:bg-slate-800/25',
    stickyBg:'#0d1117' };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtRet  = (v: number | null | undefined) => v == null ? '—' : `${v>=0?'+':''}${v.toFixed(1)}%`;
const retCls  = (v: number | null | undefined) =>
  v == null ? 'text-slate-600' : v > 10 ? 'text-emerald-300 font-bold' : v > 0 ? 'text-emerald-400' : v > -10 ? 'text-red-400' : 'text-red-500 font-bold';
const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const fmtScore = (v: number | null) => v == null ? '—' : String(v);

type SortKey = 'badge_priority' | 'total_score' | 'ttm_return' | 'earliest_date';
type SortDir = 'asc' | 'desc';
type FilterMode = 'all' | 'triple' | 'exit' | 'turnaround' | 'catalyst';

// ── Sortable Th ────────────────────────────────────────────────────────────────
function Th({ col, label, right, active, dir, onSort }:
  { col: SortKey; label: string; right?: boolean; active: boolean; dir: SortDir; onSort: (c: SortKey) => void }) {
  return (
    <th onClick={() => onSort(col)}
      className={`px-3 py-3 text-[10px] font-semibold uppercase tracking-wider cursor-pointer select-none whitespace-nowrap
        ${right ? 'text-right' : 'text-left'}
        ${active ? 'text-white' : 'text-slate-500 hover:text-slate-300'}`}>
      <span className="inline-flex items-center gap-0.5">
        {label}
        {active && (dir === 'desc' ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />)}
      </span>
    </th>
  );
}

// ── Full nav card (matches original Artha style) ──────────────────────────────
interface NavCard { href: string; icon: React.ElementType; title: string; desc: string; color: string; iconColor: string; badge: string; badgeColor: string; live: boolean; sigCount?: number; }

function NavCard({ card }: { card: NavCard }) {
  const Icon = card.icon;
  const inner = (
    <div className={`bg-gradient-to-br ${card.color} border rounded-2xl p-5 h-full transition-all duration-200 ${card.live ? 'group hover:scale-[1.02] cursor-pointer' : 'opacity-55 cursor-not-allowed'}`}>
      <div className="flex items-start justify-between mb-3">
        <Icon className={`w-6 h-6 ${card.iconColor}`} />
        <div className="flex items-center gap-1.5">
          {card.sigCount != null && card.live && (
            <span className="text-xs font-bold text-white/70">{card.sigCount}</span>
          )}
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${card.badgeColor}`}>{card.badge}</span>
        </div>
      </div>
      <div className={`font-bold text-white text-lg mb-1 ${card.live ? 'group-hover:text-white/90 transition-colors' : ''}`}>{card.title}</div>
      <div className="text-slate-400 text-sm leading-snug">{card.desc}</div>
    </div>
  );
  return card.live
    ? <Link href={card.href} className="block h-full">{inner}</Link>
    : <div className="h-full">{inner}</div>;
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function ConfluenceHub() {
  const [trinity,    setTrinity]    = useState<Trinity[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [sortKey,    setSortKey]    = useState<SortKey>('badge_priority');
  const [sortDir,    setSortDir]    = useState<SortDir>('desc');
  const [filter,     setFilter]     = useState<FilterMode>('all');
  const [triggering, setTriggering] = useState<string | null>(null);
  const [trigMsg,    setTrigMsg]    = useState('');
  const [peadTotal,  setPeadTotal]  = useState(0);
  const [s2Total,    setS2Total]    = useState(0);
  const [insTotal,   setInsTotal]   = useState(0);

  const loadData = async () => {
    setLoading(true); setError('');
    try {
      const cutoff = cutoffDate();

      // Fetch signals + performance data together
      const [peadRaw, s2Raw, insRaw, peadPerf, s2Perf] = await Promise.all([
        sb(`pead_signals?select=ticker,pead_score,trigger_path,signal_date&gte.signal_date=${cutoff}&gte.pead_score=70&order=pead_score.desc`),
        sb(`stage2_signals?select=ticker,stage2_score,tier,days_in_stage2,signal_date&gte.signal_date=${cutoff}&gte.stage2_score=75&order=stage2_score.desc`),
        sb(`insider_signals?select=ticker,company_name,insider_score,transaction_type,acquirer_name,trade_value_in_cr,promoter_historical_6m_return,tier,signal_date&gte.signal_date=${cutoff}&gte.insider_score=75&order=insider_score.desc`),
        // Performance returns keyed to pead signals
        sb(`drift_performance?select=signal_id,returns_since_result&not.is.returns_since_result.null`),
        sb(`stage2_performance?select=signal_id,returns_since_breakout&not.is.returns_since_breakout.null`),
      ]) as [PeadRow[], Stage2Row[], InsiderRow[], {signal_id: string; returns_since_result: number}[], {signal_id: string; returns_since_breakout: number}[]];

      if (!Array.isArray(peadRaw)) throw new Error('Bad response from Supabase');

      setPeadTotal(peadRaw.length);
      setS2Total(s2Raw.length);
      setInsTotal(insRaw.length);

      // Build performance lookups - we'll need to join through signal IDs
      // Simpler: re-fetch pead_signals with drift join
      const peadWithPerf = await sb(
        `pead_signals?select=id,ticker,pead_score,trigger_path,signal_date,drift_performance(returns_since_result)&gte.signal_date=${cutoff}&gte.pead_score=70`
      );
      const s2WithPerf = await sb(
        `stage2_signals?select=id,ticker,stage2_score,days_in_stage2,signal_date,stage2_performance(returns_since_breakout)&gte.signal_date=${cutoff}&gte.stage2_score=75`
      );

      // Build maps keyed by ticker (keep best score)
      const peadMap  = new Map<string, PeadRow & { returns_since_result?: number | null }>();
      const s2Map    = new Map<string, Stage2Row & { returns_since_breakout?: number | null }>();
      const insMap   = new Map<string, InsiderRow>();

      (Array.isArray(peadWithPerf) ? peadWithPerf : peadRaw).forEach((r: PeadRow & { drift_performance?: { returns_since_result: number }[] }) => {
        const existing = peadMap.get(r.ticker);
        if (!existing || r.pead_score > (existing.pead_score ?? 0)) {
          peadMap.set(r.ticker, {
            ...r,
            returns_since_result: r.drift_performance?.[0]?.returns_since_result ?? null,
          });
        }
      });

      (Array.isArray(s2WithPerf) ? s2WithPerf : s2Raw).forEach((r: Stage2Row & { stage2_performance?: { returns_since_breakout: number }[] }) => {
        const existing = s2Map.get(r.ticker);
        if (!existing || r.stage2_score > (existing.stage2_score ?? 0)) {
          s2Map.set(r.ticker, {
            ...r,
            returns_since_breakout: r.stage2_performance?.[0]?.returns_since_breakout ?? null,
          });
        }
      });

      (Array.isArray(insRaw) ? insRaw : []).forEach((r: InsiderRow) => {
        const existing = insMap.get(r.ticker);
        if (!existing || r.insider_score > (existing.insider_score ?? 0)) insMap.set(r.ticker, r);
      });

      // Build trinity — only tickers in ≥2 databases
      const allTickers = new Set([...peadMap.keys(), ...s2Map.keys(), ...insMap.keys()]);
      const rows: Trinity[] = [];

      for (const ticker of allTickers) {
        const pead    = peadMap.get(ticker);
        const s2      = s2Map.get(ticker);
        const insider = insMap.get(ticker);
        const count   = [pead, s2, insider].filter(Boolean).length;
        if (count < 2) continue;

        const dates = [pead?.signal_date, s2?.signal_date, insider?.signal_date].filter(Boolean) as string[];
        const earliest = dates.sort()[0];

        // Best available TTM return
        const s2Ret   = s2?.returns_since_breakout ?? null;
        const peadRet = pead?.returns_since_result ?? null;
        const ttm = s2Ret != null ? s2Ret : peadRet;

        rows.push({
          ticker,
          company_name:     insider?.company_name ?? null,
          pead_score:       pead?.pead_score ?? null,
          pead_path:        pead?.trigger_path ?? null,
          pead_date:        pead?.signal_date ?? null,
          stage2_score:     s2?.stage2_score ?? null,
          stage2_days:      s2?.days_in_stage2 ?? null,
          stage2_date:      s2?.signal_date ?? null,
          insider_score:    insider?.insider_score ?? null,
          insider_type:     insider?.transaction_type ?? null,
          insider_acquirer: insider?.acquirer_name ?? null,
          insider_value_cr: insider?.trade_value_in_cr ?? null,
          insider_hit_rate: insider?.promoter_historical_6m_return ?? null,
          signals_count:    count,
          earliest_date:    earliest,
          ttm_return:       ttm,
        });
      }

      setTrinity(rows);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const dispatch = async (engine: string) => {
    setTriggering(engine); setTrigMsg('');
    try {
      const ep   = engine === 'insider' ? '/api/insider-trigger' : engine === 'stage2' ? '/api/stage2-trigger' : '/api/pead-trigger';
      const body = engine === 'pead' ? { script: 'pead_engine' } : engine === 'stage2' ? { script: 'stage2_engine' } : {};
      const r = await fetch(ep, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      setTrigMsg(d.ok ? `✓ ${engine} engine dispatched` : `✗ ${d.error}`);
    } catch { setTrigMsg('✗ Network error'); }
    finally { setTriggering(null); }
  };

  // Filter
  const filtered = useMemo(() => {
    const withBadge = trinity.map(t => ({ ...t, badge: getBadge(t) }));
    if (filter === 'triple')     return withBadge.filter(t => t.badge.label === 'TRIPLE PLAY');
    if (filter === 'exit')       return withBadge.filter(t => t.badge.label === 'SMART MONEY EXIT');
    if (filter === 'turnaround') return withBadge.filter(t => t.badge.label === 'EARNINGS TURNAROUND');
    if (filter === 'catalyst')   return withBadge.filter(t => t.badge.label === 'HIDDEN CATALYST');
    return withBadge;
  }, [trinity, filter]);

  // Sort — badge_priority is the primary default (TRIPLE PLAY + SMART MONEY EXIT at top)
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const d = sortDir === 'desc' ? -1 : 1;
      if (sortKey === 'badge_priority') {
        const diff = b.badge.priority - a.badge.priority;
        if (diff !== 0) return diff;
        const ta = (a.pead_score??0)+(a.stage2_score??0)+(a.insider_score??0);
        const tb = (b.pead_score??0)+(b.stage2_score??0)+(b.insider_score??0);
        return (b.signals_count - a.signals_count) || (tb - ta);
      }
      if (sortKey === 'earliest_date') return d * a.earliest_date.localeCompare(b.earliest_date);
      if (sortKey === 'total_score') {
        const ta = (a.pead_score ?? 0) + (a.stage2_score ?? 0) + (a.insider_score ?? 0);
        const tb = (b.pead_score ?? 0) + (b.stage2_score ?? 0) + (b.insider_score ?? 0);
        return d * (ta - tb);
      }
      const va = (a[sortKey as keyof typeof a] as number | null) ?? (sortDir==='desc'?-Infinity:Infinity);
      const vb = (b[sortKey as keyof typeof b] as number | null) ?? (sortDir==='desc'?-Infinity:Infinity);
      return d * ((va as number) - (vb as number));
    });
  }, [filtered, sortKey, sortDir]);

  const onSort = (col: SortKey) => {
    if (sortKey === col) setSortDir(d => d==='desc'?'asc':'desc');
    else { setSortKey(col); setSortDir('desc'); }
  };

  const tripleCount  = trinity.filter(t => getBadge(t).label === 'TRIPLE PLAY').length;
  const exitCount    = trinity.filter(t => getBadge(t).label === 'SMART MONEY EXIT').length;

  return (
    <div className="min-h-screen bg-[#0d1117] p-3 md:p-5">
      <div className="max-w-[1900px] mx-auto space-y-4">

        {/* ── Title ── */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl md:text-2xl font-black text-white tracking-tight">
              अर्थ<span className="text-emerald-400">.</span>
              <span className="ml-2 text-base text-slate-400 font-normal">Master Confluence Hub</span>
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Trinity Matrix — PEAD × Stage 2 × Insider Intelligence · 45-day rolling window
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {([['pead','⚡','Earnings','bg-amber-600 hover:bg-amber-500'],
               ['stage2','🏔️','Stage 2','bg-blue-700 hover:bg-blue-600'],
               ['insider','🕵️','Insider','bg-violet-700 hover:bg-violet-600']]
            ).map(([eng,em,lbl,cls]) => (
              <button key={eng} onClick={() => dispatch(eng)} disabled={!!triggering}
                className={`flex items-center gap-1 px-2.5 py-1.5 ${cls} text-white rounded text-xs font-medium disabled:opacity-50 transition`}>
                {triggering === eng ? <RefreshCw className="w-3 h-3 animate-spin" /> : <span>{em}</span>}
                Run {lbl}
              </button>
            ))}
            <button onClick={loadData} disabled={loading}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs disabled:opacity-50">
              <RefreshCw className={`w-3.5 h-3.5 ${loading?'animate-spin':''}`} />
            </button>
          </div>
        </div>

        {trigMsg && (
          <div className={`text-xs px-4 py-2 rounded-lg border ${trigMsg.startsWith('✓')?'bg-emerald-900/30 border-emerald-700/40 text-emerald-300':'bg-red-900/30 border-red-700/40 text-red-300'}`}>
            {trigMsg}
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 bg-red-900/30 border border-red-700/40 rounded-lg p-3 text-red-300 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0" />{error}
          </div>
        )}

        {/* ── Navigation cards ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {([
            { href:'/portfolio',  icon:BarChart2,  title:'Portfolio',           desc:'Holdings, IRR, TWRR benchmarks, sector allocation, NAV chart',                                      color:'from-emerald-600/20 to-emerald-800/10 border-emerald-500/30 hover:border-emerald-400/50', iconColor:'text-emerald-400', badge:'Live',  badgeColor:'bg-emerald-500/20 text-emerald-300', live:true },
            { href:'/pead',       icon:Zap,        title:'PEAD Engine',         desc:'Post-earnings drift · Path A (beat) · Path B (trap) · T+1/T+5/T+20 tracking',                    color:'from-amber-600/20 to-amber-800/10 border-amber-500/30 hover:border-amber-400/50',   iconColor:'text-amber-400',   badge:'Live',  badgeColor:'bg-amber-500/20 text-amber-300',   live:true,  sigCount:peadTotal  },
            { href:'/stage2',     icon:Layers,     title:'Stage 2 Hub',         desc:'Weinstein · Minervini · SOIC structural breakout scanner · 0–100 score · 5 PM IST',             color:'from-blue-600/20 to-blue-800/10 border-blue-500/30 hover:border-blue-400/50',       iconColor:'text-blue-400',    badge:'Live',  badgeColor:'bg-blue-500/20 text-blue-300',     live:true,  sigCount:s2Total     },
            { href:'/insider',    icon:Eye,        title:'Insider Intel',        desc:'NSE PIT disclosures · Promoter & Director open-market buys/sells · cluster flags',               color:'from-violet-600/20 to-violet-800/10 border-violet-500/30 hover:border-violet-400/50', iconColor:'text-violet-400',  badge:'Live',  badgeColor:'bg-violet-500/20 text-violet-300', live:true,  sigCount:insTotal    },
            { href:'#',           icon:Target,     title:'Goals',               desc:'Financial goals tracker — retirement, home, education, corpus planning',                          color:'from-cyan-600/20 to-cyan-800/10 border-cyan-500/30',                                   iconColor:'text-cyan-400',    badge:'Soon',  badgeColor:'bg-cyan-500/20 text-cyan-300',     live:false },
            { href:'#',           icon:Wallet,     title:'Tax & P&L',           desc:'Capital gains, tax-loss harvesting, realized P&L across all holdings',                           color:'from-rose-600/20 to-rose-800/10 border-rose-500/30',                                   iconColor:'text-rose-400',    badge:'Soon',  badgeColor:'bg-rose-500/20 text-rose-300',     live:false },
            { href:'#',           icon:BookOpen,   title:'Research',            desc:'Stock thesis tracker, smart money moves, institutional research notes',                          color:'from-indigo-600/20 to-indigo-800/10 border-indigo-500/30',                             iconColor:'text-indigo-400',  badge:'Soon',  badgeColor:'bg-indigo-500/20 text-indigo-300', live:false },
          ] as NavCard[]).map(card => <NavCard key={card.title} card={card} />)}
        </div>

        {/* ── Filter pills ── */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-1 gap-1 flex-wrap">
            {([
              ['all',         '🔭 All Confluences'],
              ['triple',      '🔥 Triple Play'],
              ['exit',        '⚠️ Smart Money Exit'],
              ['turnaround',  '⚡ Earnings Turnaround'],
              ['catalyst',    '🚀 Hidden Catalyst'],
            ] as [FilterMode, string][]).map(([v,l]) => (
              <button key={v} onClick={() => setFilter(v)}
                className={`px-3 py-1 text-xs rounded font-medium transition whitespace-nowrap ${filter===v?'bg-slate-600 text-white':'text-slate-400 hover:text-white'}`}>
                {l}
              </button>
            ))}
          </div>
          <span className="text-slate-600 text-xs">{sorted.length} tickers</span>
        </div>

        {/* ── Trinity Matrix Table ── */}
        {loading ? (
          <div className="text-center py-20 text-slate-500 text-sm">Loading Trinity Matrix…</div>
        ) : sorted.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-16 text-center">
            <span className="text-4xl mb-4 block">🔭</span>
            <p className="text-slate-400 font-semibold">No cross-engine confluences yet</p>
            <p className="text-slate-600 text-xs mt-1">Run all three engines to detect Trinity setups</p>
          </div>
        ) : (
          <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
            <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: 'min(740px, calc(100vh - 230px))' }}>
              <table className="w-full text-xs border-collapse" style={{ minWidth: '1300px' }}>
                <thead className="sticky top-0 z-20">
                  <tr className="bg-[#161b22] border-b-2 border-slate-700">
                    <th className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400 bg-[#161b22] sticky left-0 z-30 whitespace-nowrap min-w-[160px]">
                      Ticker
                    </th>
                    <Th col="badge_priority" label="Trinity Signal" active={sortKey==='badge_priority'} dir={sortDir} onSort={onSort} />
                    <Th col="total_score"    label="Score Total" right active={sortKey==='total_score'}   dir={sortDir} onSort={onSort} />
                    <th className="px-3 py-3 text-center text-[10px] font-semibold uppercase tracking-wider text-amber-500/80 whitespace-nowrap">⚡ PEAD</th>
                    <th className="px-3 py-3 text-center text-[10px] font-semibold uppercase tracking-wider text-blue-500/80 whitespace-nowrap">🏔️ Stage 2</th>
                    <th className="px-3 py-3 text-center text-[10px] font-semibold uppercase tracking-wider text-violet-500/80 whitespace-nowrap">🕵️ Insider</th>
                    <Th col="ttm_return" label="TTM Return" right active={sortKey==='ttm_return'} dir={sortDir} onSort={onSort} />
                    <Th col="earliest_date" label="Since" active={sortKey==='earliest_date'} dir={sortDir} onSort={onSort} />
                    <th className="px-3 py-3 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">Chart</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(row => {
                    const badge   = row.badge;
                    const total   = (row.pead_score ?? 0) + (row.stage2_score ?? 0) + (row.insider_score ?? 0);
                    const insUp   = row.insider_type === 'BUY';
                    const hitPct  = row.insider_hit_rate;

                    return (
                      <tr key={row.ticker} className={`transition-colors border-b ${badge.rowCls} ${badge.label === 'SMART MONEY EXIT' ? 'border-red-900/30' : badge.label === 'TRIPLE PLAY' ? 'border-orange-900/30' : 'border-slate-800/40'}`}>

                        {/* Ticker */}
                        <td className="px-3 py-3 sticky left-0 z-10 whitespace-nowrap" style={{ backgroundColor: badge.stickyBg }}>
                          <a href={`https://www.screener.in/company/${row.ticker}/`} target="_blank" rel="noopener noreferrer"
                            className="font-bold text-white hover:text-blue-400 transition">{row.ticker}</a>
                          {row.company_name && (
                            <div className="text-slate-500 text-[10px] truncate max-w-[140px] mt-0.5">{row.company_name}</div>
                          )}
                        </td>

                        {/* Trinity Badge */}
                        <td className="px-3 py-3 whitespace-nowrap">
                          <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold ${badge.cls}`}>
                            <span>{badge.emoji}</span>
                            <span>{badge.label}</span>
                          </div>
                        </td>

                        {/* Total score */}
                        <td className="px-3 py-3 text-right whitespace-nowrap">
                          <span className="text-base font-black text-white">{total}</span>
                        </td>

                        {/* PEAD column */}
                        <td className="px-3 py-3 text-center whitespace-nowrap">
                          {row.pead_score != null ? (
                            <div>
                              <div className={`text-sm font-bold ${row.pead_score >= 80 ? 'text-emerald-400' : row.pead_score >= 70 ? 'text-amber-400' : 'text-slate-400'}`}>
                                {row.pead_score}
                              </div>
                              <div className="text-[9px] text-slate-600 mt-0.5">
                                {row.pead_path && <span className="mr-1">{row.pead_path}</span>}
                                {row.pead_date && fmtDate(row.pead_date)}
                              </div>
                            </div>
                          ) : <span className="text-slate-700 text-lg">—</span>}
                        </td>

                        {/* Stage 2 column */}
                        <td className="px-3 py-3 text-center whitespace-nowrap">
                          {row.stage2_score != null ? (
                            <div>
                              <div className={`text-sm font-bold ${row.stage2_score >= 75 ? 'text-emerald-400' : 'text-amber-400'}`}>
                                {row.stage2_score}
                              </div>
                              <div className="text-[9px] mt-0.5">
                                {row.stage2_days != null && (
                                  <span className={row.stage2_days <= 15 ? 'text-emerald-600' : 'text-slate-600'}>
                                    {row.stage2_days}d in S2
                                  </span>
                                )}
                              </div>
                            </div>
                          ) : <span className="text-slate-700 text-lg">—</span>}
                        </td>

                        {/* Insider column */}
                        <td className="px-3 py-3 text-center whitespace-nowrap">
                          {row.insider_score != null ? (
                            <div>
                              <div className="flex items-center justify-center gap-1">
                                {insUp
                                  ? <TrendingUp className="w-3 h-3 text-emerald-400"/>
                                  : <TrendingDown className="w-3 h-3 text-red-400"/>}
                                <span className={`text-sm font-bold ${insUp ? 'text-emerald-400' : 'text-red-400'}`}>
                                  {row.insider_type}
                                </span>
                              </div>
                              {row.insider_value_cr != null && (
                                <div className="text-[9px] text-slate-500 mt-0.5">₹{row.insider_value_cr.toFixed(1)}Cr</div>
                              )}
                              {hitPct != null && (
                                <div className={`text-[9px] mt-0.5 font-medium ${hitPct > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                                  Hit {hitPct >= 0 ? '+' : ''}{hitPct.toFixed(0)}%
                                </div>
                              )}
                            </div>
                          ) : <span className="text-slate-700 text-lg">—</span>}
                        </td>

                        {/* TTM Return */}
                        <td className={`px-3 py-3 text-right whitespace-nowrap font-bold ${retCls(row.ttm_return)}`}>
                          {fmtRet(row.ttm_return)}
                          {row.ttm_return != null && (
                            <div className="text-[9px] text-slate-600 font-normal">since signal</div>
                          )}
                        </td>

                        {/* Earliest date */}
                        <td className="px-3 py-3 text-slate-400 whitespace-nowrap">{fmtDate(row.earliest_date)}</td>

                        {/* Chart links */}
                        <td className="px-3 py-3 text-center whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1">
                            <a href={`https://in.tradingview.com/symbols/NSE-${row.ticker}/`} target="_blank" rel="noopener noreferrer"
                              className="text-[10px] text-slate-500 hover:text-blue-400 border border-slate-700 hover:border-blue-500 px-1.5 py-0.5 rounded transition">TV</a>
                            <a href={`https://www.screener.in/company/${row.ticker}/`} target="_blank" rel="noopener noreferrer"
                              className="text-[10px] text-slate-500 hover:text-emerald-400 border border-slate-700 hover:border-emerald-500 px-1.5 py-0.5 rounded transition">SCR</a>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 border-t border-slate-800 flex justify-between text-[10px] text-slate-600">
              <span>{sorted.length} confluences · 🔥 Triple Play = all 3 engines + Insider BUY · ⚠️ Exit = insider SELL against bullish signal</span>
              <span>TTM = return since earliest signal · TV = TradingView · SCR = Screener.in</span>
            </div>
          </div>
        )}

        <div className="pb-2" />

      </div>
    </div>
  );
}

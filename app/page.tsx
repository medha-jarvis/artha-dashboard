'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import {
  RefreshCw, Zap, Layers, Eye, AlertCircle,
  ChevronUp, ChevronDown, TrendingUp, TrendingDown,
  BarChart2, Target, BookOpen, Wallet, Activity, Crown,
} from 'lucide-react';

interface SectorPulseCard { name: string; score: number; stage: string; }
const STAGE_DOT: Record<string, string> = {
  STAGE2_BREAKOUT: 'bg-emerald-400',
  STAGE2_EARLY:    'bg-sky-400',
  STAGE2_WATCH:    'bg-amber-400',
  BELOW_STAGE2:    'bg-slate-600',
};

const SB_URL = 'https://jljwgwftuqrabfyiucfl.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impsandnd2Z0dXFyYWJmeWl1Y2ZsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNTQyOTUsImV4cCI6MjA4NzkzMDI5NX0.eOa9XYyZGEM3S0Xvl95gx1wgmrQnPSV8Wh9JDxPu07M';
const sb = (path: string) =>
  fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    cache: 'no-store',
  }).then(r => r.json());

const CUTOFF_DAYS         = 45;
const INSIDER_CUTOFF_DAYS = 180;
const SI_CUTOFF_DAYS      = 30;
const cutoffDate        = () => { const d = new Date(); d.setDate(d.getDate() - CUTOFF_DAYS);         return d.toISOString().slice(0,10); };
const insiderCutoffDate = () => { const d = new Date(); d.setDate(d.getDate() - INSIDER_CUTOFF_DAYS); return d.toISOString().slice(0,10); };
const siCutoffDate      = () => { const d = new Date(); d.setDate(d.getDate() - SI_CUTOFF_DAYS);      return d.toISOString().slice(0,10); };

interface PeadRow          { id: string; ticker: string; pead_score: number; trigger_path: string; signal_date: string; }
interface Stage2Row        { id: string; ticker: string; stage2_score: number; tier: string; days_in_stage2: number|null; signal_date: string; }
interface InsiderRow       { ticker: string; company_name: string|null; insider_score: number; transaction_type: string; acquirer_name: string; trade_value_in_cr: number|null; tier: string; signal_date: string; }
interface SuperInvestorRow { ticker: string; client_name: string; transaction_type: string; trade_value_cr: number; signal_date: string; }

interface Confluence {
  ticker: string; company_name: string|null;
  pead_score: number|null; pead_path: string|null; pead_date: string|null;
  stage2_score: number|null; stage2_days: number|null; stage2_date: string|null;
  insider_score: number|null; insider_type: string|null; insider_acquirer: string|null;
  insider_value_cr: number|null;
  si_type: string|null; si_client: string|null; si_value_cr: number|null; si_date: string|null;
  signals_count: number; earliest_date: string;
  ttm_return: number|null;
}

interface Badge { emoji: string; label: string; priority: number; cls: string; rowCls: string; stickyBg: string; }

function getBadge(row: Confluence): Badge {
  const hasPEAD = row.pead_score   != null;
  const hasS2   = row.stage2_score != null;
  const hasIns  = row.insider_score != null;
  const hasSI   = row.si_type      != null;

  const anyBuy  = (hasIns && row.insider_type === 'BUY')  || (hasSI && row.si_type === 'BUY');
  const anySell = (hasIns && row.insider_type === 'SELL') || (hasSI && row.si_type === 'SELL');
  const hasTech = hasPEAD || hasS2;
  const count   = [hasPEAD, hasS2, hasIns, hasSI].filter(Boolean).length;

  if (count === 4)              return { emoji:'👑', label:'QUADRANT PLAY',        priority:5, cls:'bg-yellow-500/30 text-yellow-100 border border-yellow-400/50', rowCls:'bg-yellow-950/25 hover:bg-yellow-950/35', stickyBg:'#130f00' };
  if (count === 3)              return { emoji:'🔥', label:'TRIPLE PLAY',          priority:4, cls:'bg-orange-500/25 text-orange-200 border border-orange-400/40', rowCls:'bg-orange-950/20 hover:bg-orange-950/30', stickyBg:'#120900' };
  if (hasTech && anySell)      return { emoji:'⚠️', label:'SMART MONEY EXIT',     priority:3, cls:'bg-red-500/25 text-red-200 border border-red-400/40',          rowCls:'bg-red-950/20 hover:bg-red-950/30',    stickyBg:'#120505' };
  if (hasTech && anyBuy)       return { emoji:'⚡', label:'INSTITUTIONAL BACKING', priority:2, cls:'bg-emerald-500/20 text-emerald-200 border border-emerald-400/30', rowCls:'bg-emerald-950/15 hover:bg-emerald-950/25', stickyBg:'#001208' };
  return                               { emoji:'🔗', label:'DUAL SIGNAL',          priority:0, cls:'bg-slate-700/40 text-slate-400 border border-slate-600/30',    rowCls:'hover:bg-slate-800/25',                stickyBg:'#0a0f16' };
}

const fmtRet  = (v: number|null|undefined) => v==null ? '—' : `${v>=0?'+':''}${v.toFixed(1)}%`;
const retCls  = (v: number|null|undefined) => v==null?'text-slate-600':v>10?'text-emerald-300 font-bold':v>0?'text-emerald-400':v>-10?'text-red-400':'text-red-500 font-bold';
const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-IN',{day:'numeric',month:'short'});
const fmtCr   = (v: number|null) => v == null ? null : v >= 100 ? `₹${(v/100).toFixed(1)}K Cr` : `₹${v.toFixed(0)}Cr`;

type SortKey = 'badge_priority'|'total_score'|'ttm_return'|'earliest_date';
type SortDir = 'asc'|'desc';
type FilterMode =
  'all'|'multi'|'quadrant'|'triple'|'exit'|'institutional'|
  'pead_only'|'s2_only'|'ins_buy'|'ins_sell'|'si_buy'|'si_sell';

function Th({ col, label, right, active, dir, onSort }:
  { col: SortKey; label: string; right?: boolean; active: boolean; dir: SortDir; onSort:(c:SortKey)=>void }) {
  return (
    <th onClick={() => onSort(col)}
      className={`px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider cursor-pointer select-none whitespace-nowrap
        ${right?'text-right':'text-left'} ${active?'text-white':'text-slate-500 hover:text-slate-300'}`}>
      <span className="inline-flex items-center gap-0.5">
        {label}{active&&(dir==='desc'?<ChevronDown className="w-3 h-3"/>:<ChevronUp className="w-3 h-3"/>)}
      </span>
    </th>
  );
}

export default function ConfluenceHub() {
  const [data,        setData]        = useState<Confluence[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [sortKey,     setSortKey]     = useState<SortKey>('badge_priority');
  const [sortDir,     setSortDir]     = useState<SortDir>('desc');
  const [filter,      setFilter]      = useState<FilterMode>('all');
  const [triggering,  setTriggering]  = useState<string|null>(null);
  const [trigMsg,     setTrigMsg]     = useState('');
  const [peadTotal,   setPeadTotal]   = useState(0);
  const [s2Total,     setS2Total]     = useState(0);
  const [insTotal,    setInsTotal]    = useState(0);
  const [siTotal,     setSiTotal]     = useState(0);
  const [sectorPulse, setSectorPulse] = useState<SectorPulseCard[]>([]);

  const loadData = async () => {
    setLoading(true); setError('');
    try {
      const cutoff       = cutoffDate();
      const insCutoff    = insiderCutoffDate();

      // Sector Pulse — latest scores (non-blocking)
      sb('daily_sector_scores?select=score,stage,sector_definitions(name)&order=date.desc,score.desc&limit=20')
        .then((rows: Array<{score:number;stage:string;sector_definitions:{name:string}|null}>) => {
          if (Array.isArray(rows)) {
            const seen = new Set<string>();
            const unique: SectorPulseCard[] = [];
            rows.forEach(r => {
              const n = r.sector_definitions?.name || '';
              if (n && !seen.has(n)) { seen.add(n); unique.push({ name: n, score: r.score, stage: r.stage }); }
            });
            setSectorPulse(unique.slice(0, 6));
          }
        }).catch(() => {});

      const [peadRaw, s2Raw, insRaw, siRaw] = await Promise.all([
        sb(`pead_signals?select=id,ticker,pead_score,trigger_path,signal_date&signal_date=gte.${cutoff}&pead_score=gte.70&order=pead_score.desc`),
        sb(`stage2_signals?select=id,ticker,stage2_score,tier,days_in_stage2,signal_date&signal_date=gte.${cutoff}&stage2_score=gte.75&order=stage2_score.desc`),
        sb(`insider_signals?select=ticker,company_name,insider_score,transaction_type,acquirer_name,trade_value_in_cr,tier,signal_date&signal_date=gte.${insCutoff}&insider_score=gte.75&order=insider_score.desc`),
        sb(`super_investor_signals?select=ticker,client_name,transaction_type,trade_value_cr,signal_date&signal_date=gte.${siCutoffDate()}&order=trade_value_cr.desc`),
      ]) as [PeadRow[], Stage2Row[], InsiderRow[], SuperInvestorRow[]];

      if (!Array.isArray(peadRaw)) throw new Error(`PEAD: ${JSON.stringify(peadRaw)}`);
      if (!Array.isArray(s2Raw))   throw new Error(`Stage2: ${JSON.stringify(s2Raw)}`);
      if (!Array.isArray(insRaw))  throw new Error(`Insider: ${JSON.stringify(insRaw)}`);
      if (!Array.isArray(siRaw))   throw new Error(`SuperInvestor: ${JSON.stringify(siRaw)}`);

      setPeadTotal(peadRaw.length);
      setS2Total(s2Raw.length);
      setInsTotal(insRaw.length);
      setSiTotal(siRaw.length);

      const peadIds = peadRaw.map(r => r.id).filter(Boolean);
      const s2Ids   = s2Raw.map(r => r.id).filter(Boolean);

      const [driftPerf, s2Perf] = await Promise.all([
        peadIds.length > 0 ? sb(`drift_performance?select=signal_id,returns_since_result&returns_since_result=not.is.null`) : Promise.resolve([]),
        s2Ids.length   > 0 ? sb(`stage2_performance?select=signal_id,returns_since_breakout&returns_since_breakout=not.is.null`) : Promise.resolve([]),
      ]);

      const driftMap  = new Map<string,number>();
      const s2PerfMap = new Map<string,number>();
      if (Array.isArray(driftPerf)) driftPerf.forEach((d:{signal_id:string;returns_since_result:number}) => { if(d.signal_id) driftMap.set(d.signal_id,d.returns_since_result); });
      if (Array.isArray(s2Perf))   s2Perf.forEach((d:{signal_id:string;returns_since_breakout:number})   => { if(d.signal_id) s2PerfMap.set(d.signal_id,d.returns_since_breakout); });

      const peadMap = new Map<string, PeadRow & {returns_since_result?:number|null}>();
      const s2Map   = new Map<string, Stage2Row & {returns_since_breakout?:number|null}>();
      const insMap  = new Map<string, InsiderRow>();
      const siMap   = new Map<string, SuperInvestorRow>();

      peadRaw.forEach(r => {
        const ex = peadMap.get(r.ticker);
        if (!ex || r.pead_score > ex.pead_score) peadMap.set(r.ticker, { ...r, returns_since_result: driftMap.get(r.id) ?? null });
      });
      s2Raw.forEach(r => {
        const ex = s2Map.get(r.ticker);
        if (!ex || r.stage2_score > ex.stage2_score) s2Map.set(r.ticker, { ...r, returns_since_breakout: s2PerfMap.get(r.id) ?? null });
      });
      insRaw.forEach(r => {
        const ex = insMap.get(r.ticker);
        if (!ex || r.insider_score > ex.insider_score) insMap.set(r.ticker, r);
      });
      // Keep highest-value SI trade per ticker
      siRaw.forEach(r => {
        const ex = siMap.get(r.ticker);
        if (!ex || r.trade_value_cr > ex.trade_value_cr) siMap.set(r.ticker, r);
      });

      const allTickers = new Set([...peadMap.keys(), ...s2Map.keys(), ...insMap.keys(), ...siMap.keys()]);
      const rows: Confluence[] = [];

      for (const ticker of allTickers) {
        const pead = peadMap.get(ticker), s2 = s2Map.get(ticker);
        const insider = insMap.get(ticker), si = siMap.get(ticker);

        const count = [pead, s2, insider, si].filter(Boolean).length;

        const dates = [pead?.signal_date, s2?.signal_date, insider?.signal_date, si?.signal_date].filter(Boolean) as string[];
        const ttm   = s2?.returns_since_breakout ?? pead?.returns_since_result ?? null;

        rows.push({
          ticker,
          company_name:     insider?.company_name ?? null,
          pead_score:       pead?.pead_score       ?? null,
          pead_path:        pead?.trigger_path      ?? null,
          pead_date:        pead?.signal_date        ?? null,
          stage2_score:     s2?.stage2_score         ?? null,
          stage2_days:      s2?.days_in_stage2        ?? null,
          stage2_date:      s2?.signal_date            ?? null,
          insider_score:    insider?.insider_score      ?? null,
          insider_type:     insider?.transaction_type   ?? null,
          insider_acquirer: insider?.acquirer_name       ?? null,
          insider_value_cr: insider?.trade_value_in_cr   ?? null,
          si_type:          si?.transaction_type          ?? null,
          si_client:        si?.client_name                ?? null,
          si_value_cr:      si?.trade_value_cr              ?? null,
          si_date:          si?.signal_date                  ?? null,
          signals_count:    count,
          earliest_date:    dates.sort()[0],
          ttm_return:       ttm,
        });
      }

      setData(rows);
    } catch (e:unknown) { setError(e instanceof Error ? e.message : 'Load failed'); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadData(); }, []);

  const dispatch = async (engine: string) => {
    setTriggering(engine); setTrigMsg('');
    try {
      const ep =
        engine === 'insider'        ? '/api/insider-trigger'         :
        engine === 'stage2'         ? '/api/stage2-trigger'          :
        engine === 'super_investor' ? '/api/super-investor-trigger'  :
                                      '/api/pead-trigger';
      const body =
        engine === 'pead'   ? { script: 'pead_engine' }   :
        engine === 'stage2' ? { script: 'stage2_engine' } : {};
      const r = await fetch(ep, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      setTrigMsg(d.ok ? `✓ ${engine} dispatched` : `✗ ${d.error}`);
    } catch { setTrigMsg('✗ Network error'); }
    finally { setTriggering(null); }
  };

  const filtered = useMemo(() => {
    const withBadge = data.map(t => ({ ...t, badge: getBadge(t) }));
    if (filter === 'quadrant')      return withBadge.filter(t => t.badge.label === 'QUADRANT PLAY');
    if (filter === 'triple')        return withBadge.filter(t => t.badge.label === 'TRIPLE PLAY');
    if (filter === 'exit')          return withBadge.filter(t => t.badge.label === 'SMART MONEY EXIT');
    if (filter === 'institutional') return withBadge.filter(t => t.badge.label === 'INSTITUTIONAL BACKING');
    if (filter === 'pead_only')     return withBadge.filter(t => t.pead_score != null);
    if (filter === 's2_only')       return withBadge.filter(t => t.stage2_score != null);
    if (filter === 'ins_buy')       return withBadge.filter(t => t.insider_score != null && t.insider_type === 'BUY');
    if (filter === 'ins_sell')      return withBadge.filter(t => t.insider_score != null && t.insider_type === 'SELL');
    if (filter === 'si_buy')        return withBadge.filter(t => t.si_type === 'BUY');
    if (filter === 'si_sell')       return withBadge.filter(t => t.si_type === 'SELL');
    if (filter === 'multi')         return withBadge.filter(t => t.signals_count >= 2); // 2+ pipelines filter
    return withBadge;
  }, [data, filter]);

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    const d = sortDir === 'desc' ? -1 : 1;
    if (sortKey === 'badge_priority') {
      const diff = b.badge.priority - a.badge.priority;
      if (diff !== 0) return diff;
      const ta = (a.pead_score??0)+(a.stage2_score??0)+(a.insider_score??0)+(a.si_value_cr??0 > 0 ? 50 : 0);
      const tb = (b.pead_score??0)+(b.stage2_score??0)+(b.insider_score??0)+(b.si_value_cr??0 > 0 ? 50 : 0);
      return (b.signals_count - a.signals_count) || (tb - ta);
    }
    if (sortKey === 'earliest_date') return d * a.earliest_date.localeCompare(b.earliest_date);
    if (sortKey === 'total_score') {
      const sa = (a.pead_score??0)+(a.stage2_score??0)+(a.insider_score??0)+(a.si_value_cr??0 > 0 ? 50 : 0);
      const sb2 = (b.pead_score??0)+(b.stage2_score??0)+(b.insider_score??0)+(b.si_value_cr??0 > 0 ? 50 : 0);
      return d * (sa - sb2);
    }
    const va = (a[sortKey as keyof typeof a] as number|null) ?? (sortDir==='desc'?-Infinity:Infinity);
    const vb = (b[sortKey as keyof typeof b] as number|null) ?? (sortDir==='desc'?-Infinity:Infinity);
    return d * ((va as number) - (vb as number));
  }), [filtered, sortKey, sortDir]);

  const onSort = (col: SortKey) => { if(sortKey===col) setSortDir(d=>d==='desc'?'asc':'desc'); else { setSortKey(col); setSortDir('desc'); } };

  const quadrantCount = data.filter(t => getBadge(t).label === 'QUADRANT PLAY').length;
  const tripleCount   = data.filter(t => getBadge(t).label === 'TRIPLE PLAY').length;
  const insHcCount    = data.filter(t => t.insider_score != null).length;

  const breakoutSectors = sectorPulse.filter(s => s.stage === 'STAGE2_BREAKOUT').length;

  const navLinks = [
    { href:'/portfolio',     label:'Portfolio',     icon:BarChart2, color:'text-emerald-400', border:'border-emerald-500/30 hover:border-emerald-400/60', bg:'hover:bg-emerald-500/8', count: null },
    { href:'/pead',          label:'PEAD',          icon:Zap,       color:'text-amber-400',  border:'border-amber-500/30 hover:border-amber-400/60',   bg:'hover:bg-amber-500/8',   count: peadTotal||null },
    { href:'/stage2',        label:'Stage 2',       icon:Layers,    color:'text-blue-400',   border:'border-blue-500/30 hover:border-blue-400/60',     bg:'hover:bg-blue-500/8',    count: s2Total||null },
    { href:'/insider',       label:'Insider Intel', icon:Eye,       color:'text-violet-400', border:'border-violet-500/30 hover:border-violet-400/60', bg:'hover:bg-violet-500/8',  count: insTotal||null },
    { href:'/sector-pulse',  label:'Sector Pulse',  icon:Activity,  color:'text-teal-400',   border:'border-teal-500/30 hover:border-teal-400/60',     bg:'hover:bg-teal-500/8',    count: breakoutSectors||null },
  ];

  return (
    <div className="min-h-screen bg-[#070c14] text-white">

      {/* Ambient gradient */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-emerald-600/8 rounded-full blur-3xl" />
        <div className="absolute top-0 right-1/4 w-80 h-80 bg-violet-600/6 rounded-full blur-3xl" />
        <div className="absolute top-1/3 left-0 w-64 h-64 bg-blue-600/5 rounded-full blur-3xl" />
        <div className="absolute top-1/2 right-0 w-64 h-64 bg-yellow-600/4 rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-[1920px] mx-auto px-3 md:px-6 pt-5 pb-10 space-y-5">

        {/* ── Hero ── */}
        <div className="py-4 md:py-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
            </span>
            <span className="text-emerald-400/90 text-[11px] font-semibold tracking-[0.15em] uppercase">Live Intelligence</span>
          </div>

          <div className="flex items-end gap-3 mb-2">
            <h1 className="text-5xl md:text-7xl font-black tracking-tight leading-none">
              <span className="bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">अर्थ</span>
              <span className="text-emerald-400">.</span>
            </h1>
            <div className="pb-1 md:pb-2">
              <div className="text-[10px] md:text-xs text-slate-500 font-medium tracking-widest uppercase leading-tight">
                Quadrant Intelligence Engine
              </div>
              <div className="text-[10px] md:text-xs text-slate-600 tracking-wide">
                PEAD · Stage 2 · Insider · Super Investor
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 mt-3">
            {[
              { label: '⚡ Earnings',   val: peadTotal,    color: 'text-amber-400',  border: 'border-amber-500/25',  bg: 'bg-amber-500/8' },
              { label: '🏔 Breakouts',  val: s2Total,      color: 'text-blue-400',   border: 'border-blue-500/25',   bg: 'bg-blue-500/8' },
              { label: '🕵 Insider HC', val: insHcCount,   color: 'text-violet-400', border: 'border-violet-500/25', bg: 'bg-violet-500/8' },
              { label: '🏦 Super Inv',  val: siTotal,      color: 'text-yellow-400', border: 'border-yellow-500/25', bg: 'bg-yellow-500/8' },
              { label: '🔥 Triple',     val: tripleCount,  color: 'text-orange-400', border: 'border-orange-500/25', bg: 'bg-orange-500/8' },
              { label: '👑 Quadrant',   val: quadrantCount,color: 'text-yellow-300', border: 'border-yellow-400/30', bg: 'bg-yellow-400/8' },
            ].map(s => (
              <div key={s.label} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${s.border} ${s.bg} backdrop-blur-sm`}>
                <span className="text-[11px] text-slate-400">{s.label}</span>
                <span className={`text-sm font-black ${s.color}`}>{loading ? '…' : s.val}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Quick Nav ── */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
          {navLinks.map(n => {
            const Icon = n.icon;
            return (
              <Link key={n.href} href={n.href}
                className={`group flex items-center gap-3 px-4 py-3 bg-white/[0.03] border ${n.border} ${n.bg} rounded-xl transition-all duration-200 backdrop-blur-sm`}>
                <Icon className={`w-4 h-4 ${n.color} flex-shrink-0`} />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white/90 group-hover:text-white truncate">{n.label}</div>
                  {n.count != null && n.count > 0 && (
                    <div className={`text-[11px] ${n.color} font-bold`}>{n.count} signals</div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>

        {/* ── Status Messages ── */}
        {trigMsg && (
          <div className={`text-xs px-4 py-2 rounded-lg border backdrop-blur-sm ${trigMsg.startsWith('✓')?'bg-emerald-900/30 border-emerald-700/40 text-emerald-300':'bg-red-900/30 border-red-700/40 text-red-300'}`}>
            {trigMsg}
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 bg-red-900/20 border border-red-700/30 rounded-xl p-3 text-red-300 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0"/>{error}
          </div>
        )}

        {/* ── Sector Pulse Mini-Card ── */}
        {sectorPulse.length > 0 && (
          <div className="bg-white/[0.02] border border-teal-500/20 rounded-xl p-4 backdrop-blur-sm">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-teal-400" />
                <span className="text-sm font-semibold text-white">Sector Pulse</span>
                {breakoutSectors > 0 && (
                  <span className="px-2 py-0.5 bg-emerald-500/20 border border-emerald-500/40 rounded-full text-[10px] font-bold text-emerald-300">
                    {breakoutSectors} BREAKOUT{breakoutSectors > 1 ? 'S' : ''}
                  </span>
                )}
              </div>
              <Link href="/sector-pulse" className="text-[11px] text-teal-500 hover:text-teal-300 transition-colors">
                View all →
              </Link>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
              {sectorPulse.map(s => {
                const dot = STAGE_DOT[s.stage] || 'bg-slate-600';
                const pct = Math.min(s.score, 100);
                const barColor = pct >= 80 ? 'bg-emerald-500' : pct >= 65 ? 'bg-sky-500' : pct >= 50 ? 'bg-amber-500' : 'bg-slate-600';
                return (
                  <Link key={s.name} href="/sector-pulse"
                    className="group bg-slate-900/60 hover:bg-slate-800/60 border border-slate-800 hover:border-slate-700 rounded-lg p-2.5 transition-all">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
                      <span className="text-[11px] text-slate-300 font-medium truncate">{s.name}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="flex-1 h-1 bg-slate-800 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[11px] font-mono font-bold text-white">{s.score}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Confluence Section ── */}
        <div className="space-y-3">

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-slate-400"/>
                <h2 className="text-sm font-bold text-white tracking-tight">Confluence Matrix</h2>
                <span className="text-[10px] text-slate-600 font-normal">2+ engines converging · 45d PEAD/S2/SI · 180d Insider</span>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {([
                ['pead',           '⚡', 'bg-amber-600/80 hover:bg-amber-500'],
                ['stage2',         '🏔️', 'bg-blue-700/80 hover:bg-blue-600'],
                ['insider',        '🕵️', 'bg-violet-700/80 hover:bg-violet-600'],
                ['super_investor', '🏦', 'bg-yellow-700/80 hover:bg-yellow-600'],
              ] as const).map(([eng, em, cls]) => (
                <button key={eng} onClick={() => dispatch(eng)} disabled={!!triggering}
                  className={`flex items-center gap-1 px-2 py-1 ${cls} text-white rounded-lg text-[10px] font-semibold disabled:opacity-40 transition backdrop-blur-sm`}>
                  {triggering === eng ? <RefreshCw className="w-2.5 h-2.5 animate-spin"/> : <span>{em}</span>}
                  <span className="hidden sm:inline">{eng.replace('_', ' ')}</span>
                </button>
              ))}
              <button onClick={loadData} disabled={loading}
                className="p-1.5 bg-white/5 hover:bg-white/10 border border-slate-700/50 rounded-lg disabled:opacity-40 transition">
                <RefreshCw className={`w-3.5 h-3.5 text-slate-400 ${loading?'animate-spin':''}`}/>
              </button>
            </div>
          </div>

          {/* Filter pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            {([
              ['all',          'All'],
              ['multi',        '2+ Engines'],
              ['quadrant',     '👑 Quadrant'],
              ['triple',       '🔥 Triple'],
              ['institutional','⚡ Institutional'],
              ['exit',         '⚠️ Exit'],
              ['pead_only',    'PEAD'],
              ['s2_only',      'Stage 2'],
              ['ins_buy',      'Insider BUY'],
              ['ins_sell',     'Insider SELL'],
              ['si_buy',       '🟢 SI Buy'],
              ['si_sell',      '🔴 SI Sell'],
            ] as [FilterMode,string][]).map(([v,l]) => (
              <button key={v} onClick={() => setFilter(v)}
                className={`px-2.5 py-1 text-[11px] rounded-full font-medium whitespace-nowrap flex-shrink-0 transition-all
                  ${filter===v
                    ? 'bg-white/15 text-white border border-white/20'
                    : 'bg-white/[0.03] text-slate-500 border border-white/5 hover:text-slate-300 hover:bg-white/8'}`}>
                {l}
              </button>
            ))}
            <span className="text-slate-700 text-[10px] flex-shrink-0 pl-1">{sorted.length}</span>
          </div>

          {/* Table */}
          {loading ? (
            <div className="flex items-center justify-center py-12 gap-3 text-slate-500">
              <RefreshCw className="w-4 h-4 animate-spin"/>
              <span className="text-sm">Loading Confluence Matrix…</span>
            </div>
          ) : sorted.length === 0 ? (
            <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-10 text-center">
              <div className="text-3xl mb-3">🔭</div>
              <p className="text-slate-400 font-semibold text-sm">No confluence signals in this view</p>
              <p className="text-slate-600 text-xs mt-1">Try "All" filter or run the engines</p>
            </div>
          ) : (
            <div className="bg-white/[0.025] border border-white/8 rounded-2xl overflow-hidden backdrop-blur-sm">
              <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: 'min(25vh, 220px)' }}
                   id="confluence-table-mobile">
                <style>{`
                  @media (min-width: 768px) {
                    #confluence-table-mobile { max-height: min(600px, calc(100vh - 400px)) !important; }
                  }
                `}</style>
                <table className="w-full text-xs border-collapse" style={{ minWidth: '1020px' }}>
                  <thead className="sticky top-0 z-20">
                    <tr className="bg-[#0a1018] border-b border-white/8">
                      <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500 bg-[#0a1018] sticky left-0 z-30 whitespace-nowrap w-[90px] max-w-[90px]">
                        Ticker
                      </th>
                      <Th col="badge_priority" label="Signal"       active={sortKey==='badge_priority'} dir={sortDir} onSort={onSort}/>
                      <Th col="total_score"    label="Score" right   active={sortKey==='total_score'}    dir={sortDir} onSort={onSort}/>
                      <th className="px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-amber-500/60 whitespace-nowrap">PEAD</th>
                      <th className="px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-blue-500/60 whitespace-nowrap">S2</th>
                      <th className="px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-violet-500/60 whitespace-nowrap">Insider</th>
                      <th className="px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-yellow-500/60 whitespace-nowrap">Super Inv</th>
                      <Th col="ttm_return"    label="Return" right   active={sortKey==='ttm_return'}     dir={sortDir} onSort={onSort}/>
                      <Th col="earliest_date" label="Since"          active={sortKey==='earliest_date'}  dir={sortDir} onSort={onSort}/>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map(row => {
                      const badge   = row.badge;
                      const total   = (row.pead_score??0)+(row.stage2_score??0)+(row.insider_score??0)+(row.si_value_cr??0 > 0 ? 50 : 0);
                      const insUp   = row.insider_type === 'BUY';
                      const siUp    = row.si_type === 'BUY';
                      return (
                        <tr key={row.ticker} className={`border-b border-white/4 transition-colors ${badge.rowCls}`}>
                          {/* Ticker */}
                          <td className="px-3 py-2.5 sticky left-0 z-10 whitespace-nowrap w-[90px] max-w-[90px]" style={{backgroundColor:badge.stickyBg}}>
                            <a href={`https://www.screener.in/company/${row.ticker}/`} target="_blank" rel="noopener noreferrer"
                              className="font-bold text-white hover:text-emerald-400 transition text-xs">{row.ticker}</a>
                            {row.company_name && <div className="text-slate-600 text-[9px] truncate max-w-[80px] mt-0.5">{row.company_name}</div>}
                          </td>
                          {/* Badge */}
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${badge.cls}`}>
                              {badge.emoji} {badge.label}
                            </span>
                          </td>
                          {/* Score */}
                          <td className="px-3 py-2.5 text-right whitespace-nowrap">
                            <span className="text-sm font-black text-white/90">{total}</span>
                          </td>
                          {/* PEAD */}
                          <td className="px-3 py-2.5 text-center whitespace-nowrap">
                            {row.pead_score!=null ? (
                              <span className={`text-xs font-bold ${row.pead_score>=80?'text-amber-300':row.pead_score>=70?'text-amber-500':'text-slate-500'}`}>{row.pead_score}</span>
                            ) : <span className="text-slate-800">—</span>}
                          </td>
                          {/* S2 */}
                          <td className="px-3 py-2.5 text-center whitespace-nowrap">
                            {row.stage2_score!=null ? (
                              <div>
                                <span className={`text-xs font-bold ${row.stage2_score>=75?'text-blue-300':'text-blue-500'}`}>{row.stage2_score}</span>
                                {row.stage2_days!=null && <div className="text-[9px] text-slate-700">{row.stage2_days}d</div>}
                              </div>
                            ) : <span className="text-slate-800">—</span>}
                          </td>
                          {/* Insider */}
                          <td className="px-3 py-2.5 text-center whitespace-nowrap">
                            {row.insider_score!=null ? (
                              <div className="flex flex-col items-center gap-0.5">
                                <span className={`text-[10px] font-bold flex items-center gap-0.5 ${insUp?'text-emerald-400':'text-red-400'}`}>
                                  {insUp?<TrendingUp className="w-2.5 h-2.5"/>:<TrendingDown className="w-2.5 h-2.5"/>}
                                  {row.insider_type}
                                </span>
                                {row.insider_value_cr!=null && <span className="text-[9px] text-slate-600">{fmtCr(row.insider_value_cr)}</span>}
                              </div>
                            ) : <span className="text-slate-800">—</span>}
                          </td>
                          {/* Super Investor */}
                          <td className="px-3 py-2.5 text-center whitespace-nowrap">
                            {row.si_type!=null ? (
                              <div className="flex flex-col items-center gap-0.5">
                                <span className={`text-[10px] font-bold flex items-center gap-0.5 ${siUp?'text-emerald-300 font-black':'text-red-400'}`}>
                                  {siUp ? '🟢' : '🔴'} {row.si_type}
                                </span>
                                {row.si_client && (
                                  <span className="text-[9px] text-yellow-600/80 max-w-[100px] truncate leading-tight">
                                    {row.si_client.split(' ').slice(0,2).join(' ')}
                                  </span>
                                )}
                                {row.si_value_cr!=null && <span className="text-[9px] text-slate-600">{fmtCr(row.si_value_cr)}</span>}
                              </div>
                            ) : <span className="text-slate-800">—</span>}
                          </td>
                          {/* Return */}
                          <td className={`px-3 py-2.5 text-right whitespace-nowrap text-xs font-bold ${retCls(row.ttm_return)}`}>
                            {fmtRet(row.ttm_return)}
                          </td>
                          {/* Since */}
                          <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap text-[11px]">{fmtDate(row.earliest_date)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-2 border-t border-white/5 flex justify-between text-[10px] text-slate-700">
                <span>{sorted.length} ideas · requires 2+ pipelines · Insider HC only (score ≥ 75)</span>
                <span>45d PEAD/S2/SI · 180d Insider</span>
              </div>
            </div>
          )}
        </div>

        {/* ── Module Cards ── */}
        <div className="pt-1">
          <h2 className="text-xs font-semibold text-slate-600 uppercase tracking-widest mb-3">Intelligence Modules</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
            {([
              {
                href:'/portfolio', icon:BarChart2, title:'Portfolio', live:true,
                desc:'NAV · TWRR · XIRR · Benchmark · Sector allocation',
                gradient:'from-emerald-600/15 to-transparent', border:'border-emerald-500/20 hover:border-emerald-400/40',
                accent:'text-emerald-400', badge:'Live', badgeStyle:'bg-emerald-500/15 text-emerald-400', count:null,
              },
              {
                href:'/pead', icon:Zap, title:'PEAD Engine', live:true,
                desc:'Post-earnings drift · Path A/B · T+1/T+5/T+20 tracking',
                gradient:'from-amber-600/12 to-transparent', border:'border-amber-500/20 hover:border-amber-400/40',
                accent:'text-amber-400', badge:'Live', badgeStyle:'bg-amber-500/15 text-amber-400', count:peadTotal,
              },
              {
                href:'/stage2', icon:Layers, title:'Stage 2 Hub', live:true,
                desc:'Weinstein · Minervini · SOIC structural breakout scanner',
                gradient:'from-blue-600/12 to-transparent', border:'border-blue-500/20 hover:border-blue-400/40',
                accent:'text-blue-400', badge:'Live', badgeStyle:'bg-blue-500/15 text-blue-400', count:s2Total,
              },
              {
                href:'/insider', icon:Eye, title:'Insider Intel', live:true,
                desc:'NSE PIT · Promoter open-market trades · Cluster signals · 6m return tracking',
                gradient:'from-violet-600/12 to-transparent', border:'border-violet-500/20 hover:border-violet-400/40',
                accent:'text-violet-400', badge:'Live', badgeStyle:'bg-violet-500/15 text-violet-400', count:insTotal,
              },
              {
                href:'/super-investor', icon:Crown, title:'Super Investor', live:true,
                desc:'NSE Bulk/Block deals · Parikh family · Kacholia · Rare · Institutional flow',
                gradient:'from-yellow-600/12 to-transparent', border:'border-yellow-500/20 hover:border-yellow-400/40',
                accent:'text-yellow-400', badge:'Live', badgeStyle:'bg-yellow-500/15 text-yellow-400', count:siTotal,
              },
              {
                href:'#', icon:Target, title:'Goals', live:false,
                desc:'Financial goals tracker — retirement, home, corpus planning',
                gradient:'from-cyan-600/8 to-transparent', border:'border-slate-700/30',
                accent:'text-cyan-500', badge:'Soon', badgeStyle:'bg-slate-700/50 text-slate-500', count:null,
              },
              {
                href:'#', icon:Wallet, title:'Tax & P&L', live:false,
                desc:'Capital gains, tax-loss harvesting, realized P&L',
                gradient:'from-rose-600/8 to-transparent', border:'border-slate-700/30',
                accent:'text-rose-500', badge:'Soon', badgeStyle:'bg-slate-700/50 text-slate-500', count:null,
              },
              {
                href:'#', icon:BookOpen, title:'Research', live:false,
                desc:'Thesis tracker, smart money, institutional research notes',
                gradient:'from-indigo-600/8 to-transparent', border:'border-slate-700/30',
                accent:'text-indigo-500', badge:'Soon', badgeStyle:'bg-slate-700/50 text-slate-500', count:null,
              },
            ]).map(card => {
              const Icon = card.icon;
              const isClickable = card.live;
              const inner = (
                <div className={`relative h-full bg-gradient-to-br ${card.gradient} bg-white/[0.025] border ${card.border} rounded-2xl p-4 transition-all duration-200 ${isClickable?'hover:bg-white/[0.04] hover:scale-[1.01] cursor-pointer':'opacity-50 cursor-not-allowed'} backdrop-blur-sm overflow-hidden`}>
                  <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent pointer-events-none rounded-2xl"/>
                  <div className="relative">
                    <div className="flex items-start justify-between mb-3">
                      <Icon className={`w-5 h-5 ${card.accent}`}/>
                      <div className="flex items-center gap-1.5">
                        {card.count != null && card.count > 0 && (
                          <span className={`text-[10px] font-black ${card.accent}`}>{card.count}</span>
                        )}
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${card.badgeStyle}`}>{card.badge}</span>
                      </div>
                    </div>
                    <div className="text-sm font-bold text-white/90 mb-1">{card.title}</div>
                    <div className="text-[11px] text-slate-500 leading-relaxed">{card.desc}</div>
                  </div>
                </div>
              );
              return isClickable
                ? <Link key={card.title} href={card.href} className="block h-full">{inner}</Link>
                : <div key={card.title} className="h-full">{inner}</div>;
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 text-[10px] text-slate-700">
          <span>अर्थ · Quadrant Intelligence Engine · PEAD + Stage 2 + Insider PIT + Super Investor Flow</span>
          <span>Engines run Mon-Fri 4–7 PM IST from VPS</span>
        </div>

      </div>
    </div>
  );
}

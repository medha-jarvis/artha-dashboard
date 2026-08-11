'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import {
  LineChart, Line, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, PieChart, Pie,
  ScatterChart, Scatter, LabelList, Treemap,
} from 'recharts';
import { RefreshCw, BarChart2, Database, Home, EyeOff, Eye, Zap, ChevronDown, ChevronUp, Play } from 'lucide-react';

type SortColumn = 'stock'|'qty'|'pct'|'invested'|
  'value'|'realizedPl'|'pl'|'returns'|'irr'|'duration'|'dayChange'|'dayChangePct'|
  'pe'|'signal';
interface PillarSignal { label: string; color: string; detail: string; }
interface TickerSignal {
  technical: PillarSignal; funda: PillarSignal;
  insider: PillarSignal; events: PillarSignal;
  signal: 'HOLD'|'WATCH'|'REVIEW'|'EXIT'; signalOrder: number;
}
type SortDir  = 'asc'|'desc';
type CompPeriod = 'inception'|'2020';

interface DbHolding {
  symbol:string; qty:number; avgPrice:number; currentPrice:number;
  prevClose:number|null; dayChange:number|null; dayChangePct:number|null;
  invested:number; netInvested:number; currentValue:number;
  gainLoss:number; gainPct:number;
  realizedPnl:number; unrealizedPnl:number;
  irr:number|null; duration:number|null; portfolioPct:number; signal:string|null;
  sector:string; marketCap:string;
  totalPnl:number; totalPnlPct:number; hasExits:boolean;
  // Valuation
  week52High?:number|null; week52Low?:number|null;
  pctFrom52High?:number|null; pctFrom52Low?:number|null;
  trailingPE?:number|null; medianPE5yr?:number|null;
  pb?:number|null; evEbitda?:number|null;
  divYield?:number|null; roe?:number|null; marketCapCr?:number|null;
}
interface ClosedPositions {
  count:number; grossInvested:number; grossSellProceeds:number;
  realizedPnl:number; netInvested:number;
}
interface BenchPair { sensex:number|null; nifty500:number|null; midcap?:number|null; smallcap?:number|null; }
interface DbSummary {
  totalInvested:number; totalValue:number; totalGain:number; gainPct:number;
  totalNetInvested:number; totalRealizedPnl:number; totalUnrealizedPnl:number;
  totalPnlAll:number; totalPnlPctAll:number;
  closedPositions?:ClosedPositions;
  xirr:number|null; twrrAnnualised:number; twrrAnnualised2020:number|null;
  twrrPeriods:{'1yr':number|null;'2yr':number|null;'3yr':number|null;'5yr':number|null;inception:number;since2020:number|null;ytd?:number|null};
  benchmarkPeriods:{'1yr':BenchPair;'2yr':BenchPair;'3yr':BenchPair;'5yr':BenchPair;since2020:BenchPair;inception:BenchPair;ytd?:BenchPair};
  holdingsCount:number; latestNAV:number|null;
  totalDayChange:number|null; totalDayChangePct:number|null;
}
interface NavPoint { month:string; portfolioValue:number; nav:number|null; monthlyReturn:number|null; sensex:number|null; nifty500:number|null; midcap?:number|null; smallcap?:number|null; }
interface AnnualReturn { year:string|number; portfolioReturn:number; sensexReturn:number|null; nifty500Return:number|null; midcapReturn?:number|null; smallcapReturn?:number|null; alpha:number|null; }
interface IndexComparison { name:string; twrr:number; twrr2020:number|null; terminalValueL:number|null; }
interface SectorAgg { sector:string; value:number; invested:number; gainLoss:number; gainPct:number; portfolioPct:number; holdingCount:number; holdings:string[]; avgIrr:number|null; }
interface McapAgg  { category:string; value:number; invested:number; gainLoss:number; gainPct:number; portfolioPct:number; count:number; }

// ── Formatters ──
const fmtAbs = (n:number) =>
  Math.abs(n)>=1e7 ? `₹${(n/1e7).toFixed(2)}Cr`
  : Math.abs(n)>=1e5 ? `₹${(n/1e5).toFixed(2)}L`
  : `₹${n.toFixed(0)}`;
const pct = (n:number|null) => n!=null ? `${n>=0?'+':''}${n.toFixed(2)}%` : '—';
const irrColor = (v:number|null) => v==null?'text-slate-500':v>=25?'text-emerald-300 font-bold':v>=15?'text-emerald-400':v>=0?'text-yellow-400':'text-red-400';
const irrBg    = (v:number|null) => v==null?'':v>=25?'bg-emerald-500/20':v>=15?'bg-emerald-500/10':v>=0?'bg-yellow-500/10':'bg-red-500/10';
const fmtPE    = (v:number|null|undefined) => v!=null && v > 0 && v < 500 ? v.toFixed(1) : '—';
const fmtPB    = (v:number|null|undefined) => v!=null && v > 0 ? v.toFixed(2) : '—';
const fmtNum   = (v:number|null|undefined, dec=1) => v!=null ? v.toFixed(dec) : '—';

const SIGNAL_CFG:Record<string,{bg:string;text:string}> = {
  BUY:       {bg:'bg-emerald-500/25',text:'text-emerald-300'},
  ACCUMULATE:{bg:'bg-teal-500/25',   text:'text-teal-300'},
  HOLD:      {bg:'bg-blue-500/20',   text:'text-blue-400'},
  WATCH:     {bg:'bg-yellow-500/20', text:'text-yellow-400'},
  TRIM:      {bg:'bg-orange-500/20', text:'text-orange-400'},
  REDUCE:    {bg:'bg-orange-500/20', text:'text-orange-400'},
  SELL:      {bg:'bg-red-500/20',    text:'text-red-400'},
  AVOID:     {bg:'bg-red-500/20',    text:'text-red-400'},
};
const SIGNAL_ORDER:Record<string,number> = {BUY:0,ACCUMULATE:1,HOLD:2,WATCH:3,TRIM:4,REDUCE:5,SELL:6,AVOID:7};

const SignalBadge = ({signal}:{signal:string|null}) => {
  if (!signal) return <span className="text-slate-600 text-xs">—</span>;
  const cfg = SIGNAL_CFG[signal]||SIGNAL_CFG.HOLD;
  return <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${cfg.bg} ${cfg.text}`}>{signal.slice(0,5)}</span>;
};

const COMPUTED_SIG_CFG: Record<string,{bg:string;text:string}> = {
  HOLD:   {bg:'bg-blue-500/20',   text:'text-blue-400'},
  WATCH:  {bg:'bg-yellow-500/20', text:'text-yellow-400'},
  REVIEW: {bg:'bg-orange-500/20', text:'text-orange-400'},
  EXIT:   {bg:'bg-red-500/20',    text:'text-red-400'},
};

function PillarCell({ p }: { p: PillarSignal | undefined }) {
  if (!p) return <td className="text-center px-2 py-2 whitespace-nowrap"><span className="text-slate-700 text-xs">—</span></td>;
  return (
    <td className="text-center px-2 py-2 whitespace-nowrap" title={p.detail}>
      <span className={`text-xs font-semibold cursor-default ${p.color}`}>{p.label}</span>
    </td>
  );
}

function ComputedSignalCell({ sig }: { sig: TickerSignal | undefined }) {
  if (!sig) return <td className="text-center px-2 py-2 whitespace-nowrap"><span className="text-slate-600 text-xs">—</span></td>;
  const cfg = COMPUTED_SIG_CFG[sig.signal] ?? COMPUTED_SIG_CFG.HOLD;
  const detail = `Funda: ${sig.funda.label} · Tech: ${sig.technical.label} · Insider: ${sig.insider.label}`;
  return (
    <td className="text-center px-2 py-2 whitespace-nowrap" title={detail}>
      <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${cfg.bg} ${cfg.text}`}>{sig.signal}</span>
    </td>
  );
}

const SECTOR_COLORS = ['#10b981','#3b82f6','#8b5cf6','#f59e0b','#ef4444','#ec4899','#14b8a6','#f97316','#06b6d4','#84cc16','#a855f7','#64748b','#22d3ee','#fb923c'];
const MCAP_COLORS   = {  'Large Cap':'#3b82f6', 'Mid Cap':'#10b981', 'Small Cap':'#f59e0b' };

// ─────────────────────────────────────────────────────────
// Custom Interactive Treemap
// ─────────────────────────────────────────────────────────

interface TmNode { symbol:string; currentValue:number; gainPct:number; irr:number|null; duration:number|null; portfolioPct:number; sector:string; signal:string|null; }
interface TmRect { x:number; y:number; w:number; h:number; node:TmNode; }

function buildLayout(nodes:TmNode[], x:number, y:number, w:number, h:number, horiz:boolean): TmRect[] {
  if (!nodes.length) return [];
  if (nodes.length === 1) return [{x,y,w,h,node:nodes[0]}];
  const tot = nodes.reduce((s,n)=>s+n.currentValue,0);
  let cum=0, split=0;
  for (let i=0;i<nodes.length;i++) {
    if (cum+nodes[i].currentValue > tot/2 && i>0) break;
    cum+=nodes[i].currentValue; split=i+1;
  }
  const left=nodes.slice(0,split), right=nodes.slice(split), r=cum/tot;
  if (horiz) {
    return [...buildLayout(left,x,y,w*r,h,!horiz), ...buildLayout(right,x+w*r,y,w*(1-r),h,!horiz)];
  }
  return [...buildLayout(left,x,y,w,h*r,!horiz), ...buildLayout(right,x,y+h*r,w,h*(1-r),!horiz)];
}

const GAIN_FILL = (g:number) =>
  g>=100?'#065f46':g>=50?'#059669':g>=25?'#10b981':g>=10?'#34d399':g>=0?'#86efac':g>=-10?'#fb923c':'#ef4444';

const GAIN_TEXT = (g:number) =>
  (g>=0&&g<12)||(g<0&&g>-8) ? '#1e293b' : '#ffffff';

function PortfolioTreemap({ data, nfmt }:{ data:TmNode[]; nfmt:(n:number)=>string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({w:800,h:290});
  const [hov, setHov] = useState<string|null>(null);
  const [tip, setTip] = useState<{px:number; py:number; node:TmNode}|null>(null);

  useEffect(()=>{
    const ro = new ResizeObserver(es=>{
      const w = es[0].contentRect.width;
      setSize({w, h: Math.max(220, Math.round(w*0.34))});
    });
    if (wrapRef.current) ro.observe(wrapRef.current);
    return ()=>ro.disconnect();
  },[]);

  const sorted = [...data].sort((a,b)=>b.currentValue-a.currentValue);
  const rects  = buildLayout(sorted, 2, 2, size.w-4, size.h-4, true);

  const handleEnter = useCallback((e:React.MouseEvent<SVGGElement>, node:TmNode, r:TmRect)=>{
    setHov(node.symbol);
    const px = r.x + r.w/2;
    const py = r.y + r.h/2;
    setTip({px, py, node});
  },[]);

  return (
    <div ref={wrapRef} style={{width:'100%',position:'relative',fontFamily:'Nunito, Inter, system-ui, sans-serif'}}>
      <svg width={size.w} height={size.h} style={{display:'block',borderRadius:8}}
        onMouseLeave={()=>{setHov(null);setTip(null);}}>
        {rects.map(r=>{
          const {node:n} = r;
          const isHov = hov===n.symbol;
          const fill  = GAIN_FILL(n.gainPct);
          const textC = GAIN_TEXT(n.gainPct);
          const rw=r.w-2, rh=r.h-2;
          const cx=r.x+r.w/2, cy=r.y+r.h/2;
          const fs  = Math.min(13, Math.max(7.5, rw/5.5));
          const fs2 = Math.max(6.5, fs*0.78);
          const fs3 = Math.max(6, fs*0.65);
          const showTicker = rw>32 && rh>20;
          const showGain   = rw>28 && rh>35;
          const showIrr    = rw>48 && rh>50 && n.irr!=null;
          const lines = (showTicker?1:0)+(showGain?1:0)+(showIrr?1:0);
          const totalH = lines===3?fs+fs2+fs3+4:lines===2?fs+fs2+2:fs;
          const topY   = cy - totalH/2 + fs/2;

          return (
            <g key={n.symbol} style={{cursor:'pointer'}}
              onMouseEnter={e=>handleEnter(e,n,r)}
              onMouseLeave={()=>{setHov(null);setTip(null);}}>
              <rect
                x={r.x+1} y={r.y+1} width={Math.max(0,rw)} height={Math.max(0,rh)}
                fill={fill} rx={4}
                stroke={isHov?'rgba(255,255,255,0.75)':'#0f172a'}
                strokeWidth={isHov?2:0.75}
                opacity={isHov?1:hov?0.72:0.92}
                style={{transition:'opacity 0.18s, stroke 0.18s, stroke-width 0.18s'}}
              />
              {isHov && <rect x={r.x+2} y={r.y+2} width={Math.max(0,rw-2)} height={Math.max(0,rh-2)} fill="none" rx={3} stroke="rgba(255,255,255,0.18)" strokeWidth={1}/>}
              {showTicker && <text x={cx} y={topY} textAnchor="middle" dominantBaseline="middle"
                fill={textC} fontSize={fs} fontWeight="800" fontFamily="Nunito, Inter, sans-serif" letterSpacing="-0.3"
                style={{pointerEvents:'none',userSelect:'none'}}>{n.symbol}</text>}
              {showGain && <text x={cx} y={topY+(showTicker?fs+2:0)} textAnchor="middle" dominantBaseline="middle"
                fill={showTicker?`${textC}cc`:textC} fontSize={fs2} fontWeight="700" fontFamily="Nunito, Inter, sans-serif"
                style={{pointerEvents:'none',userSelect:'none'}}>{n.gainPct>=0?'+':''}{n.gainPct.toFixed(1)}%</text>}
              {showIrr && <text x={cx} y={topY+(showTicker?fs+2:0)+(showGain?fs2+2:0)} textAnchor="middle" dominantBaseline="middle"
                fill={`${textC}88`} fontSize={fs3} fontWeight="600" fontFamily="Nunito, Inter, sans-serif"
                style={{pointerEvents:'none',userSelect:'none'}}>IRR {(n.irr??0)>=0?'+':''}{(n.irr??0).toFixed(0)}%</text>}
            </g>
          );
        })}
      </svg>
      {tip && (
        <div style={{position:'absolute',left:Math.min(tip.px+12,size.w-210),top:Math.max(4,tip.py-80),
          zIndex:50,pointerEvents:'none',fontFamily:'Nunito, Inter, sans-serif'}}
          className="bg-slate-900/95 backdrop-blur-sm border border-slate-600/60 rounded-xl p-3 w-52 shadow-2xl">
          <div className="flex items-center justify-between mb-2">
            <span className="font-extrabold text-white text-sm tracking-tight">{tip.node.symbol}</span>
            {tip.node.signal && (
              <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${SIGNAL_CFG[tip.node.signal]?.bg??'bg-blue-500/20'} ${SIGNAL_CFG[tip.node.signal]?.text??'text-blue-400'}`}>
                {tip.node.signal}
              </span>
            )}
          </div>
          <div className="text-xs text-slate-400 mb-2 truncate">{tip.node.sector}</div>
          <div className="space-y-1 text-xs">
            {[
              {l:'Value',   v: nfmt(tip.node.currentValue), c:'text-white font-semibold'},
              {l:'Weight',  v: `${tip.node.portfolioPct.toFixed(1)}%`, c:'text-white'},
              {l:'Gain',    v: `${tip.node.gainPct>=0?'+':''}${tip.node.gainPct.toFixed(1)}%`, c:tip.node.gainPct>=0?'text-emerald-400 font-semibold':'text-red-400 font-semibold'},
              tip.node.irr!=null?{l:'IRR',v:`${tip.node.irr>=0?'+':''}${tip.node.irr.toFixed(1)}%`,c:tip.node.irr>=15?'text-emerald-400':tip.node.irr>=0?'text-yellow-400':'text-red-400'}:null,
              tip.node.duration!=null?{l:'Duration',v:`${tip.node.duration.toFixed(1)}y`,c:'text-slate-300'}:null,
            ].filter(Boolean).map((row:any)=>(
              <div key={row.l} className="flex justify-between items-center">
                <span className="text-slate-400">{row.l}</span>
                <span className={row.c}>{row.v}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function PortfolioPage() {
  const [holdings,        setHoldings]        = useState<DbHolding[]>([]);
  const [summary,         setSummary]         = useState<DbSummary|null>(null);
  const [navSeries,       setNavSeries]       = useState<NavPoint[]>([]);
  const [annualReturns,   setAnnualReturns]   = useState<AnnualReturn[]>([]);
  const [indexComparison, setIndexComparison] = useState<IndexComparison[]>([]);
  const [sectorAgg,       setSectorAgg]       = useState<SectorAgg[]>([]);
  const [mcapAgg,         setMcapAgg]         = useState<McapAgg[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState<string|null>(null);
  const [lastUpdated,setLastUpdated]= useState('');
  const [sortCol,  setSortCol]  = useState<SortColumn>('value');
  const [sortDir,  setSortDir]  = useState<SortDir>('desc');
  const [navView,  setNavView]  = useState<'nav'|'value'|'monthly'>('nav');
  const [navRange, setNavRange] = useState<'all'|'5yr'|'3yr'|'1yr'>('all');
  const [compPeriod, setCompPeriod] = useState<CompPeriod>('inception');
  const [normalized, setNormalized] = useState(false);
  const [signals, setSignals] = useState<Record<string, TickerSignal & { signalOrder: number }>>({});
  const [enginesOpen,   setEnginesOpen]   = useState(false);
  const [engineStatus,  setEngineStatus]  = useState<Record<string,string>>({});  // idle|running|done|error
  const [fundaRunning,  setFundaRunning]  = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true); setError(null);
      const res  = await fetch('/api/proxy/db/portfolio');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setHoldings(data.holdings||[]);
      setSummary(data.summary||null);
      setNavSeries(data.navSeries||[]);
      setAnnualReturns(data.annualReturns||[]);
      setIndexComparison(data.indexComparison||[]);
      setSectorAgg(data.sectorAggregates||[]);
      setMcapAgg(data.mcapAggregates||[]);
      setLastUpdated(data.lastUpdated||'');
    } catch (err:any) { setError(err.message); }
    finally { setLoading(false); }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try { await fetch('/api/proxy/db/portfolio/refresh',{method:'POST'}); await fetchData(); }
    catch { setError('Refresh failed'); }
    finally { setRefreshing(false); }
  };

  useEffect(() => { fetchData(); },[]);
  useEffect(() => {
    fetch('/api/portfolio/signals', { cache: 'no-store' })
      .then(r => r.json()).then(d => { if (d && typeof d === 'object') setSignals(d); }).catch(() => {});
  }, []);

  // Poll fundamentals status while running
  useEffect(() => {
    if (!fundaRunning) return;
    const iv = setInterval(() => {
      fetch('/api/sell-signal-trigger').then(r => r.json()).then(d => {
        if (!d.running) {
          setFundaRunning(false);
          setEngineStatus(s => ({ ...s, fundamentals: 'done' }));
          fetch('/api/portfolio/signals', { cache: 'no-store' })
            .then(r => r.json()).then(d => { if (d && typeof d === 'object') setSignals(d); }).catch(() => {});
          clearInterval(iv);
        }
      }).catch(() => {});
    }, 5000);
    return () => clearInterval(iv);
  }, [fundaRunning]);

  async function triggerEngine(name: string, url: string, body: object = {}) {
    setEngineStatus(s => ({ ...s, [name]: 'running' }));
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'failed');
      if (name === 'fundamentals') {
        setFundaRunning(true);
      } else {
        setEngineStatus(s => ({ ...s, [name]: 'done' }));
        setTimeout(() => setEngineStatus(s => ({ ...s, [name]: 'idle' })), 4000);
      }
    } catch (e) {
      setEngineStatus(s => ({ ...s, [name]: 'error' }));
      setTimeout(() => setEngineStatus(s => ({ ...s, [name]: 'idle' })), 5000);
    }
  }

  async function triggerAll() {
    setEngineStatus({ stage2: 'running', pead: 'running', insider: 'running', fundamentals: 'running' });
    try {
      const r = await fetch('/api/refresh-all-signals', { method: 'POST' });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      setFundaRunning(true);
      setTimeout(() => setEngineStatus(s => ({ ...s, stage2: 'done', pead: 'done', insider: 'done' })), 3000);
      setTimeout(() => setEngineStatus(s => ({ ...s, stage2: 'idle', pead: 'idle', insider: 'idle' })), 7000);
    } catch {
      setEngineStatus({ stage2: 'error', pead: 'error', insider: 'error', fundamentals: 'error' });
      setTimeout(() => setEngineStatus({}), 5000);
    }
  }

  const normFactor = normalized && summary ? 1e7/summary.totalValue : 1;
  const nfmt = (n:number) => fmtAbs(n*normFactor);

  const handleSort = (col:SortColumn) => {
    if (sortCol===col) setSortDir(d=>d==='asc'?'desc':'asc');
    else { setSortCol(col); setSortDir('desc'); }
  };

  const sorted = [...holdings].sort((a,b) => {
    const d = sortDir==='asc'?1:-1;
    switch(sortCol){
      case 'stock':        return d*a.symbol.localeCompare(b.symbol);
      case 'qty':          return d*(a.qty-b.qty);
      case 'pct':          return d*(a.portfolioPct-b.portfolioPct);
      case 'invested':     return d*(a.invested-b.invested);
      case 'value':        return d*(a.currentValue-b.currentValue);
      case 'realizedPl':   return d*((a.realizedPnl??0)-(b.realizedPnl??0));
      case 'pl':           return d*(a.totalPnl-b.totalPnl);
      case 'returns':      return d*(a.totalPnlPct-b.totalPnlPct);
      case 'irr':          return d*((a.irr??-999)-(b.irr??-999));
      case 'duration':     return d*((a.duration??-999)-(b.duration??-999));
      case 'dayChange':    return d*((a.dayChange??-Infinity)-(b.dayChange??-Infinity));
      case 'dayChangePct': return d*((a.dayChangePct??-Infinity)-(b.dayChangePct??-Infinity));
      case 'pe':           return d*((a.trailingPE??Infinity)-(b.trailingPE??Infinity));
      case 'signal':       return d*((signals[a.symbol]?.signalOrder??99)-(signals[b.symbol]?.signalOrder??99));
      default: return 0;
    }
  });

  const filteredNav = navRange==='all' ? navSeries
    : navSeries.slice(-(navRange==='1yr'?12:navRange==='3yr'?36:60));

  // NAV chart data — normalize all indices to portfolio NAV at their respective first available month
  const navChartData = (() => {
    const firstNav = filteredNav.find(x=>x.nav);
    const navBase  = firstNav?.nav||1;

    const firstSx  = filteredNav.find(x=>x.sensex&&x.nav);
    const sBase    = firstSx?.sensex||1;  const sNavBase  = firstSx?.nav||navBase;

    const firstN5  = filteredNav.find(x=>x.nifty500&&x.nav);
    const n5Base   = firstN5?.nifty500||1; const n5NavBase = firstN5?.nav||navBase;

    const firstMid = filteredNav.find(x=>x.midcap&&x.nav);
    const midBase  = firstMid?.midcap||1;  const midNavBase= firstMid?.nav||navBase;

    const firstSc  = filteredNav.find(x=>x.smallcap&&x.nav);
    const scBase   = firstSc?.smallcap||1; const scNavBase = firstSc?.nav||navBase;

    return filteredNav.map(d=>({
      month: d.month.slice(0,7), nav: d.nav,
      sensexNorm:   d.sensex   ? Math.round((d.sensex/sBase)*sNavBase)     : null,
      nifty500Norm: d.nifty500 ? Math.round((d.nifty500/n5Base)*n5NavBase) : null,
      midcapNorm:   d.midcap   ? Math.round((d.midcap/midBase)*midNavBase) : null,
      smallcapNorm: d.smallcap ? Math.round((d.smallcap/scBase)*scNavBase) : null,
      portfolioValue: d.portfolioValue, monthlyReturn: d.monthlyReturn,
    }));
  })();

  const portfolioTwrr = compPeriod==='2020'
    ? (summary?.twrrAnnualised2020??summary?.twrrAnnualised??0)
    : (summary?.twrrAnnualised??0);

  const xInt = navRange==='1yr'?1:navRange==='3yr'?5:11;

  const Th = ({col,label,left}:{col:SortColumn;label:string;left?:boolean}) => (
    <th className={`${left?'text-left':'text-right'} px-2 py-2 text-xs font-medium text-slate-400 cursor-pointer hover:text-white whitespace-nowrap select-none bg-slate-900`}
      onClick={()=>handleSort(col)}>
      {label}{sortCol===col?(sortDir==='asc'?' ▲':' ▼'):''}
    </th>
  );

  if (loading) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="text-white text-xl flex items-center gap-3">
        <Database className="animate-pulse w-6 h-6 text-emerald-400"/>Loading portfolio…
      </div>
    </div>
  );
  if (error) return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><div className="text-red-400">{error}</div></div>;

  return (
    <div className="min-h-screen bg-slate-950 p-3 md:p-5">
      <div className="max-w-[1920px] mx-auto space-y-4">

        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-white flex items-center gap-2">
              Portfolio Command Centre
              {normalized && <span className="text-xs bg-purple-600/30 text-purple-300 border border-purple-500/40 px-2 py-0.5 rounded-full font-normal">Normalised ₹1Cr</span>}
            </h1>
            <p className="text-slate-500 text-xs mt-0.5"><Database className="inline w-3 h-3 mr-1"/>Source: portfolio.db · Updated: {lastUpdated}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/" className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded text-xs font-medium flex items-center gap-1.5">
              <Home className="w-3.5 h-3.5"/>Artha Home
            </Link>
            <button onClick={()=>setNormalized(n=>!n)}
              className={`px-3 py-1.5 rounded text-xs font-medium flex items-center gap-1.5 transition-colors ${normalized?'bg-purple-600 hover:bg-purple-700 text-white':'bg-slate-700 hover:bg-slate-600 text-slate-300'}`}>
              {normalized?<EyeOff className="w-3.5 h-3.5"/>:<Eye className="w-3.5 h-3.5"/>}
              {normalized?'Show Actual':'Normalise'}
            </button>
            <button onClick={handleRefresh} disabled={refreshing}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded text-xs font-medium flex items-center gap-1.5">
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing?'animate-spin':''}`}/>
              {refreshing?'Refreshing…':'Refresh'}
            </button>
            <Link href="/portfolio/sectors"   className="px-3 py-1.5 bg-blue-600   hover:bg-blue-700   text-white rounded text-xs font-medium">Sectors</Link>
            <Link href="/portfolio/analytics" className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs font-medium">Analytics</Link>
            <button disabled className="px-3 py-1.5 bg-gradient-to-r from-blue-600/50 to-purple-600/50 text-white/50 rounded text-xs font-semibold cursor-not-allowed">📊 Thesis Tracker</button>
          </div>
        </div>

        {/* ── KPI Cards ── */}
        {summary && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label:'Portfolio Value',  val: nfmt(summary.totalValue),  sub: `Net Invested: ${nfmt(summary.totalNetInvested??summary.totalInvested)}`, color:'text-emerald-400' },
              { label:"Today's P&L",
                val: summary.totalDayChange!=null?`${summary.totalDayChange>=0?'+':''}${nfmt(summary.totalDayChange)}`:'—',
                sub: pct(summary.totalDayChangePct),
                color: (summary.totalDayChange??0)>=0?'text-emerald-400':'text-red-400' },
              { label:'Overall Gain',
                val: `${(summary.totalPnlAll??summary.totalGain)>=0?'+':''}${nfmt(summary.totalPnlAll??summary.totalGain)}`,
                sub: pct(summary.totalPnlPctAll??summary.gainPct),
                color: (summary.totalPnlAll??summary.totalGain)>=0?'text-emerald-400':'text-red-400' },
              { label:'XIRR (Money-Weighted)',
                val: pct(summary.xirr),
                sub: `TWRR (inception): ${pct(summary.twrrPeriods.inception)}`,
                color:(summary.xirr??0)>=0?'text-emerald-400':'text-red-400' },
            ].map(c=>(
              <div key={c.label} className="bg-slate-900 border border-slate-800 rounded-xl p-3">
                <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">{c.label}</div>
                <div className={`text-xl font-bold ${c.color}`}>{c.val}</div>
                <div className={`text-xs mt-0.5 ${c.color} opacity-75`}>{c.sub}</div>
              </div>
            ))}
          </div>
        )}

        {/* ── TWRR — 7 cards with 4-benchmark comparison ── */}
        {summary && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <BarChart2 className="w-4 h-4 text-blue-400"/>
              <h2 className="text-base font-bold text-white">Time-Weighted Return (TWRR) — True Portfolio Skill</h2>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
              {([
                {label:'YTD 2026',         key:'ytd',       bench: summary.benchmarkPeriods.ytd,      noAnn:true},
                {label:'1 Year',           key:'1yr',       bench: summary.benchmarkPeriods['1yr']},
                {label:'2 Yrs (ann.)',     key:'2yr',       bench: summary.benchmarkPeriods['2yr']},
                {label:'3 Yrs (ann.)',     key:'3yr',       bench: summary.benchmarkPeriods['3yr']},
                {label:'5 Yrs (ann.)',     key:'5yr',       bench: summary.benchmarkPeriods['5yr']},
                {label:'Since 2020 (ann.)',key:'since2020', bench: summary.benchmarkPeriods.since2020},
                {label:'Since 2015 (ann.)',key:'inception', bench: summary.benchmarkPeriods.inception},
              ] as {label:string;key:keyof typeof summary.twrrPeriods;bench?:BenchPair;noAnn?:boolean}[]).map(({label,key,bench,noAnn})=>{
                const val = summary.twrrPeriods[key];
                const vs  = bench?.sensex   ?? null;
                const vn  = bench?.nifty500 ?? null;
                const vm  = bench?.midcap   ?? null;
                const vsc = bench?.smallcap ?? null;
                const alphaSx  = val!=null&&vs!=null  ? val-vs  : null;
                const alphaN5  = val!=null&&vn!=null  ? val-vn  : null;
                const alphaMid = val!=null&&vm!=null  ? val-vm  : null;
                const alphaSc  = val!=null&&vsc!=null ? val-vsc : null;
                const colorVal = val!=null&&val>=0?'text-emerald-400':'text-red-400';
                return (
                  <div key={key} className="bg-slate-800 rounded-lg p-2.5">
                    <div className="text-[10px] text-slate-400 mb-1 leading-tight">{label}</div>
                    <div className={`text-base font-bold ${colorVal}`}>
                      {val!=null?`${val>=0?'+':''}${val.toFixed(2)}%`:'—'}
                    </div>
                    {noAnn && <div className="text-[9px] text-slate-600 mb-1">not annualised</div>}
                    <div className="mt-1 space-y-0.5 text-[10px]">
                      {[
                        {l:'Sen', v:vs,  a:alphaSx,  c:'text-blue-400'},
                        {l:'N500',v:vn,  a:alphaN5,  c:'text-violet-400'},
                        {l:'Mid', v:vm,  a:alphaMid, c:'text-amber-400'},
                        {l:'Sml', v:vsc, a:alphaSc,  c:'text-rose-400'},
                      ].map(({l,v,a,c})=>(
                        <div key={l} className="flex justify-between items-center gap-1">
                          <span className={`${c} font-medium w-7 flex-shrink-0`}>{l}</span>
                          {v!=null ? (
                            <span className={a!=null&&a>=0?'text-emerald-400':'text-red-400'}>
                              {v>=0?'+':''}{v.toFixed(1)}%
                              {a!=null && <span className="text-slate-500 ml-0.5">({a>=0?'+':''}{a.toFixed(1)})</span>}
                            </span>
                          ) : <span className="text-slate-600">—</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-slate-600 mt-2">Alpha in brackets vs each benchmark. Negative = underperformance. Smallcap 250 data from Oct 2022 (fund proxy).</p>
          </div>
        )}

        {/* ── Portfolio vs Indices toggle ── */}
        {indexComparison.length>0 && summary && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
              <h2 className="text-base font-bold text-white">Portfolio vs Indices — Annualised TWRR</h2>
              <div className="flex gap-1 bg-slate-800 rounded-lg p-1">
                {(['inception','2020'] as CompPeriod[]).map(p=>(
                  <button key={p} onClick={()=>setCompPeriod(p)}
                    className={`px-3 py-1 text-xs rounded font-medium ${compPeriod===p?'bg-blue-600 text-white':'text-slate-400 hover:text-white'}`}>
                    {p==='inception'?'Since 2015':'Since 2020'}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {[
                {name:'Your Portfolio', twrr:portfolioTwrr, terminalValueL:summary.totalValue/1e5, highlight:true},
                ...indexComparison
                  .map(i=>({
                    name:i.name,
                    twrr: compPeriod==='2020' ? i.twrr2020 : i.twrr,
                    terminalValueL:i.terminalValueL, highlight:false,
                  }))
                  .filter(i => i.twrr != null)
              ].map(item=>{
                const maxT   = Math.max(portfolioTwrr,...indexComparison.map(i=>compPeriod==='2020'?i.twrr2020??0:i.twrr??0).filter(Boolean));
                const barPct = Math.max(4,Math.round(((item.twrr??0)/maxT)*100));
                const alpha  = item.highlight?null:portfolioTwrr-(item.twrr??0);
                return (
                  <div key={item.name} className={`rounded-xl p-3 border ${item.highlight?'border-emerald-500/50 bg-emerald-500/10':'border-slate-700 bg-slate-800/50'}`}>
                    <div className="text-xs font-semibold text-slate-400 mb-0.5 truncate">{item.name}</div>
                    {item.name==='Midcap 150'&&compPeriod==='inception'&&<div className="text-[9px] text-amber-600/70 mb-0.5">NSE back-calc from 2015</div>}
                    <div className={`text-xl font-bold mb-0.5 ${item.highlight?'text-emerald-400':'text-blue-400'}`}>
                      {(item.twrr??0)>=0?'+':''}{(item.twrr??0).toFixed(2)}%
                    </div>
                    <div className="text-xs text-slate-500 mb-2">Annualised</div>
                    <div className="h-1.5 bg-slate-700 rounded-full mb-2">
                      <div className={`h-1.5 rounded-full ${item.highlight?'bg-emerald-400':'bg-blue-500'}`} style={{width:`${barPct}%`}}/>
                    </div>
                    {!item.highlight&&alpha!=null&&(
                      <div className={`text-xs font-semibold ${alpha>=0?'text-emerald-400':'text-red-400'}`}>
                        {alpha>=0?'+':''}{alpha.toFixed(2)}% vs portfolio
                      </div>
                    )}

                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── NAV Chart — 5 lines ── */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-3 gap-2">
            <h2 className="text-base font-bold text-white">Portfolio NAV vs Sensex, Nifty 500, Midcap 150 &amp; Smallcap 250</h2>
            <div className="flex gap-1.5 flex-wrap">
              {(['all','5yr','3yr','1yr'] as const).map(r=>(
                <button key={r} onClick={()=>setNavRange(r)}
                  className={`px-2.5 py-1 text-xs rounded font-medium ${navRange===r?'bg-blue-600 text-white':'bg-slate-800 text-slate-400 hover:text-white'}`}>
                  {r==='all'?'All':r.toUpperCase()}
                </button>
              ))}
              <div className="w-px bg-slate-700"/>
              {(['nav','value','monthly'] as const).map(v=>(
                <button key={v} onClick={()=>setNavView(v)}
                  className={`px-2.5 py-1 text-xs rounded font-medium ${navView===v?'bg-purple-600 text-white':'bg-slate-800 text-slate-400 hover:text-white'}`}>
                  {v==='nav'?'NAV':v==='value'?'Value (₹L)':'Monthly%'}
                </button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={290}>
            {navView==='nav'?(
              <LineChart data={navChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b"/>
                <XAxis dataKey="month" stroke="#475569" tick={{fontSize:9}} interval={xInt}/>
                <YAxis stroke="#475569" tick={{fontSize:9}}/>
                <Tooltip contentStyle={{backgroundColor:'#0f172a',border:'1px solid #334155',borderRadius:8,fontSize:11}}
                  formatter={(v:any,name:any)=>[typeof v==='number'?v.toFixed(0):v,
                    name==='nav'?'Portfolio NAV':name==='sensexNorm'?'Sensex':name==='nifty500Norm'?'Nifty 500':name==='midcapNorm'?'Midcap 150':'Smallcap 250']}/>
                <Legend wrapperStyle={{fontSize:11}} formatter={v=>
                  v==='nav'?'Portfolio NAV':v==='sensexNorm'?'Sensex':v==='nifty500Norm'?'Nifty 500':v==='midcapNorm'?'Midcap 150':'Smallcap 250'}/>
                <Line type="monotone" dataKey="nav"           stroke="#10b981" strokeWidth={2.5} dot={false} name="nav"/>
                <Line type="monotone" dataKey="sensexNorm"    stroke="#3b82f6" strokeWidth={1.5} dot={false} strokeDasharray="5 3"   name="sensexNorm"/>
                <Line type="monotone" dataKey="nifty500Norm"  stroke="#8b5cf6" strokeWidth={1.5} dot={false} strokeDasharray="3 3"   name="nifty500Norm"/>
                <Line type="monotone" dataKey="midcapNorm"    stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="4 2"   name="midcapNorm"/>
                {(navRange==='1yr'||navRange==='3yr') && <Line type="monotone" dataKey="smallcapNorm" stroke="#ef4444" strokeWidth={1.5} dot={false} strokeDasharray="2 2" name="smallcapNorm"/>}
              </LineChart>
            ):navView==='value'?(
              <LineChart data={navChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b"/>
                <XAxis dataKey="month" stroke="#475569" tick={{fontSize:9}} interval={xInt}/>
                <YAxis stroke="#475569" tick={{fontSize:9}} tickFormatter={v=>`${v}L`}/>
                <Tooltip contentStyle={{backgroundColor:'#0f172a',border:'1px solid #334155',borderRadius:8,fontSize:11}}
                  formatter={(v:any)=>[`₹${v}L`,'Portfolio Value']}/>
                <Line type="monotone" dataKey="portfolioValue" stroke="#10b981" strokeWidth={2.5} dot={false}/>
              </LineChart>
            ):(
              <BarChart data={navChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b"/>
                <XAxis dataKey="month" stroke="#475569" tick={{fontSize:9}} interval={2}/>
                <YAxis stroke="#475569" tick={{fontSize:9}} tickFormatter={v=>`${v}%`}/>
                <Tooltip contentStyle={{backgroundColor:'#0f172a',border:'1px solid #334155',borderRadius:8,fontSize:11}}
                  formatter={(v:any)=>[`${v?.toFixed(2)}%`,'Monthly Return']}/>
                <ReferenceLine y={0} stroke="#475569"/>
                <Bar dataKey="monthlyReturn" radius={[2,2,0,0]}>
                  {navChartData.map((_,i)=>(
                    <Cell key={i} fill={navChartData[i].monthlyReturn!=null&&navChartData[i].monthlyReturn!>=0?'#10b981':'#ef4444'}/>
                  ))}
                </Bar>
              </BarChart>
            )}
          </ResponsiveContainer>
          {navView==='nav' && (
            <div className="mt-2 space-y-0.5">
              <p className="text-[10px] text-slate-500">
                Indices rebased to portfolio NAV at their respective data-start month. Smallcap 250 shown in 1yr/3yr only.
              </p>
              {navRange==='all' && (
                <p className="text-[10px] text-amber-600/80">
                  ⚠ Midcap 150 index launched Apr 2019 — chart shows only 2019–2026. The 9.12% alpha vs Midcap in the TWRR cards was earned in 2015–2019 (when midcap was flat/negative), not visible here.
                </p>
              )}
            </div>
          )}
        </div>

        {/* ── Annual Returns ── */}
        {annualReturns.length>0&&(
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <h2 className="text-base font-bold text-white mb-3">Annual Returns — Portfolio vs Indices</h2>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={annualReturns} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b"/>
                <XAxis dataKey="year" stroke="#475569" tick={{fontSize:10}}/>
                <YAxis stroke="#475569" tick={{fontSize:10}} tickFormatter={v=>`${v}%`}/>
                <Tooltip contentStyle={{backgroundColor:'#0f172a',border:'1px solid #334155',borderRadius:8,fontSize:11}}
                  formatter={(v:any,name:any)=>[`${v?.toFixed(1)}%`,
                    name==='portfolioReturn'?'Portfolio':name==='sensexReturn'?'Sensex':name==='nifty500Return'?'Nifty 500':name==='midcapReturn'?'Midcap 150':'Smallcap 250']}/>
                <Legend wrapperStyle={{fontSize:11}} formatter={v=>v==='portfolioReturn'?'Portfolio':v==='sensexReturn'?'Sensex':v==='nifty500Return'?'Nifty 500':v==='midcapReturn'?'Midcap 150':'Smallcap 250'}/>
                <ReferenceLine y={0} stroke="#475569"/>
                <Bar dataKey="portfolioReturn" fill="#10b981" radius={[3,3,0,0]} name="portfolioReturn"/>
                <Bar dataKey="sensexReturn"    fill="#3b82f6" radius={[3,3,0,0]} name="sensexReturn"    opacity={0.75}/>
                <Bar dataKey="nifty500Return"  fill="#8b5cf6" radius={[3,3,0,0]} name="nifty500Return"  opacity={0.75}/>
                <Bar dataKey="midcapReturn"    fill="#f59e0b" radius={[3,3,0,0]} name="midcapReturn"    opacity={0.75}/>
                <Bar dataKey="smallcapReturn"  fill="#ef4444" radius={[3,3,0,0]} name="smallcapReturn"  opacity={0.75}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* ── Signal Engines Control Panel ── */}
        {(() => {
          const engines = [
            { key: 'stage2',       label: 'Stage 2',     sub: 'Technical stage',   url: '/api/stage2-trigger',        icon: '📊' },
            { key: 'pead',         label: 'PEAD',         sub: 'Earnings quality',  url: '/api/pead-trigger',           icon: '💰' },
            { key: 'insider',      label: 'Insider',      sub: 'Promoter / FII',    url: '/api/insider-trigger',        icon: '👤' },
            { key: 'fundamentals', label: 'Fundamentals', sub: 'Screener.in ~5 min',url: '/api/sell-signal-trigger',    icon: '📋' },
          ];
          const getBtnStyle = (st: string) =>
            st === 'running' ? 'bg-blue-500/20 text-blue-300 border-blue-500/40 animate-pulse' :
            st === 'done'    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' :
            st === 'error'   ? 'bg-red-500/20 text-red-300 border-red-500/40' :
                               'bg-slate-800 text-slate-400 border-slate-700 hover:border-slate-500 hover:text-slate-200';
          return (
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <button
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-800/40 transition-colors"
                onClick={() => setEnginesOpen(o => !o)}
              >
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-400" />
                  <span className="text-sm font-semibold text-slate-200">Signal Engines</span>
                  <span className="text-[10px] text-slate-500">Run manually to refresh signal data</span>
                </div>
                <div className="flex items-center gap-3">
                  {Object.values(engineStatus).some(s => s === 'running') && (
                    <span className="text-[10px] bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full animate-pulse">Running…</span>
                  )}
                  {enginesOpen ? <ChevronUp className="w-4 h-4 text-slate-500"/> : <ChevronDown className="w-4 h-4 text-slate-500"/>}
                </div>
              </button>

              {enginesOpen && (
                <div className="border-t border-slate-800 px-4 py-3 space-y-3">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {engines.map(e => {
                      const st = engineStatus[e.key] || 'idle';
                      return (
                        <button
                          key={e.key}
                          onClick={() => st !== 'running' && triggerEngine(e.key, e.url)}
                          disabled={st === 'running'}
                          className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-left transition-all ${getBtnStyle(st)}`}
                        >
                          <span className="text-base shrink-0">{e.icon}</span>
                          <div className="min-w-0">
                            <div className="text-xs font-semibold flex items-center gap-1">
                              {e.label}
                              {st === 'running' && <RefreshCw className="w-3 h-3 animate-spin"/>}
                              {st === 'done'    && <span className="text-[10px]">✓</span>}
                              {st === 'error'   && <span className="text-[10px]">✗</span>}
                            </div>
                            <div className="text-[10px] opacity-60 truncate">
                              {st === 'running' ? 'Running…' : st === 'done' ? 'Started ✓' : st === 'error' ? 'Error — retry' : e.sub}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-3 pt-1 border-t border-slate-800/60">
                    <button
                      onClick={() => !Object.values(engineStatus).some(s=>s==='running') && triggerAll()}
                      disabled={Object.values(engineStatus).some(s => s === 'running')}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 transition-colors text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Play className="w-3.5 h-3.5"/>
                      Refresh All Signals
                    </button>
                    <span className="text-[10px] text-slate-600">Launches all 4 engines in background · fundamentals takes ~5 min</span>
                  </div>

                  {fundaRunning && (
                    <div className="flex items-center gap-2 bg-blue-500/10 border border-blue-500/20 rounded-lg px-3 py-2">
                      <RefreshCw className="w-3.5 h-3.5 text-blue-400 animate-spin shrink-0"/>
                      <span className="text-xs text-blue-300">Fundamentals scraper running on VPS — polling Screener.in for all 32 stocks (~5 min). Signal table auto-refreshes when done.</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()}

        {/* ── Holdings Table ── */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold text-white">Holdings</h2>
            <div className="text-xs text-slate-500 hidden sm:block">Click headers to sort · Click stock name for deep dive</div>
          </div>
          <div className="overflow-x-auto overflow-y-auto -mx-1" style={{maxHeight:'min(680px, calc(100vh - 200px))'}}>
            <table className="w-full text-xs border-collapse" style={{minWidth:'1560px'}}>
              <thead className="sticky top-0 z-20">
                <tr className="border-b-2 border-slate-600">
                  <th className="sticky left-0 bg-slate-900 text-left px-2 py-2.5 text-xs font-semibold text-slate-300 cursor-pointer hover:text-white whitespace-nowrap z-30"
                    onClick={()=>handleSort('stock')}>
                    Stock{sortCol==='stock'?(sortDir==='asc'?' ▲':' ▼'):''}
                  </th>
                  <Th col="qty"          label="Qty"/>
                  <Th col="pct"          label="Port%"/>
                  <Th col="invested"     label="Net Invested"/>
                  <Th col="value"        label="Value"/>
                  <Th col="realizedPl"   label="Realized P&L"/>
                  <Th col="pl"           label="Unrealized P&L"/>
                  <Th col="pl"           label="Total P&L"/>
                  <Th col="returns"      label="Return%†"/>
                  <Th col="irr"          label="IRR%"/>
                  <Th col="duration"     label="Duration"/>
                  <Th col="dayChange"    label="1D ₹"/>
                  <Th col="dayChangePct" label="1D%"/>
                  <Th col="pe"           label="PE (TTM)"/>
                  {/* Signal pillars */}
                  <Th col="signal" label="Funda" left/>
                  <Th col="signal" label="Tech"  left/>
                  <Th col="signal" label="Ins"   left/>
                  <Th col="signal" label="Events" left/>
                  <Th col="signal"       label="Signal"/>
                </tr>
              </thead>
              <tbody>
                {sorted.map(h=>(
                  <tr key={h.symbol} className="border-b border-slate-800/60 hover:bg-slate-800/40 transition-colors">
                    <td className="sticky left-0 bg-slate-900 hover:bg-slate-800/40 px-2 py-2 z-10 whitespace-nowrap">
                      <Link href={`/portfolio/company/${h.symbol}`}>
                        <div className="font-semibold text-white hover:text-blue-400">{h.symbol}</div>
                        <div className="text-slate-500" style={{fontSize:'10px'}}>{h.sector}</div>
                      </Link>
                    </td>
                    <td className="text-right px-2 py-2 text-slate-300 whitespace-nowrap">{h.qty.toLocaleString()}</td>
                    <td className="text-right px-2 py-2 text-slate-400 whitespace-nowrap">{h.portfolioPct.toFixed(1)}%</td>
                    <td className="text-right px-2 py-2 text-slate-300 whitespace-nowrap">{nfmt(h.netInvested??h.invested)}</td>
                    <td className="text-right px-2 py-2 text-white font-medium whitespace-nowrap">{nfmt(h.currentValue)}</td>
                    <td className={`text-right px-2 py-2 whitespace-nowrap ${!h.realizedPnl?'text-slate-600':h.realizedPnl>=0?'text-emerald-400':'text-red-400'}`}>
                      {h.realizedPnl ? `${h.realizedPnl>=0?'+':''}${nfmt(h.realizedPnl)}` : '—'}
                    </td>
                    <td className={`text-right px-2 py-2 font-medium whitespace-nowrap ${h.gainLoss>=0?'text-emerald-400':'text-red-400'}`}>
                      {h.gainLoss>=0?'+':''}{nfmt(h.gainLoss)}
                    </td>
                    <td className={`text-right px-2 py-2 font-semibold whitespace-nowrap ${h.totalPnl>=0?'text-emerald-400':'text-red-400'}`}>
                      {h.totalPnl>=0?'+':''}{nfmt(h.totalPnl)}
                    </td>
                    <td className={`text-right px-2 py-2 font-bold whitespace-nowrap ${h.totalPnlPct>=0?'text-emerald-400':'text-red-400'}`}>
                      <div>{pct(h.totalPnlPct)}</div>
                      {h.hasExits && <div className="text-slate-500 font-normal" style={{fontSize:'9px'}}>unreal: {pct(h.gainPct)}</div>}
                    </td>
                    <td className={`text-right px-2 py-2 whitespace-nowrap ${irrBg(h.irr)}`}>
                      <span className={irrColor(h.irr)}>{h.irr!=null?`${h.irr>=0?'+':''}${h.irr.toFixed(1)}%`:'—'}</span>
                    </td>
                    <td className="text-right px-2 py-2 whitespace-nowrap text-slate-400">
                      {h.duration!=null ? <span className="text-slate-300">{h.duration.toFixed(1)}<span className="text-slate-500 text-xs">y</span></span> : <span className="text-slate-600">NA</span>}
                    </td>
                    <td className={`text-right px-2 py-2 whitespace-nowrap ${h.dayChange==null?'text-slate-500':h.dayChange>=0?'text-emerald-400':'text-red-400'}`}>
                      {h.dayChange!=null?`${h.dayChange>=0?'+':''}${nfmt(h.dayChange)}`:'—'}
                    </td>
                    <td className={`text-right px-2 py-2 whitespace-nowrap ${h.dayChangePct==null?'text-slate-500':h.dayChangePct>=0?'text-emerald-400':'text-red-400'}`}>
                      {h.dayChangePct!=null?`${h.dayChangePct>=0?'+':''}${h.dayChangePct.toFixed(2)}%`:'—'}
                    </td>
                    {/* PE (TTM) */}
                    <td className={`text-right px-2 py-2 whitespace-nowrap ${
                      h.trailingPE==null||h.trailingPE<=0?'text-slate-500':
                      h.medianPE5yr&&h.trailingPE>h.medianPE5yr*1.2?'text-red-400':
                      h.medianPE5yr&&h.trailingPE<h.medianPE5yr*0.8?'text-emerald-400':'text-slate-300'}`}>
                      {fmtPE(h.trailingPE)}
                    </td>
                    {/* Signal pillars */}
                    <PillarCell p={signals[h.symbol]?.funda} />
                    <PillarCell p={signals[h.symbol]?.technical} />
                    <PillarCell p={signals[h.symbol]?.insider} />
                    <PillarCell p={signals[h.symbol]?.events} />
                    <ComputedSignalCell sig={signals[h.symbol]} />
                  </tr>
                ))}
                {/* Closed positions summary row */}
                {summary?.closedPositions && (
                  <tr className="border-t border-dashed border-slate-600 bg-slate-800/30 italic text-slate-400">
                    <td className="sticky left-0 bg-slate-850 px-2 py-2 z-10 whitespace-nowrap">
                      <div className="text-slate-400 text-xs font-medium">Closed Positions</div>
                      <div className="text-slate-600" style={{fontSize:'10px'}}>{summary.closedPositions.count} exited stocks</div>
                    </td>
                    <td/><td/>
                    <td className={`text-right px-2 py-2 whitespace-nowrap text-xs font-medium ${(summary.closedPositions.netInvested??0)<=0?'text-emerald-400':'text-slate-400'}`}>
                      {nfmt(summary.closedPositions.netInvested)}
                    </td>
                    <td/>
                    <td className={`text-right px-2 py-2 whitespace-nowrap font-semibold ${summary.closedPositions.realizedPnl>=0?'text-emerald-400':'text-red-400'}`}>
                      {summary.closedPositions.realizedPnl>=0?'+':''}{nfmt(summary.closedPositions.realizedPnl)}
                    </td>
                    <td className="text-right px-2 py-2 text-slate-600 whitespace-nowrap">—</td>
                    <td className={`text-right px-2 py-2 whitespace-nowrap font-semibold ${summary.closedPositions.realizedPnl>=0?'text-emerald-400':'text-red-400'}`}>
                      {summary.closedPositions.realizedPnl>=0?'+':''}{nfmt(summary.closedPositions.realizedPnl)}
                    </td>
                    <td className={`text-right px-2 py-2 text-xs whitespace-nowrap ${summary.closedPositions.realizedPnl>=0?'text-emerald-400':'text-red-400'}`}>
                      {pct(summary.closedPositions.grossInvested>0?summary.closedPositions.realizedPnl/summary.closedPositions.grossInvested*100:null)}
                    </td>
                    <td/><td/><td/><td/><td/><td/><td/><td/><td/><td/>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-500 bg-slate-800/70 font-bold">
                  <td className="sticky left-0 bg-slate-800 px-2 py-2 text-white whitespace-nowrap z-10">TOTAL ({holdings.length})</td>
                  <td/><td/>
                  <td className="text-right px-2 py-2 text-white whitespace-nowrap">{summary?nfmt(summary.totalNetInvested??summary.totalInvested):''}</td>
                  <td className="text-right px-2 py-2 text-emerald-400 whitespace-nowrap">{summary?nfmt(summary.totalValue):''}</td>
                  <td className={`text-right px-2 py-2 whitespace-nowrap ${(summary?.totalRealizedPnl??0)>=0?'text-emerald-400':'text-red-400'}`}>
                    {summary?`${(summary.totalRealizedPnl??0)>=0?'+':''}${nfmt(summary.totalRealizedPnl??0)}`:''}
                  </td>
                  <td className={`text-right px-2 py-2 whitespace-nowrap ${(summary?.totalUnrealizedPnl??0)>=0?'text-emerald-400':'text-red-400'}`}>
                    {summary?`${(summary.totalUnrealizedPnl??0)>=0?'+':''}${nfmt(summary.totalUnrealizedPnl??0)}`:''}
                  </td>
                  <td className={`text-right px-2 py-2 whitespace-nowrap ${(summary?.totalPnlAll??0)>=0?'text-emerald-400':'text-red-400'}`}>
                    {summary?`${(summary.totalPnlAll??0)>=0?'+':''}${nfmt(summary.totalPnlAll??0)}`:''}
                  </td>
                  <td className={`text-right px-2 py-2 whitespace-nowrap ${(summary?.totalPnlPctAll??0)>=0?'text-emerald-400':'text-red-400'}`}>
                    {pct(summary?.totalPnlPctAll??null)} <span className="text-slate-600 font-normal text-xs">on net</span>
                  </td>
                  <td className="text-right px-2 py-2 text-blue-400 whitespace-nowrap">XIRR: {summary?.xirr!=null?`${summary.xirr.toFixed(2)}%`:'—'}</td>
                  <td/>
                  <td className={`text-right px-2 py-2 whitespace-nowrap ${(summary?.totalDayChange??0)>=0?'text-emerald-400':'text-red-400'}`}>
                    {summary?.totalDayChange!=null?`${summary.totalDayChange>=0?'+':''}${nfmt(summary.totalDayChange)}`:'—'}
                  </td>
                  <td className={`text-right px-2 py-2 whitespace-nowrap ${(summary?.totalDayChangePct??0)>=0?'text-emerald-400':'text-red-400'}`}>
                    {summary?.totalDayChangePct!=null?`${summary.totalDayChangePct>=0?'+':''}${summary.totalDayChangePct.toFixed(2)}%`:'—'}
                  </td>
                  <td/><td/><td/><td/><td/><td/>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="mt-1.5 text-xs text-slate-600 text-right">
            † Return% = true total return incl. realized gains · IRR = annualised · PE red if &gt;20% above 5yr median · Click stock name for deep dive
            {normalized?' · Normalised to ₹1Cr':''}
          </div>
        </div>

        {/* ══ PORTFOLIO ANALYTICS ══ */}
        {holdings.length>0 && sectorAgg.length>0 && (<>

        {/* ── Chart 1: Portfolio Map (Treemap) ── */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-3">
            <div>
              <h2 className="text-base font-bold text-white">Portfolio Map</h2>
              <p className="text-xs text-slate-500 mt-0.5">Rectangle size = current value · Colour = cumulative gain (dark green → red)</p>
            </div>
            <div className="flex gap-3 text-xs shrink-0">
              {[{l:'≥50%',c:'#059669'},{l:'10–50%',c:'#10b981'},{l:'0–10%',c:'#6ee7b7'},{l:'Loss',c:'#ef4444'}].map(x=>(
                <div key={x.l} className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-sm" style={{backgroundColor:x.c}}/>
                  <span className="text-slate-400">{x.l}</span>
                </div>
              ))}
            </div>
          </div>
          <PortfolioTreemap
            data={holdings.map(h=>({
              symbol:h.symbol, currentValue:h.currentValue,
              gainPct:h.gainPct, irr:h.irr, duration:h.duration,
              portfolioPct:h.portfolioPct, sector:h.sector, signal:h.signal,
            }))}
            nfmt={nfmt}
          />
          <p className="text-xs text-slate-600 mt-1.5 text-right">Hover any cell for full details · Size = value · Colour = return</p>
        </div>

        {/* ── Chart 2 & 3: Sector Allocation + Sector Scorecard ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <h2 className="text-base font-bold text-white mb-0.5">Sector Allocation</h2>
            <p className="text-xs text-slate-500 mb-3">By current value · bar = % of portfolio</p>
            <ResponsiveContainer width="100%" height={Math.max(280, sectorAgg.length*26)}>
              <BarChart data={sectorAgg} layout="vertical" barSize={15} margin={{right:52,left:0}}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false}/>
                <XAxis type="number" stroke="#334155" tick={{fontSize:9,fill:'#64748b'}} tickFormatter={v=>`${v}%`} domain={[0,'dataMax+2']}/>
                <YAxis type="category" dataKey="sector" stroke="#334155" tick={{fontSize:9,fill:'#94a3b8'}} width={102}/>
                <Tooltip cursor={{fill:'rgba(255,255,255,0.03)'}}
                  content={({active,payload}:any)=>{
                    if(!active||!payload?.[0]) return null;
                    const s:SectorAgg = payload[0].payload;
                    return (
                      <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 text-xs space-y-1 shadow-xl">
                        <div className="font-bold text-white text-sm">{s.sector}</div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 mt-1">
                          <span className="text-slate-400">Weight</span><span className="text-white font-semibold">{s.portfolioPct.toFixed(1)}%</span>
                          <span className="text-slate-400">Value</span><span className="text-white font-semibold">{nfmt(s.value)}</span>
                          <span className="text-slate-400">Invested</span><span className="text-slate-300">{nfmt(s.invested)}</span>
                          <span className="text-slate-400">Gain</span><span className={s.gainPct>=0?'text-emerald-400 font-semibold':'text-red-400 font-semibold'}>{s.gainPct>=0?'+':''}{s.gainPct.toFixed(1)}%</span>
                          <span className="text-slate-400">Avg IRR</span><span className="text-blue-400 font-semibold">{s.avgIrr!=null?`${s.avgIrr>=0?'+':''}${s.avgIrr.toFixed(1)}%`:'—'}</span>
                          <span className="text-slate-400">Holdings</span><span className="text-slate-300">{s.holdingCount}</span>
                        </div>
                        <div className="text-slate-500 pt-1">{s.holdings.join(' · ')}</div>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="portfolioPct" name="Portfolio %" radius={[0,4,4,0]}>
                  {sectorAgg.map((s,i)=>(
                    <Cell key={i} fill={s.gainPct>=15?'#059669':s.gainPct>=0?'#10b981':s.gainPct>=-10?'#f97316':'#ef4444'} fillOpacity={0.88}/>
                  ))}
                  <LabelList dataKey="portfolioPct" position="right" style={{fontSize:9,fill:'#94a3b8'}} formatter={(v:any)=>`${v?.toFixed(1)}%`}/>
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="flex gap-3 mt-2 text-xs justify-end">
              {[{c:'#059669',l:'Gain ≥15%'},{c:'#10b981',l:'Gain 0–15%'},{c:'#f97316',l:'Loss <10%'},{c:'#ef4444',l:'Loss ≥10%'}].map(x=>(
                <div key={x.l} className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm" style={{backgroundColor:x.c}}/><span className="text-slate-500">{x.l}</span></div>
              ))}
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <h2 className="text-base font-bold text-white mb-0.5">Sector Scorecard</h2>
            <p className="text-xs text-slate-500 mb-3">Cumulative gain % vs annualised IRR · sorted by IRR</p>
            <ResponsiveContainer width="100%" height={Math.max(280, sectorAgg.filter(s=>s.avgIrr!=null).length*32)}>
              <BarChart
                data={[...sectorAgg].filter(s=>s.avgIrr!=null).sort((a,b)=>(b.avgIrr??0)-(a.avgIrr??0))}
                layout="vertical" barSize={9} barGap={3} margin={{right:10}}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false}/>
                <XAxis type="number" stroke="#334155" tick={{fontSize:9,fill:'#64748b'}} tickFormatter={v=>`${v}%`}/>
                <YAxis type="category" dataKey="sector" stroke="#334155" tick={{fontSize:9,fill:'#94a3b8'}} width={102}/>
                <Tooltip cursor={{fill:'rgba(255,255,255,0.03)'}}
                  content={({active,payload}:any)=>{
                    if(!active||!payload?.[0]) return null;
                    const s:SectorAgg = payload[0].payload;
                    return (
                      <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 text-xs space-y-1 shadow-xl">
                        <div className="font-bold text-white text-sm">{s.sector}</div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 mt-1">
                          <span className="text-slate-400">Cumul. Gain</span><span className={s.gainPct>=0?'text-emerald-400 font-semibold':'text-red-400 font-semibold'}>{s.gainPct>=0?'+':''}{s.gainPct.toFixed(1)}%</span>
                          <span className="text-slate-400">Avg IRR</span><span className="text-blue-400 font-semibold">{s.avgIrr!=null?`${s.avgIrr>=0?'+':''}${s.avgIrr.toFixed(1)}%`:'—'}</span>
                          <span className="text-slate-400">Value</span><span className="text-white">{nfmt(s.value)}</span>
                          <span className="text-slate-400">Holdings</span><span className="text-slate-300">{s.holdingCount} stocks</span>
                        </div>
                      </div>
                    );
                  }}
                />
                <Legend wrapperStyle={{fontSize:10,color:'#94a3b8'}} formatter={v=>v==='gainPct'?'Cumulative Gain %':'Annualised IRR %'}/>
                <ReferenceLine x={0} stroke="#475569" strokeWidth={1}/>
                <ReferenceLine x={15} stroke="#3b82f6" strokeDasharray="3 3" strokeOpacity={0.4}
                  label={{value:'IRR 15%',position:'top',fontSize:8,fill:'#3b82f6'}}/>
                <Bar dataKey="gainPct" name="gainPct" fill="#10b981" radius={[0,3,3,0]} fillOpacity={0.65}/>
                <Bar dataKey="avgIrr"  name="avgIrr"  fill="#3b82f6" radius={[0,3,3,0]} fillOpacity={0.95}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ── Chart 4 & 5: Market Cap Donut + IRR vs Weight Bubble ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <h2 className="text-base font-bold text-white mb-0.5">Market Cap Composition</h2>
            <p className="text-xs text-slate-500 mb-4">Portfolio split by cap tier</p>
            <div className="flex items-center gap-4">
              <div className="shrink-0">
                <PieChart width={190} height={190}>
                  <Pie data={mcapAgg} dataKey="portfolioPct" nameKey="category"
                    cx="50%" cy="50%" innerRadius={58} outerRadius={90}
                    paddingAngle={4} stroke="none" startAngle={90} endAngle={-270}>
                    {mcapAgg.map(m=>(<Cell key={m.category} fill={(MCAP_COLORS as any)[m.category]}/>))}
                  </Pie>
                  <Tooltip contentStyle={{backgroundColor:'#0f172a',border:'1px solid #334155',borderRadius:8,fontSize:11}}
                    content={({active,payload}:any)=>{
                      if(!active||!payload?.[0]) return null;
                      const m:McapAgg = payload[0].payload;
                      return (
                        <div className="bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-xs space-y-0.5 shadow-xl">
                          <div className="font-bold" style={{color:(MCAP_COLORS as any)[m.category]}}>{m.category}</div>
                          <div className="text-slate-400">Weight: <span className="text-white font-semibold">{m.portfolioPct.toFixed(1)}%</span></div>
                          <div className="text-slate-400">Value: <span className="text-white">{nfmt(m.value)}</span></div>
                          <div className="text-slate-400">Gain: <span className={m.gainPct>=0?'text-emerald-400':'text-red-400'}>{m.gainPct>=0?'+':''}{m.gainPct.toFixed(1)}%</span></div>
                          <div className="text-slate-400">{m.count} holdings</div>
                        </div>
                      );
                    }}
                  />
                </PieChart>
              </div>
              <div className="flex-1 space-y-4">
                {mcapAgg.map(m=>(
                  <div key={m.category}>
                    <div className="flex justify-between items-baseline mb-1">
                      <span className="text-sm font-bold" style={{color:(MCAP_COLORS as any)[m.category]}}>{m.category}</span>
                      <span className="text-lg font-bold text-white">{m.portfolioPct.toFixed(1)}%</span>
                    </div>
                    <div className="h-1.5 bg-slate-800 rounded-full mb-1.5">
                      <div className="h-1.5 rounded-full" style={{width:`${m.portfolioPct}%`,backgroundColor:(MCAP_COLORS as any)[m.category]}}/>
                    </div>
                    <div className="flex justify-between text-xs text-slate-500">
                      <span>{nfmt(m.value)} · {m.count} stocks</span>
                      <span className={m.gainPct>=0?'text-emerald-400 font-semibold':'text-red-400 font-semibold'}>{m.gainPct>=0?'+':''}{m.gainPct.toFixed(1)}% gain</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <h2 className="text-base font-bold text-white mb-0.5">IRR vs Portfolio Weight</h2>
            <p className="text-xs text-slate-500 mb-3">Bubble size = weight · Top-right = high-conviction, high-return</p>
            <ResponsiveContainer width="100%" height={265}>
              <ScatterChart margin={{top:10,right:20,bottom:28,left:5}}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b"/>
                <XAxis type="number" dataKey="irr" name="IRR %" stroke="#334155"
                  tick={{fontSize:9,fill:'#64748b'}} tickFormatter={v=>`${v}%`}
                  label={{value:'IRR % (annualised since first buy)',position:'insideBottom',offset:-18,fontSize:9,fill:'#64748b'}}/>
                <YAxis type="number" dataKey="portfolioPct" name="Weight %" stroke="#334155"
                  tick={{fontSize:9,fill:'#64748b'}} tickFormatter={v=>`${v}%`}
                  label={{value:'Portfolio Weight %',angle:-90,position:'insideLeft',offset:10,fontSize:9,fill:'#64748b'}}/>
                <Tooltip cursor={false}
                  content={({active,payload}:any)=>{
                    if(!active||!payload?.[0]) return null;
                    const d = payload[0].payload;
                    return (
                      <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 text-xs space-y-1 shadow-xl">
                        <div className="font-bold text-white text-sm">{d.symbol}</div>
                        <div className="text-slate-400">Sector: <span className="text-slate-300">{d.sector}</span></div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 mt-1">
                          <span className="text-slate-400">IRR</span><span className={d.irr>=0?'text-emerald-400 font-semibold':'text-red-400 font-semibold'}>{d.irr>=0?'+':''}{d.irr.toFixed(1)}%</span>
                          <span className="text-slate-400">Weight</span><span className="text-white font-semibold">{d.portfolioPct.toFixed(1)}%</span>
                          <span className="text-slate-400">Gain</span><span className={d.gainPct>=0?'text-emerald-400':'text-red-400'}>{d.gainPct>=0?'+':''}{d.gainPct.toFixed(1)}%</span>
                          <span className="text-slate-400">Value</span><span className="text-white">{nfmt(d.currentValue)}</span>
                        </div>
                        {d.signal&&<div className="mt-1 text-slate-400">Signal: <span className="font-bold text-blue-300">{d.signal}</span></div>}
                      </div>
                    );
                  }}
                />
                <ReferenceLine x={0}  stroke="#ef4444" strokeDasharray="4 2" strokeOpacity={0.35}/>
                <ReferenceLine x={15} stroke="#f59e0b" strokeDasharray="4 2" strokeOpacity={0.35}
                  label={{value:'15% IRR',position:'insideTopRight',fontSize:8,fill:'#f59e0b'}}/>
                <Scatter
                  data={holdings.filter(h=>h.irr!=null).map(h=>({
                    symbol:h.symbol, irr:h.irr!, portfolioPct:h.portfolioPct,
                    gainPct:h.gainPct, currentValue:h.currentValue,
                    sector:h.sector, signal:h.signal,
                  }))}
                  shape={(props:any)=>{
                    const {cx,cy,payload}=props;
                    const r=Math.max(6,Math.min(26,payload.portfolioPct*2.4));
                    const fill=payload.irr>=25?'#10b981':payload.irr>=15?'#34d399':payload.irr>=0?'#f59e0b':'#ef4444';
                    return (
                      <g>
                        <circle cx={cx} cy={cy} r={r} fill={fill} fillOpacity={0.8} stroke="#0f172a" strokeWidth={1.5}/>
                        {r>=11&&<text x={cx} y={cy+3} textAnchor="middle" fill="white" fontSize={Math.min(9,r*0.82)} fontWeight="700">{payload.symbol}</text>}
                      </g>
                    );
                  }}
                />
              </ScatterChart>
            </ResponsiveContainer>
            <div className="flex gap-4 mt-1 justify-center flex-wrap">
              {[{c:'#10b981',l:'IRR ≥25%'},{c:'#34d399',l:'15–25%'},{c:'#f59e0b',l:'0–15%'},{c:'#ef4444',l:'<0%'}].map(x=>(
                <div key={x.l} className="flex items-center gap-1 text-xs text-slate-400">
                  <div className="w-2.5 h-2.5 rounded-full" style={{backgroundColor:x.c}}/>{x.l}
                </div>
              ))}
            </div>
          </div>
        </div>

        </>)}

      </div>
    </div>
  );
}

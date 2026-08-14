'use client';
import { useEffect, useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, TrendingUp, TrendingDown, Database, AlertTriangle,
  Activity, Users, BarChart2, Target, Zap, ChevronDown, ChevronUp,
} from 'lucide-react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, Cell,
} from 'recharts';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Stage2Signal {
  ticker: string; signal_date: string; stage2_score: number;
  lifecycle_state: string; stage2_subtype: string; days_in_stage2: number;
  ema150_distance_pct: number; ema150_slope: number; sma200_slope: number;
  sma50_above_ema150: boolean; ema150_above_sma200: boolean;
  above_200sma: boolean; above_50sma: boolean;
  rs_52w_percentile: number; rs_63d_score: number; rs_trend: string;
  score_trend: string; score_3d_delta: number | null;
  vcp_score: number; vcp_volume_ratio: number;
  pivot_proximity_pct: number; base_20d_distance_pct: number; base_count: number;
  eps_is_accelerating: boolean; eps_acceleration_quarters: number;
  is_pead_confluence: boolean; pe_ratio: number | null;
  vol_5d_vs_50d_ratio: number; hl_depth_20d: number;
}

interface PeadSignal {
  ticker: string; signal_date: string; pead_score: number;
  yoy_profit_pct: number; yoy_revenue_pct: number; opm_expansion_bps: number;
  qoq_profit_pct: number; price_vs_ema200_pct: number;
  volume_multiplier: number; delivery_pct: number; day_gap_pct: number;
  trigger_path: string; is_hidden_catalyst: boolean; ttm_pe: number | null;
}

interface InsiderSignal {
  ticker: string; acquirer_name: string; transaction_type: string;
  signal_date: string; insider_score: number; tier: string;
  trade_value_in_cr: number; equity_pct_traded: number;
  cluster_trade_flag: boolean; ema150_distance_pct: number | null;
  actual_return_3m: number | null; actual_return_6m: number | null;
  person_category: string | null;
}

interface SectorScore {
  sector_id: string; date: string; score: number; stage: string;
  distance_52w_high: string; rs_score: string; breadth_pct: string;
}

interface SectorDef { id: string; sector_name: string; }

interface CompanyData {
  symbol: string; isin?: string; sector?: string;
  current_price?: number; avg_price?: number;
  '52_week_high'?: number; '52_week_low'?: number;
  price_from_52w_high_pct?: number; price_from_52w_low_pct?: number;
  quantity?: number; invested?: number; current_value?: number;
  unrealized_pl?: number; unrealized_pl_pct?: number;
  portfolio_weight_pct?: number; date?: string;
  wiki_analysis?: {
    company_name?: string | null; sector?: string | null;
    thesis?: string | null; moat?: string | null;
    risk_factors?: string | null; valuation?: string | null;
    content_preview?: string | null; wiki_file?: string | null;
  };
}

interface Quote {
  price?: number; change?: number; change_abs?: number; name?: string;
  open?: number; high?: number; low?: number; volume?: number;
  market_cap?: number; week_52_high?: number; week_52_low?: number;
  pe_trailing?: number | null; pe_forward?: number | null;
  pb?: number | null; eps_ttm?: number | null; dividend_yield?: number | null;
  beta?: number | null; roe?: number | null; gross_margin?: number | null;
  operating_margin?: number | null; profit_margin?: number | null;
  debt_to_equity?: number | null; free_cash_flow?: number | null;
}

interface DbHolding {
  symbol: string; irr?: number | null; duration?: number | null;
  realizedPnl?: number; signal?: string | null;
  trailingPE?: number | null; medianPE5yr?: number | null;
}

interface SellTrigger {
  severity: 'CRITICAL' | 'WARNING' | 'MONITOR' | 'BULLISH';
  category: string; signal: string; detail: string;
}

interface QuarterlyFunda {
  ticker: string; period: string;
  revenue_cr: number | null; pat_cr: number | null; opm_pct: number | null;
}

// ── Period helpers ─────────────────────────────────────────────────────────────
const MONTH_NUM: Record<string, number> = {
  Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12
};
function parsePeriod(p: string): number {
  const [m, y] = p.split(' ');
  return parseInt(y) * 100 + (MONTH_NUM[m] ?? 0);
}
function periodToFY(p: string): string {
  const [m, yr] = p.split(' ');
  const y = parseInt(yr);
  const q: Record<string, [number, number]> = { Mar:[4,0], Jun:[1,1], Sep:[2,1], Dec:[3,1] };
  if (!q[m]) return p;
  const [qn, adj] = q[m];
  return `Q${qn}FY${((y + adj) % 100).toString().padStart(2,'0')}`;
}

// ── Formatters ─────────────────────────────────────────────────────────────────
const fmtCr = (n?: number | null) => {
  if (n == null) return '—';
  const a = Math.abs(n);
  if (a >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (a >= 1e5) return `₹${(n / 1e5).toFixed(2)}L`;
  return `₹${n.toFixed(0)}`;
};
const fmtPct = (n?: number | null, dec = 2) =>
  n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(dec)}%`;

const SIGNAL_CFG: Record<string, { bg: string; text: string }> = {
  BUY:        { bg: 'bg-emerald-500/25', text: 'text-emerald-300' },
  ACCUMULATE: { bg: 'bg-teal-500/25',    text: 'text-teal-300' },
  HOLD:       { bg: 'bg-blue-500/20',    text: 'text-blue-400' },
  WATCH:      { bg: 'bg-yellow-500/20',  text: 'text-yellow-400' },
  TRIM:       { bg: 'bg-orange-500/20',  text: 'text-orange-400' },
  REDUCE:     { bg: 'bg-orange-500/20',  text: 'text-orange-400' },
  SELL:       { bg: 'bg-red-500/20',     text: 'text-red-400' },
};

// ── Sell Trigger Engine ────────────────────────────────────────────────────────
function computeSellTriggers(
  s2: Stage2Signal | null, pead: PeadSignal[], ins: InsiderSignal[],
  sec: SectorScore | null, q: Quote | null, db: DbHolding | null
): SellTrigger[] {
  const t: SellTrigger[] = [];

  // Technical
  if (s2) {
    if (s2.lifecycle_state === 'EXITED')
      t.push({ severity: 'CRITICAL', category: 'Technical', signal: 'Stage 2 Exited', detail: 'Price broke below EMA150 — structural uptrend ended. Exit or enforce stop-loss.' });
    if (s2.lifecycle_state === 'WEAKENING')
      t.push({ severity: 'CRITICAL', category: 'Technical', signal: 'Stage 2 Weakening', detail: `Score dropped >12 pts in 5 days or price crossed below 50 SMA. Score: ${s2.stage2_score}/100.` });
    if (!s2.sma50_above_ema150)
      t.push({ severity: 'CRITICAL', category: 'Technical', signal: 'SMA50 Below EMA150', detail: 'Short-term trend flipping below medium-term — structural momentum breakdown.' });
    if (s2.ema150_distance_pct < -3)
      t.push({ severity: 'CRITICAL', category: 'Technical', signal: 'Price Below EMA150', detail: `${Math.abs(s2.ema150_distance_pct).toFixed(1)}% below 150-day EMA — key structural support lost.` });
    if (s2.score_trend === 'DECLINING' && Math.abs(s2.score_3d_delta ?? 0) > 8)
      t.push({ severity: 'WARNING', category: 'Technical', signal: 'Score Declining Sharply', detail: `${Math.abs(s2.score_3d_delta ?? 0).toFixed(0)}-pt drop in 3 days. Score now ${s2.stage2_score}/100.` });
    if (s2.stage2_subtype === 'LATE STAGE 2' && s2.ema150_distance_pct > 40)
      t.push({ severity: 'WARNING', category: 'Technical', signal: 'Late Stage 2 — Overextended', detail: `${s2.ema150_distance_pct.toFixed(0)}% above EMA150. Bases at this extension prone to failure.` });
    if (s2.rs_52w_percentile < 50 && s2.rs_trend === 'Negative')
      t.push({ severity: 'WARNING', category: 'Technical', signal: 'Relative Weakness', detail: `RS rank ${s2.rs_52w_percentile}th percentile, trend negative — underperforming most NSE stocks.` });
    if (s2.score_trend === 'DECLINING' && Math.abs(s2.score_3d_delta ?? 0) <= 8)
      t.push({ severity: 'MONITOR', category: 'Technical', signal: 'Score Trending Down', detail: `Stage 2 score declining (${s2.stage2_score}/100). Monitor for acceleration.` });
    if (s2.hl_depth_20d > 12)
      t.push({ severity: 'MONITOR', category: 'Technical', signal: 'Loose Base', detail: `20-day H-L depth ${s2.hl_depth_20d.toFixed(1)}% — elevated volatility, base structure weak.` });
  }

  // Earnings
  if (pead.length > 0) {
    const p = pead[0];
    if (p.yoy_profit_pct < -20 && p.trigger_path === 'NONE')
      t.push({ severity: 'CRITICAL', category: 'Earnings', signal: 'Earnings Collapse', detail: `Profit ${fmtPct(p.yoy_profit_pct)} YoY with no PEAD support — major fundamental deterioration.` });
    else if (p.yoy_profit_pct < 0)
      t.push({ severity: 'WARNING', category: 'Earnings', signal: 'Negative YoY Earnings', detail: `Profit ${fmtPct(p.yoy_profit_pct)} YoY. Watch for confirmation next quarter.` });
    if (p.opm_expansion_bps < -300)
      t.push({ severity: 'WARNING', category: 'Earnings', signal: 'Severe Margin Compression', detail: `OPM contracted ${Math.abs(p.opm_expansion_bps).toFixed(0)} bps — profitability under severe pressure.` });
    else if (p.opm_expansion_bps < -100)
      t.push({ severity: 'MONITOR', category: 'Earnings', signal: 'Margin Compression', detail: `OPM contracted ${Math.abs(p.opm_expansion_bps).toFixed(0)} bps.` });
    if (pead.length >= 3 &&
      pead[0].yoy_profit_pct < pead[1].yoy_profit_pct &&
      pead[1].yoy_profit_pct < pead[2].yoy_profit_pct)
      t.push({ severity: 'WARNING', category: 'Earnings', signal: 'Earnings Deceleration', detail: `3 consecutive quarters of declining YoY growth: ${fmtPct(pead[2].yoy_profit_pct,1)} → ${fmtPct(pead[1].yoy_profit_pct,1)} → ${fmtPct(pead[0].yoy_profit_pct,1)}.` });
  }

  // Insider
  const sells = ins.filter(i => i.transaction_type === 'SELL');
  const buys  = ins.filter(i => i.transaction_type === 'BUY');
  const clusterSell  = sells.find(i => i.cluster_trade_flag);
  const hcSell       = sells.find(i => i.tier === 'HIGH CONVICTION');
  const bigSell      = sells.find(i => i.equity_pct_traded > 1);
  if (clusterSell && hcSell)
    t.push({ severity: 'CRITICAL', category: 'Insider', signal: 'Cluster High-Conviction Selling', detail: `Multiple insiders selling in 14-day window — ₹${clusterSell.trade_value_in_cr.toFixed(0)}Cr (${clusterSell.equity_pct_traded.toFixed(2)}% equity).` });
  else if (hcSell)
    t.push({ severity: 'WARNING', category: 'Insider', signal: 'High-Conviction Insider Selling', detail: `₹${hcSell.trade_value_in_cr.toFixed(0)}Cr sold (${hcSell.equity_pct_traded.toFixed(2)}% equity). ${hcSell.acquirer_name || ''}.` });
  else if (clusterSell)
    t.push({ severity: 'WARNING', category: 'Insider', signal: 'Cluster Insider Selling', detail: `3+ insiders selling in 14 days — ₹${clusterSell.trade_value_in_cr.toFixed(0)}Cr total.` });
  else if (bigSell)
    t.push({ severity: 'WARNING', category: 'Insider', signal: 'Large Insider Sale', detail: `${bigSell.equity_pct_traded.toFixed(2)}% equity sold — ₹${bigSell.trade_value_in_cr.toFixed(0)}Cr.` });
  else if (sells.length > 0 && sells[0].equity_pct_traded > 0.3)
    t.push({ severity: 'MONITOR', category: 'Insider', signal: 'Insider Selling', detail: `${sells[0].equity_pct_traded.toFixed(2)}% equity sold — ₹${sells[0].trade_value_in_cr.toFixed(0)}Cr.` });

  // Sector
  if (sec) {
    if (sec.stage === 'Avoid / Weak')
      t.push({ severity: 'WARNING', category: 'Sector', signal: 'Sector in Avoid Zone', detail: `Sector score ${sec.score}/100 — structural sector headwind. Breadth ${sec.breadth_pct}%.` });
    else if (sec.stage.includes('Stage 1'))
      t.push({ severity: 'MONITOR', category: 'Sector', signal: 'Sector Consolidating', detail: `Sector score ${sec.score}/100 — no sector tailwind currently.` });
  }

  // Valuation
  const pe    = q?.pe_trailing ?? db?.trailingPE;
  const medPE = db?.medianPE5yr;
  if (pe && medPE && medPE > 0) {
    const ratio = pe / medPE;
    if (ratio > 1.75)
      t.push({ severity: 'WARNING', category: 'Valuation', signal: 'Significantly Overvalued vs History', detail: `PE ${pe.toFixed(0)}x vs 5yr median ${medPE.toFixed(0)}x — ${((ratio-1)*100).toFixed(0)}% premium. Mean reversion risk.` });
    else if (ratio > 1.25)
      t.push({ severity: 'MONITOR', category: 'Valuation', signal: 'Above Historical PE', detail: `PE ${pe.toFixed(0)}x vs 5yr median ${medPE.toFixed(0)}x — ${((ratio-1)*100).toFixed(0)}% above median.` });
  }

  // Bullish counters
  if (s2 && (s2.lifecycle_state === 'CONFIRMED' || s2.lifecycle_state === 'SUSTAINED'))
    t.push({ severity: 'BULLISH', category: 'Technical', signal: `Stage 2 ${s2.lifecycle_state}`, detail: `Score ${s2.stage2_score}/100, ${s2.days_in_stage2}d in stage. Uptrend intact.` });
  if (s2 && s2.rs_52w_percentile >= 80)
    t.push({ severity: 'BULLISH', category: 'Technical', signal: 'Top RS Performer', detail: `${s2.rs_52w_percentile}th percentile RS rank — outperforming ~${s2.rs_52w_percentile}% of NSE stocks.` });
  if (pead.length > 0 && pead[0].trigger_path === 'ACT')
    t.push({ severity: 'BULLISH', category: 'Earnings', signal: 'Strong Earnings Catalyst', detail: `PEAD score ${pead[0].pead_score}/100 (ACT tier). Profit YoY ${fmtPct(pead[0].yoy_profit_pct)}.` });
  if (buys.filter(b => b.tier === 'HIGH CONVICTION' || b.tier === 'NOTABLE').length > 0) {
    const notableBuys = buys.filter(b => b.tier === 'HIGH CONVICTION' || b.tier === 'NOTABLE');
    const total = notableBuys.reduce((s, b) => s + b.trade_value_in_cr, 0);
    t.push({ severity: 'BULLISH', category: 'Insider', signal: 'Insider Accumulation', detail: `${notableBuys.length} notable buy(s) — ₹${total.toFixed(0)}Cr total.` });
  }
  if (sec && sec.stage.includes('Stage 2'))
    t.push({ severity: 'BULLISH', category: 'Sector', signal: `Sector in ${sec.stage.replace('Stage 2A Early Inflection','Stage 2A').replace('Stage 2B Sustained Trend','Stage 2B')}`, detail: `Score ${sec.score}/100 — sector tailwind.` });

  return t;
}

// ── UI Components ──────────────────────────────────────────────────────────────

function MetricBox({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-slate-800 rounded-lg p-3">
      <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-0.5">{label}</div>
      <div className={`text-sm font-bold ${color ?? 'text-white'}`}>{value}</div>
    </div>
  );
}

function ScoreRing({ score, size = 56 }: { score: number; size?: number }) {
  const pct = Math.min(100, Math.max(0, score));
  const color = pct >= 80 ? '#10b981' : pct >= 65 ? '#34d399' : pct >= 50 ? '#f59e0b' : pct >= 35 ? '#f97316' : '#ef4444';
  const r = size / 2 - 5;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#1e293b" strokeWidth={5} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={5}
        strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round" />
    </svg>
  );
}

const TRIGGER_CFG = {
  CRITICAL: { bg: 'bg-red-500/10 border-red-500/40',      badge: 'bg-red-500/20 text-red-300',      icon: '🔴' },
  WARNING:  { bg: 'bg-amber-500/10 border-amber-500/40',  badge: 'bg-amber-500/20 text-amber-300',  icon: '🟡' },
  MONITOR:  { bg: 'bg-slate-700/40 border-slate-600/40',  badge: 'bg-slate-600/30 text-slate-400',  icon: '⚪' },
  BULLISH:  { bg: 'bg-emerald-500/8 border-emerald-500/30',badge: 'bg-emerald-500/20 text-emerald-300',icon: '🟢' },
} as const;

const LC_CFG: Record<string, string> = {
  CONFIRMED: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  SUSTAINED: 'bg-emerald-600/20 text-emerald-200 border-emerald-500/40',
  EMERGING:  'bg-blue-500/20 text-blue-300 border-blue-500/40',
  WATCHING:  'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
  WEAKENING: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
  EXITED:    'bg-red-500/20 text-red-300 border-red-500/40',
};

const PEAD_CFG: Record<string, string> = {
  ACT:   'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  WATCH: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
  NONE:  'bg-slate-600/20 text-slate-400 border-slate-600/40',
};

// ── Markdown-lite thesis renderer ──────────────────────────────────────────────
function ThesisBlock({ content }: { content: string }) {
  const cleaned = content.replace(/^\s*\d+\|\s*/gm, '');
  const lines = cleaned.split('\n');
  const sections: { heading: string | null; body: string[] }[] = [{ heading: null, body: [] }];
  for (const line of lines) {
    if (line.match(/^#{1,2}\s/)) {
      sections.push({ heading: line.replace(/^#+\s*/, ''), body: [] });
    } else {
      sections[sections.length - 1].body.push(line);
    }
  }

  const inline = (text: string, key: number) => {
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return (
      <span key={key}>
        {parts.map((p, i) =>
          p.startsWith('**') && p.endsWith('**')
            ? <strong key={i} className="text-slate-200 font-semibold">{p.slice(2, -2)}</strong>
            : <span key={i}>{p}</span>
        )}
      </span>
    );
  };

  const renderLine = (line: string, i: number) => {
    const t = line.trim();
    if (!t) return <div key={i} className="h-1.5" />;
    if (t.startsWith('### ')) return <h4 key={i} className="text-[11px] font-bold text-slate-300 mt-3 mb-1 uppercase tracking-wide">{t.slice(4)}</h4>;
    if (t.startsWith('- ') || t.startsWith('* '))
      return <div key={i} className="flex gap-2 text-xs text-slate-400 leading-relaxed"><span className="text-slate-600 shrink-0 mt-0.5">•</span>{inline(t.slice(2), i)}</div>;
    if (/^\d+\.\s/.test(t)) {
      const [num, ...rest] = t.split(/\.\s(.+)/);
      return <div key={i} className="flex gap-2 text-xs text-slate-400 leading-relaxed"><span className="text-slate-500 shrink-0 font-mono w-4">{num}.</span>{inline(rest.join('. '), i)}</div>;
    }
    if (t.startsWith('> '))
      return <div key={i} className="border-l-2 border-slate-600 pl-3 text-xs text-slate-500 italic leading-relaxed my-1">{inline(t.slice(2), i)}</div>;
    return <p key={i} className="text-xs text-slate-400 leading-relaxed">{inline(t, i)}</p>;
  };

  return (
    <div className="space-y-2">
      {sections.map((sec, si) => (
        <div key={si}>
          {sec.heading && (
            <div className="flex items-center gap-2 mt-3 mb-2">
              <div className="h-px flex-1 bg-slate-700/60" />
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap px-2">{sec.heading}</span>
              <div className="h-px flex-1 bg-slate-700/60" />
            </div>
          )}
          <div className="space-y-0.5">{sec.body.map((l, li) => renderLine(l, li))}</div>
        </div>
      ))}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────
export default function CompanyPage() {
  const { symbol } = useParams<{ symbol: string }>();
  const sym = symbol?.toUpperCase() ?? '';

  const [co,        setCo]        = useState<CompanyData | null>(null);
  const [quote,     setQuote]     = useState<Quote | null>(null);
  const [dbHolding, setDbHolding] = useState<DbHolding | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');

  const [stage2,      setStage2]      = useState<Stage2Signal | null>(null);
  const [pead,        setPead]        = useState<PeadSignal[]>([]);
  const [insiders,    setInsiders]    = useState<InsiderSignal[]>([]);
  const [sectorScore, setSectorScore] = useState<SectorScore | null>(null);
  const [sectorDef,   setSectorDef]   = useState<SectorDef | null>(null);

  const [showMonitor,    setShowMonitor]    = useState(false);
  const [thesisExpanded, setThesisExpanded] = useState(false);
  const [quarterlyFunda, setQuarterlyFunda] = useState<QuarterlyFunda[]>([]);

  const sb = (path: string) =>
    fetch(`/api/sb/${path}`, { cache: 'no-store' }).then(r => r.json()).catch(() => []);

  useEffect(() => {
    if (!sym) return;
    setLoading(true);
    Promise.all([
      fetch(`/api/proxy/portfolio/company/${sym}`).then(r => r.json()),
      fetch(`/api/proxy/stock-quote/${sym}`).then(r => r.json()).catch(() => null),
      fetch('/api/proxy/db/portfolio').then(r => r.json()).catch(() => null),
    ]).then(([coData, quoteData, dbData]) => {
      setCo(coData?.error ? null : coData);
      setQuote(quoteData?.error ? null : quoteData);
      const h = (dbData?.holdings ?? []).find((h: DbHolding) => h.symbol === sym);
      setDbHolding(h ?? null);
      if (coData?.error) setError(coData.error);
      setLoading(false);
    }).catch(e => { setError(e.message); setLoading(false); });
  }, [sym]);

  useEffect(() => {
    if (!sym) return;
    sb(`quarterly_fundamentals?ticker=eq.${sym}&order=period.asc&limit=20`)
      .then(d => { if (Array.isArray(d)) setQuarterlyFunda(d as QuarterlyFunda[]); });
  }, [sym]);

  useEffect(() => {
    if (!sym) return;
    Promise.all([
      sb(`stage2_signals?ticker=eq.${sym}&order=signal_date.desc&limit=1`),
      sb(`pead_signals?ticker=eq.${sym}&order=signal_date.desc&limit=4`),
      sb(`insider_signals?ticker=eq.${sym}&order=signal_date.desc&limit=10`),
      sb(`sector_constituents?symbol=eq.${sym}&select=sector_id`),
    ]).then(async ([s2, pd, ins, secCons]) => {
      setStage2(Array.isArray(s2) && s2.length ? s2[0] : null);
      setPead(Array.isArray(pd) ? pd : []);
      setInsiders(Array.isArray(ins) ? ins : []);
      if (Array.isArray(secCons) && secCons.length) {
        const sid = secCons[0].sector_id;
        const [scores, defs] = await Promise.all([
          sb(`daily_sector_scores?sector_id=eq.${sid}&order=date.desc&limit=1`),
          sb(`sector_definitions?id=eq.${sid}&select=id,sector_name`),
        ]);
        setSectorScore(Array.isArray(scores) && scores.length ? scores[0] : null);
        setSectorDef(Array.isArray(defs) && defs.length ? defs[0] : null);
      }
    });
  }, [sym]);

  const triggers = useMemo(
    () => computeSellTriggers(stage2, pead, insiders, sectorScore, quote, dbHolding),
    [stage2, pead, insiders, sectorScore, quote, dbHolding]
  );

  const critCount    = triggers.filter(t => t.severity === 'CRITICAL').length;
  const warnCount    = triggers.filter(t => t.severity === 'WARNING').length;
  const monitorCount = triggers.filter(t => t.severity === 'MONITOR').length;
  const bullishCount = triggers.filter(t => t.severity === 'BULLISH').length;
  const visible      = showMonitor ? triggers : triggers.filter(t => t.severity !== 'MONITOR');

  if (loading) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="text-white flex items-center gap-2">
        <Database className="animate-pulse w-5 h-5 text-emerald-400" />Loading {sym}…
      </div>
    </div>
  );

  if (error || !co) return (
    <div className="min-h-screen bg-slate-950 p-6">
      <Link href="/portfolio" className="text-slate-400 hover:text-white text-sm flex items-center gap-1 mb-6">
        <ArrowLeft className="w-4 h-4" />Portfolio
      </Link>
      <div className="bg-red-900/30 border border-red-700/50 rounded-xl p-6 text-red-300">
        {error || `${sym} not found in portfolio`}
      </div>
    </div>
  );

  const livePrice = quote?.price ?? co.current_price ?? 0;
  const change    = quote?.change ?? 0;
  const changeAbs = quote?.change_abs ?? 0;
  const isUp      = change >= 0;
  const signal    = dbHolding?.signal ?? null;
  const sigCfg    = signal ? (SIGNAL_CFG[signal] ?? SIGNAL_CFG.HOLD) : null;
  const w52High   = quote?.week_52_high ?? co['52_week_high'];
  const w52Low    = quote?.week_52_low  ?? co['52_week_low'];
  // Compute % from 52W range using the actual quote values (co has ±15% estimates)
  const pctFrom52High = w52High && w52High > 0 ? ((livePrice - w52High) / w52High * 100) : null;
  const pctFrom52Low  = w52Low  && w52Low  > 0 ? ((livePrice - w52Low)  / w52Low  * 100) : null;
  const pe        = quote?.pe_trailing  ?? dbHolding?.trailingPE;
  const medPE     = dbHolding?.medianPE5yr;
  const lcBadge   = stage2 ? (LC_CFG[stage2.lifecycle_state] ?? LC_CFG.WATCHING) : '';

  return (
    <div className="min-h-screen bg-slate-950 p-3 md:p-5">
      <div className="max-w-5xl mx-auto space-y-4">

        <Link href="/portfolio" className="text-slate-400 hover:text-white text-sm flex items-center gap-1.5 w-fit">
          <ArrowLeft className="w-4 h-4" />Back to Portfolio
        </Link>

        {/* ── Hero ─────────────────────────────────────────────────────────────── */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h1 className="text-2xl font-black text-white">{sym}</h1>
                <span className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded-full">NSE</span>
                {sigCfg && signal && (
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${sigCfg.bg} ${sigCfg.text}`}>{signal}</span>
                )}
              </div>
              <div className="text-slate-400 text-sm">
                {quote?.name ?? co.wiki_analysis?.company_name ?? sym} · {co.sector ?? co.wiki_analysis?.sector ?? '—'}
              </div>
            </div>
            <div className="text-right">
              <div className="text-3xl font-black text-white">
                ₹{livePrice.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className={`flex items-center justify-end gap-1 text-sm font-semibold mt-0.5 ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
                {isUp ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                {changeAbs >= 0 ? '+' : ''}₹{Math.abs(changeAbs).toFixed(2)} ({fmtPct(change)}) today
              </div>
            </div>
          </div>
          {quote?.open != null && (
            <div className="grid grid-cols-4 gap-3 mt-4 pt-4 border-t border-slate-800">
              {[
                { l: 'Open',       v: `₹${(quote.open  ?? 0).toFixed(2)}` },
                { l: "Day's High", v: `₹${(quote.high  ?? 0).toFixed(2)}` },
                { l: "Day's Low",  v: `₹${(quote.low   ?? 0).toFixed(2)}` },
                { l: 'Volume',     v: (quote.volume ?? 0) >= 1e6
                    ? `${((quote.volume ?? 0) / 1e6).toFixed(2)}M`
                    : `${((quote.volume ?? 0) / 1e3).toFixed(0)}K` },
              ].map(s => (
                <div key={s.l}>
                  <div className="text-[10px] text-slate-500">{s.l}</div>
                  <div className="text-sm font-semibold text-white mt-0.5">{s.v}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Signal Dashboard ──────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">

          {/* Stage 2 */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex flex-col items-center gap-1.5">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">Stage 2</div>
            {stage2 ? (
              <>
                <div className="relative flex items-center justify-center">
                  <ScoreRing score={stage2.stage2_score} size={56} />
                  <span className="absolute text-sm font-black text-white">{stage2.stage2_score}</span>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold text-center ${lcBadge}`}>
                  {stage2.lifecycle_state}
                </span>
                <span className="text-[10px] text-slate-500 text-center">{stage2.stage2_subtype}</span>
              </>
            ) : <div className="text-slate-600 text-xs py-4">No data</div>}
          </div>

          {/* PEAD */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex flex-col items-center gap-1.5">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">Earnings</div>
            {pead.length > 0 ? (
              <>
                <div className="relative flex items-center justify-center">
                  <ScoreRing score={pead[0].pead_score} size={56} />
                  <span className="absolute text-sm font-black text-white">{pead[0].pead_score}</span>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${PEAD_CFG[pead[0].trigger_path] ?? PEAD_CFG.NONE}`}>
                  {pead[0].trigger_path}
                </span>
                <span className={`text-[10px] font-semibold ${(pead[0].yoy_profit_pct ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {fmtPct(pead[0].yoy_profit_pct)} YoY
                </span>
              </>
            ) : <div className="text-slate-600 text-xs py-4">No results</div>}
          </div>

          {/* Insider */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex flex-col items-center gap-1.5">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">Insider</div>
            {insiders.length > 0 ? (() => {
              const b = insiders.filter(i => i.transaction_type === 'BUY').length;
              const s = insiders.filter(i => i.transaction_type === 'SELL').length;
              const net = b >= s ? 'BUYING' : 'SELLING';
              const green = net === 'BUYING';
              return (
                <>
                  <div className={`text-2xl font-black mt-1 ${green ? 'text-emerald-400' : 'text-red-400'}`}>{green ? '↑' : '↓'}</div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${green ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-red-500/20 text-red-300 border-red-500/40'}`}>{net}</span>
                  <span className="text-[10px] text-slate-500">{insiders.length} trades</span>
                </>
              );
            })() : <div className="text-slate-600 text-xs py-4">No activity</div>}
          </div>

          {/* Sector */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex flex-col items-center gap-1.5">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">Sector</div>
            {sectorScore ? (
              <>
                <div className="relative flex items-center justify-center">
                  <ScoreRing score={sectorScore.score} size={56} />
                  <span className="absolute text-sm font-black text-white">{sectorScore.score}</span>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold text-center ${
                  sectorScore.stage.includes('Stage 2') ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' :
                  sectorScore.stage.includes('Stage 1') ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40' :
                  'bg-red-500/20 text-red-300 border-red-500/40'
                }`}>
                  {sectorScore.stage.replace('Stage 2A Early Inflection','S2A').replace('Stage 2B Sustained Trend','S2B').replace('Stage 1 Consolidation','S1').replace('Avoid / Weak','Avoid')}
                </span>
                <span className="text-[10px] text-slate-500 text-center line-clamp-1">{sectorDef?.sector_name ?? '—'}</span>
              </>
            ) : <div className="text-slate-600 text-xs py-4">No data</div>}
          </div>
        </div>

        {/* ── Quarterly Earnings Trend ────────────────────────────────────────── */}
        {pead.length > 0 && (() => {
          const quarters = [...pead].reverse(); // oldest first
          const maxRev = Math.max(...quarters.map(p => Math.abs(p.yoy_revenue_pct ?? 0)), 1);
          const maxPat = Math.max(...quarters.map(p => Math.abs(p.yoy_profit_pct ?? 0)), 1);
          return (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-4">
                <BarChart2 className="w-4 h-4 text-violet-400" />
                <h2 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Earnings Trend</h2>
                <span className="text-[10px] text-slate-600">last {quarters.length} quarters · YoY growth %</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Revenue trend */}
                <div>
                  <div className="text-[10px] text-slate-500 mb-2 uppercase tracking-wider">Revenue Growth (YoY)</div>
                  <div className="space-y-1.5">
                    {quarters.map((p, i) => {
                      const v = p.yoy_revenue_pct;
                      const pct = Math.min(100, (Math.abs(v ?? 0) / maxRev) * 100);
                      return (
                        <div key={i} className="flex items-center gap-2">
                          <span className="text-[10px] text-slate-500 w-16 shrink-0">{p.signal_date.slice(0,7)}</span>
                          <div className="flex-1 relative h-4 bg-slate-800 rounded-sm overflow-hidden">
                            <div
                              className={`absolute inset-y-0 ${(v ?? 0) >= 0 ? 'left-0 bg-emerald-500/60' : 'right-0 bg-red-500/60'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className={`text-[10px] font-bold w-12 text-right shrink-0 ${(v ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {v != null ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` : '—'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                {/* PAT trend */}
                <div>
                  <div className="text-[10px] text-slate-500 mb-2 uppercase tracking-wider">Profit Growth (YoY)</div>
                  <div className="space-y-1.5">
                    {quarters.map((p, i) => {
                      const v = p.yoy_profit_pct;
                      const pct = Math.min(100, (Math.abs(v ?? 0) / maxPat) * 100);
                      return (
                        <div key={i} className="flex items-center gap-2">
                          <span className="text-[10px] text-slate-500 w-16 shrink-0">{p.signal_date.slice(0,7)}</span>
                          <div className="flex-1 relative h-4 bg-slate-800 rounded-sm overflow-hidden">
                            <div
                              className={`absolute inset-y-0 ${(v ?? 0) >= 0 ? 'left-0 bg-emerald-500/60' : 'right-0 bg-red-500/60'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className={`text-[10px] font-bold w-12 text-right shrink-0 ${(v ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {v != null ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` : '—'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
              {/* OPM trend */}
              <div className="mt-3 pt-3 border-t border-slate-800">
                <div className="text-[10px] text-slate-500 mb-2 uppercase tracking-wider">Operating Margin Change (bps)</div>
                <div className="flex gap-3 flex-wrap">
                  {quarters.map((p, i) => (
                    <div key={i} className="flex flex-col items-center gap-1 bg-slate-800/60 rounded-lg px-3 py-2 min-w-[72px]">
                      <span className="text-[10px] text-slate-500">{p.signal_date.slice(0,7)}</span>
                      <span className={`text-sm font-bold ${p.opm_expansion_bps >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {p.opm_expansion_bps >= 0 ? '+' : ''}{p.opm_expansion_bps?.toFixed(0) ?? '—'}
                      </span>
                      <span className="text-[9px] text-slate-600">bps</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── Quarterly Fundamentals (8Q Chart) ─────────────────────────────────── */}
        {quarterlyFunda.length >= 2 && (() => {
          const sorted = [...quarterlyFunda].sort((a,b) => parsePeriod(a.period) - parsePeriod(b.period));
          const last8  = sorted.slice(-8);
          const chartData = last8.map(q => ({
            label: periodToFY(q.period),
            rev:   q.revenue_cr,
            pat:   q.pat_cr,
            opm:   q.opm_pct,
          }));
          const maxRev = Math.max(...last8.map(q => q.revenue_cr ?? 0), 1);
          return (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-4">
                <BarChart2 className="w-4 h-4 text-amber-400" />
                <h2 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Quarterly Fundamentals</h2>
                <span className="text-[10px] text-slate-600">last {last8.length} quarters · from Screener.in</span>
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={chartData} margin={{top:4,right:36,left:0,bottom:0}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b"/>
                  <XAxis dataKey="label" stroke="#475569" tick={{fontSize:9}} />
                  <YAxis yAxisId="cr" stroke="#475569" tick={{fontSize:9}}
                    tickFormatter={v => v>=1000?`${(v/1000).toFixed(0)}kCr`:`${v}Cr`} />
                  <YAxis yAxisId="pct" orientation="right" stroke="#f59e0b"
                    tick={{fontSize:9}} tickFormatter={v=>`${v}%`} domain={['auto','auto']} />
                  <Tooltip
                    contentStyle={{backgroundColor:'#0f172a',border:'1px solid #334155',borderRadius:8,fontSize:11}}
                    formatter={(v:number|string,name:string)=>{
                      if(name==='Revenue') return [`₹${v}Cr`,'Revenue'] as [string,string];
                      if(name==='PAT')     return [`₹${v}Cr`,'Net Profit'] as [string,string];
                      if(name==='OPM %')   return [`${v}%`,'OPM'] as [string,string];
                      return [`${v}`,name] as [string,string];
                    }}
                  />
                  <Legend wrapperStyle={{fontSize:10}}/>
                  <Bar yAxisId="cr" dataKey="rev" name="Revenue" radius={[3,3,0,0]} maxBarSize={28}>
                    {chartData.map((_,i) => <Cell key={i} fill="#3b82f6" fillOpacity={0.75}/>)}
                  </Bar>
                  <Bar yAxisId="cr" dataKey="pat" name="PAT" radius={[3,3,0,0]} maxBarSize={28}>
                    {chartData.map((d,i) => <Cell key={i} fill={(d.pat??0)>0?'#10b981':'#ef4444'} fillOpacity={0.9}/>)}
                  </Bar>
                  <Line yAxisId="pct" type="monotone" dataKey="opm" name="OPM %" stroke="#f59e0b"
                    strokeWidth={2} dot={{r:3,fill:'#f59e0b'}} connectNulls/>
                </ComposedChart>
              </ResponsiveContainer>
              {/* YoY growth table for last 4 quarters */}
              {last8.length >= 5 && (
                <div className="mt-3 pt-3 border-t border-slate-800 overflow-x-auto">
                  <div className="text-[10px] text-slate-500 mb-2 uppercase tracking-wider">YoY Growth (vs same quarter last year)</div>
                  <div className="grid grid-cols-4 gap-2">
                    {last8.slice(-4).map((q, i) => {
                      const idx = last8.indexOf(q);
                      const yoy = idx >= 4 ? last8[idx - 4] : null;
                      const revG = yoy?.revenue_cr && q.revenue_cr ? ((q.revenue_cr - yoy.revenue_cr) / Math.abs(yoy.revenue_cr) * 100) : null;
                      const patG = yoy?.pat_cr && q.pat_cr ? ((q.pat_cr - yoy.pat_cr) / Math.abs(yoy.pat_cr) * 100) : null;
                      const opmD = yoy?.opm_pct != null && q.opm_pct != null ? (q.opm_pct - yoy.opm_pct) : null;
                      return (
                        <div key={i} className="bg-slate-800/60 rounded-lg p-2.5">
                          <div className="text-[10px] text-slate-400 font-semibold mb-1.5">{periodToFY(q.period)}</div>
                          <div className="space-y-1 text-[10px]">
                            <div className="flex justify-between">
                              <span className="text-slate-500">Rev</span>
                              <span className={revG!=null?(revG>=0?'text-emerald-400':'text-red-400'):'text-slate-600'}>
                                {revG!=null?`${revG>=0?'+':''}${revG.toFixed(0)}%`:'—'}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-500">PAT</span>
                              <span className={patG!=null?(patG>=0?'text-emerald-400':'text-red-400'):'text-slate-600'}>
                                {patG!=null?`${patG>=0?'+':''}${patG.toFixed(0)}%`:'—'}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-500">OPM</span>
                              <span className={opmD!=null?(opmD>=0?'text-amber-400':'text-red-400'):'text-slate-600'}>
                                {opmD!=null?`${opmD>=0?'+':''}${opmD.toFixed(1)}pp`:'—'}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* ── Sell Triggers ──────────────────────────────────────────────────────── */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
            <div className="flex items-center gap-2 flex-wrap">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <h2 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Sell Triggers</h2>
              <div className="flex gap-1.5 ml-1">
                {critCount   > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-300">{critCount} critical</span>}
                {warnCount   > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300">{warnCount} warning</span>}
                {monitorCount > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-700 text-slate-400">{monitorCount} monitor</span>}
                {bullishCount > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">{bullishCount} bullish</span>}
              </div>
            </div>
            {monitorCount > 0 && (
              <button onClick={() => setShowMonitor(s => !s)}
                className="text-[10px] text-slate-500 hover:text-slate-300 flex items-center gap-1 shrink-0">
                {showMonitor ? 'Hide monitor' : 'Show all'}
                {showMonitor ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            )}
          </div>
          <div className="p-3 space-y-2">
            {visible.length === 0 ? (
              <div className="text-center py-5 text-slate-600 text-xs">
                {critCount + warnCount === 0 && bullishCount === 0
                  ? '✓ No active sell triggers — thesis intact'
                  : 'No critical/warning signals. Click "Show all" for monitor signals.'}
              </div>
            ) : visible.map((tr, i) => {
              const cfg = TRIGGER_CFG[tr.severity];
              return (
                <div key={i} className={`border rounded-lg px-3 py-2.5 ${cfg.bg}`}>
                  <div className="flex items-start gap-2.5">
                    <span className="text-sm mt-0.5 shrink-0">{cfg.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${cfg.badge}`}>{tr.severity}</span>
                        <span className="text-[10px] text-slate-500 uppercase tracking-wide">{tr.category}</span>
                        <span className="text-xs font-semibold text-slate-200">{tr.signal}</span>
                      </div>
                      <p className="text-xs text-slate-400 leading-relaxed">{tr.detail}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Position + Valuation ──────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Your Position</h2>
            <div className="space-y-2.5">
              {[
                { l: 'Shares held',   v: (co.quantity ?? 0).toLocaleString('en-IN'), c: 'text-white' },
                { l: 'Avg buy price', v: `₹${(co.avg_price ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`, c: 'text-slate-300' },
                { l: 'Invested',      v: fmtCr(co.invested),   c: 'text-slate-300' },
                { l: 'Current value', v: fmtCr((co.quantity ?? 0) * livePrice || co.current_value), c: 'text-white font-bold' },
              ].map(r => (
                <div key={r.l} className="flex justify-between">
                  <span className="text-sm text-slate-500">{r.l}</span>
                  <span className={`text-sm ${r.c}`}>{r.v}</span>
                </div>
              ))}
              <div className="border-t border-slate-800 pt-2.5">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-500">Unrealized P&L</span>
                  <div className="text-right">
                    <div className={`text-sm font-black ${(co.unrealized_pl ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {(co.unrealized_pl ?? 0) >= 0 ? '+' : ''}{fmtCr(co.unrealized_pl)}
                    </div>
                    <div className={`text-xs ${(co.unrealized_pl_pct ?? 0) >= 0 ? 'text-emerald-500' : 'text-red-400'}`}>
                      {fmtPct(co.unrealized_pl_pct)} absolute
                    </div>
                  </div>
                </div>
              </div>
              {dbHolding?.realizedPnl != null && dbHolding.realizedPnl !== 0 && (
                <div className="flex justify-between">
                  <span className="text-sm text-slate-500">Realized P&L</span>
                  <span className={`text-sm font-semibold ${dbHolding.realizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {dbHolding.realizedPnl >= 0 ? '+' : ''}{fmtCr(dbHolding.realizedPnl)}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-sm text-slate-500">Portfolio weight</span>
                <span className="text-sm text-white">{(co.portfolio_weight_pct ?? 0).toFixed(2)}%</span>
              </div>
              {dbHolding?.irr != null && (
                <div className="flex justify-between">
                  <span className="text-sm text-slate-500">IRR (annualised)</span>
                  <span className={`text-sm font-bold ${dbHolding.irr >= 25 ? 'text-emerald-300' : dbHolding.irr >= 15 ? 'text-emerald-400' : dbHolding.irr >= 0 ? 'text-yellow-400' : 'text-red-400'}`}>
                    {dbHolding.irr >= 0 ? '+' : ''}{dbHolding.irr.toFixed(1)}%
                  </span>
                </div>
              )}
              {dbHolding?.duration != null && (
                <div className="flex justify-between">
                  <span className="text-sm text-slate-500">Holding period</span>
                  <span className="text-sm text-slate-300">{dbHolding.duration.toFixed(1)} yrs</span>
                </div>
              )}
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Valuation &amp; Quality</h2>
            <div className="grid grid-cols-2 gap-2">
              {quote?.market_cap != null && quote.market_cap > 0 && (
                <MetricBox label="Market Cap" value={
                  quote.market_cap >= 1e12 ? `₹${(quote.market_cap/1e12).toFixed(1)}T` :
                  quote.market_cap >= 1e9  ? `₹${(quote.market_cap/1e9).toFixed(0)}B` :
                  `₹${(quote.market_cap/1e7).toFixed(0)}Cr`
                } />
              )}
              <MetricBox label="P/E (TTM)"
                value={pe ? `${pe.toFixed(1)}x` : '—'}
                color={pe && pe < 15 ? 'text-emerald-400' : pe && pe < 35 ? 'text-yellow-400' : pe ? 'text-red-400' : 'text-slate-500'}
              />
              {medPE != null && (
                <MetricBox label="5yr Median PE" value={`${medPE.toFixed(1)}x`}
                  color={pe && medPE ? (pe/medPE > 1.5 ? 'text-red-400' : pe/medPE > 1.2 ? 'text-amber-400' : 'text-emerald-400') : 'text-slate-300'}
                />
              )}
              <MetricBox label="P/E (Fwd)"   value={quote?.pe_forward ? `${quote.pe_forward.toFixed(1)}x` : '—'} />
              <MetricBox label="P/B"          value={quote?.pb ? `${quote.pb.toFixed(2)}x` : '—'} />
              <MetricBox label="EPS (TTM)"    value={quote?.eps_ttm ? `₹${quote.eps_ttm.toFixed(2)}` : '—'} />
              <MetricBox label="Div Yield"    value={quote?.dividend_yield ? `${quote.dividend_yield.toFixed(2)}%` : '—'} color="text-blue-400" />
              <MetricBox label="Beta"         value={quote?.beta ? quote.beta.toFixed(2) : '—'} />
              <MetricBox label="ROE"
                value={quote?.roe ? `${(quote.roe*100).toFixed(1)}%` : '—'}
                color={quote?.roe != null ? (quote.roe > 0.18 ? 'text-emerald-400' : quote.roe > 0.10 ? 'text-yellow-400' : 'text-red-400') : undefined}
              />
              <MetricBox label="Op Margin"    value={quote?.operating_margin ? `${(quote.operating_margin*100).toFixed(1)}%` : '—'} />
              <MetricBox label="Net Margin"   value={quote?.profit_margin ? `${(quote.profit_margin*100).toFixed(1)}%` : '—'} />
              <MetricBox label="D/E Ratio"
                value={quote?.debt_to_equity ? `${(quote.debt_to_equity/100).toFixed(2)}x` : '—'}
                color={quote?.debt_to_equity != null ? (quote.debt_to_equity < 50 ? 'text-emerald-400' : quote.debt_to_equity < 150 ? 'text-yellow-400' : 'text-red-400') : undefined}
              />
              {quote?.free_cash_flow != null && (
                <MetricBox label="Free Cash Flow" value={fmtCr(quote.free_cash_flow)} />
              )}
            </div>
            {pe && medPE && medPE > 0 && (() => {
              const max = Math.max(pe, medPE) * 1.6;
              const medPct = Math.min(95, (medPE / max) * 100);
              const curPct = Math.min(95, (pe   / max) * 100);
              const ratio  = pe / medPE;
              return (
                <div className="mt-3 pt-3 border-t border-slate-800">
                  <div className="text-[10px] text-slate-500 mb-2">PE vs 5-Year Median</div>
                  <div className="relative h-2 bg-slate-700 rounded-full">
                    <div className="absolute top-1/2 -translate-y-1/2 h-4 w-0.5 bg-emerald-500/60 rounded-full" style={{ left: `${medPct}%` }} />
                    <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white border-2 border-amber-400 rounded-full shadow" style={{ left: `calc(${curPct}% - 6px)` }} />
                  </div>
                  <div className={`text-[10px] mt-1.5 font-semibold ${ratio > 1.5 ? 'text-red-400' : ratio > 1.2 ? 'text-amber-400' : 'text-emerald-400'}`}>
                    Current {pe.toFixed(0)}x · Median {medPE.toFixed(0)}x · {pe > medPE ? '+' : ''}{((ratio-1)*100).toFixed(0)}% vs history
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        {/* ── Technical: Stage 2 ────────────────────────────────────────────────── */}
        {stage2 && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-blue-400" />
                <h2 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Technical Analysis</h2>
              </div>
              <span className="text-[10px] text-slate-500">{stage2.signal_date}</span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
              <div className="bg-slate-800/60 rounded-lg p-3 text-center">
                <div className={`text-2xl font-black ${stage2.stage2_score >= 80 ? 'text-emerald-400' : stage2.stage2_score >= 65 ? 'text-blue-400' : stage2.stage2_score >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                  {stage2.stage2_score}
                </div>
                <div className="text-[9px] text-slate-500 mt-0.5">Score / 100</div>
              </div>
              <div className="bg-slate-800/60 rounded-lg p-3 text-center">
                <div className="text-lg font-bold text-slate-200">{stage2.days_in_stage2}d</div>
                <div className="text-[9px] text-slate-500">Days in Stage</div>
                <div className={`text-[10px] mt-0.5 ${stage2.stage2_subtype === 'EARLY STAGE 2' ? 'text-emerald-400' : stage2.stage2_subtype === 'MID STAGE 2' ? 'text-blue-400' : 'text-amber-400'}`}>
                  {stage2.stage2_subtype}
                </div>
              </div>
              <div className="bg-slate-800/60 rounded-lg p-3 text-center">
                <div className={`text-lg font-bold ${stage2.rs_52w_percentile >= 80 ? 'text-emerald-400' : stage2.rs_52w_percentile >= 60 ? 'text-yellow-400' : 'text-red-400'}`}>
                  {stage2.rs_52w_percentile}%
                </div>
                <div className="text-[9px] text-slate-500">RS 52W Rank</div>
                <div className={`text-[10px] mt-0.5 ${stage2.rs_trend === 'Positive' ? 'text-emerald-400' : stage2.rs_trend === 'Negative' ? 'text-red-400' : 'text-slate-400'}`}>
                  {stage2.rs_trend}
                </div>
              </div>
              <div className="bg-slate-800/60 rounded-lg p-3 text-center">
                <div className={`text-lg font-bold ${stage2.score_trend === 'RISING' ? 'text-emerald-400' : stage2.score_trend === 'DECLINING' ? 'text-red-400' : 'text-slate-300'}`}>
                  {stage2.score_trend === 'RISING' ? '↑' : stage2.score_trend === 'DECLINING' ? '↓' : '→'}
                </div>
                <div className="text-[9px] text-slate-500">Score Trend</div>
                {stage2.score_3d_delta != null && (
                  <div className={`text-[10px] mt-0.5 ${stage2.score_3d_delta >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {stage2.score_3d_delta >= 0 ? '+' : ''}{stage2.score_3d_delta.toFixed(0)} pts (3d)
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-2">
              <MetricBox label="EMA150 Distance"
                value={stage2.ema150_distance_pct != null ? `${stage2.ema150_distance_pct >= 0 ? '+' : ''}${stage2.ema150_distance_pct.toFixed(1)}%` : '—'}
                color={(stage2.ema150_distance_pct ?? 0) > 0 ? ((stage2.ema150_distance_pct ?? 0) > 40 ? 'text-amber-400' : 'text-emerald-400') : 'text-red-400'} />
              <MetricBox label="EMA150 Slope"
                value={stage2.ema150_slope != null ? `${stage2.ema150_slope >= 0 ? '+' : ''}${stage2.ema150_slope.toFixed(2)}` : '—'}
                color={(stage2.ema150_slope ?? 0) > 0 ? 'text-emerald-400' : 'text-red-400'} />
              <MetricBox label="SMA200 Slope"
                value={stage2.sma200_slope != null ? `${stage2.sma200_slope >= 0 ? '+' : ''}${stage2.sma200_slope.toFixed(2)}` : '—'}
                color={(stage2.sma200_slope ?? 0) > 0 ? 'text-emerald-400' : 'text-red-400'} />
              <MetricBox label="VCP Score"
                value={stage2.vcp_score != null ? `${stage2.vcp_score}/10` : '—'}
                color={(stage2.vcp_score ?? 0) >= 7 ? 'text-emerald-400' : (stage2.vcp_score ?? 0) >= 4 ? 'text-yellow-400' : 'text-slate-400'} />
              <MetricBox label="Pivot Proximity"
                value={stage2.pivot_proximity_pct != null ? `${stage2.pivot_proximity_pct >= 0 ? '+' : ''}${stage2.pivot_proximity_pct.toFixed(1)}%` : '—'}
                color={Math.abs(stage2.pivot_proximity_pct ?? 0) <= 3 ? 'text-emerald-400' : (stage2.pivot_proximity_pct ?? 0) < -10 ? 'text-slate-500' : 'text-yellow-400'} />
              <MetricBox label="20d H-L Depth"
                value={stage2.hl_depth_20d != null ? `${stage2.hl_depth_20d.toFixed(1)}%` : '—'}
                color={(stage2.hl_depth_20d ?? 0) <= 5 ? 'text-emerald-400' : (stage2.hl_depth_20d ?? 0) <= 10 ? 'text-yellow-400' : 'text-red-400'} />
              <MetricBox label="Vol 5d/50d"
                value={stage2.vol_5d_vs_50d_ratio != null ? `${stage2.vol_5d_vs_50d_ratio.toFixed(2)}x` : '—'}
                color={(stage2.vol_5d_vs_50d_ratio ?? 1) < 0.7 ? 'text-emerald-400' : (stage2.vol_5d_vs_50d_ratio ?? 1) > 2 ? 'text-red-400' : 'text-slate-300'} />
              <MetricBox label="Base Count"
                value={stage2.base_count != null ? `#${stage2.base_count}` : '—'}
                color={stage2.base_count === 1 ? 'text-emerald-400' : stage2.base_count === 2 ? 'text-yellow-400' : 'text-amber-500'} />
              <MetricBox label="EPS Accel"
                value={(stage2.eps_acceleration_quarters ?? 0) > 0 ? `${stage2.eps_acceleration_quarters}Q ↑` : '—'}
                color={(stage2.eps_acceleration_quarters ?? 0) > 0 ? 'text-emerald-400' : 'text-slate-500'} />
            </div>

            <div className="grid grid-cols-4 gap-2">
              {[
                { l: 'Above 200 SMA',   v: stage2.above_200sma },
                { l: 'Above 50 SMA',    v: stage2.above_50sma },
                { l: '50SMA > EMA150',  v: stage2.sma50_above_ema150 },
                { l: 'PEAD Confluence', v: stage2.is_pead_confluence },
              ].map(c => (
                <div key={c.l} className={`rounded-lg px-2 py-2 text-center text-[10px] font-semibold border ${c.v ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-slate-800 border-slate-700 text-slate-600'}`}>
                  {c.v ? '✓' : '✗'} {c.l}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Earnings Quality: PEAD History ───────────────────────────────────── */}
        {pead.length > 0 && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-4">
              <BarChart2 className="w-4 h-4 text-indigo-400" />
              <h2 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Earnings Quality</h2>
              <span className="text-[10px] text-slate-600">last {pead.length} result{pead.length > 1 ? 's' : ''}</span>
            </div>
            <div className="space-y-3">
              {pead.map((p, i) => (
                <div key={i} className={`border rounded-xl p-3 ${
                  p.trigger_path === 'ACT'   ? 'border-emerald-500/30 bg-emerald-500/5' :
                  p.trigger_path === 'WATCH' ? 'border-yellow-500/25 bg-yellow-500/4' :
                  'border-slate-700/50 bg-slate-800/20'
                }`}>
                  <div className="flex items-center justify-between mb-2.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${PEAD_CFG[p.trigger_path] ?? PEAD_CFG.NONE}`}>{p.trigger_path}</span>
                      <span className="text-xs text-slate-400">{p.signal_date}</span>
                      {p.is_hidden_catalyst && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/40">Hidden Catalyst</span>
                      )}
                    </div>
                    <div className="relative w-9 h-9 flex items-center justify-center">
                      <ScoreRing score={p.pead_score} size={36} />
                      <span className="absolute text-[10px] font-black text-white">{p.pead_score}</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-x-3 gap-y-2">
                    {[
                      { l: 'Profit YoY',   v: fmtPct(p.yoy_profit_pct, 1),      pos: p.yoy_profit_pct >= 0 },
                      { l: 'Revenue YoY',  v: fmtPct(p.yoy_revenue_pct, 1),     pos: p.yoy_revenue_pct >= 0 },
                      { l: 'OPM (bps)',    v: `${(p.opm_expansion_bps ?? 0) >= 0 ? '+' : ''}${p.opm_expansion_bps?.toFixed(0) ?? '—'}`, pos: (p.opm_expansion_bps ?? 0) >= 0 },
                      { l: 'Profit QoQ',  v: fmtPct(p.qoq_profit_pct, 1),      pos: p.qoq_profit_pct >= 0 },
                      { l: 'Day Gap',     v: fmtPct(p.day_gap_pct, 1),          pos: p.day_gap_pct >= 0 },
                      { l: 'Vol Mult',    v: `${p.volume_multiplier?.toFixed(1)}x`, pos: (p.volume_multiplier ?? 0) >= 2 },
                      { l: 'Delivery %',  v: `${p.delivery_pct?.toFixed(0)}%`,  pos: (p.delivery_pct ?? 0) >= 50 },
                      { l: 'vs EMA200',   v: fmtPct(p.price_vs_ema200_pct, 1), pos: p.price_vs_ema200_pct >= 0 },
                    ].map(m => (
                      <div key={m.l}>
                        <div className="text-[10px] text-slate-500">{m.l}</div>
                        <div className={`text-xs font-bold ${m.pos ? 'text-emerald-400' : 'text-red-400'}`}>{m.v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Insider Activity ──────────────────────────────────────────────────── */}
        {insiders.length > 0 && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-purple-400" />
                <h2 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Insider Activity</h2>
              </div>
              {(() => {
                const bv = insiders.filter(i=>i.transaction_type==='BUY').reduce((s,i)=>s+i.trade_value_in_cr,0);
                const sv = insiders.filter(i=>i.transaction_type==='SELL').reduce((s,i)=>s+i.trade_value_in_cr,0);
                return (
                  <div className="flex items-center gap-3 text-xs">
                    {bv > 0 && <span className="text-emerald-400">↑ ₹{bv.toFixed(0)}Cr bought</span>}
                    {sv > 0 && <span className="text-red-400">↓ ₹{sv.toFixed(0)}Cr sold</span>}
                  </div>
                );
              })()}
            </div>
            <div className="space-y-2">
              {insiders.map((ins, i) => {
                const isBuy = ins.transaction_type === 'BUY';
                return (
                  <div key={i} className={`flex items-start gap-3 rounded-lg px-3 py-2.5 border ${isBuy ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-red-500/20 bg-red-500/5'}`}>
                    <div className={`text-base font-black shrink-0 mt-0.5 ${isBuy ? 'text-emerald-400' : 'text-red-400'}`}>{isBuy ? '↑' : '↓'}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <span className="text-xs font-semibold text-slate-200">{ins.acquirer_name || 'Insider'}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-bold ${
                          ins.tier === 'HIGH CONVICTION' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' :
                          ins.tier === 'NOTABLE'         ? 'bg-blue-500/20 text-blue-300 border-blue-500/40' :
                          'bg-slate-600/20 text-slate-500 border-slate-600/40'
                        }`}>{ins.tier}</span>
                        {ins.cluster_trade_flag && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">Cluster</span>}
                        {ins.person_category && <span className="text-[10px] text-slate-500">{ins.person_category}</span>}
                      </div>
                      <div className="flex items-center gap-3 flex-wrap text-xs">
                        <span className="text-slate-400">₹{ins.trade_value_in_cr.toFixed(1)}Cr</span>
                        <span className="text-slate-500">{ins.equity_pct_traded.toFixed(3)}% equity</span>
                        <span className="text-slate-600">{ins.signal_date}</span>
                        {ins.actual_return_3m != null && (
                          <span className={ins.actual_return_3m >= 0 ? 'text-emerald-500' : 'text-red-500'}>
                            3m: {fmtPct(ins.actual_return_3m)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[10px] text-slate-500">Score</div>
                      <div className={`text-sm font-bold ${ins.insider_score >= 75 ? 'text-emerald-400' : ins.insider_score >= 50 ? 'text-yellow-400' : 'text-slate-500'}`}>
                        {ins.insider_score}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Sector Context ────────────────────────────────────────────────────── */}
        {sectorScore && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Target className="w-4 h-4 text-cyan-400" />
              <h2 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Sector Context</h2>
            </div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-sm font-bold text-slate-200">{sectorDef?.sector_name ?? '—'}</div>
                <div className={`text-xs mt-0.5 font-semibold ${
                  sectorScore.stage.includes('Stage 2') ? 'text-emerald-400' :
                  sectorScore.stage.includes('Stage 1') ? 'text-yellow-400' : 'text-red-400'
                }`}>{sectorScore.stage}</div>
              </div>
              <div className="relative flex items-center justify-center">
                <ScoreRing score={sectorScore.score} size={56} />
                <span className="absolute text-sm font-black text-white">{sectorScore.score}</span>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <MetricBox label="RS Score" value={`${parseFloat(sectorScore.rs_score ?? '0').toFixed(1)}%`}
                color={parseFloat(sectorScore.rs_score ?? '0') >= 0 ? 'text-emerald-400' : 'text-red-400'} />
              <MetricBox label="Breadth" value={`${parseFloat(sectorScore.breadth_pct ?? '0').toFixed(0)}%`}
                color={parseFloat(sectorScore.breadth_pct ?? '0') >= 70 ? 'text-emerald-400' : parseFloat(sectorScore.breadth_pct ?? '0') >= 50 ? 'text-yellow-400' : 'text-red-400'} />
              <MetricBox label="From 52W High" value={`${parseFloat(sectorScore.distance_52w_high ?? '0').toFixed(1)}%`}
                color={parseFloat(sectorScore.distance_52w_high ?? '0') >= -10 ? 'text-emerald-400' : parseFloat(sectorScore.distance_52w_high ?? '0') >= -25 ? 'text-yellow-400' : 'text-red-400'} />
            </div>
          </div>
        )}

        {/* ── 52-Week Range ─────────────────────────────────────────────────────── */}
        {w52High != null && w52Low != null && livePrice > 0 && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">52-Week Range</h2>
            <div className="mt-1">
              <div className="relative h-2 bg-slate-700 rounded-full">
                <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-red-500 to-emerald-500" style={{ width: '100%' }} />
                {(() => {
                  const pct = w52High > w52Low ? Math.max(0, Math.min(100, ((livePrice - w52Low) / (w52High - w52Low)) * 100)) : 50;
                  return <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white border-2 border-indigo-400 rounded-full shadow" style={{ left: `calc(${pct}% - 6px)` }} />;
                })()}
              </div>
              <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                <span>52W Low ₹{w52Low.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                <span className="text-indigo-400 font-semibold">₹{livePrice.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                <span>52W High ₹{w52High.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3 text-xs">
              <div className="bg-slate-800 rounded-lg p-2.5">
                <div className="text-slate-500 mb-0.5">↓ from 52W High</div>
                <div className={`font-bold ${(pctFrom52High ?? -99) > -5 ? 'text-emerald-400' : (pctFrom52High ?? -99) > -15 ? 'text-yellow-400' : 'text-red-400'}`}>
                  {pctFrom52High != null ? `${pctFrom52High >= 0 ? '+' : ''}${pctFrom52High.toFixed(1)}%` : '—'}
                </div>
              </div>
              <div className="bg-slate-800 rounded-lg p-2.5">
                <div className="text-slate-500 mb-0.5">↑ from 52W Low</div>
                <div className={`font-bold ${(pctFrom52Low ?? 0) > 50 ? 'text-emerald-300' : 'text-emerald-400'}`}>
                  {pctFrom52Low != null ? `+${pctFrom52Low.toFixed(1)}%` : '—'}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Research Thesis ───────────────────────────────────────────────────── */}
        {co.wiki_analysis?.content_preview && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-800/40 transition-colors"
              onClick={() => setThesisExpanded(s => !s)}
            >
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-violet-400" />
                <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Research Thesis</span>
                {co.wiki_analysis.wiki_file && (
                  <span className="text-[10px] text-slate-600 font-normal normal-case">{co.wiki_analysis.wiki_file}</span>
                )}
              </div>
              {thesisExpanded
                ? <ChevronUp className="w-4 h-4 text-slate-500" />
                : <ChevronDown className="w-4 h-4 text-slate-500" />}
            </button>
            {!thesisExpanded && (
              <div className="px-4 pb-3">
                <p className="text-xs text-slate-600 leading-relaxed">
                  {co.wiki_analysis.content_preview.replace(/^\s*\d+\|\s*/gm, '').replace(/^#+\s*/gm, '').slice(0, 220)}…
                </p>
              </div>
            )}
            {thesisExpanded && (
              <div className="border-t border-slate-800 px-4 pt-3 pb-5 max-h-[640px] overflow-y-auto">
                <ThesisBlock content={co.wiki_analysis.content_preview} />
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

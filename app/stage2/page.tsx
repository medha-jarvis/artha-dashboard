'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, RefreshCw, AlertCircle, ChevronUp, ChevronDown, Layers, ExternalLink, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { InfoTooltip } from '../components/InfoTooltip';

const sb = (path: string) =>
  fetch(`/api/sb/${path}`, { cache: 'no-store' }).then(r => r.json());

interface Signal {
  id: string;
  ticker: string;
  company_name: string | null;
  sector: string | null;
  signal_date: string;
  entry_date: string | null;
  stage2_score: number;
  days_in_stage2: number | null;
  ema150_distance_pct: number | null;
  ema150_slope: number | null;
  above_200sma: boolean | null;
  above_50sma: boolean | null;
  base_20d_distance_pct: number | null;
  volume_multiplier: number | null;
  rs_trend: string | null;
  rs_63d_score: number | null;
  rs_52w_percentile: number | null;
  vcp_score: number | null;
  vcp_volume_ratio: number | null;
  vcp_adr_ratio: number | null;
  ttm_eps_growth: number | null;
  roce: number | null;
  eps_is_accelerating: boolean | null;
  eps_acceleration_quarters: number | null;
  tier: string;
  lifecycle_state: string | null;
  score_3d_delta: number | null;
  score_trend: string | null;
  is_pead_confluence: boolean;
  is_smart_money_divergence: boolean;
  is_reentry: boolean | null;
  returns_since_breakout?: number | null;
  daily_return?: number | null;
  t_5_return?: number | null;
  t_20_return?: number | null;
}

type SortKey =
  | 'ticker' | 'stage2_score' | 'days_in_stage2' | 'ema150_distance_pct'
  | 'base_20d_distance_pct' | 'volume_multiplier' | 'vcp_score'
  | 'rs_trend' | 'rs_52w_percentile' | 'ttm_eps_growth'
  | 'signal_date' | 'returns_since_breakout' | 'daily_return' | 'score_3d_delta';

type SortDir    = 'asc' | 'desc';
type FilterMode = 'all' | 'high_conviction' | 'emerging' | 'pead_confluence' | 'fresh' | 'strengthening';
type DateRange  = 'week' | 'month' | 'quarter';

const fmtPct = (v: number | null | undefined, dec = 1) =>
  v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(dec)}%`;

const fmtDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—';

const retCls = (v: number | null | undefined) =>
  v == null ? 'text-slate-500' :
  v >  15   ? 'text-emerald-300 font-bold' :
  v >   0   ? 'text-emerald-400' :
  v > -10   ? 'text-red-400' : 'text-red-500 font-bold';

const rsValue = (rs: string | null): number =>
  rs === 'Positive' ? 2 : rs === 'Flat' ? 1 : 0;

function LifecyclePill({ state }: { state: string | null }) {
  const s = state || 'WATCHING';
  const cfg: Record<string, string> = {
    SUSTAINED: 'bg-cyan-900/50 text-cyan-400 border-cyan-700/50',
    CONFIRMED: 'bg-emerald-900/50 text-emerald-400 border-emerald-700/50',
    EMERGING:  'bg-amber-900/50 text-amber-400 border-amber-700/50',
    WEAKENING: 'bg-orange-900/50 text-orange-400 border-orange-700/50',
    WATCHING:  'bg-slate-800 text-slate-400 border-slate-700',
    EXITED:    'bg-red-900/50 text-red-400 border-red-700/50',
  };
  return (
    <span className={`inline-block text-[9px] font-bold px-1.5 py-0.5 rounded border ${cfg[s] || cfg.WATCHING}`}>
      {s}
    </span>
  );
}

function ScoreDelta({ delta, trend }: { delta: number | null; trend: string | null }) {
  if (delta == null) return <span className="text-slate-600 text-[10px]">—</span>;
  const abs = Math.abs(delta);
  if (trend === 'STRENGTHENING') return (
    <span className="text-emerald-400 text-[10px] font-bold flex items-center gap-0.5">
      <TrendingUp className="w-3 h-3" />+{abs}
    </span>
  );
  if (trend === 'WEAKENING') return (
    <span className="text-red-400 text-[10px] font-bold flex items-center gap-0.5">
      <TrendingDown className="w-3 h-3" />-{abs}
    </span>
  );
  return <span className="text-slate-500 text-[10px] flex items-center gap-0.5"><Minus className="w-3 h-3" />{abs}</span>;
}

function BaseTightnessCell({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-slate-600">—</span>;
  const abs = Math.abs(pct);
  const sign = pct >= 0 ? '+' : '';
  if (abs <= 3)  return <span className="text-emerald-400 font-bold">{sign}{pct.toFixed(1)}%</span>;
  if (abs <= 8)  return <span className="text-emerald-400 font-medium">{sign}{pct.toFixed(1)}%</span>;
  if (abs <= 15) return <span className="text-amber-400">{sign}{pct.toFixed(1)}%</span>;
  return               <span className="text-slate-400">{sign}{pct.toFixed(1)}%</span>;
}

function VCPCell({ score, volR, adrR }: { score: number | null; volR: number | null; adrR: number | null }) {
  if (score == null) return <span className="text-slate-600">—</span>;
  const cls = score >= 8 ? 'text-emerald-400 font-bold' : score >= 5 ? 'text-amber-400' : 'text-slate-500';
  return (
    <div>
      <span className={`text-sm ${cls}`}>{score}/10</span>
      {(volR != null || adrR != null) && (
        <div className="text-[9px] text-slate-600 mt-0.5">
          {volR != null && `Vol ${volR.toFixed(2)}x`}{adrR != null && ` Rng ${adrR.toFixed(2)}x`}
        </div>
      )}
    </div>
  );
}

function MAsCell({ above200, above50, slope }: { above200: boolean | null; above50: boolean | null; slope: number | null }) {
  const dot = (on: boolean | null, label: string) => (
    <span key={label} title={label}
      className={`w-2 h-2 rounded-full inline-block ${on ? 'bg-emerald-400' : 'bg-red-400/60'}`} />
  );
  return (
    <div className="flex items-center gap-1">
      {dot(above200, '200d SMA aligned')}
      {dot(above50, '50d SMA aligned')}
      {dot((slope ?? 0) > 0, 'EMA150 slope positive')}
    </div>
  );
}

function RSCell({ rs, pct63 }: { rs: string | null; pct63: number | null }) {
  const cls = rs === 'Positive' ? 'text-emerald-400' : rs === 'Negative' ? 'text-red-400' : 'text-slate-400';
  const label = rs === 'Positive' ? 'Outperforming' : rs === 'Negative' ? 'Underperforming' : 'Neutral';
  return (
    <div>
      <div className={`text-xs font-medium ${cls}`}>{label}</div>
      {pct63 != null && (
        <div className="text-[9px] text-slate-600 mt-0.5">
          63d: {pct63 >= 0 ? '+' : ''}{pct63.toFixed(1)}%
        </div>
      )}
    </div>
  );
}

function FundamentalsCell({ eps, roce, accel }: { eps: number | null; roce: number | null; accel: boolean | null }) {
  if (!eps && !roce) return <span className="text-slate-600">—</span>;
  return (
    <div className="text-xs space-y-0.5">
      {eps != null && (
        <div className={`font-medium ${eps > 20 ? 'text-emerald-400' : eps > 0 ? 'text-emerald-300' : 'text-red-400'}`}>
          EPS {eps >= 0 ? '+' : ''}{eps.toFixed(1)}%{accel ? ' ↑↑' : ''}
        </div>
      )}
      {roce != null && (
        <div className={roce > 15 ? 'text-emerald-400' : roce > 10 ? 'text-amber-400' : 'text-slate-400'}>
          {roce.toFixed(1)}% ROCE
        </div>
      )}
    </div>
  );
}

const TIPS: Record<string, { title: string; content: string }> = {
  ticker: {
    title: 'Stock Name',
    content: 'NSE ticker and company name. Click the ticker to open the StockScans chart page for this stock. PEAD+S2 = earnings catalyst plus Stage 2 breakout (strongest signal). DIVERGENCE = smart money buying despite weak earnings. RE-ENTRY = stock exited Stage 2 and came back in (bullish on short gaps).',
  },
  lifecycle_state: {
    title: 'Stage Lifecycle State',
    content: 'Current status in the Stage 2 lifecycle. CONFIRMED = score 75+, all conditions met, active buy zone. SUSTAINED = CONFIRMED for 30+ consecutive days, proven multi-week leader. EMERGING = 55-74, building momentum, add to watchlist. WEAKENING = score dropped 15+ points in 5 days OR price crossed below 50-day moving average, tighten stops. WATCHING = 40-54, early signals, not ready yet.',
  },
  stage2_score: {
    title: 'Stage 2 Score (0-100)',
    content: 'Overall breakout quality score using Minervini SEPA 7-dimension formula. (1) Trend alignment: all moving averages pointing up (25 pts). (2) 63-day RS vs Nifty 500 (12 pts). (3) 52-week RS percentile rank among all Nifty 500 stocks (8 pts). (4) Breakout freshness: how recent is the entry (15 pts). (5) Base tightness from 20-day SMA (10 pts). (6) VCP pre-breakout contraction (10 pts). (7) Breakout volume (8 pts). Plus fundamental quality EPS and ROCE (12 pts). Score 75+ = CONFIRMED. 55-74 = EMERGING.',
  },
  score_3d_delta: {
    title: 'Score Change Over 3 Days',
    content: 'How the Stage 2 score changed vs 3 trading days ago. UP arrow = STRENGTHENING (rose 8+ pts): setup improving, signals aligning, consider entering. DOWN arrow = WEAKENING (dropped 8+ pts): signals deteriorating, trim or tighten stop-loss. Flat arrow = stable trend.',
  },
  days_in_stage2: {
    title: 'Days in Stage 2 (Freshness)',
    content: 'Calendar days since this stock entered Stage 2 in its current run. 0-15 days = Golden Window, best risk-reward. 15-45 days = Established, enter on pullbacks. 45+ days = Extended, wait for new tight base.',
  },
  base_20d_distance_pct: {
    title: 'Base Tightness from 20-Day SMA',
    content: 'Distance of current price from its 20-day Simple Moving Average. This measures how tight the current consolidation base is. Within plus or minus 3% = very tight (VCP territory, score 10/10). 3-8% = tight and actionable. 8-15% = slightly extended. Above 15% = running from base, not ideal entry. A stock can be 40% above its 150 EMA but only 3% from its 20-day SMA if it built a high-level base. That is bullish, not bearish.',
  },
  vcp_score: {
    title: 'VCP Setup Quality (0-10)',
    content: 'Volatility Contraction Pattern score measuring pre-breakout base quality. Volume dry-up component (0-5 pts): 5-day average volume before breakout vs 20-day average. Under 0.5x = 5 pts (excellent dry-up). Over 0.8x = 0 pts (sloppy). Price range contraction (0-5 pts): daily range in last 5 days vs prior 15 days. Under 0.5x = 5 pts (coiling tight). Over 0.8x = 0 pts (wide and loose). Score 8-10 = textbook Minervini VCP setup. Under 5 = loose base, higher failure risk.',
  },
  volume_multiplier: {
    title: 'Breakout Volume',
    content: 'Volume on breakout day divided by 50-day average. 3x or more = institutional conviction. 2-3x = strong. 1.5-2x = moderate. Under 1.5x = weak breakout, higher failure rate. Best setups combine high VCP score (tight pre-breakout) with high breakout volume.',
  },
  rs_trend: {
    title: 'Relative Strength (63-day)',
    content: 'Whether this stock is outperforming or underperforming the Nifty 500 over the last 63 trading days (3 months). Outperforming = money is specifically flowing into this stock vs the broader market. Only invest in stocks outperforming their benchmark index. The 63-day percentage shown below is the actual RS return differential.',
  },
  rs_52w_percentile: {
    title: '52-Week RS Percentile Rank',
    content: 'Where this stock ranks by 1-year return among all Nifty 500 stocks. 90th percentile = top 10% of all Nifty 500 stocks over 1 year, a true market leader. 80th+ = strong leadership. 70th+ is the minimum recommended for CONFIRMED signals. Below 70th = not a leader, just a short-term mover.',
  },
  ttm_eps_growth: {
    title: 'Fundamental Quality (EPS and ROCE)',
    content: 'EPS = Earnings Per Share growth year over year. ROCE = Return on Capital Employed. Double up-arrows means EPS has been accelerating for 2 or more consecutive quarters, a Minervini hallmark for potential multi-baggers. EPS above 20% with ROCE above 15% = strong engine behind the breakout. Stocks with accelerating earnings sustain Stage 2 moves far longer than those breaking out on sentiment alone.',
  },
  signal_date: {
    title: 'Stage 2 Entry Date',
    content: 'The date this stock first qualified for Stage 2 in its current run. Recent entry date combined with low freshness days = fresh opportunity where the move has barely started.',
  },
  returns_since_breakout: {
    title: 'Total Return Since Entry',
    content: 'Percentage gain or loss from the entry date closing price to today. Near 0% = fresh, move not started yet. Already 20-30% = first leg likely done, wait for a new base before adding. Negative = breakout may be failing, watch for close below 150-day EMA as exit signal.',
  },
  daily_return: {
    title: 'Today Price Change',
    content: 'Percentage price change today. Use as context only. Strong green on expanding volume = momentum intact. Reversal from intraday highs on high volume = potential distribution warning.',
  },
};

function Th({ col, label, right, active, dir, onSort, sticky }: {
  col: SortKey; label: string; right?: boolean; active: boolean;
  dir: SortDir; onSort: (c: SortKey) => void; sticky?: boolean;
}) {
  const tip = TIPS[col];
  return (
    <th
      onClick={() => onSort(col)}
      className={[
        'px-2 py-3 text-[10px] font-semibold uppercase tracking-wider cursor-pointer select-none whitespace-nowrap bg-[#161b22]',
        right ? 'text-right' : 'text-left',
        active ? 'text-white' : 'text-slate-500 hover:text-slate-300',
        sticky ? 'sticky left-0 z-30' : '',
      ].join(' ')}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        {active
          ? (dir === 'desc' ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />)
          : <ChevronUp className="w-3 h-3 opacity-20" />}
        {tip && <InfoTooltip title={tip.title} content={tip.content} />}
      </span>
    </th>
  );
}

function ThStatic({ label, tipKey, right }: { label: string; tipKey?: string; right?: boolean }) {
  const tip = tipKey ? TIPS[tipKey] : null;
  return (
    <th className={`px-2 py-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500 bg-[#161b22] whitespace-nowrap ${right ? 'text-right' : ''}`}>
      <span className="inline-flex items-center gap-0.5">
        {label}
        {tip && <InfoTooltip title={tip.title} content={tip.content} />}
      </span>
    </th>
  );
}

export default function Stage2Page() {
  const [signals,    setSignals]    = useState<Signal[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [triggering, setTriggering] = useState<string | null>(null);
  const [trigMsg,    setTrigMsg]    = useState('');
  const [sortKey,    setSortKey]    = useState<SortKey>('stage2_score');
  const [sortDir,    setSortDir]    = useState<SortDir>('desc');
  const [filter,     setFilter]     = useState<FilterMode>('all');
  const [dateRange,  setDateRange]  = useState<DateRange>('week');

  const loadData = async () => {
    setLoading(true); setError('');
    try {
      const [rawSigs, rawPerf] = await Promise.all([
        sb('stage2_signals?select=*&order=stage2_score.desc&limit=500'),
        sb('stage2_performance?select=signal_id,returns_since_breakout,daily_return,t_5_return,t_20_return'),
      ]);
      if (!Array.isArray(rawSigs)) throw new Error('Bad response');
      const pm: Record<string, Record<string, unknown>> = {};
      (rawPerf || []).forEach((p: Record<string, unknown>) => {
        if (typeof p.signal_id === 'string') pm[p.signal_id] = p;
      });
      setSignals(rawSigs.map((s: Signal) => ({
        ...s,
        returns_since_breakout: (pm[s.id]?.returns_since_breakout as number) ?? null,
        daily_return:           (pm[s.id]?.daily_return as number) ?? null,
        t_5_return:             (pm[s.id]?.t_5_return as number) ?? null,
        t_20_return:            (pm[s.id]?.t_20_return as number) ?? null,
      })));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const dispatch = async (script: string) => {
    setTriggering(script); setTrigMsg('');
    try {
      const r = await fetch('/api/stage2-trigger', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script }),
      });
      const d = await r.json();
      const label = script === 'stage2_tracker' ? 'Return tracker' :
                    script === 'backfill_stage2' ? 'Backfill (7 days)' : 'Stage 2 scan';
      setTrigMsg(d.ok ? `Dispatched: ${label} (20-30 min)` : `Error: ${d.error}`);
    } catch { setTrigMsg('Network error'); }
    finally { setTriggering(null); }
  };

  // Deduplicate: one row per ticker (latest signal_date wins)
  const deduplicated = useMemo(() => {
    const map = new Map<string, Signal>();
    for (const sig of signals) {
      const existing = map.get(sig.ticker);
      if (!existing || sig.signal_date > existing.signal_date) map.set(sig.ticker, sig);
    }
    return Array.from(map.values());
  }, [signals]);

  // Date filter
  const dateFiltered = useMemo(() => {
    const days = dateRange === 'week' ? 7 : dateRange === 'month' ? 30 : 90;
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
    return deduplicated.filter(s => new Date(s.signal_date) >= cutoff);
  }, [deduplicated, dateRange]);

  // Mode filter
  const modeFiltered = useMemo(() => {
    const daysLive = (s: Signal) =>
      Math.floor((Date.now() - new Date(s.signal_date + 'T00:00:00').getTime()) / 86400000);
    switch (filter) {
      case 'high_conviction': return dateFiltered.filter(s => s.stage2_score >= 75);
      case 'emerging':        return dateFiltered.filter(s => s.stage2_score >= 55 && s.stage2_score < 75);
      case 'pead_confluence': return dateFiltered.filter(s => s.is_pead_confluence);
      case 'fresh':           return dateFiltered.filter(s => daysLive(s) <= 15);
      case 'strengthening':   return dateFiltered.filter(s => s.score_trend === 'STRENGTHENING');
      default:                return dateFiltered;
    }
  }, [dateFiltered, filter]);

  // Sort — all columns supported
  const sorted = useMemo(() => {
    return [...modeFiltered].sort((a, b) => {
      const d = sortDir === 'desc' ? -1 : 1;
      if (sortKey === 'ticker')       return d * a.ticker.localeCompare(b.ticker);
      if (sortKey === 'signal_date')  return d * a.signal_date.localeCompare(b.signal_date);
      if (sortKey === 'rs_trend')     return d * (rsValue(a.rs_trend) - rsValue(b.rs_trend));
      // Freshness sorts by signal_date (newest = 0 days = ascending puts at top)
      if (sortKey === 'days_in_stage2') return d * a.signal_date.localeCompare(b.signal_date) * -1;
      const nf = sortDir === 'desc' ? -Infinity : Infinity;
      const va = (a[sortKey as keyof Signal] as number | null) ?? nf;
      const vb = (b[sortKey as keyof Signal] as number | null) ?? nf;
      return d * (Number(va) - Number(vb));
    });
  }, [modeFiltered, sortKey, sortDir]);

  const onSort = (col: SortKey) => {
    if (sortKey === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(col); setSortDir('desc'); }
  };

  // Stats
  const confirmed     = dateFiltered.filter(s => s.stage2_score >= 75).length;
  const sustained     = dateFiltered.filter(s => s.lifecycle_state === 'SUSTAINED').length;
  const emerging      = dateFiltered.filter(s => s.stage2_score >= 55 && s.stage2_score < 75).length;
  const strengthening = dateFiltered.filter(s => s.score_trend === 'STRENGTHENING').length;
  const pead          = dateFiltered.filter(s => s.is_pead_confluence).length;
  const avgReturn     = (() => {
    const v = dateFiltered.map(s => s.returns_since_breakout).filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  })();

  const stockScansUrl  = (t: string) => `https://www.stockscans.in/charts/NSE:${t.replace(/\.NS$/i, '')}`;
  const tradingViewUrl = (t: string) => `https://in.tradingview.com/symbols/NSE-${t.replace(/\.NS$/i, '')}/`;

  return (
    <div className="min-h-screen bg-[#0d1117] p-3 md:p-5">
      <div className="max-w-[1900px] mx-auto space-y-4">

        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Link href="/" className="text-slate-500 hover:text-slate-300"><ArrowLeft className="w-4 h-4" /></Link>
              <Layers className="w-5 h-5 text-blue-400" />
              <h1 className="text-lg font-black text-white">Early Stage 2 Intelligence Hub</h1>
              <span className="text-[10px] bg-blue-900/50 text-blue-400 border border-blue-700/40 px-1.5 py-0.5 rounded font-bold">v2.1</span>
            </div>
            <p className="text-xs text-slate-500 ml-11">
              Minervini SEPA 7-dimension scoring &middot; VCP + 52W RS + EPS Acceleration &middot; Lifecycle states &middot; Click column to sort &middot; Hover info icon for explanations
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => dispatch('stage2_engine')} disabled={!!triggering}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-semibold disabled:opacity-50 transition">
              <Layers className={`w-3.5 h-3.5 ${triggering === 'stage2_engine' ? 'animate-pulse' : ''}`} />
              Run Scan
            </button>
            <button onClick={() => dispatch('stage2_tracker')} disabled={!!triggering}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded text-xs font-medium disabled:opacity-50 transition">
              <RefreshCw className={`w-3.5 h-3.5 ${triggering === 'stage2_tracker' ? 'animate-spin' : ''}`} />
              Refresh Returns
            </button>
            <button onClick={() => dispatch('backfill_stage2')} disabled={!!triggering}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs disabled:opacity-50 transition">
              Seed 7 Days
            </button>
            <button onClick={loadData} disabled={loading}
              className="p-1.5 bg-slate-900 hover:bg-slate-800 text-slate-400 rounded text-xs disabled:opacity-50 transition">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {trigMsg && (
          <div className={`text-xs px-4 py-2.5 rounded-lg border ${trigMsg.startsWith('Dispatched') ? 'bg-emerald-900/30 border-emerald-700/40 text-emerald-300' : 'bg-red-900/30 border-red-700/40 text-red-300'}`}>
            {trigMsg}
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 bg-red-900/30 border border-red-700/40 rounded-lg p-3 text-red-300 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0" />{error}
          </div>
        )}

        {/* Stats */}
        {deduplicated.length > 0 && (
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
            {[
              { l: 'Confirmed (75+)',   v: confirmed.toString(),     c: 'text-emerald-400' },
              { l: 'Sustained',         v: sustained.toString(),     c: 'text-cyan-400' },
              { l: 'Emerging (55-74)', v: emerging.toString(),      c: 'text-amber-400' },
              { l: 'Strengthening',    v: strengthening.toString(), c: 'text-emerald-300' },
              { l: 'PEAD Confluence',  v: pead.toString(),          c: 'text-violet-400' },
              { l: 'Avg Return',       v: fmtPct(avgReturn),        c: retCls(avgReturn) },
            ].map(s => (
              <div key={s.l} className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-center">
                <div className="text-[10px] text-slate-500 mb-1">{s.l}</div>
                <div className={`text-lg font-black ${s.c}`}>{s.v}</div>
              </div>
            ))}
          </div>
        )}

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-1 gap-1">
            {([['week','This Week'],['month','Last Month'],['quarter','Last Quarter']] as [DateRange,string][]).map(([v,l]) => (
              <button key={v} onClick={() => setDateRange(v)}
                className={`px-3 py-1 text-xs rounded font-medium transition ${dateRange===v?'bg-indigo-600 text-white':'text-slate-400 hover:text-white'}`}>{l}</button>
            ))}
          </div>
          <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-1 gap-1 flex-wrap">
            {([
              ['all',            'All'],
              ['high_conviction','High Conviction'],
              ['emerging',       'Emerging'],
              ['strengthening',  'Strengthening'],
              ['pead_confluence','PEAD Confluence'],
              ['fresh',          'Fresh (under 15d)'],
            ] as [FilterMode,string][]).map(([v,l]) => (
              <button key={v} onClick={() => setFilter(v)}
                className={`px-3 py-1 text-xs rounded font-medium transition whitespace-nowrap ${filter===v?'bg-blue-600 text-white':'text-slate-400 hover:text-white'}`}>{l}</button>
            ))}
          </div>
          <span className="text-slate-600 text-xs">{sorted.length} setups &middot; {deduplicated.length} unique stocks</span>
        </div>

        {/* Table */}
        {loading ? (
          <div className="text-center py-20 text-slate-500 text-sm">Loading&hellip;</div>
        ) : sorted.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-16 text-center">
            <Layers className="w-8 h-8 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400 font-semibold">No Stage 2 setups in this range</p>
            <div className="flex gap-3 justify-center mt-4">
              <button onClick={() => dispatch('backfill_stage2')} disabled={!!triggering}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded text-xs font-medium disabled:opacity-50">Seed 7 Days</button>
              <button onClick={() => dispatch('stage2_engine')} disabled={!!triggering}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-medium disabled:opacity-50">Run Scan</button>
            </div>
          </div>
        ) : (
          <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
            <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: 'min(720px, calc(100vh - 310px))' }}>
              <table className="w-full text-xs border-collapse" style={{ minWidth: '1650px' }}>
                <thead className="sticky top-0 z-20">
                  <tr className="bg-[#161b22] border-b-2 border-slate-700">
                    <Th col="ticker"                  label="Stock"        active={sortKey==='ticker'}                 dir={sortDir} onSort={onSort} sticky />
                    <ThStatic label="State"           tipKey="lifecycle_state" />
                    <Th col="stage2_score"            label="Score"        active={sortKey==='stage2_score'}           dir={sortDir} onSort={onSort} />
                    <Th col="score_3d_delta"          label="3d Delta"     active={sortKey==='score_3d_delta'}         dir={sortDir} onSort={onSort} />
                    <Th col="days_in_stage2"          label="Freshness"    active={sortKey==='days_in_stage2'}         dir={sortDir} onSort={onSort} />
                    <Th col="base_20d_distance_pct"   label="Base (20d)"   active={sortKey==='base_20d_distance_pct'}  dir={sortDir} onSort={onSort} right />
                    <Th col="vcp_score"               label="VCP Setup"    active={sortKey==='vcp_score'}              dir={sortDir} onSort={onSort} />
                    <Th col="volume_multiplier"       label="Brk Vol"      active={sortKey==='volume_multiplier'}      dir={sortDir} onSort={onSort} />
                    <Th col="rs_trend"                label="RS (63d)"     active={sortKey==='rs_trend'}               dir={sortDir} onSort={onSort} />
                    <Th col="rs_52w_percentile"       label="52W %ile"     active={sortKey==='rs_52w_percentile'}      dir={sortDir} onSort={onSort} right />
                    <ThStatic label="MAs" />
                    <Th col="ttm_eps_growth"          label="Fundamentals" active={sortKey==='ttm_eps_growth'}         dir={sortDir} onSort={onSort} />
                    <Th col="signal_date"             label="Entry"        active={sortKey==='signal_date'}            dir={sortDir} onSort={onSort} />
                    <Th col="returns_since_breakout"  label="Return %"     active={sortKey==='returns_since_breakout'} dir={sortDir} onSort={onSort} right />
                    <Th col="daily_return"            label="Daily %"      active={sortKey==='daily_return'}           dir={sortDir} onSort={onSort} right />
                    <ThStatic label="Charts" />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(sig => {
                    const s   = sig.stage2_score;
                    const lc  = sig.lifecycle_state || 'WATCHING';
                    const sym = sig.ticker.replace(/\.NS$/i, '');
                    const daysLive = Math.floor(
                      (Date.now() - new Date(sig.signal_date + 'T00:00:00').getTime()) / 86400000
                    );
                    const rowBg = lc === 'SUSTAINED' ? 'bg-cyan-950/15 hover:bg-cyan-950/30'
                                : lc === 'CONFIRMED' ? 'bg-emerald-950/15 hover:bg-emerald-950/30'
                                : lc === 'EMERGING'  ? 'bg-amber-950/10 hover:bg-amber-950/20'
                                : lc === 'WEAKENING' ? 'bg-orange-950/15 hover:bg-orange-950/30'
                                : 'hover:bg-slate-800/20';
                    const stkBg = lc === 'SUSTAINED' ? '#051a1a' : lc === 'CONFIRMED' ? '#0a1f12'
                                : lc === 'EMERGING'  ? '#1a1500' : lc === 'WEAKENING'  ? '#1a0d00' : '#0d1117';

                    return (
                      <tr key={sig.id} className={`border-b border-slate-800/50 transition-colors ${rowBg}`}>

                        {/* Stock */}
                        <td className="px-3 py-2 sticky left-0 z-10 whitespace-nowrap" style={{ backgroundColor: stkBg }}>
                          <a href={stockScansUrl(sig.ticker)} target="_blank" rel="noopener noreferrer"
                            title={`Open ${sym} on StockScans`}
                            className="font-bold text-white hover:text-blue-400 transition-colors text-sm">{sym}</a>
                          {sig.company_name && (
                            <div className="text-slate-500 text-[10px] truncate max-w-[140px]">{sig.company_name}</div>
                          )}
                          <div className="flex gap-1 mt-0.5 flex-wrap">
                            {sig.is_pead_confluence && (
                              <span className="text-[9px] font-bold bg-violet-500/20 text-violet-400 border border-violet-500/30 px-1 py-0.5 rounded">PEAD+S2</span>
                            )}
                            {sig.is_smart_money_divergence && (
                              <span className="text-[9px] font-bold bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 px-1 py-0.5 rounded">DIVERGENCE</span>
                            )}
                            {sig.is_reentry && (
                              <span className="text-[9px] font-bold bg-purple-500/20 text-purple-400 border border-purple-500/30 px-1 py-0.5 rounded">RE-ENTRY</span>
                            )}
                          </div>
                        </td>

                        {/* Lifecycle state */}
                        <td className="px-2 py-2 whitespace-nowrap">
                          <LifecyclePill state={sig.lifecycle_state} />
                        </td>

                        {/* Score */}
                        <td className="px-2 py-2 whitespace-nowrap">
                          <span className={`text-base font-black ${s >= 75 ? 'text-emerald-400' : s >= 55 ? 'text-amber-400' : 'text-slate-500'}`}>{s}</span>
                        </td>

                        {/* 3d delta */}
                        <td className="px-2 py-2 whitespace-nowrap">
                          <ScoreDelta delta={sig.score_3d_delta} trend={sig.score_trend} />
                        </td>

                        {/* Freshness */}
                        <td className="px-2 py-2 whitespace-nowrap">
                          {daysLive <= 15
                            ? <div><span className="text-emerald-400 font-bold">{daysLive}d</span><div className="text-[9px] text-emerald-600">Golden Window</div></div>
                            : daysLive <= 45
                            ? <div><span className="text-amber-400 font-semibold">{daysLive}d</span><div className="text-[9px] text-amber-600">Established</div></div>
                            : <div><span className="text-slate-400">{daysLive}d</span><div className="text-[9px] text-slate-600">Extended</div></div>}
                        </td>

                        {/* Base tightness 20d SMA */}
                        <td className="px-2 py-2 text-right whitespace-nowrap">
                          <BaseTightnessCell pct={sig.base_20d_distance_pct} />
                        </td>

                        {/* VCP */}
                        <td className="px-2 py-2 whitespace-nowrap">
                          <VCPCell score={sig.vcp_score} volR={sig.vcp_volume_ratio} adrR={sig.vcp_adr_ratio} />
                        </td>

                        {/* Breakout volume */}
                        <td className={`px-2 py-2 whitespace-nowrap font-semibold ${
                          sig.volume_multiplier == null ? 'text-slate-600'
                          : sig.volume_multiplier >= 3 ? 'text-orange-400'
                          : sig.volume_multiplier >= 2 ? 'text-amber-400' : 'text-slate-400'
                        }`}>
                          {sig.volume_multiplier != null ? `${sig.volume_multiplier.toFixed(1)}x` : '—'}
                        </td>

                        {/* RS 63d */}
                        <td className="px-2 py-2 whitespace-nowrap">
                          <RSCell rs={sig.rs_trend} pct63={sig.rs_63d_score} />
                        </td>

                        {/* 52W percentile */}
                        <td className="px-2 py-2 text-right whitespace-nowrap">
                          {sig.rs_52w_percentile != null ? (
                            <span className={`text-sm font-bold ${sig.rs_52w_percentile >= 80 ? 'text-emerald-400' : sig.rs_52w_percentile >= 70 ? 'text-amber-400' : 'text-slate-500'}`}>
                              {sig.rs_52w_percentile}th
                            </span>
                          ) : <span className="text-slate-600">—</span>}
                        </td>

                        {/* MAs dots */}
                        <td className="px-2 py-2 whitespace-nowrap">
                          <MAsCell above200={sig.above_200sma} above50={sig.above_50sma} slope={sig.ema150_slope} />
                        </td>

                        {/* Fundamentals */}
                        <td className="px-2 py-2 whitespace-nowrap">
                          <FundamentalsCell eps={sig.ttm_eps_growth} roce={sig.roce} accel={sig.eps_is_accelerating} />
                        </td>

                        {/* Entry date */}
                        <td className="px-2 py-2 text-slate-400 whitespace-nowrap text-[11px]">
                          {fmtDate(sig.entry_date || sig.signal_date)}
                        </td>

                        {/* Return */}
                        <td className={`px-2 py-2 text-right whitespace-nowrap font-semibold ${retCls(sig.returns_since_breakout)}`}>
                          {fmtPct(sig.returns_since_breakout)}
                        </td>

                        {/* Daily */}
                        <td className={`px-2 py-2 text-right whitespace-nowrap ${retCls(sig.daily_return)}`}>
                          {fmtPct(sig.daily_return)}
                        </td>

                        {/* Chart links */}
                        <td className="px-2 py-2 text-center whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1">
                            <a href={stockScansUrl(sig.ticker)} target="_blank" rel="noopener noreferrer"
                              title="Open StockScans chart"
                              className="inline-flex items-center gap-0.5 text-[10px] text-slate-400 hover:text-blue-400 transition-colors px-1.5 py-0.5 rounded border border-slate-700 hover:border-blue-500 font-medium">
                              <ExternalLink className="w-2.5 h-2.5" />SS
                            </a>
                            <a href={tradingViewUrl(sig.ticker)} target="_blank" rel="noopener noreferrer"
                              title="Open TradingView chart"
                              className="inline-flex items-center gap-0.5 text-[10px] text-slate-500 hover:text-sky-400 transition-colors px-1.5 py-0.5 rounded border border-slate-700 hover:border-sky-500">
                              <ExternalLink className="w-2.5 h-2.5" />TV
                            </a>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 border-t border-slate-800 flex flex-wrap justify-between gap-2 text-[10px] text-slate-600">
              <span>{sorted.length} setups &middot; {deduplicated.length} unique stocks &middot; v2.1 scoring (7 dimensions) &middot; PEAD+S2=Triple Play &middot; RE-ENTRY=re-entered Stage 2</span>
              <span>Click column to sort &middot; Info icon for explanation &middot; SS=StockScans &middot; TV=TradingView</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

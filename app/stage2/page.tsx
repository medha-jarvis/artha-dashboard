'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, RefreshCw, AlertCircle, ChevronUp, ChevronDown, Layers, ExternalLink } from 'lucide-react';
import { InfoTooltip } from '../components/InfoTooltip';

const sb = (path: string) =>
  fetch(`/api/sb/${path}`, { cache: 'no-store' }).then(r => r.json());

interface Signal {
  id: string;
  ticker: string;
  company_name: string | null;
  sector: string | null;
  signal_date: string;
  stage2_score: number;
  days_in_stage2: number | null;
  ema150_distance_pct: number | null;
  volume_multiplier: number | null;
  rs_trend: string | null;
  ttm_eps_growth: number | null;
  roce: number | null;
  tier: 'CONFIRMED' | 'EMERGING' | 'NONE';
  is_pead_confluence: boolean;
  is_smart_money_divergence: boolean;
  returns_since_breakout?: number | null;
  daily_return?: number | null;
  t_5_return?: number | null;
  t_20_return?: number | null;
  t_60_return?: number | null;
}

type SortKey =
  | 'ticker'
  | 'stage2_score'
  | 'days_in_stage2'
  | 'ema150_distance_pct'
  | 'volume_multiplier'
  | 'rs_trend'
  | 'ttm_eps_growth'
  | 'signal_date'
  | 'returns_since_breakout'
  | 'daily_return';

type SortDir    = 'asc' | 'desc';
type FilterMode = 'all' | 'high_conviction' | 'emerging' | 'pead_confluence' | 'fresh';
type DateRange  = 'week' | 'month' | 'quarter';

const fmtPct = (v: number | null | undefined, dec = 1) =>
  v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(dec)}%`;

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

const retCls = (v: number | null | undefined) =>
  v == null ? 'text-slate-500' :
  v >  15   ? 'text-emerald-300 font-bold' :
  v >   0   ? 'text-emerald-400' :
  v > -10   ? 'text-red-400' : 'text-red-500 font-bold';

const rsValue = (rs: string | null): number =>
  rs === 'Positive' ? 2 : rs === 'Flat' ? 1 : 0;

function FreshnessCell({ days }: { days: number | null }) {
  if (days == null) return <span className="text-slate-600">—</span>;
  if (days <= 15) return (
    <div>
      <span className="text-emerald-400 font-bold">{days}d</span>
      <div className="text-[9px] text-emerald-600">Golden Window</div>
    </div>
  );
  if (days <= 45) return (
    <div>
      <span className="text-amber-400 font-semibold">{days}d</span>
      <div className="text-[9px] text-amber-600">Established</div>
    </div>
  );
  return (
    <div>
      <span className="text-slate-400">{days}d</span>
      <div className="text-[9px] text-slate-600">Extended</div>
    </div>
  );
}

function EMACell({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-slate-600">—</span>;
  if (pct <= 10) return <span className="text-emerald-400 font-semibold">+{pct.toFixed(1)}%</span>;
  if (pct <= 20) return <span className="text-amber-400 font-medium">+{pct.toFixed(1)}%</span>;
  return <span className="text-orange-400">+{pct.toFixed(1)}%</span>;
}

function RSCell({ rs }: { rs: string | null }) {
  if (!rs || rs === 'Flat') return <span className="text-slate-400">Neutral</span>;
  if (rs === 'Positive')    return <span className="text-emerald-400 font-medium">Outperforming</span>;
  return                           <span className="text-red-400">Underperforming</span>;
}

function FundamentalsCell({ eps, roce }: { eps: number | null; roce: number | null }) {
  if (!eps && !roce) return <span className="text-slate-600">—</span>;
  return (
    <div className="text-xs space-y-0.5">
      {eps != null && (
        <div className={`font-medium ${eps > 20 ? 'text-emerald-400' : eps > 0 ? 'text-emerald-300' : 'text-red-400'}`}>
          EPS {eps >= 0 ? '+' : ''}{eps.toFixed(1)}%
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

// Tooltip definitions — plain ASCII quotes to avoid encoding issues
const TIPS: Record<string, { title: string; content: string }> = {
  ticker: {
    title: 'Stock Name',
    content: [
      'The NSE ticker symbol and company name.',
      'Click the ticker to open the StockScans chart where you can see Stage 2 visually with all key moving averages drawn.',
      'PEAD+S2 badge = earnings catalyst AND Stage 2 breakout together, the strongest signal type.',
      'DIVERGENCE badge = smart money buying aggressively despite weak reported earnings.',
    ].join(' '),
  },
  stage2_score: {
    title: 'Stage 2 Breakout Score (0-100)',
    content: [
      'The overall breakout quality score from 0 to 100, built on Mark Minervini SEPA and Stan Weinstein Stage Analysis.',
      'It combines 7 signals: (1) Are all key trend lines pointing upward? (2) Is this stock beating the broader Nifty 500?',
      '(3) How fresh is the breakout? (4) Is price tight near its base (low risk entry) or stretched far from it?',
      '(5) Did volume dry up before the breakout, a sign institutions were quietly accumulating?',
      '(6) Was the breakout on strong conviction volume? (7) Are company earnings growing and accelerating?',
      'Score 75 or above = CONFIRMED, all signals green, buy zone.',
      '55 to 74 = EMERGING, trending well, add to watchlist.',
      'Below 55 = WATCHING, some signals but not ready yet.',
    ].join(' '),
  },
  days_in_stage2: {
    title: 'Days in Stage 2 (Freshness)',
    content: [
      'How many days ago this stock first entered Stage 2, its active uptrend phase.',
      'Think of it like catching a wave: the earlier you paddle in, the longer the ride.',
      '0 to 15 days = Golden Window, historically the best risk-to-reward entry point.',
      'The stock just broke out and has not run far from its base yet.',
      '15 to 45 days = Established trend, still good but enter on pullbacks rather than chasing.',
      '45+ days = Extended run. The stock has moved significantly already.',
      'Better to wait for it to form a new tight consolidation base before entering.',
    ].join(' '),
  },
  ema150_distance_pct: {
    title: 'Distance from 150-Day Moving Average',
    content: [
      'How far the current price is above its 150-day Exponential Moving Average (EMA),',
      'a long-term trend line that acts as the foundation of Stage 2.',
      '0 to 10% above = ideal entry zone, close to the base with strong risk-reward.',
      '10 to 20% = moderately extended but healthy.',
      'Above 25% = stretched, consider waiting for a pullback before entering.',
      'Important: a strong Stage 2 leader building continuation bases can legitimately',
      'show 30 to 50% here across a multi-month uptrend. That does NOT mean avoid.',
      'Check if the price is tight near its 20-day moving average for the real entry signal.',
    ].join(' '),
  },
  volume_multiplier: {
    title: 'Volume Spike on Breakout Day',
    content: [
      'The breakout day trading volume compared to the 50-day average daily volume.',
      'Volume is the engine behind price moves. It tells you whether large institutions',
      '(mutual funds, FIIs, big traders) are actually buying with conviction.',
      '3x or more = Institutional conviction. Someone big is buying aggressively.',
      '2 to 3x = Strong participation.',
      '1.5 to 2x = Moderate.',
      'Below 1.5x = Weak. Low-volume breakouts fail far more often than high-volume ones.',
      'A stock that breaks out on below-average volume often reverses within days.',
    ].join(' '),
  },
  rs_trend: {
    title: 'Relative Strength vs Nifty 500',
    content: [
      'Whether this stock price trend is stronger or weaker than the Nifty 500 index',
      'over the last 63 trading days (about 3 months).',
      'Outperforming = money is specifically flowing INTO this stock vs the broader market,',
      'a sign of institutional accumulation and genuine demand.',
      'Neutral = stock moves roughly in line with the market.',
      'Underperforming = this stock is a laggard even in a rising market, avoid for Stage 2 plays.',
      'Minervini rule: only buy stocks that are outperforming their benchmark index.',
      'Stocks with strong relative strength before a breakout have the highest success rates.',
    ].join(' '),
  },
  ttm_eps_growth: {
    title: 'Fundamental Quality (EPS and ROCE)',
    content: [
      'The business quality backing the technical breakout.',
      'EPS = Earnings Per Share growth, how fast the company profits are growing year over year.',
      'ROCE = Return on Capital Employed, how efficiently the company uses its money.',
      'High ROCE means a quality business, not just a revenue story.',
      'EPS above 20% plus ROCE above 15% = strong fundamental engine behind the breakout.',
      'Stocks breaking out on accelerating earnings sustain their moves far better than those on hype.',
      'Negative EPS is a caution flag, though some stocks with negative EPS and institutional',
      'buying (DIVERGENCE badge) can still work as technical trades.',
    ].join(' '),
  },
  signal_date: {
    title: 'Stage 2 Entry Date',
    content: [
      'The date the Stage 2 breakout was first detected by the daily scan engine',
      '(runs at 3:45 PM IST on weekdays, after market close).',
      'This is when the stock first crossed all Stage 2 filters:',
      'price above rising long-term moving averages with above-average volume.',
      'Combine this with the Freshness column.',
      'A recent entry date combined with low days-in-Stage-2 means you are looking',
      'at a fresh, early opportunity where the move has barely begun.',
    ].join(' '),
  },
  returns_since_breakout: {
    title: 'Total Return Since Breakout',
    content: [
      'Total percentage gain or loss from the Stage 2 entry date closing price to today.',
      'This is the signal report card so far.',
      'Already +20 to +30%? The first leg may be complete.',
      'The stock may need to form a new base before the next move up. Do not chase.',
      'Near 0%? The opportunity is fully fresh and the move has not started yet.',
      'Negative? The breakout may be failing.',
      'Watch for the stock to close below its 150-day EMA for two consecutive days,',
      'which would confirm an exit signal.',
    ].join(' '),
  },
  daily_return: {
    title: 'Today Price Change',
    content: [
      'The percentage change in price today.',
      'Use as context, not as a standalone buy or sell signal.',
      'A strong green day with expanding volume = momentum is intact, institutions are still buying.',
      'A reversal (opened high, closed near lows) after several green days',
      '= potential distribution warning, institutions may be selling into retail buyers.',
      'Never make entry or exit decisions based on one day of price action alone.',
      'Use this alongside the Score, RS, and Total Return columns for a complete picture.',
    ].join(' '),
  },
};

function Th({
  col, label, right, active, dir, onSort, sticky,
}: {
  col: SortKey;
  label: string;
  right?: boolean;
  active: boolean;
  dir: SortDir;
  onSort: (c: SortKey) => void;
  sticky?: boolean;
}) {
  const tip = TIPS[col];
  return (
    <th
      onClick={() => onSort(col)}
      className={[
        'px-2.5 py-3 text-[10px] font-semibold uppercase tracking-wider cursor-pointer select-none whitespace-nowrap bg-[#161b22]',
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
        sb('stage2_performance?select=signal_id,returns_since_breakout,daily_return,t_5_return,t_20_return,t_60_return'),
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
        t_60_return:            (pm[s.id]?.t_60_return as number) ?? null,
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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script }),
      });
      const d = await r.json();
      const label = script === 'stage2_tracker' ? 'Return tracker' :
                    script === 'backfill_stage2' ? 'Backfill (7 days)' : 'Stage 2 scan';
      setTrigMsg(d.ok ? `✓ ${label} dispatched — takes 20–30 min` : `✗ ${d.error}`);
    } catch { setTrigMsg('✗ Network error'); }
    finally { setTriggering(null); }
  };

  // Deduplicate: one row per ticker, latest signal_date wins
  const deduplicated = useMemo(() => {
    const map = new Map<string, Signal>();
    for (const sig of signals) {
      const existing = map.get(sig.ticker);
      if (!existing || sig.signal_date > existing.signal_date) {
        map.set(sig.ticker, sig);
      }
    }
    return Array.from(map.values());
  }, [signals]);

  // Date filter
  const dateFiltered = useMemo(() => {
    const days   = dateRange === 'week' ? 7 : dateRange === 'month' ? 30 : 90;
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
    return deduplicated.filter(s => new Date(s.signal_date) >= cutoff);
  }, [deduplicated, dateRange]);

  // Mode filter
  const modeFiltered = useMemo(() => {
    switch (filter) {
      case 'high_conviction': return dateFiltered.filter(s => s.stage2_score >= 75);
      case 'emerging':        return dateFiltered.filter(s => s.stage2_score >= 55 && s.stage2_score < 75);
      case 'pead_confluence': return dateFiltered.filter(s => s.is_pead_confluence);
      case 'fresh':           return dateFiltered.filter(s => (s.days_in_stage2 ?? 99) <= 15);
      default:                return dateFiltered;
    }
  }, [dateFiltered, filter]);

  // Sort — all 10 columns supported
  const sorted = useMemo(() => {
    return [...modeFiltered].sort((a, b) => {
      const d = sortDir === 'desc' ? -1 : 1;

      if (sortKey === 'ticker') {
        return d * a.ticker.localeCompare(b.ticker);
      }
      if (sortKey === 'signal_date') {
        return d * a.signal_date.localeCompare(b.signal_date);
      }
      if (sortKey === 'rs_trend') {
        return d * (rsValue(a.rs_trend) - rsValue(b.rs_trend));
      }
      // Freshness: sort by signal_date (fresher = more recent date = fewer days)
      // so desc puts oldest first (most days), asc puts newest first (0 days)
      if (sortKey === 'days_in_stage2') {
        return d * a.signal_date.localeCompare(b.signal_date) * -1;
      }

      const nullFallback = sortDir === 'desc' ? -Infinity : Infinity;
      const va = (a[sortKey as keyof Signal] as number | null) ?? nullFallback;
      const vb = (b[sortKey as keyof Signal] as number | null) ?? nullFallback;
      return d * (Number(va) - Number(vb));
    });
  }, [modeFiltered, sortKey, sortDir]);

  const onSort = (col: SortKey) => {
    if (sortKey === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(col); setSortDir('desc'); }
  };

  // Stats
  const confirmed  = dateFiltered.filter(s => s.stage2_score >= 75).length;
  const emerging   = dateFiltered.filter(s => s.stage2_score >= 55 && s.stage2_score < 75).length;
  const triplePlay = dateFiltered.filter(s => s.is_pead_confluence).length;
  const fresh      = dateFiltered.filter(s => (s.days_in_stage2 ?? 99) <= 15).length;
  const smartMoney = dateFiltered.filter(s => s.is_smart_money_divergence).length;
  const avgReturn  = (() => {
    const v = dateFiltered.map(s => s.returns_since_breakout).filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  })();

  const stockScansUrl = (ticker: string) => {
    const sym = ticker.replace(/\.NS$/i, '');
    return `https://www.stockscans.in/charts/NSE:${sym}`;
  };
  const tradingViewUrl = (ticker: string) => {
    const sym = ticker.replace(/\.NS$/i, '');
    return `https://in.tradingview.com/symbols/NSE-${sym}/`;
  };

  return (
    <div className="min-h-screen bg-[#0d1117] p-3 md:p-5">
      <div className="max-w-[1800px] mx-auto space-y-4">

        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Link href="/" className="text-slate-500 hover:text-slate-300"><ArrowLeft className="w-4 h-4" /></Link>
              <Layers className="w-5 h-5 text-blue-400" />
              <h1 className="text-lg font-black text-white">Early Stage 2 Intelligence Hub</h1>
            </div>
            <p className="text-xs text-slate-500 ml-11">
              Weinstein &middot; Minervini SEPA &mdash; 0&ndash;100 structural breakout score &middot; NSE liquid universe &middot; 5 PM IST daily &middot; Click any column header to sort &middot; Hover the info icon for explanations
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => dispatch('stage2_engine')} disabled={!!triggering}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-semibold disabled:opacity-50 transition">
              <Layers className={`w-3.5 h-3.5 ${triggering === 'stage2_engine' ? 'animate-pulse' : ''}`} />
              Run Stage 2 Scan
            </button>
            <button onClick={() => dispatch('stage2_tracker')} disabled={!!triggering}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded text-xs font-medium disabled:opacity-50 transition">
              <RefreshCw className={`w-3.5 h-3.5 ${triggering === 'stage2_tracker' ? 'animate-spin' : ''}`} />
              Refresh Returns
            </button>
            <button onClick={() => dispatch('backfill_stage2')} disabled={!!triggering}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs font-medium disabled:opacity-50 transition">
              Seed 7 Days
            </button>
            <button onClick={loadData} disabled={loading}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-400 rounded text-xs disabled:opacity-50 transition">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {trigMsg && (
          <div className={`text-xs px-4 py-2.5 rounded-lg border ${trigMsg.startsWith('✓') ? 'bg-emerald-900/30 border-emerald-700/40 text-emerald-300' : 'bg-red-900/30 border-red-700/40 text-red-300'}`}>
            {trigMsg}
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 bg-red-900/30 border border-red-700/40 rounded-lg p-3 text-red-300 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0" />{error}
          </div>
        )}

        {/* Stats bar */}
        {deduplicated.length > 0 && (
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
            {[
              { l: 'High Conv (75+)',   v: confirmed.toString(),  c: 'text-emerald-400' },
              { l: 'Emerging (55-74)', v: emerging.toString(),   c: 'text-amber-400' },
              { l: 'PEAD Confluence',  v: triplePlay.toString(), c: 'text-violet-400' },
              { l: 'Fresh (under 15d)', v: fresh.toString(),      c: 'text-blue-400' },
              { l: 'Smart Money',      v: smartMoney.toString(), c: 'text-cyan-400' },
              { l: 'Avg Return',       v: fmtPct(avgReturn),     c: retCls(avgReturn) },
            ].map(s => (
              <div key={s.l} className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-center">
                <div className="text-[10px] text-slate-500 mb-1 whitespace-nowrap">{s.l}</div>
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
                className={`px-3 py-1 text-xs rounded font-medium transition ${dateRange===v?'bg-indigo-600 text-white':'text-slate-400 hover:text-white'}`}>
                {l}
              </button>
            ))}
          </div>
          <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-1 gap-1 flex-wrap">
            {([
              ['all',            'All'],
              ['high_conviction','High Conviction'],
              ['emerging',       'Emerging'],
              ['pead_confluence','PEAD Confluence'],
              ['fresh',          'Fresh (under 15d)'],
            ] as [FilterMode,string][]).map(([v,l]) => (
              <button key={v} onClick={() => setFilter(v)}
                className={`px-3 py-1 text-xs rounded font-medium transition whitespace-nowrap ${filter===v?'bg-blue-600 text-white':'text-slate-400 hover:text-white'}`}>
                {l}
              </button>
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
            <p className="text-slate-600 text-xs mt-1">Seed historical data or run a live scan to detect breakouts</p>
            <div className="flex gap-3 justify-center mt-4">
              <button onClick={() => dispatch('backfill_stage2')} disabled={!!triggering}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded text-xs font-medium disabled:opacity-50">
                Seed 7 Days
              </button>
              <button onClick={() => dispatch('stage2_engine')} disabled={!!triggering}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-medium disabled:opacity-50">
                Run Scan
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
            <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: 'min(720px, calc(100vh - 290px))' }}>
              <table className="w-full text-xs border-collapse" style={{ minWidth: '1300px' }}>
                <thead className="sticky top-0 z-20">
                  <tr className="bg-[#161b22] border-b-2 border-slate-700">
                    <Th col="ticker"                label="Stock"         active={sortKey==='ticker'}                dir={sortDir} onSort={onSort} sticky />
                    <Th col="stage2_score"          label="S2 Score"      active={sortKey==='stage2_score'}          dir={sortDir} onSort={onSort} />
                    <Th col="days_in_stage2"        label="Freshness"     active={sortKey==='days_in_stage2'}        dir={sortDir} onSort={onSort} />
                    <Th col="ema150_distance_pct"   label="EMA150 Dist"   active={sortKey==='ema150_distance_pct'}   dir={sortDir} onSort={onSort} right />
                    <Th col="volume_multiplier"     label="Vol Spike"     active={sortKey==='volume_multiplier'}     dir={sortDir} onSort={onSort} />
                    <Th col="rs_trend"              label="RS vs N500"    active={sortKey==='rs_trend'}              dir={sortDir} onSort={onSort} />
                    <Th col="ttm_eps_growth"        label="Fundamentals"  active={sortKey==='ttm_eps_growth'}        dir={sortDir} onSort={onSort} />
                    <Th col="signal_date"           label="Entry Date"    active={sortKey==='signal_date'}           dir={sortDir} onSort={onSort} />
                    <Th col="returns_since_breakout" label="Return %"     active={sortKey==='returns_since_breakout'} dir={sortDir} onSort={onSort} right />
                    <Th col="daily_return"          label="Daily %"       active={sortKey==='daily_return'}          dir={sortDir} onSort={onSort} right />
                    <th className="px-2.5 py-3 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-500 bg-[#161b22] whitespace-nowrap">
                      Charts
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(sig => {
                    const s       = sig.stage2_score;
                    const rowBg   = s >= 75 ? 'bg-emerald-950/15 hover:bg-emerald-950/30' : s >= 55 ? 'bg-amber-950/10 hover:bg-amber-950/20' : 'hover:bg-slate-800/20';
                    const stkBg   = s >= 75 ? '#0a1f12' : s >= 55 ? '#1a1500' : '#0d1117';
                    const scoreCls = s >= 75 ? 'text-emerald-400' : 'text-amber-400';
                    const daysLive = Math.floor(
                      (Date.now() - new Date(sig.signal_date + 'T00:00:00').getTime()) / 86400000
                    );

                    return (
                      <tr key={sig.id} className={`border-b border-slate-800/50 transition-colors ${rowBg}`}>

                        {/* Stock — sticky + clickable to StockScans */}
                        <td className="px-3 py-2.5 sticky left-0 z-10 whitespace-nowrap" style={{ backgroundColor: stkBg }}>
                          <a
                            href={stockScansUrl(sig.ticker)}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={`Open ${sig.ticker.replace(/\.NS$/i,'')} chart on StockScans`}
                            className="font-bold text-white hover:text-blue-400 transition-colors text-sm"
                          >
                            {sig.ticker.replace(/\.NS$/i, '')}
                          </a>
                          {sig.company_name && (
                            <div className="text-slate-500 text-[10px] truncate max-w-[150px]">{sig.company_name}</div>
                          )}
                          <div className="flex gap-1 mt-0.5 flex-wrap">
                            {sig.is_pead_confluence && (
                              <span className="text-[9px] font-bold bg-violet-500/20 text-violet-400 border border-violet-500/30 px-1 py-0.5 rounded">
                                PEAD+S2
                              </span>
                            )}
                            {sig.is_smart_money_divergence && (
                              <span className="text-[9px] font-bold bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 px-1 py-0.5 rounded">
                                DIVERGENCE
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Score */}
                        <td className="px-2.5 py-2.5 whitespace-nowrap">
                          <span className={`text-base font-black ${scoreCls}`}>{s}</span>
                          <div className="text-[9px] text-slate-600">{sig.tier}</div>
                        </td>

                        {/* Freshness */}
                        <td className="px-2.5 py-2.5 whitespace-nowrap">
                          <FreshnessCell days={daysLive} />
                        </td>

                        {/* EMA distance */}
                        <td className="px-2.5 py-2.5 text-right whitespace-nowrap">
                          <EMACell pct={sig.ema150_distance_pct} />
                        </td>

                        {/* Volume */}
                        <td className={`px-2.5 py-2.5 whitespace-nowrap text-sm font-semibold ${
                          sig.volume_multiplier == null ? 'text-slate-600' :
                          sig.volume_multiplier >= 3   ? 'text-orange-400' :
                          sig.volume_multiplier >= 2   ? 'text-amber-400' : 'text-slate-400'
                        }`}>
                          {sig.volume_multiplier != null
                            ? `${sig.volume_multiplier.toFixed(1)}x`
                            : '—'}
                        </td>

                        {/* RS */}
                        <td className="px-2.5 py-2.5 whitespace-nowrap text-xs">
                          <RSCell rs={sig.rs_trend} />
                        </td>

                        {/* Fundamentals */}
                        <td className="px-2.5 py-2.5 whitespace-nowrap">
                          <FundamentalsCell eps={sig.ttm_eps_growth} roce={sig.roce} />
                        </td>

                        {/* Entry date */}
                        <td className="px-2.5 py-2.5 text-slate-400 whitespace-nowrap">
                          {fmtDate(sig.signal_date)}
                        </td>

                        {/* Return since breakout */}
                        <td className={`px-2.5 py-2.5 text-right whitespace-nowrap font-semibold ${retCls(sig.returns_since_breakout)}`}>
                          {fmtPct(sig.returns_since_breakout)}
                        </td>

                        {/* Daily */}
                        <td className={`px-2.5 py-2.5 text-right whitespace-nowrap ${retCls(sig.daily_return)}`}>
                          {fmtPct(sig.daily_return)}
                        </td>

                        {/* Chart links */}
                        <td className="px-2.5 py-2.5 text-center whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1.5">
                            <a
                              href={stockScansUrl(sig.ticker)}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Open StockScans chart"
                              className="inline-flex items-center gap-0.5 text-[10px] text-slate-400 hover:text-blue-400 transition-colors px-1.5 py-0.5 rounded border border-slate-700 hover:border-blue-500 font-medium"
                            >
                              <ExternalLink className="w-2.5 h-2.5" />SS
                            </a>
                            <a
                              href={tradingViewUrl(sig.ticker)}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Open TradingView chart"
                              className="inline-flex items-center gap-0.5 text-[10px] text-slate-500 hover:text-sky-400 transition-colors px-1.5 py-0.5 rounded border border-slate-700 hover:border-sky-500"
                            >
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
              <span>
                {sorted.length} setups &middot; {deduplicated.length} unique stocks (one per ticker, latest signal) &middot;
                PEAD+S2 = Triple Play &middot; DIVERGENCE = Smart Money
              </span>
              <span>Click column to sort &middot; Info icon for explanation &middot; SS = StockScans &middot; TV = TradingView</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

import { NextResponse } from 'next/server';

const SB_URL = 'https://jljwgwftuqrabfyiucfl.supabase.co';
const SB_KEY = process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impsandnd2Z0dXFyYWJmeWl1Y2ZsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNTQyOTUsImV4cCI6MjA4NzkzMDI5NX0.eOa9XYyZGEM3S0Xvl95gx1wgmrQnPSV8Wh9JDxPu07M';

async function sbFetch(table: string, params: string): Promise<unknown[]> {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/${table}?${params}`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
      cache: 'no-store',
    });
    if (!r.ok) return [];
    const d = await r.json();
    return Array.isArray(d) ? d : [];
  } catch { return []; }
}

interface Stage2Row {
  ticker: string; lifecycle_state: string; stage2_score: number;
  stage2_subtype: string; rs_52w_percentile: number; score_trend: string;
  ema150_distance_pct: number;
}
interface PeadRow {
  ticker: string; signal_date: string; yoy_profit_pct: number;
  yoy_revenue_pct: number; opm_expansion_bps: number; trigger_path: string;
}
interface InsiderRow {
  ticker: string; transaction_type: string; trade_value_in_cr: number;
  equity_pct_traded: number; cluster_trade_flag: boolean; tier: string; signal_date: string;
}
interface WatchlistRow { ticker: string; last_doc_date: string | null; }

export interface PillarSignal { label: string; color: string; detail: string; }
export interface TickerSignal {
  technical: PillarSignal;
  funda:     PillarSignal;
  insider:   PillarSignal;
  events:    PillarSignal;
  signal:    'HOLD' | 'WATCH' | 'REVIEW' | 'EXIT';
}

function getTechSignal(s2: Stage2Row | null): PillarSignal {
  if (!s2) return { label: '—', color: 'text-slate-600', detail: 'No stage data yet' };
  const { lifecycle_state: lc, stage2_score: score, rs_52w_percentile: rs, stage2_subtype: sub } = s2;
  if (lc === 'EXITED')    return { label: 'Brk ⚠', color: 'text-red-400',    detail: `Stage 2 EXITED — below EMA150. Score: ${score}/100` };
  if (lc === 'WEAKENING') return { label: 'Wkn ⚠', color: 'text-orange-400', detail: `Stage 2 WEAKENING. Score: ${score}/100 · RS: ${rs}th pct` };
  if (score >= 80) return { label: '2A ●', color: 'text-emerald-300', detail: `Stage 2A Early Inflection · ${score}/100 · RS ${rs}th pct · ${sub}` };
  if (score >= 65) return { label: '2B ●', color: 'text-teal-400',    detail: `Stage 2B Sustained · ${score}/100 · RS ${rs}th pct · ${sub}` };
  if (score >= 50) return { label: 'Stg1',  color: 'text-yellow-400',  detail: `Stage 1 Consolidation · ${score}/100 · RS ${rs}th pct` };
  return              { label: 'Weak',  color: 'text-red-500',    detail: `Weak / Avoid zone · ${score}/100 · RS ${rs}th pct` };
}

function getFundaSignal(peads: PeadRow[]): PillarSignal {
  if (!peads.length) return { label: '—', color: 'text-slate-600', detail: 'No earnings data yet' };
  const l = peads[0], p = peads[1] ?? null;
  const revYoY = l.yoy_revenue_pct, patYoY = l.yoy_profit_pct, opm = l.opm_expansion_bps;
  const revAccel = p ? revYoY > p.yoy_revenue_pct : null;
  const patAccel = p ? patYoY > p.yoy_profit_pct  : null;
  const detail = `Rev ${revYoY >= 0 ? '+' : ''}${revYoY.toFixed(0)}% YoY · PAT ${patYoY >= 0 ? '+' : ''}${patYoY.toFixed(0)}% YoY · OPM ${opm >= 0 ? '+' : ''}${opm.toFixed(0)}bps`;

  if (patYoY < 0 && revYoY < 0 && p && p.yoy_profit_pct < 0 && p.yoy_revenue_pct < 0)
    return { label: '↓↓', color: 'text-red-400', detail: '2+ qtrs both declining · ' + detail };
  if (patYoY < -20)
    return { label: '↓ PAT', color: 'text-red-400', detail };
  if (patYoY < 0)
    return { label: '↓ PAT', color: 'text-amber-400', detail };
  if (patAccel === true && revAccel === true && opm > 0)
    return { label: '↑ All', color: 'text-emerald-400', detail: 'Accelerating growth + margin expansion · ' + detail };
  if (patYoY > 0 && revYoY > 0)
    return { label: '↑ Rev', color: 'text-teal-400', detail };
  return { label: '→', color: 'text-slate-400', detail };
}

function getInsiderSignal(ins: InsiderRow[]): PillarSignal {
  if (!ins.length) return { label: '→', color: 'text-slate-500', detail: 'No insider activity (90d)' };
  const buys  = ins.filter(i => i.transaction_type === 'BUY');
  const sells = ins.filter(i => i.transaction_type === 'SELL');
  const bv = buys.reduce((s, i)  => s + i.trade_value_in_cr, 0);
  const sv = sells.reduce((s, i) => s + i.trade_value_in_cr, 0);
  const clusterSell = sells.find(i => i.cluster_trade_flag);
  const hcSell      = sells.find(i => i.tier === 'HIGH CONVICTION');
  const detail = `${buys.length > 0 ? `↑ ₹${bv.toFixed(0)}Cr bought` : ''}${buys.length > 0 && sells.length > 0 ? ' · ' : ''}${sells.length > 0 ? `↓ ₹${sv.toFixed(0)}Cr sold` : ''} (90d)`;

  if (clusterSell && hcSell) return { label: '⚠ Sell', color: 'text-red-400',    detail: 'Cluster HC selling · ' + detail };
  if (hcSell || clusterSell) return { label: '↓ Sell', color: 'text-orange-400', detail };
  if (sells.length > 0 && sv > bv) return { label: '↓ Sell', color: 'text-amber-400', detail };
  if (buys.length > 0 && bv > 0)   return { label: '↑ Buy',  color: 'text-emerald-400', detail };
  return { label: '→', color: 'text-slate-500', detail };
}

function getEventsSignal(wl: WatchlistRow | null): PillarSignal {
  if (!wl?.last_doc_date) return { label: '—', color: 'text-slate-600', detail: 'No NSE filings indexed' };
  const days = Math.floor((Date.now() - new Date(wl.last_doc_date).getTime()) / 86400000);
  if (days > 120) return { label: '⚠ Stale', color: 'text-amber-400', detail: `Last NSE filing ${days}d ago — results may be missing` };
  if (days > 60)  return { label: `${days}d`,  color: 'text-yellow-500', detail: `Last NSE filing ${days} days ago (${wl.last_doc_date})` };
  return              { label: `${days}d`,  color: 'text-slate-400',  detail: `Last NSE filing ${days} days ago (${wl.last_doc_date})` };
}

function computeSignal(
  tech: PillarSignal, funda: PillarSignal, insider: PillarSignal
): TickerSignal['signal'] {
  const techExit   = tech.label === 'Brk ⚠' || tech.label === 'Weak';
  const techWeak   = tech.label === 'Wkn ⚠' || tech.label === 'Stg1';
  const fundaRed   = funda.label === '↓↓' || (funda.label === '↓ PAT' && funda.color === 'text-red-400');
  const fundaAmb   = funda.label === '↓ PAT' && funda.color === 'text-amber-400';
  const insiderSell = insider.label === '⚠ Sell' || insider.label === '↓ Sell';

  if (techExit && fundaRed) return 'EXIT';
  if (techExit || (fundaRed && insiderSell)) return 'REVIEW';
  if (techWeak || fundaAmb || insiderSell) return 'WATCH';
  return 'HOLD';
}

const SIGNAL_SORT: Record<string, number> = { EXIT: 0, REVIEW: 1, WATCH: 2, HOLD: 3 };

export async function GET() {
  const ago90 = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);

  const [s2All, peadAll, insiderAll, watchlistAll] = await Promise.all([
    sbFetch('stage2_signals',
      'select=ticker,lifecycle_state,stage2_score,stage2_subtype,rs_52w_percentile,score_trend,ema150_distance_pct&order=signal_date.desc&limit=600'),
    sbFetch('pead_signals',
      'select=ticker,signal_date,yoy_profit_pct,yoy_revenue_pct,opm_expansion_bps,trigger_path&order=signal_date.desc&limit=300'),
    sbFetch('insider_signals',
      `select=ticker,transaction_type,trade_value_in_cr,equity_pct_traded,cluster_trade_flag,tier,signal_date&signal_date=gte.${ago90}&order=signal_date.desc&limit=500`),
    sbFetch('alpha_watchlist', 'select=ticker,last_doc_date'),
  ]);

  const s2Map:  Record<string, Stage2Row>     = {};
  const peadMap:Record<string, PeadRow[]>     = {};
  const insMap: Record<string, InsiderRow[]>  = {};
  const wlMap:  Record<string, WatchlistRow>  = {};

  for (const r of s2All as Stage2Row[])      { if (!s2Map[r.ticker])   s2Map[r.ticker] = r; }
  for (const r of peadAll as PeadRow[])      { if (!peadMap[r.ticker]) peadMap[r.ticker] = []; if (peadMap[r.ticker].length < 2) peadMap[r.ticker].push(r); }
  for (const r of insiderAll as InsiderRow[]) { if (!insMap[r.ticker])  insMap[r.ticker] = [];  insMap[r.ticker].push(r); }
  for (const r of watchlistAll as WatchlistRow[]) { wlMap[r.ticker] = r; }

  const allTickers = new Set([...Object.keys(s2Map), ...Object.keys(peadMap), ...Object.keys(insMap), ...Object.keys(wlMap)]);

  const result: Record<string, TickerSignal & { signalOrder: number }> = {};
  for (const ticker of allTickers) {
    const technical = getTechSignal(s2Map[ticker] ?? null);
    const funda     = getFundaSignal(peadMap[ticker] ?? []);
    const insider   = getInsiderSignal(insMap[ticker] ?? []);
    const events    = getEventsSignal(wlMap[ticker] ?? null);
    const signal    = computeSignal(technical, funda, insider);
    result[ticker]  = { technical, funda, insider, events, signal, signalOrder: SIGNAL_SORT[signal] ?? 99 };
  }

  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

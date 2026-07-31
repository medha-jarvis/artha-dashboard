'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, TrendingUp, TrendingDown, Database } from 'lucide-react';

interface CompanyData {
  symbol: string;
  isin?: string;
  sector?: string;
  current_price?: number;
  avg_price?: number;
  '52_week_high'?: number;
  '52_week_low'?: number;
  price_from_52w_high_pct?: number;
  price_from_52w_low_pct?: number;
  quantity?: number;
  invested?: number;
  current_value?: number;
  unrealized_pl?: number;
  unrealized_pl_pct?: number;
  portfolio_weight_pct?: number;
  wiki_analysis?: {
    company_name?: string | null;
    sector?: string | null;
    thesis?: string | null;
    moat?: string | null;
    risk_factors?: string | null;
    valuation?: string | null;
    content_preview?: string | null;
    wiki_file?: string | null;
  };
  date?: string;
}

interface Quote {
  price?: number;
  change?: number;
  change_abs?: number;
  name?: string;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
  market_cap?: number;
  week_52_high?: number;
  week_52_low?: number;
  pe_trailing?: number | null;
  pe_forward?: number | null;
  pb?: number | null;
  eps_ttm?: number | null;
  dividend_yield?: number | null;
  beta?: number | null;
  roe?: number | null;
  gross_margin?: number | null;
  operating_margin?: number | null;
  profit_margin?: number | null;
  debt_to_equity?: number | null;
  free_cash_flow?: number | null;
}

// Also fetch from the full portfolio DB to get IRR
interface DbHolding {
  symbol: string;
  irr?: number | null;
  duration?: number | null;
  realizedPnl?: number;
  totalPnl?: number;
  totalPnlPct?: number;
  signal?: string | null;
  dayChangePct?: number | null;
  dayChange?: number | null;
  trailingPE?: number | null;
  medianPE5yr?: number | null;
}

const fmtCr = (n?: number | null) => {
  if (n == null) return '—';
  const a = Math.abs(n);
  if (a >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (a >= 1e5) return `₹${(n / 1e5).toFixed(2)}L`;
  return `₹${n.toFixed(0)}`;
};
const fmtPct = (n?: number | null, dec = 2) =>
  n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(dec)}%`;
const fmtNum = (n?: number | null, dec = 1) => (n == null ? '—' : n.toFixed(dec));

const SIGNAL_CFG: Record<string, { bg: string; text: string }> = {
  BUY: { bg: 'bg-emerald-500/25', text: 'text-emerald-300' },
  ACCUMULATE: { bg: 'bg-teal-500/25', text: 'text-teal-300' },
  HOLD: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
  WATCH: { bg: 'bg-yellow-500/20', text: 'text-yellow-400' },
  TRIM: { bg: 'bg-orange-500/20', text: 'text-orange-400' },
  REDUCE: { bg: 'bg-orange-500/20', text: 'text-orange-400' },
  SELL: { bg: 'bg-red-500/20', text: 'text-red-400' },
};

function MetricBox({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-slate-800 rounded-lg p-3">
      <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-0.5">{label}</div>
      <div className={`text-sm font-bold ${color ?? 'text-white'}`}>{value}</div>
    </div>
  );
}

function RangeBar({ low, high, cur }: { low: number; high: number; cur: number }) {
  const pct = high > low ? Math.max(0, Math.min(100, ((cur - low) / (high - low)) * 100)) : 50;
  return (
    <div className="mt-2">
      <div className="relative h-2 bg-slate-700 rounded-full">
        <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-red-500 to-emerald-500" style={{ width: '100%' }} />
        <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white border-2 border-indigo-400 rounded-full shadow" style={{ left: `calc(${pct}% - 6px)` }} />
      </div>
      <div className="flex justify-between text-[10px] text-slate-500 mt-1">
        <span>52W Low ₹{low.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
        <span className="text-indigo-400 font-semibold">₹{cur.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
        <span>52W High ₹{high.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
      </div>
    </div>
  );
}

export default function CompanyPage() {
  const { symbol } = useParams<{ symbol: string }>();
  const sym = symbol?.toUpperCase() ?? '';

  const [co, setCo] = useState<CompanyData | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [dbHolding, setDbHolding] = useState<DbHolding | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

  if (loading) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="text-white flex items-center gap-2"><Database className="animate-pulse w-5 h-5 text-emerald-400" />Loading {sym}…</div>
    </div>
  );

  if (error || !co) return (
    <div className="min-h-screen bg-slate-950 p-6">
      <Link href="/portfolio" className="text-slate-400 hover:text-white text-sm flex items-center gap-1 mb-6"><ArrowLeft className="w-4 h-4" />Portfolio</Link>
      <div className="bg-red-900/30 border border-red-700/50 rounded-xl p-6 text-red-300">{error || `${sym} not found in portfolio`}</div>
    </div>
  );

  const livePrice = quote?.price ?? co.current_price ?? 0;
  const change = quote?.change ?? 0;
  const changeAbs = quote?.change_abs ?? 0;
  const isUp = change >= 0;
  const signal = dbHolding?.signal ?? null;
  const sigCfg = signal ? (SIGNAL_CFG[signal] ?? SIGNAL_CFG.HOLD) : null;

  const w52High = quote?.week_52_high ?? co['52_week_high'];
  const w52Low = quote?.week_52_low ?? co['52_week_low'];

  return (
    <div className="min-h-screen bg-slate-950 p-3 md:p-5">
      <div className="max-w-5xl mx-auto space-y-4">

        {/* Back */}
        <Link href="/portfolio" className="text-slate-400 hover:text-white text-sm flex items-center gap-1.5 w-fit">
          <ArrowLeft className="w-4 h-4" />Back to Portfolio
        </Link>

        {/* Hero */}
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
              <div className="text-slate-400 text-sm">{quote?.name ?? co.wiki_analysis?.company_name ?? sym} · {co.sector ?? co.wiki_analysis?.sector ?? '—'}</div>
            </div>
            <div className="text-right">
              <div className="text-3xl font-black text-white">₹{livePrice.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              <div className={`flex items-center justify-end gap-1 text-sm font-semibold mt-0.5 ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
                {isUp ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                {changeAbs >= 0 ? '+' : ''}₹{Math.abs(changeAbs).toFixed(2)} ({fmtPct(change)}) today
              </div>
            </div>
          </div>

          {/* Intraday strip */}
          {quote?.open != null && (
            <div className="grid grid-cols-4 gap-3 mt-4 pt-4 border-t border-slate-800">
              {[
                { l: 'Open', v: `₹${(quote.open ?? 0).toFixed(2)}` },
                { l: "Day's High", v: `₹${(quote.high ?? 0).toFixed(2)}` },
                { l: "Day's Low", v: `₹${(quote.low ?? 0).toFixed(2)}` },
                { l: 'Volume', v: (quote.volume ?? 0) >= 1e6 ? `${((quote.volume ?? 0) / 1e6).toFixed(2)}M` : `${(((quote.volume ?? 0)) / 1e3).toFixed(0)}K` },
              ].map(s => (
                <div key={s.l}>
                  <div className="text-[10px] text-slate-500">{s.l}</div>
                  <div className="text-sm font-semibold text-white mt-0.5">{s.v}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Position + Valuation grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* Your Position */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Your Position</h2>
            <div className="space-y-2.5">
              {[
                { l: 'Shares held', v: (co.quantity ?? 0).toLocaleString('en-IN'), c: 'text-white' },
                { l: 'Avg buy price', v: `₹${(co.avg_price ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`, c: 'text-slate-300' },
                { l: 'Invested', v: fmtCr(co.invested), c: 'text-slate-300' },
                { l: 'Current value', v: fmtCr((co.quantity ?? 0) * livePrice || co.current_value), c: 'text-white font-bold' },
              ].map(r => (
                <div key={r.l} className="flex justify-between">
                  <span className="text-sm text-slate-500">{r.l}</span>
                  <span className={`text-sm ${r.c}`}>{r.v}</span>
                </div>
              ))}

              <div className="border-t border-slate-800 pt-2.5 mt-1">
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

          {/* Valuation */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Valuation &amp; Quality</h2>
            <div className="grid grid-cols-2 gap-2">
              {quote?.market_cap != null && quote.market_cap > 0 && (
                <MetricBox label="Market Cap" value={
                  quote.market_cap >= 1e12 ? `₹${(quote.market_cap / 1e12).toFixed(1)}T` :
                  quote.market_cap >= 1e9 ? `₹${(quote.market_cap / 1e9).toFixed(0)}B` :
                  `₹${(quote.market_cap / 1e7).toFixed(0)}Cr`
                } />
              )}
              <MetricBox label="P/E (TTM)"
                value={quote?.pe_trailing ? `${quote.pe_trailing.toFixed(1)}x` : dbHolding?.trailingPE ? `${dbHolding.trailingPE.toFixed(1)}x` : '—'}
                color={(() => { const pe = quote?.pe_trailing ?? dbHolding?.trailingPE; return pe && pe < 15 ? 'text-emerald-400' : pe && pe < 35 ? 'text-yellow-400' : pe ? 'text-red-400' : 'text-slate-500'; })()}
              />
              {dbHolding?.medianPE5yr != null && (
                <MetricBox label="5yr Median PE" value={`${dbHolding.medianPE5yr.toFixed(1)}x`} color="text-slate-300" />
              )}
              <MetricBox label="P/E (Fwd)" value={quote?.pe_forward ? `${quote.pe_forward.toFixed(1)}x` : '—'} />
              <MetricBox label="P/B" value={quote?.pb ? `${quote.pb.toFixed(2)}x` : '—'} />
              <MetricBox label="EPS (TTM)" value={quote?.eps_ttm ? `₹${quote.eps_ttm.toFixed(2)}` : '—'} />
              <MetricBox label="Div Yield" value={quote?.dividend_yield ? `${quote.dividend_yield.toFixed(2)}%` : '—'} color="text-blue-400" />
              <MetricBox label="Beta" value={quote?.beta ? quote.beta.toFixed(2) : '—'} />
              <MetricBox label="ROE"
                value={quote?.roe ? `${(quote.roe * 100).toFixed(1)}%` : '—'}
                color={quote?.roe != null ? (quote.roe > 0.18 ? 'text-emerald-400' : quote.roe > 0.10 ? 'text-yellow-400' : 'text-red-400') : undefined}
              />
              <MetricBox label="Op Margin" value={quote?.operating_margin ? `${(quote.operating_margin * 100).toFixed(1)}%` : '—'} />
              <MetricBox label="Net Margin" value={quote?.profit_margin ? `${(quote.profit_margin * 100).toFixed(1)}%` : '—'} />
              <MetricBox label="D/E Ratio" value={quote?.debt_to_equity ? `${(quote.debt_to_equity / 100).toFixed(2)}x` : '—'}
                color={quote?.debt_to_equity != null ? (quote.debt_to_equity < 50 ? 'text-emerald-400' : quote.debt_to_equity < 150 ? 'text-yellow-400' : 'text-red-400') : undefined}
              />
              {quote?.free_cash_flow != null && (
                <MetricBox label="Free Cash Flow" value={fmtCr(quote.free_cash_flow)} />
              )}
            </div>
          </div>
        </div>

        {/* 52-Week Range */}
        {w52High != null && w52Low != null && livePrice > 0 && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">52-Week Range</h2>
            <RangeBar low={w52Low} high={w52High} cur={livePrice} />
            <div className="grid grid-cols-2 gap-3 mt-3 text-xs">
              <div className="bg-slate-800 rounded-lg p-2.5">
                <div className="text-slate-500 mb-0.5">↓ from 52W High</div>
                <div className={`font-bold ${(co.price_from_52w_high_pct ?? -99) > -5 ? 'text-emerald-400' : (co.price_from_52w_high_pct ?? -99) > -15 ? 'text-yellow-400' : 'text-red-400'}`}>
                  {fmtPct(co.price_from_52w_high_pct, 1)}
                </div>
              </div>
              <div className="bg-slate-800 rounded-lg p-2.5">
                <div className="text-slate-500 mb-0.5">↑ from 52W Low</div>
                <div className="font-bold text-emerald-400">+{(co.price_from_52w_low_pct ?? 0).toFixed(1)}%</div>
              </div>
            </div>
          </div>
        )}

        {/* Wiki Analysis */}
        {co.wiki_analysis?.content_preview && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
              Research Note
              {co.wiki_analysis.wiki_file && <span className="ml-2 text-slate-600 font-normal normal-case">{co.wiki_analysis.wiki_file}</span>}
            </h2>
            <pre className="text-xs text-slate-400 whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto font-mono bg-slate-800/50 rounded-lg p-3">
              {co.wiki_analysis.content_preview
                .replace(/^\s*\d+\|\s*/gm, '')  // strip line numbers
                .substring(0, 1200)}
              {(co.wiki_analysis.content_preview.length > 1200) ? '\n…(truncated)' : ''}
            </pre>
          </div>
        )}

      </div>
    </div>
  );
}

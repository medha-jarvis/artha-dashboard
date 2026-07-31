'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, TrendingUp, TrendingDown, Zap, RefreshCw, AlertCircle } from 'lucide-react';

// Data comes from the VPS backend via the existing /api/proxy/ route.
// Signals already include drift columns joined server-side.

// ── Types ────────────────────────────────────────────────────────────────────
interface Signal {
  id: string;
  ticker: string;
  signal_date: string;
  trigger_path: 'A' | 'B';
  fundamental_score: string | null;
  volume_multiplier: number | null;
  status: string;
  created_at: string;
  drift_performance?: DriftRow;
}

interface DriftRow {
  t_1_return: number | null;
  t_5_return: number | null;
  t_20_return: number | null;
  updated_at: string;
}

interface ParsedScore {
  yoy_profit_pct?: number;
  opm_curr?: number;
  opm_prev?: number;
  close?: number;
  ema200?: number;
  vol_mult?: number;
  price_vs_open?: number;
}

// ── Formatters ───────────────────────────────────────────────────────────────
const pct = (v: number | null | undefined, dec = 2) =>
  v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(dec)}%`;

const returnColor = (v: number | null | undefined) =>
  v == null ? 'text-slate-500' : v >= 5 ? 'text-emerald-400' : v >= 0 ? 'text-emerald-300' : v >= -5 ? 'text-amber-400' : 'text-red-400';

const parseFundamental = (raw: string | null): ParsedScore => {
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
};

// ── Sub-components ───────────────────────────────────────────────────────────
function SignalCard({ sig }: { sig: Signal }) {
  const f   = parseFundamental(sig.fundamental_score);
  const drft = sig.drift_performance;
  const isA  = sig.trigger_path === 'A';
  const accentBorder = isA ? 'border-emerald-500/40' : 'border-amber-500/40';
  const accentBg     = isA ? 'bg-emerald-500/10'     : 'bg-amber-500/10';
  const accentText   = isA ? 'text-emerald-400'       : 'text-amber-400';

  return (
    <div className={`bg-slate-900 border ${accentBorder} rounded-xl p-4 flex flex-col gap-3`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-black text-white tracking-tight">{sig.ticker}</span>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${accentBg} ${accentText}`}>
              PATH {sig.trigger_path}
            </span>
            {sig.status !== 'active' && (
              <span className="text-[10px] text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded">{sig.status}</span>
            )}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            {new Date(sig.signal_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className={`text-sm font-bold ${accentText}`}>
            {sig.volume_multiplier ? `${sig.volume_multiplier.toFixed(1)}x vol` : '—'}
          </div>
          <div className="text-[10px] text-slate-500">vs 20d SMA</div>
        </div>
      </div>

      {/* Fundamentals strip */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-slate-800/60 rounded-lg p-2 text-center">
          <div className="text-[10px] text-slate-500 mb-0.5">YoY Profit</div>
          <div className={`text-sm font-bold ${(f.yoy_profit_pct ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {f.yoy_profit_pct != null ? pct(f.yoy_profit_pct, 1) : '—'}
          </div>
        </div>
        <div className="bg-slate-800/60 rounded-lg p-2 text-center">
          <div className="text-[10px] text-slate-500 mb-0.5">vs EMA200</div>
          <div className={`text-sm font-bold ${f.close && f.ema200 && f.close > f.ema200 ? 'text-emerald-400' : 'text-red-400'}`}>
            {f.close && f.ema200
              ? `${f.close > f.ema200 ? '+' : ''}${(((f.close - f.ema200) / f.ema200) * 100).toFixed(1)}%`
              : '—'}
          </div>
        </div>
        <div className="bg-slate-800/60 rounded-lg p-2 text-center">
          <div className="text-[10px] text-slate-500 mb-0.5">Day Gap</div>
          <div className={`text-sm font-bold ${(f.price_vs_open ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {f.price_vs_open != null ? pct(f.price_vs_open, 1) : '—'}
          </div>
        </div>
      </div>

      {/* Drift returns */}
      {drft && (
        <div className="border-t border-slate-800 pt-3">
          <div className="text-[10px] text-slate-500 mb-2 uppercase tracking-wider">PEAD Drift Returns</div>
          <div className="grid grid-cols-3 gap-2">
            {([['T+1', drft.t_1_return], ['T+5', drft.t_5_return], ['T+20', drft.t_20_return]] as [string, number | null][]).map(
              ([label, val]) => (
                <div key={label} className="bg-slate-800/60 rounded-lg p-2 text-center">
                  <div className="text-[10px] text-slate-500 mb-0.5">{label}</div>
                  <div className={`text-sm font-bold ${returnColor(val)}`}>{pct(val, 1)}</div>
                </div>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ReturnPill({ val, label }: { val: number | null; label: string }) {
  const col = returnColor(val);
  return (
    <div className="text-center">
      <div className="text-[9px] text-slate-500 mb-0.5">{label}</div>
      <div className={`text-xs font-bold ${col}`}>{pct(val, 1)}</div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function PEADPage() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [tab,     setTab]     = useState<'live' | 'history'>('live');

  const loadData = async () => {
    setLoading(true); setError('');
    try {
      // Signals come back from the VPS with drift columns joined server-side
      const raw = await fetch('/api/proxy/pead/signals', { cache: 'no-store' }).then(r => r.json());
      if (!Array.isArray(raw)) throw new Error('Bad response from API');

      // Flatten drift columns into drift_performance sub-object for reuse in components
      const joined: Signal[] = raw.map((s: Signal & { t_1_return?: number | null; t_5_return?: number | null; t_20_return?: number | null; drift_updated_at?: string }) => ({
        ...s,
        drift_performance: {
          t_1_return:  s.t_1_return  ?? null,
          t_5_return:  s.t_5_return  ?? null,
          t_20_return: s.t_20_return ?? null,
          updated_at:  s.drift_updated_at ?? '',
        },
      }));
      setSignals(joined);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  // Split into live (active) vs history
  const liveSignals = signals.filter(s => s.status === 'active');
  const pathALive   = liveSignals.filter(s => s.trigger_path === 'A');
  const pathBLive   = liveSignals.filter(s => s.trigger_path === 'B');
  const completedCount = signals.filter(s => s.drift_performance?.t_20_return != null).length;
  const avgReturn = (col: keyof DriftRow) => {
    const vals = signals
      .map(s => s.drift_performance?.[col] as number | null)
      .filter((v): v is number => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };

  return (
    <div className="min-h-screen bg-slate-950 p-3 md:p-5">
      <div className="max-w-6xl mx-auto space-y-4">

        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Link href="/portfolio" className="text-slate-500 hover:text-slate-300 transition">
                <ArrowLeft className="w-4 h-4" />
              </Link>
              <h1 className="text-xl font-black text-white flex items-center gap-2">
                <Zap className="w-5 h-5 text-amber-400" />
                PEAD Signal Engine
              </h1>
            </div>
            <p className="text-xs text-slate-500 ml-6">
              Post-Earnings Announcement Drift · Path A = VCP beat · Path B = Trap reversal
            </p>
          </div>
          <button
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded text-xs font-medium disabled:opacity-50 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 bg-red-900/30 border border-red-700/50 rounded-xl p-4 text-red-300 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Aggregate stats bar */}
        {signals.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: 'Total Signals', value: signals.length.toString(), accent: 'text-white' },
              { label: 'Active', value: liveSignals.length.toString(), accent: 'text-emerald-400' },
              { label: 'Avg T+1', value: pct(avgReturn('t_1_return'), 1), accent: returnColor(avgReturn('t_1_return')) },
              { label: 'Avg T+5', value: pct(avgReturn('t_5_return'), 1), accent: returnColor(avgReturn('t_5_return')) },
              { label: 'Avg T+20', value: pct(avgReturn('t_20_return'), 1), accent: returnColor(avgReturn('t_20_return')) },
            ].map(s => (
              <div key={s.label} className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-center">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">{s.label}</div>
                <div className={`text-lg font-black ${s.accent}`}>{s.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Tab switcher */}
        <div className="flex gap-1 bg-slate-900 border border-slate-800 rounded-xl p-1 w-fit">
          {(['live', 'history'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition ${tab === t ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white'}`}>
              {t === 'live' ? `⚡ Live Signals (${liveSignals.length})` : `📈 Drift History (${signals.length})`}
            </button>
          ))}
        </div>

        {loading && (
          <div className="text-center py-20 text-slate-500 text-sm">Loading signals…</div>
        )}

        {/* Live Signals Tab */}
        {!loading && tab === 'live' && (
          <>
            {liveSignals.length === 0 ? (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center">
                <Zap className="w-8 h-8 text-slate-600 mx-auto mb-3" />
                <p className="text-slate-400 font-semibold">No active signals</p>
                <p className="text-slate-600 text-xs mt-1">The GitHub Action runs at 3:45 PM IST on market days</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Path A */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <TrendingUp className="w-4 h-4 text-emerald-400" />
                    <h2 className="text-sm font-bold text-white">Path A — Classic PEAD Beat</h2>
                    <span className="text-xs text-slate-500">({pathALive.length})</span>
                  </div>
                  <p className="text-[10px] text-slate-600 mb-3">
                    YoY Profit &gt;30% OR OPM +200bps · Close &gt; EMA200 · Volume &gt;2.5x SMA
                  </p>
                  {pathALive.length === 0
                    ? <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-center text-slate-600 text-sm">No Path A signals today</div>
                    : pathALive.map(s => <SignalCard key={s.id} sig={s} />)}
                </div>

                {/* Path B */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <TrendingDown className="w-4 h-4 text-amber-400" />
                    <h2 className="text-sm font-bold text-white">Path B — Trap Reversal</h2>
                    <span className="text-xs text-slate-500">({pathBLive.length})</span>
                  </div>
                  <p className="text-[10px] text-slate-600 mb-3">
                    YoY Profit &lt;0% · Price gap ≥4% · Volume &gt;3x SMA (short squeeze setup)
                  </p>
                  {pathBLive.length === 0
                    ? <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-center text-slate-600 text-sm">No Path B signals today</div>
                    : pathBLive.map(s => <SignalCard key={s.id} sig={s} />)}
                </div>
              </div>
            )}
          </>
        )}

        {/* Drift History Tab */}
        {!loading && tab === 'history' && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <h2 className="text-sm font-bold text-white">Historical Drift Performance</h2>
              <span className="text-xs text-slate-500">{completedCount} completed (T+20 measured)</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse" style={{ minWidth: '700px' }}>
                <thead className="sticky top-0 z-10">
                  <tr className="border-b border-slate-700 bg-slate-900">
                    {['Date', 'Ticker', 'Path', 'Vol ×', 'YoY P%', 'vs EMA200', 'T+1', 'T+5', 'T+20', 'Status'].map(h => (
                      <th key={h} className="px-3 py-2.5 text-left font-semibold text-slate-400 bg-slate-900 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {signals.map(s => {
                    const f    = parseFundamental(s.fundamental_score);
                    const drft = s.drift_performance;
                    const vsEma = f.close && f.ema200
                      ? ((f.close - f.ema200) / f.ema200 * 100).toFixed(1)
                      : null;
                    return (
                      <tr key={s.id} className="border-b border-slate-800/60 hover:bg-slate-800/30 transition">
                        <td className="px-3 py-2.5 text-slate-400 whitespace-nowrap">
                          {new Date(s.signal_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                        </td>
                        <td className="px-3 py-2.5 font-bold text-white whitespace-nowrap">{s.ticker}</td>
                        <td className="px-3 py-2.5">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            s.trigger_path === 'A'
                              ? 'bg-emerald-500/20 text-emerald-400'
                              : 'bg-amber-500/20 text-amber-400'
                          }`}>
                            {s.trigger_path}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-slate-300 whitespace-nowrap">
                          {s.volume_multiplier ? `${s.volume_multiplier.toFixed(1)}x` : '—'}
                        </td>
                        <td className={`px-3 py-2.5 whitespace-nowrap font-medium ${(f.yoy_profit_pct ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {f.yoy_profit_pct != null ? pct(f.yoy_profit_pct, 1) : '—'}
                        </td>
                        <td className={`px-3 py-2.5 whitespace-nowrap ${vsEma && parseFloat(vsEma) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {vsEma ? `${parseFloat(vsEma) >= 0 ? '+' : ''}${vsEma}%` : '—'}
                        </td>
                        <td className={`px-3 py-2.5 font-semibold whitespace-nowrap ${returnColor(drft?.t_1_return)}`}>
                          {pct(drft?.t_1_return, 1)}
                        </td>
                        <td className={`px-3 py-2.5 font-semibold whitespace-nowrap ${returnColor(drft?.t_5_return)}`}>
                          {pct(drft?.t_5_return, 1)}
                        </td>
                        <td className={`px-3 py-2.5 font-bold whitespace-nowrap ${returnColor(drft?.t_20_return)}`}>
                          {pct(drft?.t_20_return, 1)}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                            s.status === 'active'  ? 'bg-emerald-500/20 text-emerald-400' :
                            s.status === 'expired' ? 'bg-slate-700 text-slate-500'        :
                                                     'bg-slate-700 text-slate-500'
                          }`}>
                            {s.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {signals.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-3 py-12 text-center text-slate-600">No signals recorded yet</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Footer note */}
        <div className="text-[10px] text-slate-600 pb-2">
          Engine runs via GitHub Actions · Mon–Fri 3:45 PM IST · Data source: stockscans.in + yfinance
        </div>
      </div>
    </div>
  );
}

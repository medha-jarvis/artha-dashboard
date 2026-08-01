'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { RefreshCw, Zap, Layers, Eye, AlertCircle, ChevronUp, ChevronDown, TrendingUp, TrendingDown } from 'lucide-react';

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
  const d = new Date(); d.setDate(d.getDate() - CUTOFF_DAYS); return d.toISOString().slice(0,10);
};

// ── Types ─────────────────────────────────────────────────────────────────────
interface PeadRow   { ticker: string; pead_score: number; trigger_path: string; signal_date: string; }
interface Stage2Row { ticker: string; stage2_score: number; tier: string; days_in_stage2: number | null; signal_date: string; }
interface InsiderRow{ ticker: string; company_name: string | null; insider_score: number; transaction_type: string; acquirer_name: string; trade_value_in_cr: number | null; tier: string; signal_date: string; }

interface Trinity {
  ticker: string;
  company_name: string | null;
  sector: string | null;
  // scores (null = not in that engine)
  pead_score:    number | null;
  pead_path:     string | null;
  stage2_score:  number | null;
  stage2_tier:   string | null;
  stage2_days:   number | null;
  insider_score: number | null;
  insider_type:  string | null;
  insider_acquirer: string | null;
  insider_value_cr: number | null;
  // computed
  signals_count: number;   // how many engines fired
  total_score:   number;   // sum of available scores
  latest_date:   string;
}

type SortKey = 'signals_count' | 'total_score' | 'pead_score' | 'stage2_score' | 'insider_score' | 'latest_date';
type SortDir = 'asc' | 'desc';
type FilterMode = 'all' | 'triple' | 'pead_s2' | 'pead_insider' | 's2_insider';

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtPct  = (v: number | null | undefined) => v == null ? '—' : `${v>=0?'+':''}${v.toFixed(1)}%`;
const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

const confluenceBadge = (n: number) =>
  n >= 3 ? { label: '⭐ TRIPLE CROWN', cls: 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/40' }
         : { label: '🔗 DUAL SIGNAL',  cls: 'bg-blue-500/20 text-blue-300 border border-blue-500/30' };

const scoreBadge = (score: number | null) =>
  score == null ? 'text-slate-600' :
  score >= 75   ? 'text-emerald-400 font-bold' :
  score >= 55   ? 'text-amber-400' : 'text-slate-400';

// ── Header Engine Card ─────────────────────────────────────────────────────────
function EngineCard({ icon, title, href, count, color }: { icon: React.ReactNode; title: string; href: string; count: number; color: string }) {
  return (
    <Link href={href} className={`bg-slate-900 border ${color} rounded-xl p-4 flex items-center gap-3 hover:opacity-80 transition`}>
      <div className="shrink-0">{icon}</div>
      <div>
        <div className="text-xs text-slate-500 uppercase tracking-wider">{title}</div>
        <div className="text-xl font-black text-white mt-0.5">{count} <span className="text-xs text-slate-500 font-normal">signals</span></div>
      </div>
    </Link>
  );
}

// ── Sortable Th ────────────────────────────────────────────────────────────────
function Th({ col, label, right, active, dir, onSort }:
  { col: SortKey; label: string; right?: boolean; active: boolean; dir: SortDir; onSort: (c: SortKey) => void }) {
  return (
    <th onClick={() => onSort(col)} className={`px-3 py-3 text-[10px] font-semibold uppercase tracking-wider cursor-pointer select-none whitespace-nowrap ${right?'text-right':'text-left'} ${active?'text-white':'text-slate-500 hover:text-slate-300'}`}>
      <span className="inline-flex items-center gap-0.5">{label}{active && (dir==='desc'?<ChevronDown className="w-3 h-3"/>:<ChevronUp className="w-3 h-3"/>)}</span>
    </th>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function ConfluenceHub() {
  const [trinity,    setTrinity]    = useState<Trinity[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [sortKey,    setSortKey]    = useState<SortKey>('signals_count');
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
      const [peadRaw, s2Raw, insRaw] = await Promise.all([
        sb(`pead_signals?select=ticker,pead_score,trigger_path,signal_date&gte.signal_date=${cutoff}&gte.pead_score=70&order=pead_score.desc`),
        sb(`stage2_signals?select=ticker,stage2_score,tier,days_in_stage2,signal_date&gte.signal_date=${cutoff}&gte.stage2_score=75&order=stage2_score.desc`),
        sb(`insider_signals?select=ticker,company_name,insider_score,transaction_type,acquirer_name,trade_value_in_cr,tier,signal_date&gte.signal_date=${cutoff}&gte.insider_score=75&order=insider_score.desc`),
      ]) as [PeadRow[], Stage2Row[], InsiderRow[]];

      if (!Array.isArray(peadRaw) || !Array.isArray(s2Raw) || !Array.isArray(insRaw)) {
        throw new Error('Unexpected Supabase response');
      }

      setPeadTotal(peadRaw.length);
      setS2Total(s2Raw.length);
      setInsTotal(insRaw.length);

      // Build maps keyed by ticker (keep highest score per ticker)
      const peadMap  = new Map<string, PeadRow>();
      const s2Map    = new Map<string, Stage2Row>();
      const insMap   = new Map<string, InsiderRow>();

      peadRaw.forEach(r => { if (!peadMap.has(r.ticker) || r.pead_score > (peadMap.get(r.ticker)?.pead_score ?? 0)) peadMap.set(r.ticker, r); });
      s2Raw.forEach(r  => { if (!s2Map.has(r.ticker)   || r.stage2_score > (s2Map.get(r.ticker)?.stage2_score ?? 0))   s2Map.set(r.ticker, r); });
      insRaw.forEach(r => { if (!insMap.has(r.ticker)  || r.insider_score > (insMap.get(r.ticker)?.insider_score ?? 0)) insMap.set(r.ticker, r); });

      // Union of all tickers, then filter to ≥2 signals
      const allTickers = new Set([...peadMap.keys(), ...s2Map.keys(), ...insMap.keys()]);
      const rows: Trinity[] = [];

      for (const ticker of allTickers) {
        const pead    = peadMap.get(ticker);
        const s2      = s2Map.get(ticker);
        const insider = insMap.get(ticker);
        const count   = [pead, s2, insider].filter(Boolean).length;
        if (count < 2) continue;

        const dates   = [pead?.signal_date, s2?.signal_date, insider?.signal_date].filter(Boolean) as string[];
        const totalSc = (pead?.pead_score ?? 0) + (s2?.stage2_score ?? 0) + (insider?.insider_score ?? 0);

        rows.push({
          ticker,
          company_name:     insider?.company_name ?? null,
          sector:           null,
          pead_score:       pead?.pead_score ?? null,
          pead_path:        pead?.trigger_path ?? null,
          stage2_score:     s2?.stage2_score ?? null,
          stage2_tier:      s2?.tier ?? null,
          stage2_days:      s2?.days_in_stage2 ?? null,
          insider_score:    insider?.insider_score ?? null,
          insider_type:     insider?.transaction_type ?? null,
          insider_acquirer: insider?.acquirer_name ?? null,
          insider_value_cr: insider?.trade_value_in_cr ?? null,
          signals_count:    count,
          total_score:      totalSc,
          latest_date:      dates.sort().reverse()[0],
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
      const ep = engine === 'insider' ? '/api/insider-trigger' :
                 engine === 'pead'    ? '/api/pead-trigger' :
                 engine === 'stage2'  ? '/api/stage2-trigger' : '/api/pead-trigger';
      const body = engine === 'pead' ? { script: 'pead_engine' } : engine === 'stage2' ? { script: 'stage2_engine' } : {};
      const r = await fetch(ep, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      setTrigMsg(d.ok ? `✓ ${engine} engine dispatched` : `✗ ${d.error}`);
    } catch { setTrigMsg('✗ Network error'); }
    finally { setTriggering(null); }
  };

  // Filter
  const filtered = useMemo(() => {
    if (filter === 'triple')       return trinity.filter(t => t.signals_count === 3);
    if (filter === 'pead_s2')      return trinity.filter(t => t.pead_score != null && t.stage2_score != null && t.insider_score == null);
    if (filter === 'pead_insider') return trinity.filter(t => t.pead_score != null && t.insider_score != null && t.stage2_score == null);
    if (filter === 's2_insider')   return trinity.filter(t => t.stage2_score != null && t.insider_score != null && t.pead_score == null);
    return trinity;
  }, [trinity, filter]);

  // Sort
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const d = sortDir === 'desc' ? -1 : 1;
      if (sortKey === 'latest_date') return d * a.latest_date.localeCompare(b.latest_date);
      const va = (a[sortKey] as number | null) ?? (sortDir==='desc'?-Infinity:Infinity);
      const vb = (b[sortKey] as number | null) ?? (sortDir==='desc'?-Infinity:Infinity);
      return d * ((va as number) - (vb as number));
    });
  }, [filtered, sortKey, sortDir]);

  const onSort = (col: SortKey) => {
    if (sortKey === col) setSortDir(d => d==='desc'?'asc':'desc');
    else { setSortKey(col); setSortDir('desc'); }
  };

  const tripleCount = trinity.filter(t => t.signals_count === 3).length;

  return (
    <div className="min-h-screen bg-[#0d1117] p-3 md:p-5">
      <div className="max-w-[1800px] mx-auto space-y-4">

        {/* ── Title ── */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl md:text-2xl font-black text-white flex items-center gap-2">
              अर्थ<span className="text-emerald-400">.</span>
              <span className="text-base text-slate-400 font-normal ml-2">Master Confluence Hub</span>
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Trinity Matrix — tickers confirmed by ≥2 of 3 engines · 45-day rolling window
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {[['pead','⚡','Earnings','bg-amber-600 hover:bg-amber-500'],
              ['stage2','🏔️','Stage 2','bg-blue-700 hover:bg-blue-600'],
              ['insider','🕵️','Insider','bg-violet-700 hover:bg-violet-600'],
            ].map(([eng, em, lbl, cls]) => (
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
            <AlertCircle className="w-4 h-4 shrink-0"/>{error}
          </div>
        )}

        {/* ── Engine Nav Cards ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <EngineCard icon={<Zap className="w-5 h-5 text-amber-400"/>} title="PEAD Engine" href="/pead" count={peadTotal} color="border-amber-500/30 hover:border-amber-400/50"/>
          <EngineCard icon={<Layers className="w-5 h-5 text-blue-400"/>} title="Stage 2 Hub" href="/stage2" count={s2Total} color="border-blue-500/30 hover:border-blue-400/50"/>
          <EngineCard icon={<Eye className="w-5 h-5 text-violet-400"/>} title="Insider Intel" href="/insider" count={insTotal} color="border-violet-500/30 hover:border-violet-400/50"/>
          <div className="bg-gradient-to-br from-yellow-600/15 to-amber-600/10 border border-yellow-500/30 rounded-xl p-4 flex items-center gap-3">
            <span className="text-2xl">⭐</span>
            <div>
              <div className="text-xs text-slate-500 uppercase tracking-wider">Triple Crown</div>
              <div className="text-xl font-black text-yellow-300 mt-0.5">{tripleCount} <span className="text-xs text-slate-500 font-normal">tickers</span></div>
            </div>
          </div>
        </div>

        {/* ── Filter pills ── */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-1 gap-1 flex-wrap">
            {([
              ['all',          '🔭 All Confluences'],
              ['triple',       '⭐ Triple Crown (3/3)'],
              ['pead_s2',      '⚡🏔️ PEAD + Stage 2'],
              ['pead_insider', '⚡🕵️ PEAD + Insider'],
              ['s2_insider',   '🏔️🕵️ Stage 2 + Insider'],
            ] as [FilterMode,string][]).map(([v,l])=>(
              <button key={v} onClick={()=>setFilter(v)}
                className={`px-3 py-1 text-xs rounded font-medium transition whitespace-nowrap ${filter===v?'bg-slate-600 text-white':'text-slate-400 hover:text-white'}`}>{l}</button>
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
            <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: 'min(720px, calc(100vh - 240px))' }}>
              <table className="w-full text-xs border-collapse" style={{ minWidth: '1200px' }}>
                <thead className="sticky top-0 z-20">
                  <tr className="bg-[#161b22] border-b-2 border-slate-700">
                    <th className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400 bg-[#161b22] sticky left-0 z-30 whitespace-nowrap min-w-[160px]">
                      Ticker
                    </th>
                    <Th col="signals_count" label="Confluence"  active={sortKey==='signals_count'} dir={sortDir} onSort={onSort} />
                    <Th col="total_score"   label="Total Score" active={sortKey==='total_score'}   dir={sortDir} onSort={onSort} right />
                    <Th col="pead_score"    label="⚡ PEAD"      active={sortKey==='pead_score'}    dir={sortDir} onSort={onSort} right />
                    <Th col="stage2_score"  label="🏔️ Stage 2"   active={sortKey==='stage2_score'}  dir={sortDir} onSort={onSort} right />
                    <Th col="insider_score" label="🕵️ Insider"   active={sortKey==='insider_score'} dir={sortDir} onSort={onSort} right />
                    <th className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">Insider Detail</th>
                    <Th col="latest_date"   label="Latest"       active={sortKey==='latest_date'}   dir={sortDir} onSort={onSort} />
                    <th className="px-3 py-3 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">Links</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(row => {
                    const badge  = confluenceBadge(row.signals_count);
                    const rowBg  = row.signals_count === 3
                      ? 'bg-yellow-950/15 hover:bg-yellow-950/30 border-b border-yellow-900/20'
                      : 'hover:bg-slate-800/30 border-b border-slate-800/50';
                    const stkBg  = row.signals_count === 3 ? '#1a1500' : '#0d1117';

                    return (
                      <tr key={row.ticker} className={`transition-colors ${rowBg}`}>
                        {/* Ticker */}
                        <td className="px-3 py-3 sticky left-0 z-10 whitespace-nowrap" style={{ backgroundColor: stkBg }}>
                          <a href={`https://www.screener.in/company/${row.ticker}/`} target="_blank" rel="noopener noreferrer"
                            className="font-bold text-white hover:text-blue-400 transition text-sm">{row.ticker}</a>
                          {row.company_name && (
                            <div className="text-slate-500 text-[10px] truncate max-w-[140px]">{row.company_name}</div>
                          )}
                        </td>

                        {/* Confluence badge */}
                        <td className="px-3 py-3 whitespace-nowrap">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${badge.cls}`}>{badge.label}</span>
                          <div className="flex gap-0.5 mt-1">
                            {row.pead_score    != null && <span className="text-[9px] bg-amber-500/20 text-amber-400 px-1 py-0.5 rounded">PEAD</span>}
                            {row.stage2_score  != null && <span className="text-[9px] bg-blue-500/20 text-blue-400 px-1 py-0.5 rounded">S2</span>}
                            {row.insider_score != null && <span className={`text-[9px] px-1 py-0.5 rounded ${row.insider_type==='BUY'?'bg-emerald-500/20 text-emerald-400':'bg-red-500/20 text-red-400'}`}>
                              {row.insider_type==='BUY'?'↑BUY':'↓SELL'}
                            </span>}
                          </div>
                        </td>

                        {/* Total score */}
                        <td className="px-3 py-3 text-right whitespace-nowrap">
                          <span className="text-base font-black text-white">{row.total_score}</span>
                        </td>

                        {/* PEAD score */}
                        <td className={`px-3 py-3 text-right whitespace-nowrap ${scoreBadge(row.pead_score)}`}>
                          {row.pead_score != null ? (
                            <div>
                              <div>{row.pead_score}</div>
                              <div className="text-[9px] text-slate-600">{row.pead_path}</div>
                            </div>
                          ) : <span className="text-slate-700">—</span>}
                        </td>

                        {/* Stage 2 score */}
                        <td className={`px-3 py-3 text-right whitespace-nowrap ${scoreBadge(row.stage2_score)}`}>
                          {row.stage2_score != null ? (
                            <div>
                              <div>{row.stage2_score}</div>
                              {row.stage2_days != null && (
                                <div className={`text-[9px] ${row.stage2_days<=15?'text-emerald-600':'text-slate-600'}`}>{row.stage2_days}d</div>
                              )}
                            </div>
                          ) : <span className="text-slate-700">—</span>}
                        </td>

                        {/* Insider score */}
                        <td className={`px-3 py-3 text-right whitespace-nowrap ${scoreBadge(row.insider_score)}`}>
                          {row.insider_score != null ? (
                            <div className="flex items-center justify-end gap-1">
                              {row.insider_type==='BUY'
                                ? <TrendingUp className="w-3 h-3 text-emerald-400"/>
                                : <TrendingDown className="w-3 h-3 text-red-400"/>}
                              {row.insider_score}
                            </div>
                          ) : <span className="text-slate-700">—</span>}
                        </td>

                        {/* Insider detail */}
                        <td className="px-3 py-3 whitespace-nowrap">
                          {row.insider_acquirer ? (
                            <div>
                              <div className="text-slate-300 text-[11px] truncate max-w-[160px]">{row.insider_acquirer}</div>
                              {row.insider_value_cr != null && (
                                <div className="text-slate-500 text-[10px]">₹{row.insider_value_cr.toFixed(1)}Cr</div>
                              )}
                            </div>
                          ) : <span className="text-slate-700">—</span>}
                        </td>

                        {/* Latest date */}
                        <td className="px-3 py-3 text-slate-400 whitespace-nowrap">{fmtDate(row.latest_date)}</td>

                        {/* Links */}
                        <td className="px-3 py-3 text-center whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1">
                            <a href={`https://in.tradingview.com/symbols/NSE-${row.ticker}/`} target="_blank" rel="noopener noreferrer"
                              className="text-[10px] text-slate-500 hover:text-blue-400 border border-slate-700 hover:border-blue-500 px-1.5 py-0.5 rounded transition">
                              TV
                            </a>
                            <a href={`https://www.screener.in/company/${row.ticker}/`} target="_blank" rel="noopener noreferrer"
                              className="text-[10px] text-slate-500 hover:text-emerald-400 border border-slate-700 hover:border-emerald-500 px-1.5 py-0.5 rounded transition">
                              SCR
                            </a>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 border-t border-slate-800 flex justify-between text-[10px] text-slate-600">
              <span>{sorted.length} confluence signals · ⭐ Triple Crown = all 3 engines aligned · 45-day window</span>
              <span>TV = TradingView · SCR = Screener.in</span>
            </div>
          </div>
        )}

        {/* ── Footer nav ── */}
        <div className="flex flex-wrap gap-3 text-xs text-slate-600 pb-4">
          {[['⚡ PEAD','/pead'],['🏔️ Stage 2','/stage2'],['🕵️ Insider','/insider'],['📊 Portfolio','/portfolio']].map(([l,h])=>(
            <Link key={h} href={h} className="hover:text-slate-300 transition">{l}</Link>
          ))}
        </div>

      </div>
    </div>
  );
}

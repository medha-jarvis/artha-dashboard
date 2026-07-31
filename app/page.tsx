'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { TrendingUp, TrendingDown, RefreshCw, BarChart2, PieChart, Target, BookOpen, Eye, Wallet, Zap } from 'lucide-react';

const fmtAbs = (n: number) =>
  Math.abs(n) >= 1e7 ? `₹${(n / 1e7).toFixed(2)}Cr`
    : Math.abs(n) >= 1e5 ? `₹${(n / 1e5).toFixed(2)}L`
      : `₹${n.toFixed(0)}`;

const pct = (n: number | null) => n != null ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : '—';

interface Summary {
  totalValue: number;
  totalInvested: number;
  totalNetInvested: number;
  totalGain: number;
  gainPct: number;
  totalPnlAll: number;
  totalPnlPctAll: number;
  xirr: number | null;
  twrrAnnualised: number;
  twrrPeriods: { ytd?: number | null; '1yr': number | null; inception: number };
  holdingsCount: number;
  totalDayChange: number | null;
  totalDayChangePct: number | null;
  latestNAV: number | null;
}

const NAV_CARDS = [
  {
    href: '/portfolio',
    icon: BarChart2,
    title: 'Portfolio',
    description: 'Holdings table, IRR, valuation metrics, sector allocation, NAV chart',
    color: 'from-emerald-600/20 to-emerald-800/10 border-emerald-500/30 hover:border-emerald-400/50',
    iconColor: 'text-emerald-400',
    badge: 'Live',
    badgeColor: 'bg-emerald-500/20 text-emerald-300',
  },
  {
    href: '/pead',
    icon: Zap,
    title: 'PEAD Engine',
    description: 'Post-earnings drift signals — Path A (VCP beat) & Path B (trap reversal) with T+1/T+5/T+20 drift tracking',
    color: 'from-amber-600/20 to-amber-800/10 border-amber-500/30 hover:border-amber-400/50',
    iconColor: 'text-amber-400',
    badge: 'Live',
    badgeColor: 'bg-amber-500/20 text-amber-300',
  },
  {
    href: '#',
    icon: Target,
    title: 'Goals',
    description: 'Financial goals tracker — retirement, home, education',
    color: 'from-blue-600/20 to-blue-800/10 border-blue-500/30 hover:border-blue-400/50',
    iconColor: 'text-blue-400',
    badge: 'Soon',
    badgeColor: 'bg-blue-500/20 text-blue-300',
  },
  {
    href: '#',
    icon: Wallet,
    title: 'Tax & P&L',
    description: 'Capital gains, tax harvesting opportunities, realized P&L',
    color: 'from-violet-600/20 to-violet-800/10 border-violet-500/30 hover:border-violet-400/50',
    iconColor: 'text-violet-400',
    badge: 'Soon',
    badgeColor: 'bg-violet-500/20 text-violet-300',
  },
  {
    href: '#',
    icon: BookOpen,
    title: 'Research',
    description: 'Stock analysis, thesis tracker, smart money moves',
    color: 'from-rose-600/20 to-rose-800/10 border-rose-500/30 hover:border-rose-400/50',
    iconColor: 'text-rose-400',
    badge: 'Soon',
    badgeColor: 'bg-rose-500/20 text-rose-300',
  },
  {
    href: '#',
    icon: Eye,
    title: 'Watchlist',
    description: 'Stocks on radar with buy targets and thesis notes',
    color: 'from-cyan-600/20 to-cyan-800/10 border-cyan-500/30 hover:border-cyan-400/50',
    iconColor: 'text-cyan-400',
    badge: 'Soon',
    badgeColor: 'bg-cyan-500/20 text-cyan-300',
  },
];

export default function HomePage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState('');
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setError(null);
      const res = await fetch('/api/proxy/db/portfolio');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setSummary(data.summary || null);
      setLastUpdated(data.lastUpdated || '');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetch('/api/proxy/db/portfolio/refresh', { method: 'POST' });
      await fetchData();
    } catch { setError('Refresh failed'); }
    finally { setRefreshing(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const dayUp = (summary?.totalDayChange ?? 0) >= 0;
  const gainUp = (summary?.totalPnlAll ?? summary?.totalGain ?? 0) >= 0;

  return (
    <div className="min-h-screen bg-slate-950 p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-8">

        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-3xl font-black text-white tracking-tight">
                अर्थ<span className="text-emerald-400">.</span>
              </h1>
              <span className="text-xs bg-slate-800 border border-slate-700 text-slate-400 px-2 py-0.5 rounded-full">Personal Finance</span>
            </div>
            <p className="text-slate-500 text-sm">
              {lastUpdated ? `Updated ${new Date(lastUpdated).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}` : 'Loading data…'}
            </p>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {/* KPI Cards */}
        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 animate-pulse">
                <div className="h-3 bg-slate-800 rounded w-20 mb-3"/>
                <div className="h-7 bg-slate-800 rounded w-32 mb-2"/>
                <div className="h-3 bg-slate-800 rounded w-16"/>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="bg-red-900/20 border border-red-500/30 rounded-2xl p-6 text-red-400 text-sm">{error}</div>
        ) : summary ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
              <div className="text-xs text-slate-500 uppercase tracking-wider mb-2">Portfolio Value</div>
              <div className="text-2xl font-bold text-emerald-400">{fmtAbs(summary.totalValue)}</div>
              <div className="text-xs text-slate-500 mt-1">Net Invested: {fmtAbs(summary.totalNetInvested ?? summary.totalInvested)}</div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
              <div className="text-xs text-slate-500 uppercase tracking-wider mb-2">Today&apos;s P&L</div>
              <div className={`text-2xl font-bold flex items-center gap-2 ${dayUp ? 'text-emerald-400' : 'text-red-400'}`}>
                {dayUp ? <TrendingUp className="w-5 h-5 shrink-0"/> : <TrendingDown className="w-5 h-5 shrink-0"/>}
                {summary.totalDayChange != null ? fmtAbs(summary.totalDayChange) : '—'}
              </div>
              <div className={`text-xs mt-1 ${dayUp ? 'text-emerald-500' : 'text-red-500'}`}>
                {pct(summary.totalDayChangePct)}
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
              <div className="text-xs text-slate-500 uppercase tracking-wider mb-2">Total Gain (All)</div>
              <div className={`text-2xl font-bold ${gainUp ? 'text-emerald-400' : 'text-red-400'}`}>
                {pct(summary.totalPnlPctAll ?? summary.gainPct)}
              </div>
              <div className={`text-xs mt-1 ${gainUp ? 'text-emerald-500' : 'text-red-500'}`}>
                {gainUp ? '+' : ''}{fmtAbs(summary.totalPnlAll ?? summary.totalGain)}
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
              <div className="text-xs text-slate-500 uppercase tracking-wider mb-2">XIRR</div>
              <div className={`text-2xl font-bold ${(summary.xirr ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {pct(summary.xirr)}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                TWRR inception: {pct(summary.twrrPeriods?.inception ?? null)}
              </div>
            </div>
          </div>
        ) : null}

        {/* Quick Stats Row */}
        {summary && (
          <div className="flex flex-wrap gap-3 text-sm">
            {[
              { label: 'Holdings', value: `${summary.holdingsCount} stocks` },
              { label: 'NAV', value: summary.latestNAV ? `₹${summary.latestNAV.toFixed(0)}` : '—' },
              { label: 'YTD 2026', value: pct(summary.twrrPeriods?.ytd ?? null) },
              { label: '1Y TWRR', value: pct(summary.twrrPeriods?.['1yr'] ?? null) },
            ].map(s => (
              <div key={s.label} className="bg-slate-900 border border-slate-800 rounded-lg px-4 py-2 flex items-center gap-2">
                <span className="text-slate-500">{s.label}</span>
                <span className="text-white font-semibold">{s.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* Navigation Cards */}
        <div>
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Sections</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {NAV_CARDS.map(card => {
              const Icon = card.icon;
              const isLive = card.badge === 'Live';
              const CardWrapper = ({ children }: { children: React.ReactNode }) =>
                isLive ? (
                  <Link href={card.href} className={`block bg-gradient-to-br ${card.color} border rounded-2xl p-5 transition-all duration-200 group hover:scale-[1.02]`}>
                    {children}
                  </Link>
                ) : (
                  <div className={`bg-gradient-to-br ${card.color} border rounded-2xl p-5 opacity-60 cursor-not-allowed`}>
                    {children}
                  </div>
                );
              return (
                <CardWrapper key={card.title}>
                  <div className="flex items-start justify-between mb-3">
                    <Icon className={`w-6 h-6 ${card.iconColor}`} />
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${card.badgeColor}`}>
                      {card.badge}
                    </span>
                  </div>
                  <div className="font-bold text-white text-lg mb-1 group-hover:text-emerald-100 transition-colors">
                    {card.title}
                  </div>
                  <div className="text-slate-400 text-sm leading-snug">{card.description}</div>
                </CardWrapper>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="text-center text-slate-700 text-xs pb-4">
          अर्थ · Personal Finance · Source: portfolio.db · VPS backend port 5000
        </div>
      </div>
    </div>
  );
}

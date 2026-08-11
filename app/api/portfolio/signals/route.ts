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

export interface PillarSignal { label: string; color: string; detail: string; }
export interface TickerSignal {
  technical: PillarSignal; funda: PillarSignal;
  insider: PillarSignal; events: PillarSignal;
  signal: 'HOLD' | 'WATCH' | 'REVIEW' | 'EXIT'; signalOrder: number;
}

interface PortfolioSignalRow {
  ticker: string;
  tech_label: string; tech_color: string; tech_detail: string;
  funda_label: string; funda_color: string; funda_detail: string;
  insider_label: string; insider_color: string; insider_detail: string;
  events_label: string; events_color: string; events_detail: string;
  signal: string; signal_order: number;
  weekly_score: number; above_40w_sma: boolean; rs_pct: number | null; rsi_weekly: number | null;
  updated_at: string;
}

export async function GET() {
  // Primary source: portfolio_signals (computed by portfolio_signal_tracker.py for ALL portfolio stocks)
  const rows = await sbFetch('portfolio_signals',
    'select=ticker,tech_label,tech_color,tech_detail,funda_label,funda_color,funda_detail,insider_label,insider_color,insider_detail,events_label,events_color,events_detail,signal,signal_order,weekly_score,above_40w_sma,rs_pct,rsi_weekly,updated_at'
  ) as PortfolioSignalRow[];

  const result: Record<string, TickerSignal & { signalOrder: number; score?: number; updatedAt?: string }> = {};

  for (const r of rows) {
    if (!r.ticker || !r.signal) continue;
    result[r.ticker] = {
      technical: { label: r.tech_label    || '—', color: r.tech_color    || 'text-slate-600', detail: r.tech_detail    || '' },
      funda:     { label: r.funda_label   || '—', color: r.funda_color   || 'text-slate-600', detail: r.funda_detail   || '' },
      insider:   { label: r.insider_label || '→', color: r.insider_color || 'text-slate-500', detail: r.insider_detail || '' },
      events:    { label: r.events_label  || '—', color: r.events_color  || 'text-slate-600', detail: r.events_detail  || '' },
      signal:    (r.signal as TickerSignal['signal']) || 'HOLD',
      signalOrder: r.signal_order ?? 3,
      score: r.weekly_score,
      updatedAt: r.updated_at,
    };
  }

  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

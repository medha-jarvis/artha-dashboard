import { NextRequest, NextResponse } from 'next/server';
const VPS_API = process.env.API_BASE_URL || 'http://31.97.227.135/api';
export async function POST() {
  try {
    const r = await fetch(`${VPS_API}/trigger/portfolio-signals`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    const d = await r.json();
    if (!r.ok) return NextResponse.json({ ok: false, error: d.error || `VPS ${r.status}` }, { status: 500 });
    return NextResponse.json(d);
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'error' }, { status: 500 });
  }
}
export async function GET() {
  try {
    const r = await fetch(`${VPS_API}/trigger/portfolio-signals/status`, { signal: AbortSignal.timeout(8000) });
    return NextResponse.json(await r.json());
  } catch (e: unknown) {
    return NextResponse.json({ running: false, error: e instanceof Error ? e.message : 'error' });
  }
}
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

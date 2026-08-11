import { NextResponse } from 'next/server';

const VPS_API = process.env.API_BASE_URL || 'http://31.97.227.135/api';

export async function POST() {
  try {
    const r = await fetch(`${VPS_API}/trigger/refresh-all-signals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    const data = await r.json();
    if (!r.ok) return NextResponse.json({ ok: false, error: data.error || `VPS ${r.status}` }, { status: 500 });
    return NextResponse.json(data);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export const dynamic     = 'force-dynamic';
export const maxDuration = 30;

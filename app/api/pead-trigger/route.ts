import { NextRequest, NextResponse } from 'next/server';

const VPS_API = process.env.API_BASE_URL || 'http://31.97.227.135/api';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const r = await fetch(`${VPS_API}/trigger/pead`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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

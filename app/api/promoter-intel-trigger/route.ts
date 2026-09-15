import { NextRequest, NextResponse } from 'next/server';

const VPS_API = process.env.API_BASE_URL || 'http://31.97.227.135/api';

export async function POST(_req: NextRequest) {
  try {
    const r = await fetch(`${VPS_API}/trigger/promoter-intel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    const text = await r.text();
    let data: Record<string, unknown>;
    try { data = JSON.parse(text); } catch { data = { error: `VPS ${r.status}: ${text.slice(0, 120)}` }; }
    if (!r.ok) return NextResponse.json({ ok: false, error: (data.error as string) || `VPS ${r.status}` }, { status: 500 });
    return NextResponse.json(data);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export const dynamic     = 'force-dynamic';
export const maxDuration = 30;

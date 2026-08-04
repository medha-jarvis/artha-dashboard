import { NextRequest, NextResponse } from 'next/server';

const SB_URL = 'https://jljwgwftuqrabfyiucfl.supabase.co';
const SB_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  '';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const ticker: string | undefined = (body.ticker as string | undefined)?.trim().toUpperCase();
    const company_name: string | null = (body.company_name as string | undefined)?.trim() || null;

    if (!ticker) {
      return NextResponse.json({ error: 'ticker is required' }, { status: 400 });
    }

    if (!SB_SERVICE_KEY) {
      return NextResponse.json({ error: 'Supabase service key not configured' }, { status: 500 });
    }

    const res = await fetch(`${SB_URL}/rest/v1/alpha_watchlist`, {
      method: 'POST',
      headers: {
        apikey:          SB_SERVICE_KEY,
        Authorization:   `Bearer ${SB_SERVICE_KEY}`,
        'Content-Type':  'application/json',
        Prefer:          'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify({
        ticker,
        company_name,
        source: 'MANUAL',
        is_active: true,
        backfill_done: false,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `Supabase error ${res.status}: ${text}` }, { status: 500 });
    }

    return NextResponse.json({ success: true, ticker });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';

const GH_TOKEN = process.env.GITHUB_TOKEN || '';
const REPO     = 'medha-jarvis/artha-dashboard';
const GH_HEADERS = {
  Authorization:          `Bearer ${GH_TOKEN}`,
  Accept:                 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'Content-Type':         'application/json',
};

export async function POST() {
  try {
    const r = await fetch(
      `https://api.github.com/repos/${REPO}/actions/workflows/pulse_cron.yml/dispatches`,
      {
        method: 'POST',
        headers: GH_HEADERS,
        body: JSON.stringify({ ref: 'main', inputs: { script: 'pulse_engine' } }),
        signal: AbortSignal.timeout(15000),
      }
    );
    if (r.status === 204) return NextResponse.json({ ok: true, message: 'Sector Pulse scan dispatched — takes ~5 min' });
    return NextResponse.json({ ok: false, error: await r.text() }, { status: 500 });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Error' }, { status: 500 });
  }
}

export const dynamic    = 'force-dynamic';
export const maxDuration = 30;

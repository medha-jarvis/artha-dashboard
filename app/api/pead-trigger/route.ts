import { NextRequest, NextResponse } from 'next/server';

const GH_TOKEN = process.env.GITHUB_TOKEN || '';
const REPO     = 'medha-jarvis/artha-dashboard';
const GH_HEADERS = {
  Authorization:       `Bearer ${GH_TOKEN}`,
  Accept:              'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'Content-Type':      'application/json',
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const script   = (body.script as string)   || 'pead_engine';
    const daysBack = (body.days_back as string) || '7';

    const isBackfill   = script === 'backfill';
    const workflowFile = isBackfill ? 'backfill.yml' : 'pead_cron.yml';
    // pead_cron.yml only accepts { script }; backfill.yml only accepts { days }
    const inputs = isBackfill ? { days: daysBack } : { script };

    const ghRes = await fetch(
      `https://api.github.com/repos/${REPO}/actions/workflows/${workflowFile}/dispatches`,
      {
        method: 'POST',
        headers: GH_HEADERS,
        body: JSON.stringify({ ref: 'main', inputs }),
        signal: AbortSignal.timeout(15000),
      }
    );

    if (ghRes.status === 204) {
      const label = isBackfill ? 'Backfill' : script === 'drift_tracker' ? 'Drift tracker' : 'Engine scan';
      return NextResponse.json({ ok: true, message: `${label} dispatched to GitHub Actions` });
    }

    const err = await ghRes.text();
    return NextResponse.json({ ok: false, error: `GitHub ${ghRes.status}: ${err}` }, { status: 500 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export const dynamic  = 'force-dynamic';
export const maxDuration = 30;

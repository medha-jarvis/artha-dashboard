import { NextRequest, NextResponse } from 'next/server';

const GH_TOKEN = process.env.GITHUB_TOKEN || '';
const REPO     = 'medha-jarvis/artha-dashboard';
const GH_HEADERS = {
  Authorization:          `Bearer ${GH_TOKEN}`,
  Accept:                 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'Content-Type':         'application/json',
};

export async function POST(req: NextRequest) {
  try {
    const body   = await req.json().catch(() => ({}));
    const script = (body.script as string) || 'stage2_engine';

    const isBackfill   = script === 'backfill_stage2';
    const workflowFile = isBackfill ? 'backfill_stage2.yml' : 'stage2_cron.yml';
    const inputs       = isBackfill ? { days: '7' } : { script };

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
      const label = isBackfill ? 'Stage 2 Backfill (7 days)' :
                    script === 'stage2_tracker' ? 'Return tracker' : 'Stage 2 scan';
      return NextResponse.json({ ok: true, message: `${label} dispatched` });
    }
    const err = await ghRes.text();
    return NextResponse.json({ ok: false, error: `GitHub ${ghRes.status}: ${err}` }, { status: 500 });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Error' }, { status: 500 });
  }
}

export const dynamic     = 'force-dynamic';
export const maxDuration = 30;

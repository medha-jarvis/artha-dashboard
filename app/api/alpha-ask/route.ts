import { NextRequest, NextResponse } from 'next/server';

const SB_URL  = 'https://jljwgwftuqrabfyiucfl.supabase.co';
const SB_KEY  = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const OR_KEY  = process.env.OPENROUTER_API_KEY || '';
const VPS_API = process.env.API_BASE_URL || 'http://31.97.227.135:5000/api';
const FLASH   = 'deepseek/deepseek-v4-flash';
const PRO     = 'deepseek/deepseek-v4-pro';

const VALUE_CHAINS: Record<string, string[]> = {
  'capex infrastructure':   ['POLYCAB','KEI','INTERARCH'],
  'electronics ems':        ['DIXON','KAYNES'],
  'lending nbfc':           ['BAJFINANCE','HDFCBANK','AAVAS','HOMEFIRST'],
  'it services':            ['INFY','TCS','LTTS','PERSISTENT','OFSS'],
  'capital markets':        ['IEX','INDIAMART'],
  'consumer discretionary': ['TITAN','KALYANKJIL','SENCO','VBL'],
  'healthcare':             ['NH','RAINBOW'],
  'auto mobility':          ['M&M','SHRIPISTON'],
};
const ALL_TICKERS = ['AAVAS','APLAPOLLO','BAJFINANCE','CMSINFO','COALINDIA','DIXON','E2E',
  'HDFCBANK','HOMEFIRST','IEX','INDIAMART','INFY','INTERARCH','KALYANKJIL','KAYNES','KEI',
  'LTTS','M&M','NH','OFSS','PERSISTENT','PFC','POLYCAB','RAINBOW','REDINGTON','SAGILITY',
  'SENCO','SHRIPISTON','TCS','TITAN','VBL','VINATIORGA'];

async function sbGet(path: string): Promise<any[]> {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
      cache: 'no-store',
    });
    if (!r.ok) return [];
    return r.json();
  } catch { return []; }
}

async function tsSearch(q: string, tickers: string[]): Promise<string> {
  if (!q.trim()) return '';
  try {
    const ticker = tickers.length ? tickers.slice(0, 8).join(',') : '';
    const url = `${VPS_API}/ts-search?q=${encodeURIComponent(q)}&limit=6${ticker ? `&ticker=${ticker}` : ''}`;
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return '';
    const d = await r.json();
    return (d.hits || []).map((h: any) =>
      `[${h.ticker} ${h.quarter}] ${h.snippet}`
    ).join('\n\n');
  } catch { return ''; }
}

async function planQuery(query: string, history: string[]): Promise<any> {
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OR_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: FLASH,
      messages: [{
        role: 'system',
        content: `You plan intelligence queries for an Indian stock portfolio system.
Value chains: ${JSON.stringify(VALUE_CHAINS)}
All portfolio tickers: ${ALL_TICKERS.join(',')}
Return JSON only:
{"tickers":["list, empty=all"],"uc_focus":[1-24, empty=all triggered],"text_query":"for full-text search","intent":"STOCK|COMPARE|SECTOR|GENERAL"}`
      }, ...history.slice(-4).map((h,i) => ({role: i%2===0?'user':'assistant',content:h})),
        {role:'user',content:query}
      ],
      response_format: {type:'json_object'}, temperature: 0, max_tokens: 256,
    }),
  });
  try {
    const d = await r.json();
    return JSON.parse(d.choices?.[0]?.message?.content || '{}');
  } catch { return {tickers:[],uc_focus:[],text_query:query,intent:'GENERAL'}; }
}

async function buildContext(plan: any, query: string): Promise<string> {
  const tickers: string[] = plan.tickers?.length ? plan.tickers : [];
  const ucFocus: number[] = plan.uc_focus || [];
  const parts: string[] = [];

  // Parallel fetches — all token-capped
  const tickerFilter = tickers.length ? `ticker=in.(${tickers.join(',')})` : '';

  const [profiles, creds, sigs, evals, tsResults] = await Promise.all([
    sbGet(`alpha_intelligence_profiles?${tickerFilter || 'composite_score=gt.0'}&select=ticker,composite_score,composite_trend,guidance_trend,order_book_health,evasiveness_3q_avg,last_quarter,quarters_tracked&order=composite_score.desc&limit=15`),
    sbGet(`alpha_management_credibility?${tickerFilter || ''}&select=ticker,credibility_score,promises_kept,promises_total,trend&order=credibility_score.desc&limit=15`),
    sbGet(`alpha_signals?${tickerFilter || ''}&select=ticker,composite_score,signal_type,entry_exit,quarter,fiscal_year&order=signal_date.desc&limit=20`),
    sbGet(`alpha_evaluations?${tickerFilter || 'triggered=eq.true'}&${ucFocus.length ? `uc_number=in.(${ucFocus.join(',')})&` : 'triggered=eq.true&'}select=ticker,uc_number,uc_name,result_json,quarter,fiscal_year&order=created_at.desc&limit=25`),
    tsSearch(plan.text_query || query, tickers),
  ]);

  if (profiles.length) parts.push('## Intelligence Profiles\n' + JSON.stringify(profiles).slice(0, 4000));
  if (creds.some(c => c.promises_total > 0)) parts.push('## Management Credibility\n' + JSON.stringify(creds).slice(0, 2000));
  if (evals.length) parts.push('## Key Findings (triggered evaluations)\n' + JSON.stringify(evals).slice(0, 6000));
  if (sigs.length) parts.push('## Latest Signals\n' + JSON.stringify(sigs).slice(0, 2000));
  if (tsResults) parts.push('## Relevant Transcript Excerpts\n' + tsResults.slice(0, 3000));

  return parts.join('\n\n');
}

export async function POST(req: NextRequest) {
  if (!OR_KEY) return NextResponse.json({error:'OpenRouter key not configured'},{status:500});

  const {query, history = []} = await req.json().catch(()=>({query:'',history:[]}));
  if (!query?.trim()) return NextResponse.json({error:'Empty query'},{status:400});

  try {
    // Step 1: plan (fast)
    const plan = await planQuery(query, history);

    // Step 2: retrieve context
    const context = await buildContext(plan, query);

    // Step 3: stream synthesis
    const histMsgs = (history as string[]).map((h,i) => ({
      role: (i%2===0?'user':'assistant') as 'user'|'assistant', content: h
    }));

    const orResp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OR_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: PRO,
        messages: [
          { role: 'system', content:
            `You are Medha, an elite Indian equity analyst. Use the intelligence data below to answer. Be specific, cite numbers, mention quarters, flag contradictions. If data is sparse, say so honestly and suggest what to check.

${context || '(No data yet — backfill may still be running. Answer based on general knowledge and note that live data is being indexed.)'}` },
          ...histMsgs,
          { role: 'user', content: query },
        ],
        temperature: 0.3, max_tokens: 1200, stream: true,
      }),
    });

    if (!orResp.ok) {
      const err = await orResp.text();
      return NextResponse.json({error:`OpenRouter error: ${err.slice(0,200)}`},{status:500});
    }

    // Stream SSE → plain text
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      async start(ctrl) {
        const reader = orResp.body!.getReader();
        const dec = new TextDecoder();
        let buf = '';
        try {
          while (true) {
            const {done, value} = await reader.read();
            if (done) break;
            buf += dec.decode(value, {stream:true});
            const lines = buf.split('\n');
            buf = lines.pop() || '';
            for (const line of lines) {
              const clean = line.replace(/^data:\s*/,'').trim();
              if (!clean || clean === '[DONE]') continue;
              try {
                const chunk = JSON.parse(clean);
                const t = chunk.choices?.[0]?.delta?.content;
                if (t) ctrl.enqueue(enc.encode(t));
              } catch {}
            }
          }
        } finally { ctrl.close(); }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache, no-store',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (e:any) {
    return NextResponse.json({error: e.message}, {status:500});
  }
}

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

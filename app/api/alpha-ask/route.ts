import { NextRequest, NextResponse } from 'next/server';

const SB_URL = 'https://jljwgwftuqrabfyiucfl.supabase.co';
const SB_KEY = process.env.SUPABASE_SERVICE_KEY ||
               process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const OR_KEY = process.env.OPENROUTER_API_KEY || '';

const FLASH = 'deepseek/deepseek-v4-flash';
const PRO   = 'deepseek/deepseek-v4-pro';

const VALUE_CHAINS: Record<string, string[]> = {
  'capex infrastructure':  ['POLYCAB','KEI','INTERARCH'],
  'electronics ems':       ['DIXON','KAYNES'],
  'lending nbfc':          ['BAJFINANCE','HDFCBANK','AAVAS','HOMEFIRST'],
  'it services':           ['INFY','TCS','LTTS','PERSISTENT','OFSS'],
  'capital markets':       ['IEX','INDIAMART'],
  'consumer discretionary':['TITAN','KALYANKJIL','SENCO','VBL'],
  'healthcare':            ['NH','RAINBOW'],
  'auto mobility':         ['M&M','SHRIPISTON'],
};

async function sbFetch(path: string) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
               'Content-Type': 'application/json' },
    cache: 'no-store',
  });
  return r.ok ? r.json() : [];
}

async function planQuery(query: string, history: string[]): Promise<any> {
  const vcJson = JSON.stringify(VALUE_CHAINS);
  const systemPrompt = `You are a query planner for an Indian stock market intelligence system.
Value chain groups: ${vcJson}
Portfolio stocks: AAVAS,APLAPOLLO,BAJFINANCE,CMSINFO,COALINDIA,DIXON,E2E,HDFCBANK,HOMEFIRST,IEX,INDIAMART,INFY,INTERARCH,KALYANKJIL,KAYNES,KEI,LTTS,M&M,NH,OFSS,PERSISTENT,PFC,POLYCAB,RAINBOW,REDINGTON,SAGILITY,SENCO,SHRIPISTON,TCS,TITAN,VBL,VINATIORGA

Parse the user query and return a JSON plan:
{
  "intent": "STOCK_SPECIFIC|COMPARISON|SECTOR_THEME|CREDIBILITY|TREND|GENERAL",
  "tickers": ["array of relevant tickers - expand value chain if theme detected"],
  "uc_focus": [list of UC numbers 1-24 most relevant, empty=all],
  "time_filter_quarters": 4,
  "summary": "one line of what to retrieve"
}`;

  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OR_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: FLASH,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: query },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1, max_tokens: 512,
    }),
  });
  const d = await r.json();
  try { return JSON.parse(d.choices[0].message.content); }
  catch { return { intent: 'GENERAL', tickers: [], uc_focus: [], time_filter_quarters: 4 }; }
}

async function retrieveContext(plan: any): Promise<string> {
  const parts: string[] = [];
  const tickers: string[] = plan.tickers || [];
  const ucFocus: number[] = plan.uc_focus || [];

  // 1. Intelligence profiles
  if (tickers.length > 0) {
    const tickerIn = tickers.map((t: string) => `"${t}"`).join(',');
    const profiles = await sbFetch(
      `alpha_intelligence_profiles?ticker=in.(${tickers.join(',')})&select=*&limit=20`);
    if (profiles.length) {
      parts.push('## Intelligence Profiles\n' + JSON.stringify(profiles, null, 1));
    }

    // 2. Management credibility
    const cred = await sbFetch(
      `alpha_management_credibility?ticker=in.(${tickers.join(',')})&select=*`);
    if (cred.length) {
      parts.push('## Management Credibility\n' + JSON.stringify(cred, null, 1));
    }

    // 3. Triggered evaluations for context
    let evalPath = `alpha_evaluations?ticker=in.(${tickers.join(',')})&triggered=eq.true&select=ticker,uc_name,uc_number,result_json,quarter,fiscal_year&order=created_at.desc&limit=30`;
    if (ucFocus.length > 0) {
      evalPath = `alpha_evaluations?ticker=in.(${tickers.join(',')})&uc_number=in.(${ucFocus.join(',')})&select=ticker,uc_name,uc_number,result_json,quarter,fiscal_year,triggered&order=created_at.desc&limit=40`;
    }
    const evals = await sbFetch(evalPath);
    if (evals.length) {
      parts.push('## Relevant Evaluations\n' + JSON.stringify(evals, null, 1));
    }

    // 4. Recent signals
    const sigs = await sbFetch(
      `alpha_signals?ticker=in.(${tickers.join(',')})&select=*&order=signal_date.desc&limit=20`);
    if (sigs.length) {
      parts.push('## Recent Signals\n' + JSON.stringify(sigs, null, 1));
    }
  } else {
    // General query — get overview
    const profiles = await sbFetch(
      `alpha_intelligence_profiles?select=*&order=composite_score.desc&limit=15`);
    parts.push('## Top Intelligence Profiles\n' + JSON.stringify(profiles, null, 1));

    const alerts = await sbFetch(
      `alpha_evaluations?triggered=eq.true&select=ticker,uc_name,result_json,quarter&order=created_at.desc&limit=20`);
    if (alerts.length) parts.push('## Recent Alerts\n' + JSON.stringify(alerts, null, 1));
  }

  return parts.join('\n\n').slice(0, 40000);
}

export async function POST(req: NextRequest) {
  try {
    const { query, history = [] } = await req.json();
    if (!query?.trim()) return NextResponse.json({ error: 'Empty query' }, { status: 400 });

    // Step 1: Plan
    const plan = await planQuery(query, history);

    // Step 2: Retrieve
    const context = await retrieveContext(plan);

    // Step 3: Synthesize (streaming)
    const historyMsgs = (history as string[]).map((h, i) =>
      ({ role: i % 2 === 0 ? 'user' : 'assistant', content: h }));

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OR_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: PRO,
        messages: [
          {
            role: 'system',
            content: `You are Medha, an elite Indian equity analyst. Answer questions about portfolio companies using the intelligence data below. Be specific, cite exact numbers from the data, flag contradictions, and suggest follow-up questions. Data covers concall evaluations, management credibility, and composite intelligence scores.

RETRIEVED CONTEXT:
${context}`,
          },
          ...historyMsgs,
          { role: 'user', content: query },
        ],
        temperature: 0.3, max_tokens: 1500, stream: true,
      }),
    });

    // Stream the response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') { controller.close(); return; }
            try {
              const j = JSON.parse(data);
              const t = j.choices?.[0]?.delta?.content;
              if (t) controller.enqueue(encoder.encode(t));
            } catch {}
          }
        }
        controller.close();
      },
    });

    return new Response(stream, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8',
                 'Cache-Control': 'no-cache', 'X-Alpha-Plan': plan.intent },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

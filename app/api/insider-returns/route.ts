import { NextRequest, NextResponse } from 'next/server';

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function findPriceNear(timestamps: number[], prices: (number | null)[], targetTs: number): number | null {
  let best: number | null = null;
  let minDiff = Infinity;
  for (let i = 0; i < timestamps.length; i++) {
    const diff = Math.abs(timestamps[i] - targetTs);
    if (diff < minDiff && prices[i] != null) {
      minDiff = diff;
      best = prices[i];
    }
  }
  // Only accept if within 5 trading days (~7 calendar days)
  return minDiff <= 7 * 86400 ? best : null;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ticker = searchParams.get('ticker');
  const date = searchParams.get('date');

  if (!ticker || !date) {
    return NextResponse.json({ error: 'Missing ticker or date' }, { status: 400 });
  }

  const signalDate = new Date(date + 'T00:00:00Z');
  const now = new Date();
  const nseSymbol = encodeURIComponent(ticker + '.NS');

  const period1 = Math.floor(signalDate.getTime() / 1000) - 86400;
  const period2 = Math.floor(now.getTime() / 1000);

  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${nseSymbol}?period1=${period1}&period2=${period2}&interval=1d&includePrePost=false`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          Accept: 'application/json',
        },
        next: { revalidate: 3600 },
      }
    );

    if (!res.ok) {
      return NextResponse.json({ error: `Yahoo Finance returned ${res.status}` }, { status: 502 });
    }

    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) {
      return NextResponse.json({ error: 'No chart data from Yahoo Finance' }, { status: 404 });
    }

    const timestamps: number[] = result.timestamp || [];
    const closes: (number | null)[] = result.indicators?.quote?.[0]?.close || [];

    const sigTs = Math.floor(signalDate.getTime() / 1000);
    const ts30 = Math.floor(addDays(signalDate, 30).getTime() / 1000);
    const ts90 = Math.floor(addDays(signalDate, 90).getTime() / 1000);
    const ts180 = Math.floor(addDays(signalDate, 180).getTime() / 1000);

    const basePrice = findPriceNear(timestamps, closes, sigTs);
    const price30d = findPriceNear(timestamps, closes, ts30);
    const price90d = findPriceNear(timestamps, closes, ts90);
    const price180d = findPriceNear(timestamps, closes, ts180);
    const priceCurrent = closes.filter(Boolean).slice(-1)[0] ?? null;

    const pct = (p: number | null) =>
      basePrice && p ? parseFloat(((p - basePrice) / basePrice * 100).toFixed(2)) : null;

    const chartData = timestamps
      .map((ts, i) => ({
        date: new Date(ts * 1000).toISOString().split('T')[0],
        price: closes[i] != null ? parseFloat((closes[i] as number).toFixed(2)) : null,
      }))
      .filter(d => d.price != null);

    return NextResponse.json({
      ticker,
      signal_date: date,
      base_price: basePrice ? parseFloat(basePrice.toFixed(2)) : null,
      price_30d: price30d ? parseFloat(price30d.toFixed(2)) : null,
      price_90d: price90d ? parseFloat(price90d.toFixed(2)) : null,
      price_180d: price180d ? parseFloat(price180d.toFixed(2)) : null,
      price_current: priceCurrent ? parseFloat((priceCurrent as number).toFixed(2)) : null,
      return_30d: pct(price30d),
      return_90d: pct(price90d),
      return_180d: pct(price180d),
      return_current: pct(priceCurrent),
      chart_data: chartData,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

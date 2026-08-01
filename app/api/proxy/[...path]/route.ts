import { NextRequest, NextResponse } from 'next/server';

const API_BASE = process.env.API_BASE_URL || 'http://31.97.227.135:5000/api';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const resolvedParams = await params;
    const path = resolvedParams.path.join('/');
    const searchParams = request.nextUrl.searchParams.toString();
    const url = `${API_BASE}/${path}${searchParams ? `?${searchParams}` : ''}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API returned ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'no-store, must-revalidate' },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to fetch data from API', details: error.message, apiBase: API_BASE, timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const resolvedParams = await params;
    const path = resolvedParams.path.join('/');
    const url = `${API_BASE}/${path}`;

    const body = await request.text().catch(() => '');
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body || undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API returned ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'no-store, must-revalidate' },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to POST to API', details: error.message, apiBase: API_BASE, timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

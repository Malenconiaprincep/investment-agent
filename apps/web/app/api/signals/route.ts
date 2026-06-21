import { NextResponse } from 'next/server';
import { runAgentCoreWatchlistJson } from '@/lib/agent-core';

export const runtime = 'nodejs';
export const maxDuration = 180;

function checkCronAuth(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('scan') === '1') {
    if (!checkCronAuth(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    try {
      const stdout = await runAgentCoreWatchlistJson(['diamond-scan', 'watchlist']);
      return NextResponse.json(JSON.parse(stdout));
    } catch (error) {
      const message = error instanceof Error ? error.message : '钻石扫描失败';
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  try {
    const stdout = await runAgentCoreWatchlistJson(['diamond-list']);
    return NextResponse.json(JSON.parse(stdout));
  } catch (error) {
    const message = error instanceof Error ? error.message : '读取信号失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const json: unknown = await request.json().catch(() => ({}));
    const mode =
      (json as { mode?: string }).mode === 'latest-screening'
        ? 'latest-screening'
        : 'watchlist';
    const stdout = await runAgentCoreWatchlistJson(['diamond-scan', mode]);
    return NextResponse.json(JSON.parse(stdout));
  } catch (error) {
    const message = error instanceof Error ? error.message : '钻石扫描失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

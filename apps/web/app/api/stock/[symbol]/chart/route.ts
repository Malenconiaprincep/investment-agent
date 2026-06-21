import { NextResponse } from 'next/server';
import { runAgentCoreWatchlistJson } from '@/lib/agent-core';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ symbol: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const { symbol } = await context.params;
    const { searchParams } = new URL(request.url);
    const days = searchParams.get('days') ?? '120';
    const stdout = await runAgentCoreWatchlistJson(['stock-chart', symbol, days]);
    return NextResponse.json(JSON.parse(stdout));
  } catch (error) {
    const message = error instanceof Error ? error.message : '读取股票图表失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

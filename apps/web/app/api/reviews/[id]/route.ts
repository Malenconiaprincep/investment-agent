import { NextResponse } from 'next/server';
import { runAgentCoreWatchlistJson } from '@/lib/agent-core';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const stdout = await runAgentCoreWatchlistJson(['weekly-get', id]);
    return NextResponse.json(JSON.parse(stdout));
  } catch (error) {
    const message = error instanceof Error ? error.message : '读取周报失败';
    return NextResponse.json({ error: message }, { status: 404 });
  }
}

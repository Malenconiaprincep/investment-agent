import { NextResponse } from 'next/server';
import { runAgentCoreWatchlistJson } from '@/lib/agent-core';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const stdout = await runAgentCoreWatchlistJson(['get', id]);
    return NextResponse.json(JSON.parse(stdout));
  } catch (error) {
    const message = error instanceof Error ? error.message : '读取失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    await runAgentCoreWatchlistJson(['remove', id]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : '删除失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

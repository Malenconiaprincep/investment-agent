import { NextResponse } from 'next/server';
import { streamAgentCoreStockDailyCsvUpdate } from '@/lib/agent-core';
import { requireProScheduledTasks } from '@/lib/scheduled-tasks-access';

export const runtime = 'nodejs';

export async function POST() {
  try {
    await requireProScheduledTasks();
    const response = await streamAgentCoreStockDailyCsvUpdate();
    return new Response(response.body, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '启动股票日线更新失败';
    const status = message.includes('登录')
      ? 401
      : message.includes('Pro')
        ? 403
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

import { NextResponse } from 'next/server';
import { runAgentCoreStockDailyMarketDataSync } from '@/lib/agent-core';
import { requireProScheduledTasks } from '@/lib/scheduled-tasks-access';

export const runtime = 'nodejs';

export async function POST() {
  try {
    await requireProScheduledTasks();
    const result = await runAgentCoreStockDailyMarketDataSync();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : '同步股票日线失败';
    const status = message.includes('登录')
      ? 401
      : message.includes('Pro')
        ? 403
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

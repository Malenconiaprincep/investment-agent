import { NextResponse } from 'next/server';
import { requireProScheduledTasks } from '@/lib/scheduled-tasks-access';
import { fetchAgentCoreScheduledTaskLogs } from '@/lib/agent-core';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    await requireProScheduledTasks();
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get('limit') ?? 40);
    const tradeDate = searchParams.get('tradeDate')?.trim() || undefined;
    const taskId = searchParams.get('taskId')?.trim() || undefined;
    const { logs } = await fetchAgentCoreScheduledTaskLogs({
      limit: Number.isFinite(limit) ? limit : 40,
      tradeDate,
      taskId,
    });
    return NextResponse.json({ logs });
  } catch (error) {
    const message = error instanceof Error ? error.message : '加载定时任务日志失败';
    const status = message.includes('登录')
      ? 401
      : message.includes('Pro')
        ? 403
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

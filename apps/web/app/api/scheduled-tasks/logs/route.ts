import { NextResponse } from 'next/server';
import {
  fetchAgentCoreScheduledTaskLogs,
  fetchAgentCoreScheduledTasks,
} from '@/lib/agent-core';
import { requireProScheduledTasks } from '@/lib/scheduled-tasks-access';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    await requireProScheduledTasks();
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get('limit') ?? 200);
    const tradeDate = searchParams.get('tradeDate')?.trim() || undefined;
    const taskId = searchParams.get('taskId')?.trim() || undefined;
    const [{ logs, tradeDates: agentTradeDates }, tasks] = await Promise.all([
      fetchAgentCoreScheduledTaskLogs({
        limit: Number.isFinite(limit) ? limit : 200,
        tradeDate,
        taskId,
      }),
      fetchAgentCoreScheduledTasks(),
    ]);
    const tradeDates =
      agentTradeDates.length > 0
        ? agentTradeDates
        : [...new Set(logs.map((entry) => entry.tradeDate))].sort((a, b) =>
            b.localeCompare(a),
          );
    return NextResponse.json({ logs, tradeDates, tasks });
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

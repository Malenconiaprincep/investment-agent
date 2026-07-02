import { NextResponse } from 'next/server';
import {
  fetchAgentCoreScheduledTasks,
  patchAgentCoreScheduledTask,
} from '@/lib/agent-core';
import { requireProScheduledTasks } from '@/lib/scheduled-tasks-access';

export const runtime = 'nodejs';

export async function GET() {
  try {
    await requireProScheduledTasks();
    const tasks = await fetchAgentCoreScheduledTasks();
    return NextResponse.json({ tasks });
  } catch (error) {
    const message = error instanceof Error ? error.message : '加载定时任务失败';
    const status = message.includes('登录')
      ? 401
      : message.includes('Pro')
        ? 403
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(request: Request) {
  try {
    await requireProScheduledTasks();
    const body = (await request.json()) as {
      id?: string;
      enabled?: unknown;
    };

    if (!body.id || typeof body.enabled !== 'boolean') {
      return NextResponse.json(
        { error: '请提供任务 ID 和 enabled 状态' },
        { status: 400 },
      );
    }

    const tasks = await patchAgentCoreScheduledTask(body.id, body.enabled);
    return NextResponse.json({ tasks });
  } catch (error) {
    const message = error instanceof Error ? error.message : '保存定时任务失败';
    const status = message.includes('登录')
      ? 401
      : message.includes('Pro')
        ? 403
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

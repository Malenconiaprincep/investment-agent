import { NextResponse } from 'next/server';
import { runAgentCoreMonitorJson } from '@/lib/agent-core';

export const runtime = 'nodejs';

const MODES = ['balanced', 'aggressive', 'notify_only'] as const;

export async function GET() {
  try {
    const stdout = await runAgentCoreMonitorJson(['settings']);
    return NextResponse.json(JSON.parse(stdout));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '读取雷达设置失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as { mode?: string };
    const mode = body.mode?.trim();
    if (!mode || !MODES.includes(mode as (typeof MODES)[number])) {
      return NextResponse.json(
        { error: 'mode 须为 balanced | aggressive | notify_only' },
        { status: 400 },
      );
    }
    const stdout = await runAgentCoreMonitorJson(['set-mode', mode]);
    return NextResponse.json(JSON.parse(stdout));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '更新雷达设置失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

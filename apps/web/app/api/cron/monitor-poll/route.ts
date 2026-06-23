import { NextResponse } from 'next/server';
import { runAgentCoreMonitorJson } from '@/lib/agent-core';

export const runtime = 'nodejs';
export const maxDuration = 120;

function checkCronAuth(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

/** 盘中每 15 分钟轮询：新闻 + 实时行情 */
export async function GET(request: Request) {
  if (!checkCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const stdout = await runAgentCoreMonitorJson(['poll']);
    return NextResponse.json(JSON.parse(stdout));
  } catch (error) {
    const message = error instanceof Error ? error.message : '实时监控任务失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

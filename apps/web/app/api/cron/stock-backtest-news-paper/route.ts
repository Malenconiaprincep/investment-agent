import { NextResponse } from 'next/server';
import { runAgentCorePaperJson } from '@/lib/agent-core';

export const runtime = 'nodejs';
export const maxDuration = 900;

function checkCronAuth(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

/** 北京时间 08:00 运行回测策略+新闻模拟盘 */
export async function GET(request: Request) {
  if (!checkCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const stdout = await runAgentCorePaperJson(['stock-backtest-news-auto-run']);
    return NextResponse.json(JSON.parse(stdout));
  } catch (error) {
    const message = error instanceof Error ? error.message : '回测策略+新闻模拟盘任务失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

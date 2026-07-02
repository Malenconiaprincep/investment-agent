import { NextResponse } from 'next/server';
import { runAgentCorePaperJson } from '@/lib/agent-core';

export const runtime = 'nodejs';
export const maxDuration = 120;

function checkCronAuth(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

/** 检查本地 CSV 行情数据是否已更新 */
export async function GET(request: Request) {
  if (!checkCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const stdout = await runAgentCorePaperJson(['market-data-status']);
    return NextResponse.json(JSON.parse(stdout));
  } catch (error) {
    const message = error instanceof Error ? error.message : '行情数据状态检查失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

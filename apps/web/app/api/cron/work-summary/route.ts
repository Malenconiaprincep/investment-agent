import { NextResponse } from 'next/server';
import { runAgentCoreWorkSummaryJson } from '@/lib/agent-core';

export const runtime = 'nodejs';
export const maxDuration = 120;

function checkCronAuth(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = request.headers.get('authorization');
  return auth === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!checkCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const stdout = await runAgentCoreWorkSummaryJson(['snapshot']);
    return NextResponse.json(JSON.parse(stdout));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '工作总结快照任务失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { runAgentCorePaperJson } from '@/lib/agent-core';

export const runtime = 'nodejs';
export const maxDuration = 900;

export async function POST() {
  try {
    const stdout = await runAgentCorePaperJson(['stock-backtest-manual-check']);
    return NextResponse.json(JSON.parse(stdout));
  } catch (error) {
    const message = error instanceof Error ? error.message : '回测策略手动检查失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

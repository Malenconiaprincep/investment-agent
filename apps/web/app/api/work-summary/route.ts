import { NextResponse } from 'next/server';
import { runAgentCoreWorkSummaryJson } from '@/lib/agent-core';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const stdout = await runAgentCoreWorkSummaryJson(['latest']);
    return NextResponse.json(JSON.parse(stdout));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '读取工作总结失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

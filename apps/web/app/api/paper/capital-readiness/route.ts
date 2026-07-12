import { NextResponse } from 'next/server';
import { runAgentCorePaperJson } from '@/lib/agent-core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const stdout = await runAgentCorePaperJson(['capital-readiness']);
    return NextResponse.json(JSON.parse(stdout));
  } catch (error) {
    const message = error instanceof Error ? error.message : '读取资金准入状态失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

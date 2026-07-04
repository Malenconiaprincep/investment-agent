import { NextResponse } from 'next/server';
import { runAgentCorePaperJson } from '@/lib/agent-core';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const stdout = await runAgentCorePaperJson(['etf-observation']);
    return NextResponse.json(JSON.parse(stdout));
  } catch (error) {
    const message = error instanceof Error ? error.message : '读取 ETF 观察报告失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST() {
  try {
    const stdout = await runAgentCorePaperJson(['etf-observation', '--snapshot']);
    return NextResponse.json(JSON.parse(stdout));
  } catch (error) {
    const message = error instanceof Error ? error.message : '写入 ETF 观察快照失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

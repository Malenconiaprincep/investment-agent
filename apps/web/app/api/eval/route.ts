import { NextResponse } from 'next/server';
import { runAgentCoreScreeningsJson } from '@/lib/agent-core';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const stdout = await runAgentCoreScreeningsJson(['eval-report']);
    if (stdout.trim() === 'null') {
      return NextResponse.json({ report: null });
    }

    const report = JSON.parse(stdout);
    return NextResponse.json({ report });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '读取 Eval 报告失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

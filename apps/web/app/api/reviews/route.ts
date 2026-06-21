import { NextResponse } from 'next/server';
import { runAgentCoreWatchlistJson } from '@/lib/agent-core';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const stdout = await runAgentCoreWatchlistJson(['weekly-list']);
    return NextResponse.json({ reviews: JSON.parse(stdout) });
  } catch (error) {
    const message = error instanceof Error ? error.message : '读取周报失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { runAgentCorePaperJson } from '@/lib/agent-core';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = searchParams.get('limit') ?? '100';
  try {
    const stdout = await runAgentCorePaperJson(['trades', limit]);
    return NextResponse.json(JSON.parse(stdout));
  } catch (error) {
    const message = error instanceof Error ? error.message : '读取成交记录失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

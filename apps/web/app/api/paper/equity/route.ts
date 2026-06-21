import { NextResponse } from 'next/server';
import { runAgentCorePaperJson } from '@/lib/agent-core';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = searchParams.get('limit') ?? '90';
  try {
    const stdout = await runAgentCorePaperJson(['equity', limit]);
    return NextResponse.json(JSON.parse(stdout));
  } catch (error) {
    const message = error instanceof Error ? error.message : '读取收益曲线失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { runAgentCoreEtfJson } from '@/lib/agent-core';

export const runtime = 'nodejs';
export const maxDuration = 180;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limit = url.searchParams.get('limit');
    const stdout = limit
      ? await runAgentCoreEtfJson(['list', limit])
      : await runAgentCoreEtfJson(['latest']);
    return NextResponse.json(JSON.parse(stdout));
  } catch (error) {
    const message = error instanceof Error ? error.message : '读取 ETF 推荐失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const json = (await request.json().catch(() => ({}))) as { force?: boolean };
    const stdout = await runAgentCoreEtfJson([
      'tail-pick',
      ...(json.force ? ['--force'] : []),
    ]);
    return NextResponse.json(JSON.parse(stdout));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ETF 尾盘推荐失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

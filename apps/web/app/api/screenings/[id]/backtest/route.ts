import { NextResponse } from 'next/server';
import { runAgentCoreScreeningsJson } from '@/lib/agent-core';

export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;

    if (!id) {
      return NextResponse.json({ error: '缺少选股记录 ID' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const days = searchParams.get('days') ?? '5';
    const args = ['backtest', id, days];

    const stdout = await runAgentCoreScreeningsJson(args);
    const backtest = JSON.parse(stdout);

    return NextResponse.json(backtest);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '事后验证计算失败';

    if (message.includes('not found')) {
      return NextResponse.json({ error: '选股记录不存在' }, { status: 404 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

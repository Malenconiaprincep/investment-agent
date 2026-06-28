import { NextResponse } from 'next/server';
import { runAgentCoreScreeningsJson } from '@/lib/agent-core';
import { requirePermission } from '@/lib/session';

export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    await requirePermission('backtest');
    const { id } = await context.params;

    if (!id) {
      return NextResponse.json({ error: '缺少选股记录 ID' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const days = searchParams.get('days') ?? 'auto';
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

    const status = message === '无权访问此功能' ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

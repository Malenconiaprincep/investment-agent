import { NextResponse } from 'next/server';
import { runAgentCoreBacktestJson } from '@/lib/agent-core';
import { requirePermission } from '@/lib/session';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requirePermission('backtest');
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: '缺少回测记录 id' }, { status: 400 });
    }
    const stdout = await runAgentCoreBacktestJson(['get', id]);
    return NextResponse.json(JSON.parse(stdout));
  } catch (error) {
    const message = error instanceof Error ? error.message : '加载回测详情失败';
    const status = message === '无权访问此功能' ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

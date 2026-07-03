import { NextResponse } from 'next/server';
import { runAgentCoreBacktestJson } from '@/lib/agent-core';
import { requirePermission } from '@/lib/session';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    await requirePermission('backtest');
    const { searchParams } = new URL(request.url);
    const limit = searchParams.get('limit') ?? '60';
    const stdout = await runAgentCoreBacktestJson(['history', limit]);
    return NextResponse.json(JSON.parse(stdout));
  } catch (error) {
    const message = error instanceof Error ? error.message : '加载回测记录失败';
    const status = message === '无权访问此功能' ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

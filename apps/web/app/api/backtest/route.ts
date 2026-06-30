import { NextResponse } from 'next/server';
import { runAgentCoreBacktestJson } from '@/lib/agent-core';
import { requirePermission } from '@/lib/session';
import { getBacktestArgsFromSearchParams } from './args';

export const runtime = 'nodejs';
export const maxDuration = 180;

export async function GET(request: Request) {
  try {
    await requirePermission('backtest');
    const { searchParams } = new URL(request.url);
    const stdout = await runAgentCoreBacktestJson(
      getBacktestArgsFromSearchParams(searchParams),
    );
    return NextResponse.json(JSON.parse(stdout));
  } catch (error) {
    const message = error instanceof Error ? error.message : '回测计算失败';
    const status = message === '无权访问此功能' ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: Request) {
  try {
    await requirePermission('backtest');
    const body = (await request.json().catch(() => ({}))) as { args?: string[] };
    if (!Array.isArray(body.args) || body.args.length === 0) {
      return NextResponse.json({ error: '缺少 args' }, { status: 400 });
    }

    const stdout = await runAgentCoreBacktestJson(body.args.map(String));
    return NextResponse.json(JSON.parse(stdout));
  } catch (error) {
    const message = error instanceof Error ? error.message : '回测计算失败';
    const status = message === '无权访问此功能' ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

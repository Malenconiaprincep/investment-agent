import { NextResponse } from 'next/server';
import { runAgentCoreBacktestJson } from '@/lib/agent-core';

export const runtime = 'nodejs';
export const maxDuration = 180;

function getArgsFromSearchParams(searchParams: URLSearchParams): string[] {
  const strategy = searchParams.get('strategy') ?? 'etf-momentum';

  if (strategy === 'diamond' || strategy === 'diamond-momentum') {
    const symbols = searchParams.get('symbols');
    if (!symbols) throw new Error('缺少 symbols 参数');
    return [
      strategy,
      symbols,
      searchParams.get('days') ?? '250',
      searchParams.get('holdDays') ?? '',
    ].filter(Boolean);
  }

  if (strategy === 'screening') {
    const id = searchParams.get('id');
    if (!id) throw new Error('缺少 id 参数');
    return ['screening', id, searchParams.get('days') ?? 'auto'];
  }

  if (strategy === 'etf-momentum') {
    const args = ['etf-momentum', searchParams.get('days') ?? '365'];
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    if (startDate) args.push(`--from=${startDate}`);
    if (endDate) args.push(`--to=${endDate}`);
    const top = searchParams.get('top');
    const momentum = searchParams.get('momentum');
    const rebalance = searchParams.get('rebalance');
    const trendMa = searchParams.get('trendMa');
    if (top) args.push(`--top=${top}`);
    if (momentum) args.push(`--momentum=${momentum}`);
    if (rebalance) args.push(`--rebalance=${rebalance}`);
    if (trendMa) args.push(`--trend-ma=${trendMa}`);
    return args;
  }

  const args = [
    'etf',
    searchParams.get('days') ?? '250',
    searchParams.get('holdDays') ?? '',
  ].filter(Boolean);
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');
  if (startDate) args.push(`--from=${startDate}`);
  if (endDate) args.push(`--to=${endDate}`);
  if (searchParams.get('includeWaitPullback') === '1') {
    args.push('--include-wait-pullback');
  }
  const maxFail = searchParams.get('maxFail');
  if (maxFail) args.push(`--max-fail=${maxFail}`);
  const exitMaxFail = searchParams.get('exitMaxFail');
  if (exitMaxFail) args.push(`--exit-max-fail=${exitMaxFail}`);
  const maxConcurrent = searchParams.get('maxConcurrent');
  if (maxConcurrent) args.push(`--max-concurrent=${maxConcurrent}`);
  const newsFilter = searchParams.get('newsFilter');
  if (newsFilter) args.push(`--news-filter=${newsFilter}`);
  const newsLookback = searchParams.get('newsLookback');
  if (newsLookback) args.push(`--news-lookback=${newsLookback}`);
  return args;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const stdout = await runAgentCoreBacktestJson(
      getArgsFromSearchParams(searchParams),
    );
    return NextResponse.json(JSON.parse(stdout));
  } catch (error) {
    const message = error instanceof Error ? error.message : '回测计算失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { args?: string[] };
    if (!Array.isArray(body.args) || body.args.length === 0) {
      return NextResponse.json({ error: '缺少 args' }, { status: 400 });
    }

    const stdout = await runAgentCoreBacktestJson(body.args.map(String));
    return NextResponse.json(JSON.parse(stdout));
  } catch (error) {
    const message = error instanceof Error ? error.message : '回测计算失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

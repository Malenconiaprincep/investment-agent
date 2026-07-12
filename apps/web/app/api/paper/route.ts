import { NextResponse } from 'next/server';
import { runAgentCorePaperJson } from '@/lib/agent-core';
import { normalizeDualPaperPayload } from '@/lib/paper-dual';
import { enrichPaperScheduleFields } from '@/lib/paper-schedule';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const stdout = await runAgentCorePaperJson(['account']);
    const payload = normalizeDualPaperPayload(JSON.parse(stdout));
    const enriched = await enrichPaperScheduleFields(payload, async () => {
      const tradesStdout = await runAgentCorePaperJson(['trades', '200', '--bucket', 'etf']);
      const parsed = JSON.parse(tradesStdout) as { trades?: unknown };
      return Array.isArray(parsed.trades) ? parsed.trades : [];
    });
    return NextResponse.json(enriched);
  } catch (error) {
    const message = error instanceof Error ? error.message : '读取模拟账户失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const json: unknown = await request.json();
    const body = json as {
      side?: 'buy' | 'sell';
      symbol?: string;
      name?: string;
      shares?: number;
      price?: number;
      bucket?: 'etf' | 'etf-evergreen' | 'etf-t-plus' | 'stock';
    };

    if (!body.side || !body.symbol || !body.name || !body.shares) {
      return NextResponse.json({ error: '参数不完整' }, { status: 400 });
    }

    const args = [
      'trade',
      body.side,
      body.symbol,
      body.name,
      String(body.shares),
      body.price != null ? String(body.price) : '',
    ];
    if (
      body.bucket === 'etf' ||
      body.bucket === 'etf-evergreen' ||
      body.bucket === 'etf-t-plus' ||
      body.bucket === 'stock'
    ) {
      args.push('--bucket', body.bucket);
    }
    const stdout = await runAgentCorePaperJson(args);
    return NextResponse.json(JSON.parse(stdout));
  } catch (error) {
    const message = error instanceof Error ? error.message : '模拟交易失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

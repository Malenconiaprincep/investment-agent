import { NextResponse } from 'next/server';
import { runAgentCorePaperJson } from '@/lib/agent-core';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const stdout = await runAgentCorePaperJson(['account']);
    return NextResponse.json(JSON.parse(stdout));
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
    const stdout = await runAgentCorePaperJson(args);
    return NextResponse.json(JSON.parse(stdout));
  } catch (error) {
    const message = error instanceof Error ? error.message : '模拟交易失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

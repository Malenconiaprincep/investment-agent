import { NextResponse } from 'next/server';
import { runAgentCoreJson } from '@/lib/agent-core';

export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;

    if (!id) {
      return NextResponse.json({ error: '缺少研报 ID' }, { status: 400 });
    }

    const stdout = await runAgentCoreJson(['get', id]);
    const report = JSON.parse(stdout);

    return NextResponse.json(report);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '读取研报失败';

    if (message.includes('not found') || message.includes('Report not found')) {
      return NextResponse.json({ error: '研报不存在' }, { status: 404 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

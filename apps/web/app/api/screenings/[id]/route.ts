import { NextResponse } from 'next/server';
import { runAgentCoreScreeningsJson } from '@/lib/agent-core';
import { requirePermission } from '@/lib/session';

export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    await requirePermission('screen');
    const { id } = await context.params;

    if (!id) {
      return NextResponse.json({ error: '缺少选股记录 ID' }, { status: 400 });
    }

    const stdout = await runAgentCoreScreeningsJson(['get', id]);
    const session = JSON.parse(stdout);

    return NextResponse.json(session);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '读取选股记录失败';

    if (
      message.includes('not found') ||
      message.includes('Screening session not found')
    ) {
      return NextResponse.json({ error: '选股记录不存在' }, { status: 404 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

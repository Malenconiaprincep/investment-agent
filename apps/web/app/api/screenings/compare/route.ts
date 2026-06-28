import { NextResponse } from 'next/server';
import { runAgentCoreScreeningsJson } from '@/lib/agent-core';
import { requirePermission } from '@/lib/session';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    await requirePermission('screen');
    const { searchParams } = new URL(request.url);
    const base = searchParams.get('base');
    const target = searchParams.get('target');

    if (!base || !target) {
      return NextResponse.json(
        { error: '请提供 base 与 target 选股记录 ID' },
        { status: 400 },
      );
    }

    const stdout = await runAgentCoreScreeningsJson(['compare', base, target]);
    const compare = JSON.parse(stdout);
    return NextResponse.json(compare);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '对比选股记录失败';

    if (message.includes('not found')) {
      return NextResponse.json({ error: '选股记录不存在' }, { status: 404 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

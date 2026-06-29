import { NextResponse } from 'next/server';
import { runAgentCoreNotifyJson } from '@/lib/agent-core';
import { requireSessionUsername } from '@/lib/session';

export const runtime = 'nodejs';

export async function POST() {
  try {
    await requireSessionUsername();
    const stdout = await runAgentCoreNotifyJson(['test']);
    const result = JSON.parse(stdout) as { ok?: boolean; error?: string };
    if (result.ok === false) {
      return NextResponse.json(
        { error: result.error ?? '飞书推送失败' },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : '飞书测试失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  runAgentCoreMonitorJson,
  runAgentCoreWatchlistJson,
} from '@/lib/agent-core';

export const runtime = 'nodejs';

const postSchema = z.object({
  symbol: z.string().regex(/^\d{6}$/),
  name: z.string().min(1),
  reason: z.string().optional(),
  sourceType: z.enum(['report', 'screening', 'manual', 'signal']).optional(),
  sourceId: z.string().optional(),
});

export async function GET() {
  try {
    await runAgentCoreMonitorJson(['status']).catch(() => null);
    const stdout = await runAgentCoreWatchlistJson(['list']);
    const items = JSON.parse(stdout);
    const summaryStdout = await runAgentCoreWatchlistJson(['today-summary']).catch(
      () => null,
    );
    const summary = summaryStdout ? JSON.parse(summaryStdout) : null;
    return NextResponse.json(
      { items, summary },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : '读取监控池失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const json: unknown = await request.json();
    const parsed = postSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: '参数无效' }, { status: 400 });
    }

    const args = [
      'add',
      parsed.data.symbol,
      parsed.data.name,
      parsed.data.reason ?? '',
      parsed.data.sourceType ?? 'manual',
      parsed.data.sourceId ?? '',
    ];
    const stdout = await runAgentCoreWatchlistJson(args);
    return NextResponse.json(JSON.parse(stdout));
  } catch (error) {
    const message = error instanceof Error ? error.message : '添加监控失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

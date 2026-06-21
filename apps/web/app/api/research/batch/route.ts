import { NextResponse } from 'next/server';
import { z } from 'zod';
import { runAgentCoreBatchResearch } from '@/lib/agent-core';

export const runtime = 'nodejs';

const bodySchema = z.object({
  symbols: z
    .array(z.string().regex(/^\d{6}$/))
    .min(1)
    .max(5),
});

export async function POST(request: Request) {
  try {
    const json: unknown = await request.json();
    const parsed = bodySchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { error: '请提供 1–5 个 6 位股票代码' },
        { status: 400 },
      );
    }

    const stdout = await runAgentCoreBatchResearch(parsed.data.symbols);
    const payload = JSON.parse(stdout);

    return NextResponse.json(payload);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '批量生成研报失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

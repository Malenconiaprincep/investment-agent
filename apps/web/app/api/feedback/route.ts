import { NextResponse } from 'next/server';
import { z } from 'zod';
import { runAgentCoreFeedback } from '@/lib/agent-core';

export const runtime = 'nodejs';

const bodySchema = z.object({
  targetType: z.enum(['report', 'screening']),
  targetId: z.string().min(1),
  rating: z.union([z.literal(1), z.literal(-1)]),
  comment: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const json: unknown = await request.json();
    const parsed = bodySchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? '参数无效' },
        { status: 400 },
      );
    }

    const args = [
      'save',
      parsed.data.targetType,
      parsed.data.targetId,
      String(parsed.data.rating),
    ];
    if (parsed.data.comment) {
      args.push(parsed.data.comment);
    }

    const stdout = await runAgentCoreFeedback(args);
    const payload = JSON.parse(stdout) as {
      summary: { up: number; down: number; latest: { rating: 1 | -1 } | null };
    };

    return NextResponse.json({ ok: true, summary: payload.summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : '提交反馈失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

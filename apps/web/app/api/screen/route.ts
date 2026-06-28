import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  createAgentCoreSSEStream,
  SSE_RESPONSE_HEADERS,
} from '@/lib/agent-core-stream';
import { requirePermission } from '@/lib/session';

export const runtime = 'nodejs';
export const maxDuration = 180;

const bodySchema = z.object({
  query: z.string().optional(),
  maxCandidates: z.number().int().min(1).max(20).optional(),
  lookbackDays: z.number().int().min(1).max(30).optional(),
  asOfDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'asOfDate 须为 YYYY-MM-DD')
    .optional(),
});

export async function POST(request: Request) {
  try {
    await requirePermission('screen');
    const json: unknown = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? '参数无效' },
        { status: 400 },
      );
    }

    const payload = {
      maxCandidates: parsed.data.maxCandidates ?? 10,
      lookbackDays: parsed.data.lookbackDays ?? 14,
      excludeSt: true,
      ...(parsed.data.query?.trim()
        ? { query: parsed.data.query.trim() }
        : {}),
      ...(parsed.data.asOfDate ? { asOfDate: parsed.data.asOfDate } : {}),
    };

    const stream = createAgentCoreSSEStream(
      '/stream/screen',
      payload,
      'screen',
    );

    return new Response(stream, { headers: SSE_RESPONSE_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : '服务器错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

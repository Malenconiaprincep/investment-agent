import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  createAgentCoreSSEStream,
  SSE_RESPONSE_HEADERS,
} from '@/lib/agent-core-stream';

export const runtime = 'nodejs';
export const maxDuration = 120;

const bodySchema = z
  .object({
    symbol: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
    query: z.string().min(1).optional(),
  })
  .refine((data) => data.symbol || data.query, {
    message: '请提供 symbol 或 query',
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

    const stream = createAgentCoreSSEStream(
      '/stream/research',
      parsed.data,
      'research',
    );

    return new Response(stream, { headers: SSE_RESPONSE_HEADERS });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '服务器错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

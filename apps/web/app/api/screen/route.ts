import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  createAgentCoreSSEStream,
  SSE_RESPONSE_HEADERS,
} from '@/lib/agent-core-stream';

export const runtime = 'nodejs';
export const maxDuration = 180;

const bodySchema = z.object({
  query: z.string().optional(),
  maxCandidates: z.number().int().min(1).max(20).optional(),
});

export async function POST(request: Request) {
  try {
    const json: unknown = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? '参数无效' },
        { status: 400 },
      );
    }

    const userQuery = parsed.data.query?.trim();
    const args = userQuery ? [userQuery] : [];

    const stream = createAgentCoreSSEStream(
      'sector-screen-stream.ts',
      args,
      'screen',
    );

    return new Response(stream, { headers: SSE_RESPONSE_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : '服务器错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

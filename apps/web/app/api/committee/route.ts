import { NextResponse } from 'next/server';
import { z } from 'zod';
import { spawnAgentCoreScript } from '@/lib/agent-core';
import {
  encodeSSE,
  SSE_RESPONSE_HEADERS,
} from '@/lib/agent-core-stream';

export const runtime = 'nodejs';
export const maxDuration = 300;

const bodySchema = z.object({
  candidates: z
    .array(
      z.object({
        symbol: z.string().regex(/^\d{6}$/),
        name: z.string(),
      }),
    )
    .min(1)
    .max(5),
  screeningSessionId: z.string().optional(),
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

    const symbols = parsed.data.candidates.map((c) => c.symbol).join(',');
    const child = spawnAgentCoreScript('committee-stream.ts', [symbols], {
      env: {
        COMMITTEE_SCREENING_SESSION_ID:
          parsed.data.screeningSessionId ?? '',
        COMMITTEE_CANDIDATES_JSON: JSON.stringify(parsed.data.candidates),
      },
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(': stream-open\n\n'));

        child.stdout?.on('data', (chunk: Buffer) => {
          controller.enqueue(new Uint8Array(chunk));
        });

        child.stderr?.on('data', (chunk: Buffer) => {
          const text = chunk.toString().trim();
          if (text) console.warn('[committee]', text);
        });

        child.on('error', (error) => {
          controller.enqueue(
            encoder.encode(
              encodeSSE('error', {
                type: 'error',
                message:
                  error instanceof Error ? error.message : '服务启动失败',
              }),
            ),
          );
          controller.close();
        });

        child.on('close', (code) => {
          if (code !== 0 && code !== null) {
            controller.enqueue(
              encoder.encode(
                encodeSSE('error', {
                  type: 'error',
                  message: `处理失败（退出码 ${code}）`,
                }),
              ),
            );
          }
          controller.close();
        });
      },
      cancel() {
        child.kill('SIGTERM');
      },
    });

    return new Response(stream, { headers: SSE_RESPONSE_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : '服务器错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

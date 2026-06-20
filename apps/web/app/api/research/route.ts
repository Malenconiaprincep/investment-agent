import path from 'node:path';
import { spawn } from 'node:child_process';
import { NextResponse } from 'next/server';
import { z } from 'zod';

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

function getAgentCoreRoot() {
  return path.resolve(process.cwd(), '../../packages/agent-core');
}

function encodeSSE(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

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

    const agentCoreRoot = getAgentCoreRoot();
    const tsxBin = path.join(agentCoreRoot, 'node_modules/.bin/tsx');
    const scriptPath = path.join(agentCoreRoot, 'src/cli/research-stream.ts');
    const args = [scriptPath];

    if (parsed.data.symbol) {
      args.push(parsed.data.symbol);
    } else if (parsed.data.query) {
      args.push(parsed.data.query);
    }

    const child = spawn(tsxBin, args, {
      cwd: agentCoreRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(': stream-open\n\n'));

        child.stdout.on('data', (chunk: Buffer) => {
          controller.enqueue(new Uint8Array(chunk));
        });

        child.stderr.on('data', (chunk: Buffer) => {
          const text = chunk.toString().trim();
          if (text) {
            console.warn('[research]', text);
          }
        });

        child.on('error', (error) => {
          const message =
            error instanceof Error ? error.message : '子进程启动失败';
          controller.enqueue(
            encoder.encode(encodeSSE('error', { type: 'error', message })),
          );
          controller.close();
        });

        child.on('close', (code) => {
          if (code !== 0 && code !== null) {
            controller.enqueue(
              encoder.encode(
                encodeSSE('error', {
                  type: 'error',
                  message: `Workflow 退出码 ${code}`,
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

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '服务器错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

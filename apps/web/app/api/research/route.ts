import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';
export const maxDuration = 120;

const execFileAsync = promisify(execFile);

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
    const args = ['exec', 'tsx', 'src/cli/research-json.ts'];

    if (parsed.data.symbol) {
      args.push(parsed.data.symbol);
    } else if (parsed.data.query) {
      args.push(parsed.data.query);
    }

    const startedAt = Date.now();

    const { stdout, stderr } = await execFileAsync('pnpm', args, {
      cwd: agentCoreRoot,
      env: process.env,
      maxBuffer: 16 * 1024 * 1024,
    });

    if (stderr?.trim()) {
      console.warn('[research]', stderr.trim());
    }

    const result = JSON.parse(stdout) as Record<string, unknown>;
    const elapsedMs = Date.now() - startedAt;

    return NextResponse.json({ ...result, elapsedMs });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message.includes('JSON')
          ? 'Workflow 返回格式异常'
          : error.message
        : '服务器错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

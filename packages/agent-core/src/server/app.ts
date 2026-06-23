import 'dotenv/config';

import { Hono } from 'hono';
import type { Context } from 'hono';
import { cors } from 'hono/cors';
import { stream } from 'hono/streaming';
import { runResearchWorkflowStream } from '../api/run-research-workflow-stream.js';
import { runSectorScreenStream } from '../api/run-sector-screen-stream.js';
import { runCommitteeStream } from '../api/run-committee-stream.js';
import type { SectorScreenWorkflowInput } from '../mastra/workflows/sector-screen-workflow.js';
import { dispatchCliModule, isCliModule } from '../handlers/index.js';

const app = new Hono();

app.use(
  '*',
  cors({
    origin: (origin) => origin ?? '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  }),
);

function requireAuth(authHeader: string | undefined): boolean {
  const token = process.env.AGENT_CORE_TOKEN?.trim();
  if (!token) return true;
  return authHeader === `Bearer ${token}`;
}

function unauthorized() {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

function jsonError(message: string, status = 500) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

app.get('/health', (c) => c.json({ ok: true, service: 'agent-core' }));

app.post('/cli/:module', async (c) => {
  if (!requireAuth(c.req.header('Authorization'))) return unauthorized();

  const module = c.req.param('module');
  if (!isCliModule(module)) {
    return jsonError(`未知模块: ${module}`, 404);
  }

  let body: { args?: string[] };
  try {
    body = await c.req.json();
  } catch {
    return jsonError('请求体须为 JSON', 400);
  }

  const args = Array.isArray(body.args) ? body.args.map(String) : [];
  try {
    const result = await dispatchCliModule(module, args);
    return new Response(result, {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes('Not found') ? 404 : 400;
    return jsonError(message, status);
  }
});

function sseLine(event: { type: string; message?: string; [key: string]: unknown }) {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const;

function applySseHeaders(c: Context) {
  for (const [key, value] of Object.entries(SSE_HEADERS)) {
    c.header(key, value);
  }
}

app.post('/stream/research', async (c) => {
  if (!requireAuth(c.req.header('Authorization'))) return unauthorized();

  const body = (await c.req.json().catch(() => ({}))) as {
    symbol?: string;
    query?: string;
  };

  const input =
    body.symbol && /^\d{6}$/.test(body.symbol)
      ? { symbol: body.symbol }
      : body.query?.trim()
        ? { query: body.query.trim() }
        : null;

  if (!input) return jsonError('请提供 symbol 或 query', 400);

  applySseHeaders(c);
  applySseHeaders(c);
  applySseHeaders(c);
  return stream(c, async (s) => {
    await s.write(': stream-open\n\n');
    try {
      await runResearchWorkflowStream(input, async (event) => {
        await s.write(sseLine(event));
      });
    } catch (error) {
      await s.write(
        sseLine({
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  });
});

app.post('/stream/screen', async (c) => {
  if (!requireAuth(c.req.header('Authorization'))) return unauthorized();

  const body = (await c.req.json().catch(() => ({}))) as SectorScreenWorkflowInput;
  const input: SectorScreenWorkflowInput = {
    maxCandidates: body.maxCandidates ?? 10,
    lookbackDays: body.lookbackDays ?? 14,
    excludeSt: body.excludeSt ?? true,
    ...(body.query?.trim() ? { query: body.query.trim() } : {}),
    ...(body.asOfDate ? { asOfDate: body.asOfDate } : {}),
  };

  return stream(c, async (s) => {
    await s.write(': stream-open\n\n');
    try {
      await runSectorScreenStream(input, async (event) => {
        await s.write(sseLine(event));
      });
    } catch (error) {
      await s.write(
        sseLine({
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  });
});

app.post('/stream/committee', async (c) => {
  if (!requireAuth(c.req.header('Authorization'))) return unauthorized();

  const body = (await c.req.json().catch(() => ({}))) as {
    candidates?: Array<{ symbol: string; name: string }>;
    screeningSessionId?: string;
    maxAnalyze?: number;
  };

  if (!body.candidates?.length) {
    return jsonError('candidates 不能为空', 400);
  }

  return stream(c, async (s) => {
    await s.write(': stream-open\n\n');
    try {
      await runCommitteeStream(
        {
          candidates: body.candidates!,
          screeningSessionId: body.screeningSessionId,
          maxAnalyze: body.maxAnalyze ?? 3,
        },
        async (event) => {
          await s.write(sseLine(event));
        },
      );
    } catch (error) {
      await s.write(
        sseLine({
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  });
});

export { app };

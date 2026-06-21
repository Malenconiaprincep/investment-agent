import { NextResponse } from 'next/server';
import {
  createAgentCoreSSEStream,
  SSE_RESPONSE_HEADERS,
} from '@/lib/agent-core-stream';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const json: unknown = await request.json();
    const body = json as {
      candidates?: Array<{ symbol: string; name: string }>;
      screeningSessionId?: string;
    };

    if (!body.candidates?.length) {
      return NextResponse.json({ error: '参数无效' }, { status: 400 });
    }

    const stream = createAgentCoreSSEStream(
      '/stream/committee',
      body,
      'committee',
    );

    return new Response(stream, { headers: SSE_RESPONSE_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : '服务器错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { getAgentCoreConfig, proxyAgentCoreStream } from './agent-core';

export function encodeSSE(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export const SSE_RESPONSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const;

export function createAgentCoreSSEStream(
  path: '/stream/research' | '/stream/screen' | '/stream/committee',
  body: unknown,
  logPrefix: string,
): ReadableStream<Uint8Array> {
  getAgentCoreConfig();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const upstream = await proxyAgentCoreStream(path, body);
        if (!upstream.ok || !upstream.body) {
          const message = await upstream.text();
          controller.enqueue(
            new TextEncoder().encode(
              encodeSSE('error', {
                type: 'error',
                message: message || `agent-core 流式请求失败 (${upstream.status})`,
              }),
            ),
          );
          controller.close();
          return;
        }

        const reader = upstream.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) controller.enqueue(value);
        }
        controller.close();
      } catch (error) {
        console.warn(`[${logPrefix}]`, error);
        controller.enqueue(
          new TextEncoder().encode(
            encodeSSE('error', {
              type: 'error',
              message: error instanceof Error ? error.message : '服务连接失败',
            }),
          ),
        );
        controller.close();
      }
    },
  });
}

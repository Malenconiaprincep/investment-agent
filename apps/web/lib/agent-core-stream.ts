import { spawnAgentCoreScript } from './agent-core';

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
  scriptName: string,
  args: string[],
  logPrefix: string,
): ReadableStream<Uint8Array> {
  const child = spawnAgentCoreScript(scriptName, args);
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(': stream-open\n\n'));

      child.stdout?.on('data', (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString().trim();
        if (text) {
          console.warn(`[${logPrefix}]`, text);
        }
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
}

export type SSEHandler = (event: string, data: string) => void;

export function parseSSEBlock(block: string): { event: string; data: string } | null {
  const trimmed = block.trim();
  if (!trimmed) {
    return null;
  }

  let event = 'message';
  let data = '';

  for (const line of trimmed.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      data = line.slice(5).trim();
    }
  }

  if (!data) {
    return null;
  }

  return { event, data };
}

export async function readSSEStream(
  response: Response,
  onEvent: SSEHandler,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('浏览器不支持流式响应');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const boundary = buffer.indexOf('\n\n');
      if (boundary === -1) {
        break;
      }

      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const parsed = parseSSEBlock(block);
      if (parsed) {
        onEvent(parsed.event, parsed.data);
      }
    }
  }

  const tail = parseSSEBlock(buffer);
  if (tail) {
    onEvent(tail.event, tail.data);
  }
}

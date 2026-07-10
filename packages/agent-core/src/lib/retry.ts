export type RetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
};

function retryableErrorText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;

  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (current instanceof Error) {
      parts.push(current.name, current.message);
    }
    if (typeof current === 'object') {
      const value = current as { cause?: unknown; code?: unknown };
      if (value.code != null) parts.push(String(value.code));
      current = value.cause;
    } else {
      break;
    }
  }

  return parts.join(' ');
}

const DEFAULT_SHOULD_RETRY = (error: unknown) =>
  /abort|timeout|timed out|fetch failed|network|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|ENOTFOUND|UND_ERR|HTTP 408|HTTP 429|HTTP 502|HTTP 503|HTTP 504/i.test(
    retryableErrorText(error),
  );

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 300,
    maxDelayMs = 3_000,
    shouldRetry = DEFAULT_SHOULD_RETRY,
  } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !shouldRetry(error, attempt)) {
        throw error;
      }

      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

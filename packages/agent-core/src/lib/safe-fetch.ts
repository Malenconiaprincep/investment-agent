import { z } from 'zod';
import { retryWithBackoff } from './retry.js';

export type SafeFetchOptions = {
  timeoutMs?: number;
  allowedHosts?: string[];
  retries?: number;
};

const DEFAULT_ALLOWED_HOSTS = [
  'api.deepseek.com',
  'geocoding-api.open-meteo.com',
  'api.open-meteo.com',
];

export async function safeFetch(
  url: string,
  init?: RequestInit,
  options: SafeFetchOptions = {},
): Promise<Response> {
  const {
    timeoutMs = 10_000,
    allowedHosts = DEFAULT_ALLOWED_HOSTS,
    retries = 2,
  } = options;

  const parsed = new URL(url);
  if (!allowedHosts.includes(parsed.hostname)) {
    throw new Error(
      `Host not allowed: ${parsed.hostname}. Allowed: ${allowedHosts.join(', ')}`,
    );
  }

  return retryWithBackoff(
    async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          ...init,
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} for ${url}`);
        }

        return response;
      } finally {
        clearTimeout(timer);
      }
    },
    { maxAttempts: retries + 1 },
  );
}

export async function safeFetchJson<T>(
  url: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
  options?: SafeFetchOptions,
): Promise<T> {
  const response = await safeFetch(url, init, options);
  const json: unknown = await response.json();
  return schema.parse(json);
}

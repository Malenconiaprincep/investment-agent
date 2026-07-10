import { describe, expect, it, vi } from 'vitest';
import { retryWithBackoff } from './retry.js';

describe('retryWithBackoff', () => {
  it('retries the generic fetch failed error emitted by Node fetch', async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValue('ok');

    await expect(
      retryWithBackoff(operation, { maxAttempts: 3, baseDelayMs: 0 }),
    ).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('recognizes a retryable network code stored in an error cause', async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(
        new TypeError('request unavailable', {
          cause: Object.assign(new Error('socket closed'), { code: 'ECONNRESET' }),
        }),
      )
      .mockResolvedValue('ok');

    await expect(
      retryWithBackoff(operation, { maxAttempts: 2, baseDelayMs: 0 }),
    ).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
  });
});

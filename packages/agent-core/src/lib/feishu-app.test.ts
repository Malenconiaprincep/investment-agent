import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  getFeishuTenantAccessToken,
  resetFeishuAppTokenCacheForTests,
  sendFeishuAppText,
} from './feishu-app.js';

describe('feishu app client', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    resetFeishuAppTokenCacheForTests();
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('fetches tenant token and sends text message', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            tenant_access_token: 't-token',
            expire: 7200,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 0 }), { status: 200 }),
      );

    const result = await sendFeishuAppText(
      {
        appId: 'cli_test',
        appSecret: 'secret',
        chatId: 'oc_test',
      },
      'hello',
    );

    expect(result.ok).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('requires chat id', async () => {
    const result = await sendFeishuAppText(
      { appId: 'cli_test', appSecret: 'secret' },
      'hello',
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('FEISHU_CHAT_ID');
  });
});

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  isFeishuWebhookUrl,
  sendFeishuText,
  sendFeishuWebhook,
} from './feishu-webhook.js';

describe('isFeishuWebhookUrl', () => {
  it('accepts feishu webhook urls', () => {
    expect(
      isFeishuWebhookUrl(
        'https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxxxx',
      ),
    ).toBe(true);
  });

  it('rejects http and unknown hosts', () => {
    expect(isFeishuWebhookUrl('http://open.feishu.cn/hook/x')).toBe(false);
    expect(isFeishuWebhookUrl('https://evil.com/hook')).toBe(false);
  });
});

describe('sendFeishuWebhook', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sends text payload', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ code: 0, msg: 'success' }), { status: 200 }),
    );

    const result = await sendFeishuText(
      { webhookUrl: 'https://open.feishu.cn/open-apis/bot/v2/hook/test' },
      'hello',
    );

    expect(result.ok).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://open.feishu.cn/open-apis/bot/v2/hook/test',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          msg_type: 'text',
          content: { text: 'hello' },
        }),
      }),
    );
  });

  it('adds sign when secret configured', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ code: 0 }), { status: 200 }),
    );

    await sendFeishuWebhook(
      {
        webhookUrl: 'https://open.feishu.cn/open-apis/bot/v2/hook/test',
        secret: 'abc123',
      },
      { msg_type: 'text', content: { text: 'x' } },
    );

    const body = JSON.parse(
      String(vi.mocked(globalThis.fetch).mock.calls[0]?.[1]?.body),
    );
    expect(body.sign).toBeTruthy();
    expect(body.timestamp).toBeTruthy();
  });
});

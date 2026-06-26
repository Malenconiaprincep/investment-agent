import { createHmac } from 'node:crypto';

export type FeishuWebhookConfig = {
  webhookUrl: string;
  secret?: string;
};

export type FeishuSendResult =
  | { ok: true; status: number }
  | { ok: false; error: string; status?: number };

type FeishuWebhookResponse = {
  code?: number;
  msg?: string;
  StatusCode?: number;
  StatusMessage?: string;
};

const ALLOWED_HOST_SUFFIXES = ['.feishu.cn', '.larksuite.com'];

export function isFeishuWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'https:') return false;
    return ALLOWED_HOST_SUFFIXES.some((suffix) => parsed.hostname.endsWith(suffix));
  } catch {
    return false;
  }
}

function buildSign(secret: string, timestamp: string): string {
  const payload = `${timestamp}\n${secret}`;
  return createHmac('sha256', secret).update(payload).digest('base64');
}

function parseResponse(json: FeishuWebhookResponse): FeishuSendResult {
  const code = json.code ?? json.StatusCode;
  if (code === 0) return { ok: true, status: 200 };
  return {
    ok: false,
    error: json.msg ?? json.StatusMessage ?? `飞书返回 code=${String(code)}`,
    status: 200,
  };
}

/** 飞书自定义机器人 Webhook（text / post / interactive） */
export async function sendFeishuWebhook(
  config: FeishuWebhookConfig,
  payload: Record<string, unknown>,
): Promise<FeishuSendResult> {
  const webhookUrl = config.webhookUrl.trim();
  if (!isFeishuWebhookUrl(webhookUrl)) {
    return { ok: false, error: 'FEISHU_WEBHOOK_URL 无效（须为 https://open.feishu.cn/... 或 larksuite）' };
  }

  const body: Record<string, unknown> = { ...payload };
  const secret = config.secret?.trim();
  if (secret) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    body.timestamp = timestamp;
    body.sign = buildSign(secret, timestamp);
  }

  let response: Response;
  try {
    response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }

  let json: FeishuWebhookResponse = {};
  try {
    json = (await response.json()) as FeishuWebhookResponse;
  } catch {
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}`, status: response.status };
    }
    return { ok: true, status: response.status };
  }

  if (!response.ok) {
    return {
      ok: false,
      error: json.msg ?? json.StatusMessage ?? `HTTP ${response.status}`,
      status: response.status,
    };
  }

  return parseResponse(json);
}

export async function sendFeishuText(
  config: FeishuWebhookConfig,
  text: string,
): Promise<FeishuSendResult> {
  return sendFeishuWebhook(config, {
    msg_type: 'text',
    content: { text },
  });
}

export async function sendFeishuPost(
  config: FeishuWebhookConfig,
  title: string,
  lines: string[],
): Promise<FeishuSendResult> {
  return sendFeishuWebhook(config, {
    msg_type: 'post',
    content: {
      post: {
        zh_cn: {
          title,
          content: lines.map((line) => [{ tag: 'text', text: line }]),
        },
      },
    },
  });
}

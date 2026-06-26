import {
  listFeishuAppChats,
  sendFeishuAppPost,
  sendFeishuAppText,
  type FeishuAppConfig,
} from '../../lib/feishu-app.js';
import {
  sendFeishuPost,
  sendFeishuText,
  type FeishuSendResult,
  type FeishuWebhookConfig,
} from '../../lib/feishu-webhook.js';

export type FeishuNotifyMode = 'app' | 'webhook';

export function getFeishuAppConfig(): FeishuAppConfig | null {
  const appId = process.env.FEISHU_APP_ID?.trim();
  const appSecret = process.env.FEISHU_APP_SECRET?.trim();
  if (!appId || !appSecret) return null;
  const chatId = process.env.FEISHU_CHAT_ID?.trim();
  return { appId, appSecret, ...(chatId ? { chatId } : {}) };
}

export function getFeishuWebhookConfig(): FeishuWebhookConfig | null {
  const webhookUrl = process.env.FEISHU_WEBHOOK_URL?.trim();
  if (!webhookUrl) return null;
  const secret = process.env.FEISHU_WEBHOOK_SECRET?.trim();
  return { webhookUrl, ...(secret ? { secret } : {}) };
}

/** App 优先；未配 App 时退回 Webhook */
export function getFeishuMode(): FeishuNotifyMode | null {
  if (process.env.FEISHU_NOTIFY_ENABLED === '0') return null;
  if (getFeishuAppConfig()) return 'app';
  if (getFeishuWebhookConfig()) return 'webhook';
  return null;
}

export function isFeishuNotifyEnabled(): boolean {
  return getFeishuMode() != null;
}

export function shouldNotifyEtfPaperMonitor(): boolean {
  return process.env.FEISHU_NOTIFY_ETF_MONITOR === '1';
}

export async function notifyFeishuText(text: string): Promise<FeishuSendResult> {
  const mode = getFeishuMode();
  if (mode === 'app') {
    return sendFeishuAppText(getFeishuAppConfig()!, text);
  }
  const webhook = getFeishuWebhookConfig();
  if (webhook) return sendFeishuText(webhook, text);
  return { ok: false, error: '未配置飞书（FEISHU_APP_ID 或 FEISHU_WEBHOOK_URL）' };
}

export async function notifyFeishuPost(
  title: string,
  lines: string[],
): Promise<FeishuSendResult> {
  const mode = getFeishuMode();
  if (mode === 'app') {
    return sendFeishuAppPost(getFeishuAppConfig()!, title, lines);
  }
  const webhook = getFeishuWebhookConfig();
  if (webhook) return sendFeishuPost(webhook, title, lines);
  return { ok: false, error: '未配置飞书（FEISHU_APP_ID 或 FEISHU_WEBHOOK_URL）' };
}

export async function listFeishuChats() {
  const config = getFeishuAppConfig();
  if (!config) {
    throw new Error('未配置 FEISHU_APP_ID / FEISHU_APP_SECRET');
  }
  return listFeishuAppChats(config);
}

/** 推送失败只打日志，不阻断主流程 */
export async function notifyFeishuPostSafe(title: string, lines: string[]): Promise<void> {
  if (!isFeishuNotifyEnabled()) return;

  try {
    const result = await notifyFeishuPost(title, lines);
    if (!result.ok) {
      console.warn(`[feishu] 推送失败：${result.error}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[feishu] 推送异常：${message}`);
  }
}

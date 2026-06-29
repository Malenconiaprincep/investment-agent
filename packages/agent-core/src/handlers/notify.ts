import {
  getFeishuAppConfig,
  getFeishuMode,
  getFeishuWebhookConfig,
  isFeishuNotifyEnabled,
  listFeishuChats,
} from '../data/notify/feishu.js';
import { getFeishuTenantAccessToken, sendFeishuAppPost } from '../lib/feishu-app.js';
import { sendFeishuPost } from '../lib/feishu-webhook.js';

export async function dispatchNotify(args: string[]): Promise<string> {
  const cmd = args[0] ?? 'status';

  if (cmd === 'status') {
    const mode = getFeishuMode();
    const app = getFeishuAppConfig();
    const webhook = getFeishuWebhookConfig();
    return JSON.stringify({
      enabled: isFeishuNotifyEnabled(),
      mode,
      appConfigured: app != null,
      appId: app?.appId ?? null,
      chatId: app?.chatId ?? null,
      webhookConfigured: webhook != null,
      webhookHost: webhook ? new URL(webhook.webhookUrl).hostname : null,
      hasWebhookSecret: Boolean(webhook?.secret),
      etfMonitorPushAll: process.env.FEISHU_NOTIFY_ETF_MONITOR === '1',
    });
  }

  if (cmd === 'chats') {
    const chats = await listFeishuChats();
    return JSON.stringify({ count: chats.length, chats }, null, 2);
  }

  if (cmd === 'auth-test') {
    const app = getFeishuAppConfig();
    if (!app) throw new Error('未配置 FEISHU_APP_ID / FEISHU_APP_SECRET');
    const token = await getFeishuTenantAccessToken(app);
    return JSON.stringify({
      ok: true,
      tokenPreview: `${token.slice(0, 8)}…`,
    });
  }

  if (cmd === 'test') {
    const message =
      args.slice(1).join(' ').trim() || '投研助手飞书推送测试成功 ✅';
    const title = '🔔 投研助手测试';
    const lines = [
      `时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}`,
      `模式：${getFeishuMode() ?? (getFeishuAppConfig() ? 'app' : getFeishuWebhookConfig() ? 'webhook' : '未启用')}`,
      message,
    ];

    const app = getFeishuAppConfig();
    const webhook = getFeishuWebhookConfig();
    const result = app
      ? await sendFeishuAppPost(app, title, lines)
      : webhook
        ? await sendFeishuPost(webhook, title, lines)
        : { ok: false, error: '未配置飞书（FEISHU_APP_ID 或 FEISHU_WEBHOOK_URL）' };

    return JSON.stringify(result);
  }

  throw new Error('Usage: status | auth-test | chats | test [message]');
}

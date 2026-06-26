import {
  getFeishuAppConfig,
  getFeishuMode,
  getFeishuWebhookConfig,
  isFeishuNotifyEnabled,
  listFeishuChats,
  notifyFeishuPost,
} from '../data/notify/feishu.js';
import { getFeishuTenantAccessToken } from '../lib/feishu-app.js';

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
    const result = await notifyFeishuPost('🔔 投研助手测试', [
      `时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}`,
      `模式：${getFeishuMode() ?? '未启用'}`,
      message,
    ]);
    return JSON.stringify(result);
  }

  throw new Error('Usage: status | auth-test | chats | test [message]');
}

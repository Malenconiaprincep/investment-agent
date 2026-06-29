export const FEISHU_NOTIFY_KEYS = [
  'FEISHU_APP_ID',
  'FEISHU_APP_SECRET',
  'FEISHU_CHAT_ID',
  'FEISHU_WEBHOOK_URL',
  'FEISHU_WEBHOOK_SECRET',
] as const;

export const FEISHU_TOGGLE_KEYS = [
  'FEISHU_NOTIFY_ENABLED',
  'FEISHU_NOTIFY_ETF_MONITOR',
  'FEISHU_NOTIFY_MONITOR',
  'FEISHU_NOTIFY_STOCK_INTRADAY',
] as const;

export type FeishuNotifyKey = (typeof FEISHU_NOTIFY_KEYS)[number];
export type FeishuToggleKey = (typeof FEISHU_TOGGLE_KEYS)[number];

export function isFeishuConfigReady(input: {
  values: Partial<Record<FeishuNotifyKey, string | undefined>>;
  configured?: Partial<Record<FeishuNotifyKey, boolean>>;
}): boolean {
  const has = (key: FeishuNotifyKey) =>
    Boolean(input.values[key]?.trim()) || Boolean(input.configured?.[key]);

  const appReady =
    has('FEISHU_APP_ID') &&
    has('FEISHU_APP_SECRET') &&
    has('FEISHU_CHAT_ID');
  const webhookReady = has('FEISHU_WEBHOOK_URL');
  return appReady || webhookReady;
}

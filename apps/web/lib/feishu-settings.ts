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

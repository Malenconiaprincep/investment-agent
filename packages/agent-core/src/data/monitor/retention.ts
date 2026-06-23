import { formatTradeDate, getBeijingNow } from '../paper/trading-calendar.js';

/** 当晚几点后清理前一日数据（北京时间，默认 20:00） */
export function getMonitorPurgeHour(): number {
  const fromEnv = Number(process.env.MONITOR_PURGE_HOUR ?? 20);
  if (Number.isFinite(fromEnv) && fromEnv >= 0 && fromEnv <= 23) return fromEnv;
  return 20;
}

/**
 * 返回应保留的最早交易日。
 * - 当晚 purge 后：只保留当天
 * - 当晚 purge 前：保留昨天 + 今天（第二天晚上才删前一天）
 */
export function getMonitorRetentionCutoffTradeDate(
  now: Date = getBeijingNow(),
): string {
  const today = formatTradeDate(now);
  if (now.getHours() >= getMonitorPurgeHour()) return today;

  const keepFrom = new Date(now);
  keepFrom.setDate(keepFrom.getDate() - 1);
  return formatTradeDate(keepFrom);
}

export function monitorRetentionCutoffInstant(cutoffTradeDate: string): string {
  return `${cutoffTradeDate}T00:00:00+08:00`;
}

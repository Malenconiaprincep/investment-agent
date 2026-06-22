/** A 股交易日历与时段（北京时间） */

export function getBeijingNow(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
}

export function formatTradeDate(date: Date = getBeijingNow()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 跳过周末，得到下一个自然工作日（不含法定节假日） */
export function getNextTradeDateLabel(from: Date = getBeijingNow()): string {
  const next = new Date(from);
  next.setDate(next.getDate() + 1);
  while (next.getDay() === 0 || next.getDay() === 6) {
    next.setDate(next.getDate() + 1);
  }
  return formatTradeDate(next);
}

export function isWeekday(date: Date = getBeijingNow()): boolean {
  const day = date.getDay();
  return day >= 1 && day <= 5;
}

/** 9:30–11:30、13:00–15:00 */
export function isTradingSession(date: Date = getBeijingNow()): boolean {
  if (!isWeekday(date)) return false;
  const minutes = date.getHours() * 60 + date.getMinutes();
  const morning = minutes >= 9 * 60 + 30 && minutes <= 11 * 60 + 30;
  const afternoon = minutes >= 13 * 60 && minutes <= 15 * 60;
  return morning || afternoon;
}

/** 收盘后执行窗口：15:05 起（日 K 完整） */
export function isPostMarketWindow(date: Date = getBeijingNow()): boolean {
  if (!isWeekday(date)) return false;
  const minutes = date.getHours() * 60 + date.getMinutes();
  return minutes >= 15 * 60 + 5;
}

export function assertTradingSession(force = false): void {
  if (!force && !isTradingSession()) {
    throw new Error('当前非 A 股交易时段（9:30–11:30、13:00–15:00 北京时间）');
  }
}

export function assertPostMarketWindow(force = false): void {
  if (!force && !isPostMarketWindow()) {
    throw new Error('自动任务应在收盘后执行（15:05 后北京时间）');
  }
}

/** A 股最小交易单位 100 股 */
export function roundToLot(shares: number): number {
  if (shares <= 0) return 0;
  return Math.floor(shares / 100) * 100;
}

export const TRADING_HOURS_LABEL =
  'A 股交易时段：9:30–11:30、13:00–15:00（北京时间）';

export const AUTO_RUN_SCHEDULE_LABEL =
  '每个交易日 15:05（北京时间，收盘后）自动执行';

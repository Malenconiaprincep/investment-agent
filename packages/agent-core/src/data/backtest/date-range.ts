/** YYYY-MM-DD 或 YYYYMMDD → YYYYMMDD */
export function normalizeTradeDateKey(value: string): string {
  return value.trim().replace(/-/g, '').slice(0, 8);
}

export function formatTradeDateKey(value: string): string {
  const key = normalizeTradeDateKey(value);
  if (key.length !== 8) return value;
  return `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
}

export function todayDateKey(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

export function addCalendarDays(dateKey: string, deltaDays: number): string {
  const key = normalizeTradeDateKey(dateKey);
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(4, 6)) - 1;
  const d = Number(key.slice(6, 8));
  const date = new Date(y, m, d);
  date.setDate(date.getDate() + deltaDays);
  const ny = date.getFullYear();
  const nm = String(date.getMonth() + 1).padStart(2, '0');
  const nd = String(date.getDate()).padStart(2, '0');
  return `${ny}${nm}${nd}`;
}

export type BacktestDateRange = {
  startDate: string;
  endDate: string;
};

export function resolveBacktestDateRange(input?: {
  startDate?: string;
  endDate?: string;
  fallbackCalendarDays?: number;
}): BacktestDateRange {
  const today = todayDateKey();
  const fallbackDays = Math.max(30, Math.floor(input?.fallbackCalendarDays ?? 365));

  let endDate = input?.endDate
    ? normalizeTradeDateKey(input.endDate)
    : today;
  if (endDate > today) endDate = today;

  let startDate = input?.startDate
    ? normalizeTradeDateKey(input.startDate)
    : addCalendarDays(endDate, -fallbackDays);

  if (startDate > endDate) {
    const tmp = startDate;
    startDate = endDate;
    endDate = tmp;
  }

  return { startDate, endDate };
}

export function isTradeDateInRange(
  tradeDate: string,
  range: BacktestDateRange,
): boolean {
  const key = normalizeTradeDateKey(tradeDate);
  return key >= range.startDate && key <= range.endDate;
}

/** 从 start 到 end（或今天）估算需拉取的 K 线根数 */
export function computeKlineDaysForRange(
  range: BacktestDateRange,
  extraBars = 45,
): number {
  const today = todayDateKey();
  const anchorEnd = range.endDate > today ? today : range.endDate;
  const start = new Date(
    Number(range.startDate.slice(0, 4)),
    Number(range.startDate.slice(4, 6)) - 1,
    Number(range.startDate.slice(6, 8)),
  );
  const end = new Date(
    Number(anchorEnd.slice(0, 4)),
    Number(anchorEnd.slice(4, 6)) - 1,
    Number(anchorEnd.slice(6, 8)),
  );
  const calendarDays = Math.max(
    1,
    Math.ceil((Date.now() - start.getTime()) / (24 * 60 * 60 * 1000)),
  );
  const rangeDays = Math.max(
    1,
    Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1,
  );
  const tradingEstimate = Math.ceil(Math.max(calendarDays, rangeDays) * (5 / 7));
  return Math.min(Math.max(tradingEstimate + extraBars, 60), 800);
}

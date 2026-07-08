/** A 股交易日历与时段（北京时间） */

import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { MARKET_CSV_DIR } from '../../mastra/config/paths.js';

type TradingCalendar = {
  mtimeMs: number;
  rows: Map<
    string,
    {
      isTrading: boolean;
      previousTradeDate: string | null;
    }
  >;
  tradingDates: string[];
};

const TRADING_CALENDAR_PATH = path.join(MARKET_CSV_DIR, 'meta', 'trading-calendar.csv');
let tradingCalendarCache: TradingCalendar | null = null;

function normalizeDateLabel(value: string): string {
  const key = value.trim().replace(/^\uFEFF/, '').replace(/-/g, '').slice(0, 8);
  if (!/^\d{8}$/.test(key)) return value.trim();
  return `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
}

function readTradingCalendar(): TradingCalendar | null {
  if (!existsSync(TRADING_CALENDAR_PATH)) return null;

  const mtimeMs = statSync(TRADING_CALENDAR_PATH).mtimeMs;
  if (tradingCalendarCache?.mtimeMs === mtimeMs) {
    return tradingCalendarCache;
  }

  const rows = new Map<
    string,
    {
      isTrading: boolean;
      previousTradeDate: string | null;
    }
  >();
  const tradingDates: string[] = [];
  const lines = readFileSync(TRADING_CALENDAR_PATH, 'utf-8').split(/\r?\n/);

  for (const line of lines.slice(1)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const cols = trimmed.split(',');
    const date = normalizeDateLabel(cols[1] ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const isTrading = (cols[2] ?? '').trim() === '交易';
    const previousTradeDate = cols[3]?.trim()
      ? normalizeDateLabel(cols[3] ?? '')
      : null;
    rows.set(date, { isTrading, previousTradeDate });
    if (isTrading) tradingDates.push(date);
  }

  tradingDates.sort((a, b) => a.localeCompare(b));
  tradingCalendarCache = { mtimeMs, rows, tradingDates };
  return tradingCalendarCache;
}

function findTradingDateIndex(dates: string[], tradeDate: string): number {
  let low = 0;
  let high = dates.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const value = dates[mid];
    if (value === tradeDate) return mid;
    if (value < tradeDate) low = mid + 1;
    else high = mid - 1;
  }
  return -low - 1;
}

export function getBeijingNow(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
}

export function formatTradeDate(date: Date = getBeijingNow()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 优先按本地交易日历得到下一个 A 股交易日；无日历时退回工作日估算 */
export function getNextTradeDateLabel(from: Date = getBeijingNow()): string {
  return shiftTradeDateLabel(formatTradeDate(from), 1);
}

/** 优先按本地交易日历偏移 A 股交易日；无日历时退回工作日估算 */
export function shiftTradeDateLabel(tradeDate: string, deltaTradingDays: number): string {
  const calendar = readTradingCalendar();
  const normalized = normalizeDateLabel(tradeDate);
  if (calendar && calendar.tradingDates.length > 0) {
    const delta = Math.trunc(deltaTradingDays);
    if (delta === 0) return normalized;

    const foundIndex = findTradingDateIndex(calendar.tradingDates, normalized);
    const insertionIndex = foundIndex >= 0 ? foundIndex : -foundIndex - 1;
    const targetIndex =
      delta > 0
        ? (foundIndex >= 0 ? foundIndex + delta : insertionIndex + delta - 1)
        : (foundIndex >= 0 ? foundIndex + delta : insertionIndex + delta);
    const target = calendar.tradingDates[targetIndex];
    if (target) return target;
  }

  const [y, m, d] = tradeDate.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  let remaining = Math.abs(Math.trunc(deltaTradingDays));
  const dir = deltaTradingDays >= 0 ? 1 : -1;
  while (remaining > 0) {
    date.setDate(date.getDate() + dir);
    const day = date.getDay();
    if (day >= 1 && day <= 5) remaining -= 1;
  }
  return formatTradeDate(date);
}

export function getPreviousTradeDateLabel(from: Date = getBeijingNow()): string {
  const tradeDate = formatTradeDate(from);
  const calendar = readTradingCalendar();
  const previous = calendar?.rows.get(tradeDate)?.previousTradeDate;
  if (previous) return previous;
  return shiftTradeDateLabel(tradeDate, -1);
}

/** 收盘后（15:05+）期望本地 CSV 已包含当日；盘前则期望上一交易日 */
export function getExpectedMarketDataDate(now: Date = getBeijingNow()): string {
  const tradeDate = formatTradeDate(now);
  if (!isMarketTradingDay(now)) return getPreviousTradeDateLabel(now);
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (minutes >= 15 * 60 + 5) return tradeDate;
  return getPreviousTradeDateLabel(now);
}

export function isPreMarketMorningWindow(date: Date = getBeijingNow()): boolean {
  if (!isMarketTradingDay(date)) return false;
  const minutes = date.getHours() * 60 + date.getMinutes();
  return minutes >= 7 * 60 && minutes < 9 * 60 + 30;
}

export const STOCK_BACKTEST_EXIT_SCHEDULE_LABEL =
  '每个交易日 9:30–15:00 监控回测策略仓与新闻仓出场（止盈/止损/持有到期等）';

export const STOCK_BACKTEST_CLOSE_SCHEDULE_LABEL =
  '回测策略仓：交易日前 08:00 按前一交易日数据扫描并买入';

export const MARKET_DATA_REMINDER_SCHEDULE_LABEL =
  '每个交易日提醒更新大盘/个股日线 CSV（数据未就绪时不跑回测策略仓买入）';

export function isWeekday(date: Date = getBeijingNow()): boolean {
  const day = date.getDay();
  return day >= 1 && day <= 5;
}

export function isMarketTradingDay(date: Date = getBeijingNow()): boolean {
  const calendar = readTradingCalendar();
  const tradeDate = formatTradeDate(date);
  const row = calendar?.rows.get(tradeDate);
  if (row) return row.isTrading;
  return isWeekday(date);
}

export const STOCK_INTRADAY_MONITOR_INTERVAL_MINUTES_DEFAULT = 15;

export function getStockIntradayMonitorIntervalMs(
  envMinutes: string | undefined = process.env.STOCK_INTRADAY_MONITOR_INTERVAL_MINUTES,
): number {
  const parsed = Number(envMinutes ?? STOCK_INTRADAY_MONITOR_INTERVAL_MINUTES_DEFAULT);
  if (!Number.isFinite(parsed) || parsed < 5) {
    return STOCK_INTRADAY_MONITOR_INTERVAL_MINUTES_DEFAULT * 60 * 1000;
  }
  return parsed * 60 * 1000;
}

export const STOCK_INTRADAY_MONITOR_SCHEDULE_LABEL =
  `每个交易日交易时段内每 ${STOCK_INTRADAY_MONITOR_INTERVAL_MINUTES_DEFAULT} 分钟扫描股票买入信号（飞书推送）`;

/** 9:30–11:30、13:00–15:00 */
export function isTradingSession(date: Date = getBeijingNow()): boolean {
  if (!isMarketTradingDay(date)) return false;
  const seconds = date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
  const morning = seconds >= (9 * 60 + 30) * 60 && seconds <= (11 * 60 + 30) * 60;
  const afternoon = seconds >= 13 * 60 * 60 && seconds <= 15 * 60 * 60;
  return morning || afternoon;
}

/** ETF 模拟盘可执行窗口：A 股交易时段内（轮询监听，条件满足即调仓/止损） */
export function isEtfAutoRunWindow(date: Date = getBeijingNow()): boolean {
  return isTradingSession(date);
}

export const ETF_PAPER_MONITOR_INTERVAL_MINUTES_DEFAULT = 30;
export const ETF_T_PLUS_SCHEDULE_LABEL =
  'ETF 正T仓：初始化同步 ETF 仓底仓一次，之后交易时段每 30 分钟按自身持仓和监听盘口价做正T模拟';

export function getEtfPaperMonitorIntervalMs(
  envMinutes: string | undefined = process.env.ETF_PAPER_MONITOR_INTERVAL_MINUTES,
): number {
  const parsed = Number(envMinutes ?? ETF_PAPER_MONITOR_INTERVAL_MINUTES_DEFAULT);
  if (!Number.isFinite(parsed) || parsed < 5) {
    return ETF_PAPER_MONITOR_INTERVAL_MINUTES_DEFAULT * 60 * 1000;
  }
  return parsed * 60 * 1000;
}

/** ETF 正T观察窗口：交易时段内按监听间隔运行。 */
export function isEtfTPlusRunWindow(date: Date = getBeijingNow()): boolean {
  return isTradingSession(date);
}

/** 股票动量窗口：15:05 起（日 K 完整后再选股） */
export function isPostMarketWindow(date: Date = getBeijingNow()): boolean {
  if (!isMarketTradingDay(date)) return false;
  const minutes = date.getHours() * 60 + date.getMinutes();
  return minutes >= 15 * 60 + 5;
}

export function assertTradingSession(force = false): void {
  if (!force && !isTradingSession()) {
    throw new Error('当前非 A 股交易时段（9:30–11:30、13:00–15:00 北京时间）');
  }
}

/** 将北京时间（tradeDate + 时分秒）转为 UTC ISO 字符串 */
export function beijingTimeToUtcIso(
  tradeDate: string,
  hour: number,
  minute: number,
  second = 0,
): string {
  const [y, m, d] = tradeDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hour - 8, minute, second)).toISOString();
}

/** 非交易时段的自动成交：按交易日 + 默认盘中时刻落库，避免凌晨/深夜时间戳 */
export function resolvePaperTradedAt(input: {
  tradeDate: string;
  source: 'manual' | 'auto';
  side: 'buy' | 'sell';
}): string {
  if (input.source === 'manual' || isTradingSession()) {
    return new Date().toISOString();
  }
  return beijingTimeToUtcIso(
    input.tradeDate,
    input.side === 'buy' ? 14 : 15,
    input.side === 'buy' ? 30 : 0,
  );
}

export function isBeijingTradingSessionFromIso(iso: string): boolean {
  const date = new Date(iso);
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    weekday: 'short',
  }).format(date);
  if (weekday === 'Sat' || weekday === 'Sun') return false;

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  const second = Number(parts.find((p) => p.type === 'second')?.value ?? 0);
  const seconds = hour * 3600 + minute * 60 + second;
  const morning = seconds >= (9 * 60 + 30) * 60 && seconds <= (11 * 60 + 30) * 60;
  const afternoon = seconds >= 13 * 60 * 60 && seconds <= 15 * 60 * 60;
  return morning || afternoon;
}

export function formatPaperTradeDisplayTime(input: {
  tradeDate: string;
  tradedAt: string;
  source: 'manual' | 'auto';
  side: 'buy' | 'sell';
}): string {
  if (input.source === 'manual' || isBeijingTradingSessionFromIso(input.tradedAt)) {
    return new Date(input.tradedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  }
  const [y, m, d] = input.tradeDate.split('-');
  const time = input.side === 'buy' ? '14:30:00' : '15:00:00';
  return `${Number(y)}/${Number(m)}/${Number(d)} ${time}`;
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

export const ETF_AUTO_RUN_SCHEDULE_LABEL =
  `每个交易日交易时段内每 ${ETF_PAPER_MONITOR_INTERVAL_MINUTES_DEFAULT} 分钟监听 ETF 动量（条件满足即调仓/止损）`;

export const STOCK_AUTO_RUN_SCHEDULE_LABEL =
  '每个交易日 15:05（北京时间，收盘后）股票动量选股';

export const AUTO_RUN_SCHEDULE_LABEL =
  `${ETF_AUTO_RUN_SCHEDULE_LABEL}；${STOCK_AUTO_RUN_SCHEDULE_LABEL}`;

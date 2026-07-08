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
  return shiftTradeDateLabel(formatTradeDate(from), 1);
}

/** 按 A 股工作日（不含法定节假日）偏移交易日 */
export function shiftTradeDateLabel(tradeDate: string, deltaTradingDays: number): string {
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
  return shiftTradeDateLabel(formatTradeDate(from), -1);
}

/** 收盘后（15:05+）期望本地 CSV 已包含当日；盘前则期望上一交易日 */
export function getExpectedMarketDataDate(now: Date = getBeijingNow()): string {
  const tradeDate = formatTradeDate(now);
  if (!isWeekday(now)) return getPreviousTradeDateLabel(now);
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (minutes >= 15 * 60 + 5) return tradeDate;
  return getPreviousTradeDateLabel(now);
}

export function isPreMarketMorningWindow(date: Date = getBeijingNow()): boolean {
  if (!isWeekday(date)) return false;
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
  if (!isWeekday(date)) return false;
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
  if (!isWeekday(date)) return false;
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

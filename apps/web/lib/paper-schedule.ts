import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { BucketSummary, DualPaperPayload } from '@/lib/paper-dual';

const ETF_REBALANCE_DAYS = 10;

type TradingCalendar = {
  mtimeMs: number;
  tradingDates: string[];
};

type PaperTradeLike = {
  bucket?: string;
  tradeDate?: string;
  source?: string;
  note?: string | null;
};

let tradingCalendarCache: TradingCalendar | null = null;

function normalizeDateLabel(value: string | null | undefined): string | null {
  const key = value?.trim().replace(/^\uFEFF/, '').replace(/[-/.年月日]/g, '').slice(0, 8);
  if (!key || !/^\d{8}$/.test(key)) return null;
  return `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
}

function findPackageRoot(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 12; i++) {
    const candidate = path.join(dir, 'packages/agent-core/package.json');
    if (existsSync(candidate)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function tradingCalendarPath(): string {
  const marketCsvDir = process.env.INVESTMENT_AGENT_MARKET_CSV_DIR?.trim();
  if (marketCsvDir) return path.join(path.resolve(marketCsvDir), 'meta', 'trading-calendar.csv');
  const root = findPackageRoot();
  return root
    ? path.join(root, 'packages/agent-core/data/market-csv/meta/trading-calendar.csv')
    : '';
}

function readTradingCalendar(): TradingCalendar | null {
  const filePath = tradingCalendarPath();
  if (!filePath || !existsSync(filePath)) return null;

  const mtimeMs = statSync(filePath).mtimeMs;
  if (tradingCalendarCache?.mtimeMs === mtimeMs) return tradingCalendarCache;

  const tradingDates: string[] = [];
  const lines = readFileSync(filePath, 'utf-8').split(/\r?\n/);
  for (const line of lines.slice(1)) {
    const cols = line.trim().split(',');
    const date = normalizeDateLabel(cols[1] ?? '');
    if (!date) continue;
    if ((cols[2] ?? '').trim() === '交易') tradingDates.push(date);
  }
  tradingDates.sort((a, b) => a.localeCompare(b));
  tradingCalendarCache = { mtimeMs, tradingDates };
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

export function shiftTradeDateLabel(tradeDate: string, deltaTradingDays: number): string {
  const normalized = normalizeDateLabel(tradeDate) ?? tradeDate;
  const calendar = readTradingCalendar();
  if (calendar?.tradingDates.length) {
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

  const [y, m, d] = normalized.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  let remaining = Math.abs(Math.trunc(deltaTradingDays));
  const dir = deltaTradingDays >= 0 ? 1 : -1;
  while (remaining > 0) {
    date.setDate(date.getDate() + dir);
    const day = date.getDay();
    if (day >= 1 && day <= 5) remaining -= 1;
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function extractDateLabels(value: string | null | undefined): string[] {
  if (!value) return [];
  const matches = value.match(/\b20\d{2}[-/.年]?\d{1,2}[-/.月]?\d{1,2}日?\b/g) ?? [];
  return matches
    .map((item) => normalizeDateLabel(item))
    .filter((item): item is string => item != null);
}

function inferLastRebalanceDateFromPositions(etf: BucketSummary): string | null {
  const dates = etf.positions.flatMap((position) => extractDateLabels(position.entryMemo));
  return dates.sort((a, b) => b.localeCompare(a))[0] ?? null;
}

function isEtfRebalanceTrade(trade: PaperTradeLike): boolean {
  if (trade.bucket && trade.bucket !== 'etf') return false;
  const note = trade.note ?? '';
  if (note.includes('ETF 动量')) return true;
  if (note.includes('调仓')) return true;
  return trade.source === 'auto' && !note.includes('ETF 正T');
}

function inferLastRebalanceDateFromTrades(trades: PaperTradeLike[]): string | null {
  const dates = trades
    .filter(isEtfRebalanceTrade)
    .map((trade) => normalizeDateLabel(trade.tradeDate))
    .filter((item): item is string => item != null);
  return dates.sort((a, b) => b.localeCompare(a))[0] ?? null;
}

export function resolveNextEtfRebalanceDate(input: {
  lastRebalanceDate?: string | null;
  tradeDate: string;
  rebalanceDays?: number;
}): string {
  const last = normalizeDateLabel(input.lastRebalanceDate);
  const tradeDate = normalizeDateLabel(input.tradeDate) ?? input.tradeDate;
  if (!last) return tradeDate;
  const target = shiftTradeDateLabel(last, input.rebalanceDays ?? ETF_REBALANCE_DAYS);
  return target < tradeDate ? tradeDate : target;
}

export async function enrichPaperScheduleFields(
  payload: DualPaperPayload,
  loadEtfTrades?: () => Promise<PaperTradeLike[]>,
): Promise<DualPaperPayload> {
  const etf = payload.etf;
  let inferredLast = etf.lastRebalanceDate ?? inferLastRebalanceDateFromPositions(etf);

  if (!inferredLast && loadEtfTrades) {
    const trades = await loadEtfTrades().catch(() => []);
    inferredLast = inferLastRebalanceDateFromTrades(trades);
  }

  const nextRebalanceDate =
    etf.nextRebalanceDate ??
    resolveNextEtfRebalanceDate({
      lastRebalanceDate: inferredLast,
      tradeDate: etf.tradeDate,
      rebalanceDays: etf.rebalanceDays,
    });
  const etfEvergreen = payload.etfEvergreen;
  const evergreenLast =
    etfEvergreen.lastRebalanceDate ?? inferLastRebalanceDateFromPositions(etfEvergreen);
  const evergreenNext =
    etfEvergreen.nextRebalanceDate ??
    resolveNextEtfRebalanceDate({
      lastRebalanceDate: evergreenLast,
      tradeDate: etfEvergreen.tradeDate,
      rebalanceDays: etfEvergreen.rebalanceDays,
    });

  return {
    ...payload,
    etf: {
      ...etf,
      lastRebalanceDate: inferredLast ?? etf.lastRebalanceDate ?? null,
      nextRebalanceDate,
      nextTradeDate: etf.nextTradeDate ?? shiftTradeDateLabel(etf.tradeDate, 1),
      rebalanceDays: etf.rebalanceDays ?? ETF_REBALANCE_DAYS,
    },
    etfEvergreen: {
      ...etfEvergreen,
      lastRebalanceDate: evergreenLast ?? null,
      nextRebalanceDate: evergreenNext,
      nextTradeDate:
        etfEvergreen.nextTradeDate ?? shiftTradeDateLabel(etfEvergreen.tradeDate, 1),
      rebalanceDays: etfEvergreen.rebalanceDays ?? ETF_REBALANCE_DAYS,
    },
    etfTPlus: {
      ...payload.etfTPlus,
      nextTradeDate:
        payload.etfTPlus.nextTradeDate ?? shiftTradeDateLabel(payload.etfTPlus.tradeDate, 1),
    },
  };
}

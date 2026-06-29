import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { MARKET_CSV_DIR } from '../../../mastra/config/paths.js';
import { getCached, setCached } from '../cache.js';

export type LocalDailyKlineBar = {
  tradeDate: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  pctChg: number | null;
  vol: number | null;
  amount: number | null;
};

const ETF_QFQ_DIR = path.join(MARKET_CSV_DIR, 'etf', 'qfq-daily');
const STOCK_QFQ_DIR = process.env.INVESTMENT_AGENT_STOCK_QFQ_DIR?.trim()
  ? path.resolve(process.env.INVESTMENT_AGENT_STOCK_QFQ_DIR)
  : path.join(MARKET_CSV_DIR, 'stock', 'qfq-daily');
const CACHE_TTL_MS = 5 * 60 * 1000;
const LOAD_ALL_DAYS = 100_000;

type LocalCsvAssetType = 'etf' | 'stock';

function dailyCsvPath(assetType: LocalCsvAssetType, symbol: string): string {
  const baseDir = assetType === 'etf' ? ETF_QFQ_DIR : STOCK_QFQ_DIR;
  return path.join(baseDir, `${symbol.trim()}_daily_qfq.csv`);
}

function etfCsvPath(symbol: string): string {
  return dailyCsvPath('etf', symbol);
}

function stockCsvPath(symbol: string): string {
  return dailyCsvPath('stock', symbol);
}

export function hasLocalEtfDailyCsv(symbol: string): boolean {
  return existsSync(etfCsvPath(symbol));
}

export function hasLocalStockDailyCsv(symbol: string): boolean {
  return existsSync(stockCsvPath(symbol));
}

export function listLocalStockDailyCsvSymbols(): string[] {
  if (!existsSync(STOCK_QFQ_DIR)) return [];
  return readdirSync(STOCK_QFQ_DIR)
    .map((fileName) => fileName.match(/^(\d{6})_daily_qfq\.csv$/)?.[1])
    .filter((symbol): symbol is string => Boolean(symbol))
    .sort((a, b) => a.localeCompare(b));
}

function parseNumber(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeTradeDate(value: string): string {
  return value.trim().replace(/^\uFEFF/, '').replace(/-/g, '').slice(0, 8);
}

export function parseLocalDailyCsv(
  content: string,
  limit?: number,
): LocalDailyKlineBar[] {
  const rows: LocalDailyKlineBar[] = [];
  const pushLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    const cols = trimmed.split(',');
    if (cols.length < 8) return;

    const tradeDate = normalizeTradeDate(cols[0] ?? '');
    if (tradeDate.length !== 8) return;

    rows.push({
      tradeDate,
      open: parseNumber(cols[2]),
      close: parseNumber(cols[3]),
      high: parseNumber(cols[4]),
      low: parseNumber(cols[5]),
      vol: parseNumber(cols[6]),
      amount: parseNumber(cols[7]),
      pctChg: parseNumber(cols[9]),
    });
  };

  if (limit != null) {
    const maxRows = Math.max(1, Math.floor(limit));
    let end = content.trimEnd().length;
    while (end > 0 && rows.length < maxRows) {
      const start = content.lastIndexOf('\n', end - 1);
      const lineStart = start < 0 ? 0 : start + 1;
      pushLine(content.slice(lineStart, end));
      if (start < 0) break;
      end = start;
    }
    return rows;
  }

  const lines = content.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  for (let index = lines.length - 1; index >= 1; index -= 1) {
    const line = lines[index]?.trim();
    if (!line) continue;
    pushLine(line);
  }

  return rows;
}

export function parseEtfDailyCsv(content: string): LocalDailyKlineBar[] {
  return parseLocalDailyCsv(content);
}

function withPctChg(quotes: LocalDailyKlineBar[]): LocalDailyKlineBar[] {
  return quotes.map((quote, index) => {
    const prev = quotes[index + 1];
    const pctChg =
      prev?.close && quote.close
        ? Number((((quote.close - prev.close) / prev.close) * 100).toFixed(2))
        : quote.pctChg;
    return { ...quote, pctChg };
  });
}

function fetchLocalDailyKlines(
  assetType: LocalCsvAssetType,
  symbol: string,
  days: number,
): { quotes: LocalDailyKlineBar[]; cached: boolean } {
  const filePath = dailyCsvPath(assetType, symbol);
  if (!existsSync(filePath)) {
    throw new Error(`本地 ${assetType === 'etf' ? 'ETF' : '股票'} CSV 不存在: ${symbol}`);
  }

  const limit =
    days >= LOAD_ALL_DAYS ? LOAD_ALL_DAYS : Math.max(1, Math.floor(days));
  const shouldCache = assetType === 'etf' || limit >= LOAD_ALL_DAYS;
  const cacheKey = `local-csv:${assetType}:${symbol}:${limit >= LOAD_ALL_DAYS ? 'all' : limit}`;
  const fileMtime = statSync(filePath).mtimeMs;
  const cachedEntry = shouldCache
    ? getCached<{ mtime: number; quotes: LocalDailyKlineBar[] }>(cacheKey)
    : undefined;

  let allQuotes: LocalDailyKlineBar[];
  let cached = false;

  if (cachedEntry && cachedEntry.mtime === fileMtime) {
    allQuotes = cachedEntry.quotes;
    cached = true;
  } else {
    const content = readFileSync(filePath, 'utf-8');
    allQuotes = parseLocalDailyCsv(
      content,
      limit >= LOAD_ALL_DAYS ? undefined : limit,
    );
    if (allQuotes.length === 0) {
      throw new Error(`本地 ${assetType === 'etf' ? 'ETF' : '股票'} CSV 无有效数据: ${symbol}`);
    }
    if (shouldCache) {
      setCached(cacheKey, { mtime: fileMtime, quotes: allQuotes }, CACHE_TTL_MS);
    }
  }

  return {
    quotes: withPctChg(allQuotes),
    cached,
  };
}

export function fetchLocalEtfDailyKlines(
  symbol: string,
  days: number,
): { quotes: LocalDailyKlineBar[]; cached: boolean } {
  return fetchLocalDailyKlines('etf', symbol, days);
}

export function fetchLocalStockDailyKlines(
  symbol: string,
  days: number,
): { quotes: LocalDailyKlineBar[]; cached: boolean } {
  return fetchLocalDailyKlines('stock', symbol, days);
}

export const LOCAL_DAILY_LOAD_ALL_DAYS = LOAD_ALL_DAYS;
export const LOCAL_ETF_LOAD_ALL_DAYS = LOAD_ALL_DAYS;

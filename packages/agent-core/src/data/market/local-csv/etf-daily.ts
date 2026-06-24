import { existsSync, readFileSync, statSync } from 'node:fs';
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
const CACHE_TTL_MS = 5 * 60 * 1000;
const LOAD_ALL_DAYS = 100_000;

function etfCsvPath(symbol: string): string {
  return path.join(ETF_QFQ_DIR, `${symbol.trim()}_daily_qfq.csv`);
}

export function hasLocalEtfDailyCsv(symbol: string): boolean {
  return existsSync(etfCsvPath(symbol));
}

function parseNumber(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeTradeDate(value: string): string {
  return value.trim().replace(/-/g, '').slice(0, 8);
}

export function parseEtfDailyCsv(content: string): LocalDailyKlineBar[] {
  const lines = content.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const rows: LocalDailyKlineBar[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]?.trim();
    if (!line) continue;

    const cols = line.split(',');
    if (cols.length < 8) continue;

    const tradeDate = normalizeTradeDate(cols[0] ?? '');
    if (tradeDate.length !== 8) continue;

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
  }

  return rows.reverse();
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

export function fetchLocalEtfDailyKlines(
  symbol: string,
  days: number,
): { quotes: LocalDailyKlineBar[]; cached: boolean } {
  const filePath = etfCsvPath(symbol);
  if (!existsSync(filePath)) {
    throw new Error(`本地 ETF CSV 不存在: ${symbol}`);
  }

  const cacheKey = `local-csv:etf:${symbol}`;
  const fileMtime = statSync(filePath).mtimeMs;
  const cachedEntry = getCached<{ mtime: number; quotes: LocalDailyKlineBar[] }>(
    cacheKey,
  );

  let allQuotes: LocalDailyKlineBar[];
  let cached = false;

  if (cachedEntry && cachedEntry.mtime === fileMtime) {
    allQuotes = cachedEntry.quotes;
    cached = true;
  } else {
    const content = readFileSync(filePath, 'utf-8');
    allQuotes = parseEtfDailyCsv(content);
    if (allQuotes.length === 0) {
      throw new Error(`本地 ETF CSV 无有效数据: ${symbol}`);
    }
    setCached(cacheKey, { mtime: fileMtime, quotes: allQuotes }, CACHE_TTL_MS);
  }

  const limit =
    days >= LOAD_ALL_DAYS ? allQuotes.length : Math.max(1, Math.floor(days));
  return {
    quotes: withPctChg(allQuotes.slice(0, limit)),
    cached,
  };
}

export const LOCAL_ETF_LOAD_ALL_DAYS = LOAD_ALL_DAYS;

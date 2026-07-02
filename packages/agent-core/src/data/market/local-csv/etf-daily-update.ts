import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ETF_POOL_19 } from '../../etf/pool.js';
import { isEtfSymbol, isStockSymbol } from '../asset-type.js';
import { fetchDailyKlines } from '../free/tencent.js';
import {
  getLocalEtfDailyCsvPath,
  getLocalStockDailyCsvPath,
  getLocalStockName,
  listLocalEtfDailyCsvSymbols,
  listLocalStockDailyCsvSymbols,
} from './etf-daily.js';

const DAILY_HEADER =
  '\uFEFF日期,代码,开盘,收盘,最高,最低,成交量,成交额,振幅,涨跌幅,涨跌额,换手率';

type DailyCsvAssetType = 'etf' | 'stock';

type DailyCsvRow = {
  tradeDate: string;
  symbol: string;
  open: number | null;
  close: number | null;
  high: number | null;
  low: number | null;
  vol: number | null;
  amount: number | null;
  amplitude: number | null;
  pctChg: number | null;
  change: number | null;
  turnover: number | null;
};

export type DailyCsvUpdateItem = {
  assetType: DailyCsvAssetType;
  symbol: string;
  name: string;
  path: string;
  beforeRows: number;
  afterRows: number;
  addedRows: number;
  updatedRows: number;
  latestDate: string | null;
  error?: string;
};

export type DailyCsvUpdateResult = {
  assetType: DailyCsvAssetType;
  tradeDate: string;
  updatedAt: string;
  items: DailyCsvUpdateItem[];
  addedRows: number;
  updatedRows: number;
  errors: number;
};

export type EtfDailyUpdateItem = DailyCsvUpdateItem;
export type EtfDailyUpdateResult = DailyCsvUpdateResult;

const ETF_NAME_BY_SYMBOL = new Map(ETF_POOL_19.map((item) => [item.symbol, item.name]));

function normalizeTradeDate(value: string | undefined): string | null {
  const normalized = value?.trim().replace(/^\uFEFF/, '').replace(/-/g, '').slice(0, 8);
  return normalized && /^\d{8}$/.test(normalized) ? normalized : null;
}

function formatTradeDate(value: string): string {
  const normalized = value.replace(/-/g, '');
  return `${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6, 8)}`;
}

function parseNumber(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '';
  return String(Number(value.toFixed(6)));
}

function readExistingRows(filePath: string, symbol: string): DailyCsvRow[] {
  if (!existsSync(filePath)) return [];

  const lines = readFileSync(filePath, 'utf-8').split(/\r?\n/);
  const rows: DailyCsvRow[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]?.trim();
    if (!line) continue;
    const cols = line.split(',');
    const tradeDate = normalizeTradeDate(cols[0]);
    if (!tradeDate) continue;
    rows.push({
      tradeDate,
      symbol: cols[1]?.trim() || symbol,
      open: parseNumber(cols[2]),
      close: parseNumber(cols[3]),
      high: parseNumber(cols[4]),
      low: parseNumber(cols[5]),
      vol: parseNumber(cols[6]),
      amount: parseNumber(cols[7]),
      amplitude: parseNumber(cols[8]),
      pctChg: parseNumber(cols[9]),
      change: parseNumber(cols[10]),
      turnover: parseNumber(cols[11]),
    });
  }
  return rows;
}

function rowsEqual(a: DailyCsvRow, b: DailyCsvRow): boolean {
  return (
    a.open === b.open &&
    a.close === b.close &&
    a.high === b.high &&
    a.low === b.low &&
    a.vol === b.vol &&
    a.amount === b.amount &&
    a.amplitude === b.amplitude &&
    a.pctChg === b.pctChg &&
    a.change === b.change &&
    a.turnover === b.turnover
  );
}

function mergeRows(input: {
  symbol: string;
  existing: DailyCsvRow[];
  fetched: Array<{
    tradeDate: string;
    open: number | null;
    close: number | null;
    high: number | null;
    low: number | null;
    vol: number | null;
    amount: number | null;
  }>;
}): { rows: DailyCsvRow[]; addedRows: number; updatedRows: number } {
  const byDate = new Map(input.existing.map((row) => [row.tradeDate, row]));
  let addedRows = 0;
  let updatedRows = 0;

  for (const quote of input.fetched) {
    const tradeDate = normalizeTradeDate(quote.tradeDate);
    if (!tradeDate) continue;

    const existing = byDate.get(tradeDate);
    const next: DailyCsvRow = {
      tradeDate,
      symbol: input.symbol,
      open: quote.open,
      close: quote.close,
      high: quote.high,
      low: quote.low,
      vol: quote.vol,
      amount: quote.amount ?? existing?.amount ?? null,
      amplitude: existing?.amplitude ?? null,
      pctChg: existing?.pctChg ?? null,
      change: existing?.change ?? null,
      turnover: existing?.turnover ?? null,
    };

    if (!existing) {
      addedRows += 1;
      byDate.set(tradeDate, next);
      continue;
    }

    const merged = {
      ...next,
      symbol: existing.symbol || next.symbol,
      amount: next.amount ?? existing.amount,
      turnover: existing.turnover,
    };
    if (!rowsEqual(existing, merged)) {
      updatedRows += 1;
      byDate.set(tradeDate, merged);
    }
  }

  const rows = [...byDate.values()].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const prev = rows[index - 1];
    const prevClose = prev?.close;
    if (row.close != null && prevClose != null && prevClose > 0) {
      row.change = Number((row.close - prevClose).toFixed(6));
      row.pctChg = Number((((row.close - prevClose) / prevClose) * 100).toFixed(2));
    }
    if (row.high != null && row.low != null && prevClose != null && prevClose > 0) {
      row.amplitude = Number((((row.high - row.low) / prevClose) * 100).toFixed(2));
    }
  }

  return { rows, addedRows, updatedRows };
}

function serializeRows(rows: DailyCsvRow[]): string {
  const body = rows
    .map((row) =>
      [
        formatTradeDate(row.tradeDate),
        row.symbol,
        formatNumber(row.open),
        formatNumber(row.close),
        formatNumber(row.high),
        formatNumber(row.low),
        formatNumber(row.vol),
        formatNumber(row.amount),
        formatNumber(row.amplitude),
        formatNumber(row.pctChg),
        formatNumber(row.change),
        formatNumber(row.turnover),
      ].join(','),
    )
    .join('\n');
  return `${DAILY_HEADER}\n${body}\n`;
}

function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function envNumber(name: string): number | undefined {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function uniqueSymbols(symbols: Iterable<string>, predicate: (symbol: string) => boolean): string[] {
  return [...new Set([...symbols].map((item) => item.trim()).filter(predicate))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function maybeLimit(symbols: string[], maxSymbols: number | undefined): string[] {
  if (!maxSymbols || maxSymbols <= 0) return symbols;
  return symbols.slice(0, Math.floor(maxSymbols));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveDelayMs(assetType: DailyCsvAssetType, input?: number): number {
  const fromEnv =
    assetType === 'etf'
      ? envNumber('ETF_DAILY_CSV_DELAY_MS')
      : envNumber('STOCK_DAILY_CSV_DELAY_MS');
  return Math.max(
    0,
    Math.floor(input ?? fromEnv ?? envNumber('DAILY_CSV_UPDATE_DELAY_MS') ?? 80),
  );
}

async function collectActiveStockSymbols(): Promise<string[]> {
  const symbols = new Set<string>();

  const [{ listWatchlistItems }, { listPaperPositions }, { listScreeningSessions, getScreeningSession }] =
    await Promise.all([
      import('../../watchlist/store.js'),
      import('../../paper/store.js'),
      import('../../screening/store.js'),
    ]);

  for (const item of await listWatchlistItems()) {
    symbols.add(item.symbol);
  }

  for (const position of await listPaperPositions('stock')) {
    symbols.add(position.symbol);
  }

  const limit = Math.max(1, Math.floor(envNumber('STOCK_DAILY_CSV_SCREENING_SESSIONS') ?? 5));
  const sessions = await listScreeningSessions({ limit });
  for (const summary of sessions) {
    const session = await getScreeningSession(summary.id);
    for (const candidate of session?.candidates ?? []) {
      if (candidate.assetType === 'etf') continue;
      symbols.add(candidate.symbol);
    }
  }

  return uniqueSymbols(symbols, isStockSymbol);
}

async function resolveSymbols(input: {
  assetType: DailyCsvAssetType;
  symbols?: string[];
  includeLocal?: boolean;
  includeActive?: boolean;
  maxSymbols?: number;
}): Promise<string[]> {
  if (input.symbols?.length) {
    return maybeLimit(
      uniqueSymbols(input.symbols, input.assetType === 'etf' ? isEtfSymbol : isStockSymbol),
      input.maxSymbols,
    );
  }

  const symbols = new Set<string>();
  if (input.assetType === 'etf') {
    for (const item of ETF_POOL_19) symbols.add(item.symbol);
    const includeLocal =
      input.includeLocal ?? envFlag('ETF_DAILY_CSV_INCLUDE_LOCAL', true);
    if (includeLocal) {
      for (const symbol of listLocalEtfDailyCsvSymbols()) symbols.add(symbol);
    }
    return maybeLimit(uniqueSymbols(symbols, isEtfSymbol), input.maxSymbols);
  }

  const includeLocal = input.includeLocal ?? envFlag('STOCK_DAILY_CSV_INCLUDE_LOCAL', false);
  const includeActive = input.includeActive ?? envFlag('STOCK_DAILY_CSV_INCLUDE_ACTIVE', true);
  if (includeLocal) {
    for (const symbol of listLocalStockDailyCsvSymbols()) symbols.add(symbol);
  }
  if (includeActive) {
    for (const symbol of await collectActiveStockSymbols()) symbols.add(symbol);
  }
  return maybeLimit(uniqueSymbols(symbols, isStockSymbol), input.maxSymbols);
}

function getName(assetType: DailyCsvAssetType, symbol: string): string {
  if (assetType === 'etf') return ETF_NAME_BY_SYMBOL.get(symbol) ?? symbol;
  return getLocalStockName(symbol) ?? symbol;
}

function getFilePath(assetType: DailyCsvAssetType, symbol: string): string {
  return assetType === 'etf'
    ? getLocalEtfDailyCsvPath(symbol)
    : getLocalStockDailyCsvPath(symbol);
}

export async function updateDailyCsvPool(options: {
  assetType: DailyCsvAssetType;
  days?: number;
  symbols?: string[];
  includeLocal?: boolean;
  includeActive?: boolean;
  maxSymbols?: number;
  delayMs?: number;
}): Promise<DailyCsvUpdateResult> {
  const days = Math.max(5, Math.floor(options.days ?? 30));
  const maxSymbols =
    options.maxSymbols ??
    (options.assetType === 'etf'
      ? envNumber('ETF_DAILY_CSV_MAX_SYMBOLS')
      : envNumber('STOCK_DAILY_CSV_MAX_SYMBOLS'));
  const symbols = await resolveSymbols({ ...options, maxSymbols });
  const delayMs = resolveDelayMs(options.assetType, options.delayMs);
  const items: DailyCsvUpdateItem[] = [];

  for (const [index, symbol] of symbols.entries()) {
    const filePath = getFilePath(options.assetType, symbol);
    const item: DailyCsvUpdateItem = {
      assetType: options.assetType,
      symbol,
      name: getName(options.assetType, symbol),
      path: filePath,
      beforeRows: 0,
      afterRows: 0,
      addedRows: 0,
      updatedRows: 0,
      latestDate: null,
    };

    try {
      const existing = readExistingRows(filePath, symbol);
      item.beforeRows = existing.length;
      const { quotes } = await fetchDailyKlines(symbol, days, {
        forceRefresh: true,
      });
      const merged = mergeRows({
        symbol,
        existing,
        fetched: quotes,
      });
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(filePath, serializeRows(merged.rows), 'utf-8');
      item.afterRows = merged.rows.length;
      item.addedRows = merged.addedRows;
      item.updatedRows = merged.updatedRows;
      item.latestDate = merged.rows.at(-1)?.tradeDate ?? null;
    } catch (error) {
      item.error = error instanceof Error ? error.message : String(error);
    }

    items.push(item);
    if (delayMs > 0 && index < symbols.length - 1) {
      await delay(delayMs);
    }
  }

  return {
    assetType: options.assetType,
    tradeDate: items.map((item) => item.latestDate).filter(Boolean).sort().at(-1) ?? '',
    updatedAt: new Date().toISOString(),
    items,
    addedRows: items.reduce((sum, item) => sum + item.addedRows, 0),
    updatedRows: items.reduce((sum, item) => sum + item.updatedRows, 0),
    errors: items.filter((item) => item.error).length,
  };
}

export async function updateEtfDailyCsvPool(options?: {
  days?: number;
  symbols?: string[];
  includeLocal?: boolean;
  maxSymbols?: number;
  delayMs?: number;
}): Promise<EtfDailyUpdateResult> {
  return updateDailyCsvPool({
    assetType: 'etf',
    ...options,
  });
}

export async function updateStockDailyCsvPool(options?: {
  days?: number;
  symbols?: string[];
  includeLocal?: boolean;
  includeActive?: boolean;
  maxSymbols?: number;
  delayMs?: number;
}): Promise<DailyCsvUpdateResult> {
  return updateDailyCsvPool({
    assetType: 'stock',
    ...options,
  });
}

export const __privateEtfDailyUpdate = {
  mergeRows,
};

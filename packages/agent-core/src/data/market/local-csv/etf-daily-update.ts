import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { ETF_POOL_19 } from '../../etf/pool.js';
import { isEtfSymbol, isStockSymbol } from '../asset-type.js';
import { fetchDailyKlines } from '../free/tencent.js';
import { fetchInfowayDailyKlines } from '../free/infoway.js';
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
type DailyCsvProvider = 'auto' | 'tencent' | 'infoway';

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
  attempts: number;
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

export type DailyCsvUpdateProgressEvent =
  | {
      type: 'start';
      assetType: DailyCsvAssetType;
      total: number;
      days: number;
      retryRounds: number;
    }
  | {
      type: 'round';
      assetType: DailyCsvAssetType;
      round: number;
      retryRounds: number;
      pending: number;
      total: number;
      processed: number;
      roundProcessed: number;
    }
  | {
      type: 'item';
      assetType: DailyCsvAssetType;
      round: number;
      retryRounds: number;
      total: number;
      processed: number;
      roundProcessed: number;
      pending: number;
      item: DailyCsvUpdateItem;
      final: boolean;
    }
  | {
      type: 'done';
      assetType: DailyCsvAssetType;
      total: number;
      processed: number;
      result: DailyCsvUpdateResult;
    };

export type EtfDailyUpdateItem = DailyCsvUpdateItem;
export type EtfDailyUpdateResult = DailyCsvUpdateResult;

type DailyCsvUpdateProgressHandler = (
  event: DailyCsvUpdateProgressEvent,
) => void | Promise<void>;

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

function writeDailyCsvAtomic(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}`;
  writeFileSync(tempPath, content, 'utf-8');
  renameSync(tempPath, filePath);
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

function resolveDailyCsvProvider(assetType: DailyCsvAssetType): DailyCsvProvider {
  const raw =
    assetType === 'stock'
      ? process.env.STOCK_DAILY_CSV_PROVIDER?.trim().toLowerCase()
      : process.env.ETF_DAILY_CSV_PROVIDER?.trim().toLowerCase();
  if (raw === 'tencent' || raw === 'infoway' || raw === 'auto') return raw;
  return 'auto';
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
  const defaultDelayMs = assetType === 'stock' ? 333 : 80;
  return Math.max(
    0,
    Math.floor(
      input ??
        fromEnv ??
        envNumber('DAILY_CSV_UPDATE_DELAY_MS') ??
        defaultDelayMs,
    ),
  );
}

function resolveRetryCount(input?: number): number {
  return Math.max(
    0,
    Math.floor(input ?? envNumber('DAILY_CSV_UPDATE_RETRIES') ?? 2),
  );
}

function resolveRetryRounds(assetType: DailyCsvAssetType, input?: number): number {
  const fromEnv =
    assetType === 'etf'
      ? envNumber('ETF_DAILY_CSV_RETRY_ROUNDS')
      : envNumber('STOCK_DAILY_CSV_RETRY_ROUNDS');
  return Math.max(
    1,
    Math.floor(
      input ??
        fromEnv ??
        envNumber('DAILY_CSV_UPDATE_RETRY_ROUNDS') ??
        (assetType === 'stock' ? 3 : 1),
    ),
  );
}

function resolveRetryRoundDelayMs(assetType: DailyCsvAssetType, input?: number): number {
  const fromEnv =
    assetType === 'etf'
      ? envNumber('ETF_DAILY_CSV_RETRY_ROUND_DELAY_MS')
      : envNumber('STOCK_DAILY_CSV_RETRY_ROUND_DELAY_MS');
  return Math.max(
    0,
    Math.floor(
      input ??
        fromEnv ??
        envNumber('DAILY_CSV_UPDATE_RETRY_ROUND_DELAY_MS') ??
        5_000,
    ),
  );
}

function resolveTimeoutMs(input?: number): number {
  return Math.max(
    1_000,
    Math.floor(input ?? envNumber('DAILY_CSV_UPDATE_TIMEOUT_MS') ?? 5_000),
  );
}

async function fetchDailyKlinesWithRetry(input: {
  symbol: string;
  days: number;
  retryCount: number;
  retryDelayMs: number;
  timeoutMs: number;
  provider: DailyCsvProvider;
}): Promise<Awaited<ReturnType<typeof fetchDailyKlines>> & { attempts: number }> {
  let lastError: unknown;
  const maxAttempts = input.retryCount + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const useInfoway =
        input.provider === 'infoway' ||
        (input.provider === 'auto' && Boolean(process.env.INFOWAY_API_KEY?.trim()));
      let infowayError: unknown;
      if (useInfoway) {
        try {
          const result = await fetchInfowayDailyKlines(input.symbol, input.days, {
            retries: 0,
            timeoutMs: input.timeoutMs,
          });
          return { ...result, attempts: attempt };
        } catch (error) {
          infowayError = error;
          if (input.provider === 'infoway') throw error;
        }
      }

      const result = await fetchDailyKlines(input.symbol, input.days, {
        forceRefresh: true,
        retries: 0,
        timeoutMs: input.timeoutMs,
      }).catch((tencentError: unknown) => {
        if (infowayError) {
          const infowayMessage =
            infowayError instanceof Error ? infowayError.message : String(infowayError);
          const tencentMessage =
            tencentError instanceof Error ? tencentError.message : String(tencentError);
          throw new Error(`Infoway 失败: ${infowayMessage}; 腾讯兜底失败: ${tencentMessage}`);
        }
        throw tencentError;
      });
      return { ...result, attempts: attempt };
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) break;
      if (input.retryDelayMs > 0) {
        await delay(input.retryDelayMs);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function updateDailyCsvSymbol(input: {
  assetType: DailyCsvAssetType;
  symbol: string;
  days: number;
  retryCount: number;
  delayMs: number;
  timeoutMs: number;
  provider: DailyCsvProvider;
  previousAttempts?: number;
}): Promise<DailyCsvUpdateItem> {
  const filePath = getFilePath(input.assetType, input.symbol);
  const item: DailyCsvUpdateItem = {
    assetType: input.assetType,
    symbol: input.symbol,
    name: getName(input.assetType, input.symbol),
    path: filePath,
    attempts: input.previousAttempts ?? 0,
    beforeRows: 0,
    afterRows: 0,
    addedRows: 0,
    updatedRows: 0,
    latestDate: null,
  };

  try {
    const existing = readExistingRows(filePath, input.symbol);
    item.beforeRows = existing.length;
    const { quotes, attempts } = await fetchDailyKlinesWithRetry({
      symbol: input.symbol,
      days: input.days,
      retryCount: input.retryCount,
      retryDelayMs: input.delayMs,
      timeoutMs: input.timeoutMs,
      provider: input.provider,
    });
    item.attempts += attempts;
    const merged = mergeRows({
      symbol: input.symbol,
      existing,
      fetched: quotes,
    });
    writeDailyCsvAtomic(filePath, serializeRows(merged.rows));
    item.afterRows = merged.rows.length;
    item.addedRows = merged.addedRows;
    item.updatedRows = merged.updatedRows;
    item.latestDate = merged.rows.at(-1)?.tradeDate ?? null;
  } catch (error) {
    item.attempts += input.retryCount + 1;
    item.error = error instanceof Error ? error.message : String(error);
  }

  return item;
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
  retryCount?: number;
  retryRounds?: number;
  retryRoundDelayMs?: number;
  timeoutMs?: number;
  onProgress?: DailyCsvUpdateProgressHandler;
}): Promise<DailyCsvUpdateResult> {
  const days = Math.max(5, Math.floor(options.days ?? 30));
  const maxSymbols =
    options.maxSymbols ??
    (options.assetType === 'etf'
      ? envNumber('ETF_DAILY_CSV_MAX_SYMBOLS')
      : envNumber('STOCK_DAILY_CSV_MAX_SYMBOLS'));
  const symbols = await resolveSymbols({ ...options, maxSymbols });
  const delayMs = resolveDelayMs(options.assetType, options.delayMs);
  const retryCount = resolveRetryCount(options.retryCount);
  const retryRounds = resolveRetryRounds(options.assetType, options.retryRounds);
  const retryRoundDelayMs = resolveRetryRoundDelayMs(
    options.assetType,
    options.retryRoundDelayMs,
  );
  const timeoutMs = resolveTimeoutMs(options.timeoutMs);
  const provider = resolveDailyCsvProvider(options.assetType);
  const itemsBySymbol = new Map<string, DailyCsvUpdateItem>();
  const finalSymbols = new Set<string>();
  let pendingSymbols = symbols;

  await options.onProgress?.({
    type: 'start',
    assetType: options.assetType,
    total: symbols.length,
    days,
    retryRounds,
  });

  for (
    let round = 1;
    round <= retryRounds && pendingSymbols.length > 0;
    round += 1
  ) {
    const failedSymbols: string[] = [];

    await options.onProgress?.({
      type: 'round',
      assetType: options.assetType,
      round,
      retryRounds,
      pending: pendingSymbols.length,
      total: symbols.length,
      processed: finalSymbols.size,
      roundProcessed: 0,
    });

    for (const [index, symbol] of pendingSymbols.entries()) {
      const item = await updateDailyCsvSymbol({
        assetType: options.assetType,
        symbol,
        days,
        retryCount,
        delayMs,
        timeoutMs,
        provider,
        previousAttempts: itemsBySymbol.get(symbol)?.attempts,
      });

      itemsBySymbol.set(symbol, item);
      const final = !item.error || round === retryRounds;
      if (item.error) failedSymbols.push(symbol);
      if (final) finalSymbols.add(symbol);

      await options.onProgress?.({
        type: 'item',
        assetType: options.assetType,
        round,
        retryRounds,
        total: symbols.length,
        processed: finalSymbols.size,
        roundProcessed: index + 1,
        pending: Math.max(0, pendingSymbols.length - index - 1),
        item,
        final,
      });

      if (delayMs > 0 && index < pendingSymbols.length - 1) {
        await delay(delayMs);
      }
    }

    pendingSymbols = failedSymbols;
    if (
      pendingSymbols.length > 0 &&
      round < retryRounds &&
      retryRoundDelayMs > 0
    ) {
      await delay(retryRoundDelayMs);
    }
  }

  const items = symbols
    .map((symbol) => itemsBySymbol.get(symbol))
    .filter((item): item is DailyCsvUpdateItem => Boolean(item));

  const result = {
    assetType: options.assetType,
    tradeDate: items.map((item) => item.latestDate).filter(Boolean).sort().at(-1) ?? '',
    updatedAt: new Date().toISOString(),
    items,
    addedRows: items.reduce((sum, item) => sum + item.addedRows, 0),
    updatedRows: items.reduce((sum, item) => sum + item.updatedRows, 0),
    errors: items.filter((item) => item.error).length,
  };

  await options.onProgress?.({
    type: 'done',
    assetType: options.assetType,
    total: symbols.length,
    processed: finalSymbols.size,
    result,
  });

  return result;
}

export async function updateEtfDailyCsvPool(options?: {
  days?: number;
  symbols?: string[];
  includeLocal?: boolean;
  maxSymbols?: number;
  delayMs?: number;
  retryCount?: number;
  retryRounds?: number;
  retryRoundDelayMs?: number;
  timeoutMs?: number;
  onProgress?: DailyCsvUpdateProgressHandler;
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
  retryCount?: number;
  retryRounds?: number;
  retryRoundDelayMs?: number;
  timeoutMs?: number;
  onProgress?: DailyCsvUpdateProgressHandler;
}): Promise<DailyCsvUpdateResult> {
  return updateDailyCsvPool({
    assetType: 'stock',
    ...options,
  });
}

export const __privateEtfDailyUpdate = {
  mergeRows,
};

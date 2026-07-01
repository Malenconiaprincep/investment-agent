import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ETF_POOL_19 } from '../../etf/pool.js';
import { fetchDailyKlines } from '../free/tencent.js';
import { getLocalEtfDailyCsvPath } from './etf-daily.js';

const ETF_DAILY_HEADER =
  '\uFEFF日期,基金代码,开盘,收盘,最高,最低,成交量,成交额,振幅,涨跌幅,涨跌额,换手率';

type EtfDailyCsvRow = {
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

export type EtfDailyUpdateItem = {
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

export type EtfDailyUpdateResult = {
  tradeDate: string;
  updatedAt: string;
  items: EtfDailyUpdateItem[];
  addedRows: number;
  updatedRows: number;
  errors: number;
};

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

function readExistingRows(filePath: string, symbol: string): EtfDailyCsvRow[] {
  if (!existsSync(filePath)) return [];

  const lines = readFileSync(filePath, 'utf-8').split(/\r?\n/);
  const rows: EtfDailyCsvRow[] = [];
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

function rowsEqual(a: EtfDailyCsvRow, b: EtfDailyCsvRow): boolean {
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
  existing: EtfDailyCsvRow[];
  fetched: Array<{
    tradeDate: string;
    open: number | null;
    close: number | null;
    high: number | null;
    low: number | null;
    vol: number | null;
    amount: number | null;
  }>;
}): { rows: EtfDailyCsvRow[]; addedRows: number; updatedRows: number } {
  const byDate = new Map(input.existing.map((row) => [row.tradeDate, row]));
  let addedRows = 0;
  let updatedRows = 0;

  for (const quote of input.fetched) {
    const tradeDate = normalizeTradeDate(quote.tradeDate);
    if (!tradeDate) continue;

    const existing = byDate.get(tradeDate);
    const next: EtfDailyCsvRow = {
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

function serializeRows(rows: EtfDailyCsvRow[]): string {
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
  return `${ETF_DAILY_HEADER}\n${body}\n`;
}

export async function updateEtfDailyCsvPool(options?: {
  days?: number;
  symbols?: string[];
}): Promise<EtfDailyUpdateResult> {
  const days = Math.max(5, Math.floor(options?.days ?? 30));
  const wanted = options?.symbols ? new Set(options.symbols.map((item) => item.trim())) : null;
  const items: EtfDailyUpdateItem[] = [];

  for (const etf of ETF_POOL_19) {
    if (wanted && !wanted.has(etf.symbol)) continue;

    const filePath = getLocalEtfDailyCsvPath(etf.symbol);
    const item: EtfDailyUpdateItem = {
      symbol: etf.symbol,
      name: etf.name,
      path: filePath,
      beforeRows: 0,
      afterRows: 0,
      addedRows: 0,
      updatedRows: 0,
      latestDate: null,
    };

    try {
      const existing = readExistingRows(filePath, etf.symbol);
      item.beforeRows = existing.length;
      const { quotes } = await fetchDailyKlines(etf.symbol, days, {
        forceRefresh: true,
      });
      const merged = mergeRows({
        symbol: etf.symbol,
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
  }

  return {
    tradeDate: items.map((item) => item.latestDate).filter(Boolean).sort().at(-1) ?? '',
    updatedAt: new Date().toISOString(),
    items,
    addedRows: items.reduce((sum, item) => sum + item.addedRows, 0),
    updatedRows: items.reduce((sum, item) => sum + item.updatedRows, 0),
    errors: items.filter((item) => item.error).length,
  };
}

export const __privateEtfDailyUpdate = {
  mergeRows,
  serializeRows,
};

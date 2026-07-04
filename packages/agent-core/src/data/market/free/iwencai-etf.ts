import { callIwencaiTool } from '../../../mastra/mcp/iwencai.js';

export type IwencaiEtfDailyQuote = {
  tradeDate: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  pctChg: number | null;
  vol: number | null;
  amount: number | null;
};

function parseNumber(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function collectTradeDates(row: Record<string, unknown>): string[] {
  const dates = new Set<string>();
  for (const key of Object.keys(row)) {
    const match = key.match(/\[(\d{8})\]$/);
    if (match?.[1]) dates.add(match[1]);
  }
  return [...dates].sort((a, b) => b.localeCompare(a));
}

function valueByDate(
  row: Record<string, unknown>,
  field: string,
  date: string,
): number | null {
  return parseNumber(row[`${field}[${date}]`]);
}

function normalizeIwencaiDailyRow(
  row: Record<string, unknown>,
): IwencaiEtfDailyQuote[] {
  return collectTradeDates(row)
    .map((tradeDate) => ({
      tradeDate,
      open: valueByDate(row, '开盘价_前复权', tradeDate),
      high: valueByDate(row, '最高价_前复权', tradeDate),
      low: valueByDate(row, '最低价_前复权', tradeDate),
      close: valueByDate(row, '收盘价_前复权', tradeDate),
      pctChg: valueByDate(row, '涨跌幅', tradeDate),
      vol: valueByDate(row, '成交量', tradeDate),
      amount: valueByDate(row, '成交额', tradeDate),
    }))
    .filter((quote) => quote.close != null && quote.close > 0);
}

export async function fetchIwencaiEtfQfqDailyKlines(
  symbol: string,
  days: number,
  options?: { timeout?: number },
): Promise<{
  quotes: IwencaiEtfDailyQuote[];
  cached: false;
  provider: 'iwencai';
  adjustment: 'qfq';
}> {
  const lookback = Math.max(1, Math.min(30, Math.floor(days)));
  const raw = await callIwencaiTool('hithink_market_query', {
    query: `${symbol} 最近${lookback}个交易日 前复权 开盘价 收盘价 最高价 最低价 成交量 成交额 涨跌幅`,
    page: '1',
    limit: '1',
    timeout: options?.timeout ?? 30,
  });
  const data = raw as { datas?: unknown[]; status_code?: number; error?: string };
  if (data.status_code != null && data.status_code !== 0) {
    throw new Error(`问财 ETF 前复权日线失败: ${data.error ?? data.status_code}`);
  }
  const row = data.datas?.[0];
  if (!row || typeof row !== 'object') {
    throw new Error(`问财 ETF 前复权日线无数据: ${symbol}`);
  }

  const quotes = normalizeIwencaiDailyRow(row as Record<string, unknown>);
  if (quotes.length === 0) {
    throw new Error(`问财 ETF 前复权日线无有效 K 线: ${symbol}`);
  }

  return {
    quotes,
    cached: false,
    provider: 'iwencai',
    adjustment: 'qfq',
  };
}

export const __privateIwencaiEtf = {
  normalizeIwencaiDailyRow,
};

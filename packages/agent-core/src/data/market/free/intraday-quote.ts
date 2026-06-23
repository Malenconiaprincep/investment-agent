import { getCached, setCached } from '../cache.js';
import { freeFetchJson, toSecId } from './http.js';

const TTL_MS = 30 * 1000;

export type IntradayQuote = {
  symbol: string;
  name: string;
  price: number;
  pctChg: number;
  change: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
  volume: number;
  amount: number;
};

type UlistResponse = {
  data?: {
    diff?: Array<Record<string, number | string>>;
  };
};

function mapRow(raw: Record<string, number | string>): IntradayQuote | null {
  const symbol = String(raw.f12 ?? '').trim();
  if (!/^\d{6}$/.test(symbol)) return null;

  const price = Number(raw.f2 ?? 0);
  if (!Number.isFinite(price) || price <= 0) return null;

  return {
    symbol,
    name: String(raw.f14 ?? symbol),
    price,
    pctChg: Number(raw.f3 ?? 0),
    change: Number(raw.f4 ?? 0),
    open: Number(raw.f17 ?? 0),
    high: Number(raw.f15 ?? 0),
    low: Number(raw.f16 ?? 0),
    prevClose: Number(raw.f18 ?? 0),
    volume: Number(raw.f5 ?? 0),
    amount: Number(raw.f6 ?? 0),
  };
}

/** 东财实时行情（批量，盘中约 30s 缓存） */
export async function fetchIntradayQuotes(
  symbols: string[],
): Promise<Map<string, IntradayQuote>> {
  const unique = [...new Set(symbols.map((s) => s.trim()).filter(Boolean))];
  const result = new Map<string, IntradayQuote>();
  if (unique.length === 0) return result;

  const batchSize = 40;
  for (let i = 0; i < unique.length; i += batchSize) {
    const batch = unique.slice(i, i + batchSize);
    const cacheKey = `em:intraday:${batch.sort().join(',')}`;
    const cached = getCached<Map<string, IntradayQuote>>(cacheKey);
    if (cached) {
      for (const [symbol, quote] of cached) result.set(symbol, quote);
      continue;
    }

    const secids = batch.map((symbol) => toSecId(symbol)).join(',');
    const json = await freeFetchJson<UlistResponse>(
      `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&fields=f2,f3,f4,f5,f6,f12,f14,f15,f16,f17,f18&secids=${secids}`,
    );

    const batchMap = new Map<string, IntradayQuote>();
    for (const row of json.data?.diff ?? []) {
      const quote = mapRow(row);
      if (quote) batchMap.set(quote.symbol, quote);
    }

    setCached(cacheKey, batchMap, TTL_MS);
    for (const [symbol, quote] of batchMap) result.set(symbol, quote);
  }

  return result;
}

export async function fetchIntradayQuote(
  symbol: string,
): Promise<IntradayQuote | null> {
  const map = await fetchIntradayQuotes([symbol]);
  return map.get(symbol.trim()) ?? null;
}

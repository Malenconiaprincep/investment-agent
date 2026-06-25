import { getCached, setCached } from '../cache.js';
import { fetchIntradayQuote } from './intraday-quote.js';
import { freeFetchJson, toSecId } from './http.js';

const TTL_MS = 15 * 1000;

export type OrderBookQuote = {
  symbol: string;
  name: string;
  lastPrice: number;
  bid1: number | null;
  bid1Volume: number | null;
  ask1: number | null;
  ask1Volume: number | null;
};

type StockGetResponse = {
  data?: Record<string, number | string>;
};

function readPrice(value: number | string | undefined): number | null {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return num;
}

/** 东财五档：买一 f19/f20，卖一 f39/f40 */
export async function fetchOrderBookQuote(symbol: string): Promise<OrderBookQuote | null> {
  const cacheKey = `em:orderbook:${symbol}`;
  const cached = getCached<OrderBookQuote>(cacheKey);
  if (cached) return cached;

  try {
    const json = await freeFetchJson<StockGetResponse>(
      `https://push2.eastmoney.com/api/qt/stock/get?secid=${toSecId(symbol)}&fltt=2&fields=f43,f58,f19,f20,f39,f40`,
    );
    const data = json.data;
    const lastPrice = readPrice(data?.f43);
    if (!lastPrice) return null;

    const quote: OrderBookQuote = {
      symbol,
      name: String(data?.f58 ?? symbol),
      lastPrice,
      bid1: readPrice(data?.f19),
      bid1Volume: readPrice(data?.f20),
      ask1: readPrice(data?.f39),
      ask1Volume: readPrice(data?.f40),
    };
    setCached(cacheKey, quote, TTL_MS);
    return quote;
  } catch {
    const fallback = await fetchIntradayQuote(symbol);
    if (!fallback) return null;
    return {
      symbol: fallback.symbol,
      name: fallback.name,
      lastPrice: fallback.price,
      bid1: null,
      bid1Volume: null,
      ask1: null,
      ask1Volume: null,
    };
  }
}

export type PaperExecutionPrice = {
  price: number;
  priceSource: 'ask1' | 'bid1' | 'last';
  quote: OrderBookQuote;
};

/** 模拟盘成交价：买入用卖一，卖出用买一，缺失时退回最新价 */
export async function resolvePaperExecutionPrice(
  symbol: string,
  side: 'buy' | 'sell',
): Promise<PaperExecutionPrice> {
  const quote = await fetchOrderBookQuote(symbol);
  if (!quote) {
    throw new Error(`无法获取 ${symbol} 盘口行情`);
  }

  if (side === 'buy') {
    const price = quote.ask1 ?? quote.lastPrice;
    return {
      price,
      priceSource: quote.ask1 != null ? 'ask1' : 'last',
      quote,
    };
  }

  const price = quote.bid1 ?? quote.lastPrice;
  return {
    price,
    priceSource: quote.bid1 != null ? 'bid1' : 'last',
    quote,
  };
}

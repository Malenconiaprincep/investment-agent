import {
  readLocalDailyCsvLatestTradeDate,
  hasLocalEtfDailyCsv,
  hasLocalStockDailyCsv,
} from '../market/local-csv/etf-daily.js';
import { normalizeTradeDateKey } from '../backtest/date-range.js';
import {
  formatTradeDate,
  getBeijingNow,
  getExpectedMarketDataDate,
  isMarketTradingDay,
} from './trading-calendar.js';

export type MarketDataFreshness = {
  tradeDate: string;
  isTradingDay: boolean;
  expectedDataDate: string;
  benchmarkLatestDate: string | null;
  stockSampleLatestDate: string | null;
  latestDataDate: string | null;
  isFresh: boolean;
  reminder: string | null;
};

function maxDateKey(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return normalizeTradeDateKey(a) >= normalizeTradeDateKey(b) ? a : b;
}

export function checkMarketDataFreshness(now = getBeijingNow()): MarketDataFreshness {
  const tradeDate = formatTradeDate(now);
  const isTradingDay = isMarketTradingDay(now);
  const expectedDataDate = getExpectedMarketDataDate(now);
  const expectedKey = normalizeTradeDateKey(expectedDataDate);

  const benchmarkLatestDate = hasLocalEtfDailyCsv('510300')
    ? readLocalDailyCsvLatestTradeDate('etf', '510300')
    : null;
  const stockSampleLatestDate = hasLocalStockDailyCsv('000001')
    ? readLocalDailyCsvLatestTradeDate('stock', '000001')
    : null;
  const latestDataDate = maxDateKey(benchmarkLatestDate, stockSampleLatestDate);
  const latestKey = latestDataDate ? normalizeTradeDateKey(latestDataDate) : null;
  const isFresh = latestKey != null && latestKey >= expectedKey;

  let reminder: string | null = null;
  if (isTradingDay && !isFresh) {
    reminder = `今日为交易日，请先更新本地日线 CSV（期望至少包含 ${expectedDataDate}，当前最新 ${latestDataDate ?? '未知'}）。更新沪深300（510300）与个股前复权日线后再跑回测策略模拟仓。`;
  }

  return {
    tradeDate,
    isTradingDay,
    expectedDataDate,
    benchmarkLatestDate,
    stockSampleLatestDate,
    latestDataDate,
    isFresh,
    reminder,
  };
}

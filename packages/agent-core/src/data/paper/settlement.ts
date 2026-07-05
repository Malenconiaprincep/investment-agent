import { isEtfSymbol } from '../market/asset-type.js';
import type { PaperBucket } from './bucket.js';
import { shiftTradeDateLabel } from './trading-calendar.js';

export type PaperSettlementRule = 't0' | 't1' | 't2';

const KNOWN_T0_ETF_SYMBOLS = new Set([
  // 跨境 ETF：部分深市跨境 ETF 不在 513/520 前缀里，先覆盖当前策略池常用标的。
  '159941',
]);

function isLikelyT0Etf(symbol: string): boolean {
  if (!isEtfSymbol(symbol)) return false;
  if (KNOWN_T0_ETF_SYMBOLS.has(symbol)) return true;
  return (
    symbol.startsWith('511') || // 债券/货币类 ETF
    symbol.startsWith('513') || // 跨境 ETF
    symbol.startsWith('518') || // 黄金/商品类 ETF
    symbol.startsWith('520') // 部分跨境 ETF
  );
}

/** A 股股票型 ETF 通常 T+1；跨境/债券/黄金/货币等可回转 ETF 按 T+0。 */
export function getPaperSettlementRule(symbol: string): PaperSettlementRule {
  return isLikelyT0Etf(symbol) ? 't0' : 't1';
}

export function usesT1Settlement(symbol: string): boolean {
  return getPaperSettlementRule(symbol) === 't1';
}

/** 分仓可卖延迟：T+1 标的买入后的下一交易日才可卖，T+0 标的当日可卖。 */
export function getStockSettlementDelayDays(
  bucket: PaperBucket,
  symbol: string,
): number {
  return getPaperSettlementRule(symbol) === 't0' ? 0 : 1;
}

export function getSellableCutoffTradeDate(input: {
  bucket: PaperBucket;
  symbol: string;
  tradeDate: string;
}): string | null {
  const delay = getStockSettlementDelayDays(input.bucket, input.symbol);
  if (delay <= 0) return null;
  return shiftTradeDateLabel(input.tradeDate, -delay);
}

export function isLotSellableOnTradeDate(input: {
  bucket: PaperBucket;
  symbol: string;
  buyDate: string;
  tradeDate: string;
}): boolean {
  const delay = getStockSettlementDelayDays(input.bucket, input.symbol);
  if (delay <= 0) return true;
  const cutoff = shiftTradeDateLabel(input.tradeDate, -delay);
  return input.buyDate.replace(/-/g, '') <= cutoff.replace(/-/g, '');
}

export function bucketSettlementRuleLabel(bucket: PaperBucket, symbol: string): string {
  return settlementRuleLabel(symbol);
}

export function settlementRuleLabel(symbol: string): string {
  return usesT1Settlement(symbol) ? 'T+1' : 'T+0';
}

import { isEtfSymbol } from '../market/asset-type.js';
import type { PaperBucket } from './bucket.js';
import { shiftTradeDateLabel } from './trading-calendar.js';

export type PaperSettlementRule = 't0' | 't1' | 't2';

/** A 股 ETF 场内 T+0；普通股票默认 T+1 */
export function getPaperSettlementRule(symbol: string): PaperSettlementRule {
  return isEtfSymbol(symbol) ? 't0' : 't1';
}

export function usesT1Settlement(symbol: string): boolean {
  return getPaperSettlementRule(symbol) === 't1';
}

/** 分仓可卖延迟：普通股票 T+1，ETF T+0 */
export function getStockSettlementDelayDays(
  bucket: PaperBucket,
  symbol: string,
): number {
  if (isEtfSymbol(symbol)) return 0;
  return 1;
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
  if (isEtfSymbol(symbol)) return 'T+0';
  return 'T+1';
}

export function settlementRuleLabel(symbol: string): string {
  return usesT1Settlement(symbol) ? 'T+1' : 'T+0';
}

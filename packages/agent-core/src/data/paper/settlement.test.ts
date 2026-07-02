import { describe, expect, it } from 'vitest';
import {
  bucketSettlementRuleLabel,
  getStockSettlementDelayDays,
  isLotSellableOnTradeDate,
  settlementRuleLabel,
  usesT1Settlement,
} from './settlement.js';

describe('paper settlement rules', () => {
  it('treats A-share ETFs as T+0', () => {
    expect(getStockSettlementDelayDays('etf', '510300')).toBe(0);
    expect(usesT1Settlement('510300')).toBe(false);
    expect(settlementRuleLabel('510300')).toBe('T+0');
    expect(bucketSettlementRuleLabel('etf', '510300')).toBe('T+0');
  });

  it('treats radar stock bucket as T+1', () => {
    expect(getStockSettlementDelayDays('stock', '600519')).toBe(1);
    expect(bucketSettlementRuleLabel('stock', '600519')).toBe('T+1');
  });

  it('treats backtest strategy bucket as T+2', () => {
    expect(getStockSettlementDelayDays('stock-backtest', '600519')).toBe(2);
    expect(bucketSettlementRuleLabel('stock-backtest', '600519')).toBe('T+2');
  });

  it('treats backtest news bucket as T+1', () => {
    expect(getStockSettlementDelayDays('stock-backtest-news', '600519')).toBe(1);
    expect(bucketSettlementRuleLabel('stock-backtest-news', '600519')).toBe('T+1');
  });

  it('blocks T+1 sell on buy day and allows next trading day', () => {
    expect(
      isLotSellableOnTradeDate({
        bucket: 'stock-backtest-news',
        symbol: '600519',
        buyDate: '2026-07-01',
        tradeDate: '2026-07-01',
      }),
    ).toBe(false);
    expect(
      isLotSellableOnTradeDate({
        bucket: 'stock-backtest-news',
        symbol: '600519',
        buyDate: '2026-07-01',
        tradeDate: '2026-07-02',
      }),
    ).toBe(true);
  });

  it('blocks T+2 sell until two trading days after buy', () => {
    expect(
      isLotSellableOnTradeDate({
        bucket: 'stock-backtest',
        symbol: '600519',
        buyDate: '2026-07-01',
        tradeDate: '2026-07-02',
      }),
    ).toBe(false);
    expect(
      isLotSellableOnTradeDate({
        bucket: 'stock-backtest',
        symbol: '600519',
        buyDate: '2026-07-01',
        tradeDate: '2026-07-03',
      }),
    ).toBe(true);
  });
});

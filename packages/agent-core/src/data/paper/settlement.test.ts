import { describe, expect, it } from 'vitest';
import {
  bucketSettlementRuleLabel,
  getStockSettlementDelayDays,
  isLotSellableOnTradeDate,
  settlementRuleLabel,
  usesT1Settlement,
} from './settlement.js';

describe('paper settlement rules', () => {
  it('treats domestic equity ETFs as T+1', () => {
    expect(getStockSettlementDelayDays('etf', '510300')).toBe(1);
    expect(usesT1Settlement('510300')).toBe(true);
    expect(settlementRuleLabel('510300')).toBe('T+1');
    expect(bucketSettlementRuleLabel('etf', '510300')).toBe('T+1');
  });

  it('treats known cross-border ETFs as T+0', () => {
    expect(getStockSettlementDelayDays('etf', '513100')).toBe(0);
    expect(usesT1Settlement('513100')).toBe(false);
    expect(settlementRuleLabel('513100')).toBe('T+0');
    expect(bucketSettlementRuleLabel('etf', '159941')).toBe('T+0');
  });

  it('treats radar stock bucket as T+1', () => {
    expect(getStockSettlementDelayDays('stock', '600519')).toBe(1);
    expect(bucketSettlementRuleLabel('stock', '600519')).toBe('T+1');
  });

  it('treats backtest strategy bucket as T+1 after real next-day entry', () => {
    expect(getStockSettlementDelayDays('stock-backtest', '600519')).toBe(1);
    expect(bucketSettlementRuleLabel('stock-backtest', '600519')).toBe('T+1');
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

  it('treats backtest strategy lots as sellable on the next trading day', () => {
    expect(
      isLotSellableOnTradeDate({
        bucket: 'stock-backtest',
        symbol: '600519',
        buyDate: '2026-07-01',
        tradeDate: '2026-07-01',
      }),
    ).toBe(false);
    expect(
      isLotSellableOnTradeDate({
        bucket: 'stock-backtest',
        symbol: '600519',
        buyDate: '2026-07-01',
        tradeDate: '2026-07-02',
      }),
    ).toBe(true);
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

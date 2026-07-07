import { describe, expect, it } from 'vitest';
import { buildPortfolioLedger, filterTradesByPortfolioRules } from './portfolio.js';
import type { BacktestTrade } from './types.js';

function trade(
  partial: Partial<BacktestTrade> & Pick<BacktestTrade, 'symbol' | 'entryDate' | 'exitDate'>,
): BacktestTrade {
  return {
    name: partial.symbol,
    assetType: 'etf',
    strategy: 'etf-tail-rules',
    entryPrice: 1,
    exitPrice: 1.01,
    holdDays: 1,
    returnPct: 1,
    exitReason: 'max_hold',
    signal: {
      symbol: partial.symbol,
      name: partial.symbol,
      assetType: 'etf',
      strategy: 'etf-tail-rules',
      tradeDate: partial.entryDate,
      entryPrice: 1,
    },
    ...partial,
  };
}

describe('portfolio filter', () => {
  it('skips overlapping positions for same symbol', () => {
    const filtered = filterTradesByPortfolioRules(
      [
        trade({ symbol: '510300', entryDate: '20260101', exitDate: '20260105' }),
        trade({ symbol: '510300', entryDate: '20260103', exitDate: '20260108' }),
      ],
      { maxConcurrent: 5, noSymbolOverlap: true },
    );
    expect(filtered).toHaveLength(1);
  });

  it('respects max concurrent slots', () => {
    const filtered = filterTradesByPortfolioRules(
      [
        trade({ symbol: '510300', entryDate: '20260101', exitDate: '20260110' }),
        trade({ symbol: '512880', entryDate: '20260102', exitDate: '20260110' }),
        trade({ symbol: '512760', entryDate: '20260103', exitDate: '20260110' }),
        trade({ symbol: '512010', entryDate: '20260104', exitDate: '20260110' }),
      ],
      { maxConcurrent: 3, noSymbolOverlap: true },
    );
    expect(filtered).toHaveLength(3);
  });

  it('can reserve rejected slots to avoid lower-quality backfills', () => {
    const filtered = filterTradesByPortfolioRules(
      [
        trade({ symbol: '510300', entryDate: '20260101', exitDate: '20260110' }),
        trade({ symbol: '512880', entryDate: '20260102', exitDate: '20260110' }),
        trade({ symbol: '512760', entryDate: '20260103', exitDate: '20260110' }),
      ],
      {
        maxConcurrent: 2,
        noSymbolOverlap: true,
        reserveRejectedSlots: true,
        rejectTrade: (item) => item.symbol === '510300',
      },
    );
    expect(filtered.map((item) => item.symbol)).toEqual(['512880']);
  });
});

describe('portfolio ledger', () => {
  it('sizes A-share positions by whole 100-share lots and keeps leftover cash', () => {
    const ledger = buildPortfolioLedger(
      [
        trade({
          symbol: '000001',
          assetType: 'stock',
          entryDate: '20260101',
          entryPrice: 57.5,
          exitDate: '20260103',
          exitPrice: 60,
          returnPct: 4.3478,
          signal: {
            symbol: '000001',
            name: '平安银行',
            assetType: 'stock',
            strategy: 'red-diamond-momentum',
            tradeDate: '20260101',
            entryPrice: 57.5,
            metadata: {
              pricePath: [
                { tradeDate: '20260101', close: 57.5 },
                { tradeDate: '20260102', close: 60 },
                { tradeDate: '20260103', close: 60 },
              ],
            },
          },
        }),
      ],
      { slots: 1, initialCapital: 10_000 },
    );

    expect(ledger.snapshots[0]?.cash).toBe(4250);
    expect(ledger.snapshots[0]?.positions[0]?.shares).toBe(100);
    expect(ledger.snapshots[0]?.positions[0]?.costAmount).toBe(5750);
    expect(ledger.snapshots[1]?.totalValue).toBe(10_250);
  });

  it('marks open positions to market with the daily price path', () => {
    const ledger = buildPortfolioLedger(
      [
        trade({
          symbol: '000001',
          entryDate: '20260101',
          entryPrice: 10,
          exitDate: '20260103',
          exitPrice: 12,
          returnPct: 20,
          signal: {
            symbol: '000001',
            name: '平安银行',
            assetType: 'stock',
            strategy: 'red-diamond-momentum',
            tradeDate: '20260101',
            entryPrice: 10,
            metadata: {
              pricePath: [
                { tradeDate: '20260101', close: 10 },
                { tradeDate: '20260102', close: 11 },
                { tradeDate: '20260103', close: 12 },
              ],
            },
          },
        }),
      ],
      { slots: 1, initialCapital: 100_000 },
    );

    expect(ledger.snapshots.map((snapshot) => snapshot.tradeDate)).toEqual([
      '20260101',
      '20260102',
      '20260103',
    ]);
    expect(ledger.snapshots[1]?.totalValue).toBe(110_000);
    expect(ledger.snapshots[1]?.returnPct).toBe(10);
    expect(ledger.snapshots[1]?.positions[0]?.returnPct).toBe(10);
    expect(ledger.snapshots[2]?.totalValue).toBe(120_000);
    expect(ledger.snapshots[2]?.positions).toHaveLength(0);
  });

  it('applies ETF commission and slippage to portfolio cash flows', () => {
    const ledger = buildPortfolioLedger(
      [
        trade({
          symbol: '510300',
          entryDate: '20260101',
          entryPrice: 10,
          exitDate: '20260103',
          exitPrice: 11,
          returnPct: 10,
          signal: {
            symbol: '510300',
            name: '沪深300ETF',
            assetType: 'etf',
            strategy: 'etf-tail-rules',
            tradeDate: '20260101',
            entryPrice: 10,
            metadata: {
              pricePath: [
                { tradeDate: '20260101', close: 10 },
                { tradeDate: '20260103', close: 11 },
              ],
            },
          },
        }),
      ],
      {
        slots: 1,
        initialCapital: 10_000,
        etfTradingCosts: {
          commissionRate: 0.001,
          slippageRate: 0.01,
        },
      },
    );

    expect(ledger.snapshots[0]?.cash).toBe(900.91);
    expect(ledger.snapshots[0]?.positions[0]?.shares).toBe(900);
    expect(ledger.snapshots[0]?.positions[0]?.costAmount).toBe(9099.09);
    expect(ledger.snapshots[0]?.totalValue).toBe(9900.91);
    expect(ledger.snapshots[1]?.totalValue).toBe(10692.11);
  });
});

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
});

describe('portfolio ledger', () => {
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
});

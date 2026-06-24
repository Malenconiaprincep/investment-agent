import { describe, expect, it } from 'vitest';
import { filterTradesByPortfolioRules } from './portfolio.js';
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

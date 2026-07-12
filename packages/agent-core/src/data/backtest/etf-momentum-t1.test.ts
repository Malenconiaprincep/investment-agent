import { describe, expect, it } from 'vitest';
import { runEtfMomentumT1Backtest } from './etf-momentum-t1.js';

describe('ETF T+1 动量轮动', () => {
  it('信号日严格早于实际开仓日', async () => {
    const result = await runEtfMomentumT1Backtest({
      startDate: '2026-01-01',
      endDate: '2026-07-10',
      maxExposure: 0.6,
      weakRegimeMaxExposure: 0.5,
      bearRegimeMaxExposure: 0.15,
    });

    expect(result.config?.signalExecution).toBe('next_open');
    expect(result.trades.length).toBeGreaterThan(0);
    for (const trade of result.trades) {
      expect(trade.signal.tradeDate.localeCompare(trade.entryDate)).toBeLessThan(0);
      expect(trade.signal.metadata?.executionDate).toBe(trade.entryDate);
    }
  });
});

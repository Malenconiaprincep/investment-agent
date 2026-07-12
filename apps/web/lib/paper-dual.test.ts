import { describe, expect, it } from 'vitest';
import { normalizeDualPaperPayload } from './paper-dual';

function bucket(key: string) {
  return {
    bucket: key,
    account: { cash: 100_000, initialCash: 100_000 },
    totalValue: 100_000,
    marketValue: 0,
    returnPct: 0,
    tradeDate: '2026-07-11',
    isTradingSession: false,
    positions: [],
  };
}

describe('长青一号网页数据', () => {
  it('保留 V3 影子目标供模拟盘页面展示', () => {
    const etfEvergreen = {
      ...bucket('etf-evergreen'),
      shadowPlan: {
        strategy: 'etf-evergreen-v3',
        signalDate: '20260710',
        executionDate: '20260713',
        generatedAt: '2026-07-11T05:00:00.000Z',
        cashReservePct: 17.95,
        targets: [{
          symbol: '510300',
          name: '沪深300ETF',
          targetWeightPct: 20,
          assetClass: '防守:equity_core',
        }],
      },
    };
    const result = normalizeDualPaperPayload({
      etf: bucket('etf'),
      etfEvergreen,
      etfTPlus: bucket('etf-t-plus'),
      stock: bucket('stock'),
      stockBacktest: bucket('stock-backtest'),
      stockBacktestNews: bucket('stock-backtest-news'),
      combined: {
        totalValue: 600_000,
        initialCash: 600_000,
        returnPct: 0,
        tradeDate: '2026-07-11',
        isTradingSession: false,
      },
    });

    expect(result.etfEvergreen.shadowPlan?.strategy).toBe('etf-evergreen-v3');
    expect(result.etfEvergreen.shadowPlan?.targets[0]?.symbol).toBe('510300');
    expect(result.etfEvergreen.shadowPlan?.cashReservePct).toBe(17.95);
  });
});

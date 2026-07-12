import { describe, expect, it } from 'vitest';
import type { DualPaperPayload } from '@/lib/paper-dual';
import {
  enrichPaperScheduleFields,
  resolveNextEtfRebalanceDate,
  shiftTradeDateLabel,
} from './paper-schedule';

function payload(overrides: Partial<DualPaperPayload['etf']> = {}): DualPaperPayload {
  const bucket = {
    bucket: 'etf' as const,
    account: { cash: 100_000, initialCash: 100_000 },
    totalValue: 100_000,
    marketValue: 0,
    returnPct: 0,
    tradeDate: '2026-07-09',
    isTradingSession: true,
    positions: [],
  };

  return {
    etf: { ...bucket, ...overrides },
    etfEvergreen: { ...bucket, bucket: 'etf-evergreen' as const },
    etfTPlus: { ...bucket, bucket: 'etf-t-plus' as const },
    stock: { ...bucket, bucket: 'stock' as const },
    stockBacktest: { ...bucket, bucket: 'stock-backtest' as const },
    stockBacktestNews: { ...bucket, bucket: 'stock-backtest-news' as const },
    combined: {
      totalValue: 600_000,
      initialCash: 600_000,
      returnPct: 0,
      tradeDate: '2026-07-09',
      isTradingSession: true,
    },
  };
}

describe('paper schedule enrichment', () => {
  it('uses the local trading calendar for ETF rebalance dates', () => {
    expect(shiftTradeDateLabel('2026-06-29', 10)).toBe('2026-07-13');
    expect(
      resolveNextEtfRebalanceDate({
        lastRebalanceDate: '2026-06-29',
        tradeDate: '2026-07-09',
      }),
    ).toBe('2026-07-13');
  });

  it('infers ETF rebalance dates from position memos when agent payload is old', async () => {
    const enriched = await enrichPaperScheduleFields(
      payload({
        positions: [
          {
            symbol: '159995',
            name: '芯片ETF华夏',
            shares: 5200,
            avgCost: 1.649,
            availableShares: 5200,
            frozenShares: 0,
            latestPrice: 1.617,
            marketValue: 8408.4,
            pnlPct: -1.94,
            stopLoss: 1.52,
            highWaterMark: 1.649,
            entryMemo: 'ETF 动量补账：2026-06-29 起始建仓',
          },
        ],
      }),
    );

    expect(enriched.etf.lastRebalanceDate).toBe('2026-06-29');
    expect(enriched.etf.nextRebalanceDate).toBe('2026-07-13');
  });

  it('falls back to recent ETF trades when no bucket state or memo exists', async () => {
    const enriched = await enrichPaperScheduleFields(payload(), async () => [
      {
        bucket: 'etf',
        tradeDate: '2026-06-29',
        source: 'auto',
        note: 'ETF 动量调仓加仓',
      },
    ]);

    expect(enriched.etf.lastRebalanceDate).toBe('2026-06-29');
    expect(enriched.etf.nextRebalanceDate).toBe('2026-07-13');
  });

  it('enriches the Evergreen schedule independently from the legacy ETF bucket', async () => {
    const data = payload({ lastRebalanceDate: '2026-06-29' });
    data.etfEvergreen = {
      ...data.etfEvergreen,
      tradeDate: '2026-07-09',
      lastRebalanceDate: null,
    };

    const enriched = await enrichPaperScheduleFields(data);

    expect(enriched.etf.nextRebalanceDate).toBe('2026-07-13');
    expect(enriched.etfEvergreen.nextRebalanceDate).toBe('2026-07-09');
    expect(enriched.etfEvergreen.lastRebalanceDate).toBeNull();
  });
});

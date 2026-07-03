import { describe, expect, it } from 'vitest';
import type { EtfPaperPipelineResult } from '../paper/etf-paper-pipeline.js';
import { hasEtfPaperTrades } from './feishu-daily.js';

function result(
  overrides: Partial<EtfPaperPipelineResult> = {},
): EtfPaperPipelineResult {
  return {
    tradeDate: '2026-07-03',
    ...overrides,
  };
}

describe('feishu daily notifications', () => {
  it('treats ETF paper notifications as trade-only', () => {
    expect(hasEtfPaperTrades(result())).toBe(false);
    expect(
      hasEtfPaperTrades(
        result({
          targets: [
            {
              symbol: '512880',
              name: '证券ETF',
              isBenchmarkFill: false,
            },
          ],
        }),
      ),
    ).toBe(false);
    expect(
      hasEtfPaperTrades(
        result({
          buys: [
            {
              symbol: '512880',
              name: '证券ETF',
              shares: 1000,
              price: 1.155,
            },
          ],
        }),
      ),
    ).toBe(true);
    expect(
      hasEtfPaperTrades(
        result({
          stopLosses: [
            {
              symbol: '512480',
              name: '半导体ETF国联安',
              shares: 5900,
              price: 1.333,
            },
          ],
        }),
      ),
    ).toBe(true);
  });
});

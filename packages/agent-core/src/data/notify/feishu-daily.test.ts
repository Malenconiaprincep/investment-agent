import { describe, expect, it } from 'vitest';
import type { EtfMorningRadarResult } from '../etf/morning-radar.js';
import type { EtfPaperPipelineResult } from '../paper/etf-paper-pipeline.js';
import {
  buildEtfMorningRadarLines,
  buildEtfPaperMonitorLines,
  hasEtfPaperTrades,
} from './feishu-daily.js';

function result(
  overrides: Partial<EtfPaperPipelineResult> = {},
): EtfPaperPipelineResult {
  return {
    tradeDate: '2026-07-03',
    ...overrides,
  };
}

describe('feishu daily notifications', () => {
  it('labels unavailable live ETF quotes as no conclusion instead of no signal', () => {
    const radar: EtfMorningRadarResult = {
      tradeDate: '2026-07-10',
      stage: 'confirm',
      stageLabel: '10点承接确认',
      summary: '10点承接确认：实时行情暂不可用，本次未作承接判断',
      candidates: [],
      errors: ['实时行情：fetch failed / ECONNRESET'],
      poolSize: 19,
      generatedAt: '2026-07-10T02:00:17.000Z',
      elapsedMs: 1_000,
    };

    const lines = buildEtfMorningRadarLines(radar).join('\n');

    expect(lines).toContain('本次不输出承接结论');
    expect(lines).not.toContain('没有达到异动阈值');
  });

  it('includes the next ETF paper rebalance date', () => {
    const lines = buildEtfPaperMonitorLines(
      result({
        bucket: 'etf',
        nextRebalanceDate: '2026-07-17',
        buys: [
          {
            symbol: '512880',
            name: '证券ETF',
            shares: 1000,
            price: 1.155,
          },
        ],
      }),
    );

    expect(lines.join('\n')).toContain('下次调仓日：2026-07-17');
  });

  it('keeps ETF T+ review wording for the T+ bucket', () => {
    const lines = buildEtfPaperMonitorLines(
      result({
        bucket: 'etf-t-plus',
        nextTradeDate: '2026-07-06',
        tPlusEntries: [
          {
            symbol: '512880',
            name: '证券ETF',
            shares: 1000,
            buyPrice: 1.155,
            dipPct: -1.6,
          },
        ],
      }),
    );

    expect(lines.join('\n')).toContain('下次观察交易日：2026-07-06');
  });

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

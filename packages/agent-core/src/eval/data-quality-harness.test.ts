import { describe, expect, it } from 'vitest';
import {
  runDataQualityHarness,
  type DataQualityHarnessDeps,
} from './data-quality-harness.js';
import type { LocalDailyKlineBar } from '../data/market/local-csv/etf-daily.js';
import type { MarketDataFreshness } from '../data/paper/market-data-freshness.js';

function bar(input: Partial<LocalDailyKlineBar> & { tradeDate: string }): LocalDailyKlineBar {
  return {
    tradeDate: input.tradeDate,
    open: input.open ?? 10,
    high: input.high ?? 11,
    low: input.low ?? 9,
    close: input.close ?? 10.5,
    pctChg: input.pctChg ?? 1,
    vol: input.vol ?? 100_000,
    amount: input.amount ?? 10_000_000,
  };
}

function freshness(input?: Partial<MarketDataFreshness>): MarketDataFreshness {
  return {
    tradeDate: '2026-07-02',
    isTradingDay: true,
    expectedDataDate: '2026-07-02',
    benchmarkLatestDate: '20260702',
    stockSampleLatestDate: '20260702',
    latestDataDate: '20260702',
    isFresh: true,
    reminder: null,
    ...input,
  };
}

function deps(input?: {
  freshness?: MarketDataFreshness;
  etfBars?: LocalDailyKlineBar[];
  stockBars?: LocalDailyKlineBar[];
}): DataQualityHarnessDeps {
  return {
    getFreshness: () => input?.freshness ?? freshness(),
    listSymbols: (assetType) =>
      assetType === 'etf' ? ['510300'] : ['000001', '600519'],
    readBars: (assetType) =>
      assetType === 'etf'
        ? (input?.etfBars ?? [
            bar({ tradeDate: '20260702' }),
            bar({ tradeDate: '20260701', close: 10.4 }),
            bar({ tradeDate: '20260630', close: 10.3 }),
          ])
        : (input?.stockBars ?? [
            bar({ tradeDate: '20260702' }),
            bar({ tradeDate: '20260701', close: 10.4 }),
            bar({ tradeDate: '20260630', close: 10.3 }),
          ]),
  };
}

describe('data quality harness', () => {
  it('passes when freshness and sample bars are valid', () => {
    const report = runDataQualityHarness({
      now: new Date('2026-07-02T16:00:00+08:00'),
      deps: deps(),
    });

    expect(report.passed).toBe(true);
    expect(report.summary.fail).toBe(0);
    expect(report.checks.map((check) => check.id)).toContain(
      'freshness.expected-date',
    );
  });

  it('fails when local data is stale versus the expected date', () => {
    const report = runDataQualityHarness({
      now: new Date('2026-07-02T16:00:00+08:00'),
      deps: deps({
        freshness: freshness({
          benchmarkLatestDate: '20260701',
          stockSampleLatestDate: '20260701',
          latestDataDate: '20260701',
          isFresh: false,
          reminder: '测试提醒：行情未更新',
        }),
        etfBars: [bar({ tradeDate: '20260701' })],
        stockBars: [bar({ tradeDate: '20260701' })],
      }),
    });

    expect(report.passed).toBe(false);
    expect(report.checks.find((check) => check.id === 'freshness.expected-date')?.status).toBe(
      'fail',
    );
    expect(report.checks.find((check) => check.id === 'etf.510300.latest-date')?.status).toBe(
      'fail',
    );
  });

  it('fails when OHLC fields violate price invariants', () => {
    const report = runDataQualityHarness({
      now: new Date('2026-07-02T16:00:00+08:00'),
      deps: deps({
        stockBars: [
          bar({
            tradeDate: '20260702',
            open: 10,
            high: 9.8,
            low: 9.5,
            close: 10.2,
          }),
          bar({ tradeDate: '20260701' }),
        ],
      }),
    });

    const ohlcCheck = report.checks.find((check) => check.id === 'stock.000001.ohlc');
    expect(report.passed).toBe(false);
    expect(ohlcCheck?.status).toBe('fail');
    expect(ohlcCheck?.evidence?.samples).toBeDefined();
  });
});

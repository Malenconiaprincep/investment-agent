import { describe, expect, it } from 'vitest';
import { getBacktestArgsFromSearchParams } from './args';

describe('backtest args', () => {
  it('passes stock news filter options to the agent-core CLI', () => {
    const params = new URLSearchParams({
      strategy: 'diamond-momentum',
      universe: 'retail-stock',
      days: '365',
      marketFilter: 'avoid_bearish',
      minBenchmarkMomentum: '2',
      defensiveBenchmarkMomentum: '3',
      minPrice: '3',
      minAmount: '30000000',
      excludeRiskyNames: '1',
      newsFilter: 'avoid_bearish',
      newsLookback: '5',
      maxConcurrent: '4',
    });

    expect(getBacktestArgsFromSearchParams(params)).toEqual([
      'diamond-momentum',
      'all',
      '365',
      '--universe=retail-stock',
      '--max-concurrent=4',
      '--market-filter=avoid_bearish',
      '--min-benchmark-momentum=2',
      '--defensive-benchmark-momentum=3',
      '--min-price=3',
      '--min-amount=30000000',
      '--exclude-risky-names',
      '--news-filter=avoid_bearish',
      '--news-lookback=5',
    ]);
  });

  it('passes ETF momentum variant options to the agent-core CLI', () => {
    const params = new URLSearchParams({
      strategy: 'etf-momentum',
      startDate: '2025-01-01',
      endDate: '2025-12-31',
      initialCapital: '100000',
      cashFallbackWeak: '1',
      exitOnTrendBreak: '1',
      netRebalance: '1',
      tPlus: '1',
      tPlusBuyDip: '1.5',
      tPlusMinProfit: '0.6',
      tPlusBudgetPct: '20',
      tPlusMaxTradesPerDay: '2',
    });

    expect(getBacktestArgsFromSearchParams(params)).toEqual([
      'etf-momentum',
      '365',
      '--from=2025-01-01',
      '--to=2025-12-31',
      '--capital=100000',
      '--cash-fallback-weak',
      '--exit-on-trend-break',
      '--net-rebalance',
      '--t-plus',
      '--t-plus-buy-dip=1.5',
      '--t-plus-min-profit=0.6',
      '--t-plus-budget=20',
      '--t-plus-max-trades=2',
    ]);
  });

  it('passes ETF Stable V2 options to the agent-core CLI', () => {
    const params = new URLSearchParams({
      strategy: 'etf-stable',
      startDate: '2018-01-01',
      endDate: '2026-07-09',
      initialCapital: '100000',
      rebalance: '20',
      volTarget: '12',
    });
    expect(getBacktestArgsFromSearchParams(params)).toEqual([
      'etf-stable',
      String(365 * 5),
      '--from=2018-01-01',
      '--to=2026-07-09',
      '--capital=100000',
      '--rebalance=20',
      '--vol-target=12',
    ]);
  });
});

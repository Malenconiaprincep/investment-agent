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
});

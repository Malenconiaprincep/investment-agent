import { describe, expect, it } from 'vitest';
import { checkMarketDataFreshness } from './market-data-freshness.js';
import {
  getExpectedMarketDataDate,
  shiftTradeDateLabel,
} from './trading-calendar.js';

describe('trading calendar helpers', () => {
  it('shifts trade dates by weekdays only', () => {
    expect(shiftTradeDateLabel('2026-07-02', -2)).toBe('2026-06-30');
    expect(shiftTradeDateLabel('2026-07-06', -1)).toBe('2026-07-03');
  });

  it('expects previous trade date before close', () => {
    const beforeClose = new Date('2026-07-02T10:00:00+08:00');
    expect(getExpectedMarketDataDate(beforeClose)).toBe('2026-07-01');
  });

  it('expects same day after close', () => {
    const afterClose = new Date('2026-07-02T16:00:00+08:00');
    expect(getExpectedMarketDataDate(afterClose)).toBe('2026-07-02');
  });
});

describe('market data freshness', () => {
  it('returns structured freshness on weekdays', () => {
    const result = checkMarketDataFreshness(new Date('2026-07-02T08:00:00+08:00'));
    expect(result.isTradingDay).toBe(true);
    expect(result.expectedDataDate).toBe('2026-07-01');
    expect(typeof result.isFresh).toBe('boolean');
  });
});

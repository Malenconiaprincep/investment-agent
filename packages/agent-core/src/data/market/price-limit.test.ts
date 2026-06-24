import { describe, expect, it } from 'vitest';
import { isLikelyLimitUp } from './price-limit.js';

describe('price limit helpers', () => {
  it('detects ordinary 10cm limit-up stocks', () => {
    expect(
      isLikelyLimitUp({
        symbol: '002167',
        name: '东方锆业',
        pctChg: 9.99,
      }),
    ).toBe(true);
  });

  it('does not block normal intraday strength below the limit', () => {
    expect(
      isLikelyLimitUp({
        symbol: '600519',
        name: '贵州茅台',
        pctChg: 6.8,
      }),
    ).toBe(false);
  });

  it('detects 20cm growth-board limit-up stocks', () => {
    expect(
      isLikelyLimitUp({
        symbol: '300750',
        name: '宁德时代',
        pctChg: 19.99,
      }),
    ).toBe(true);
  });
});

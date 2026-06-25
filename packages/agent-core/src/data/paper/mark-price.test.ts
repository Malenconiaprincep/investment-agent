import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../market/free/intraday-quote.js', () => ({
  fetchIntradayQuotes: vi.fn(),
}));

vi.mock('../market/free/tencent.js', () => ({
  fetchDailyKlines: vi.fn(),
}));

vi.mock('../market/services.js', () => ({
  getDailyQuote: vi.fn(),
}));

import { fetchIntradayQuotes } from '../market/free/intraday-quote.js';
import { fetchDailyKlines } from '../market/free/tencent.js';
import { getDailyQuote } from '../market/services.js';
import { resolvePaperMarkPrices } from './mark-price.js';

describe('resolvePaperMarkPrices', () => {
  beforeEach(() => {
    vi.mocked(fetchIntradayQuotes).mockReset();
    vi.mocked(fetchDailyKlines).mockReset();
    vi.mocked(getDailyQuote).mockReset();
  });

  it('always prefers intraday quotes even outside trading session', async () => {
    vi.mocked(fetchIntradayQuotes).mockResolvedValue(
      new Map([
        [
          '510300',
          {
            symbol: '510300',
            name: '沪深300ETF',
            price: 5.048,
            pctChg: 0.5,
            change: 0.02,
            open: 5,
            high: 5.1,
            low: 4.99,
            prevClose: 5.02,
            volume: 1,
            amount: 1,
          },
        ],
      ]),
    );

    const prices = await resolvePaperMarkPrices(['510300']);
    expect(prices.get('510300')).toEqual({ price: 5.048, source: 'intraday' });
    expect(fetchDailyKlines).not.toHaveBeenCalled();
    expect(getDailyQuote).not.toHaveBeenCalled();
  });

  it('falls back to tencent daily for ETF when intraday is unavailable', async () => {
    vi.mocked(fetchIntradayQuotes).mockResolvedValue(new Map());
    vi.mocked(fetchDailyKlines).mockResolvedValue({
      quotes: [{ tradeDate: '20260625', close: 5.048, open: 5, high: 5.1, low: 4.99, pctChg: 0, vol: 1, amount: null }],
      cached: false,
    });

    const prices = await resolvePaperMarkPrices(['510300']);
    expect(prices.get('510300')).toEqual({ price: 5.048, source: 'daily' });
    expect(getDailyQuote).not.toHaveBeenCalled();
  });

  it('falls back to daily close for stocks when intraday is unavailable', async () => {
    vi.mocked(fetchIntradayQuotes).mockResolvedValue(new Map());
    vi.mocked(getDailyQuote).mockResolvedValue({
      tsCode: '300014.SZ',
      quotes: [],
      latestClose: 66.81,
      latestPctChg: 1.2,
      dataSource: 'tencent',
      asOf: '2026-06-25',
      cached: false,
    });

    const prices = await resolvePaperMarkPrices(['300014']);
    expect(prices.get('300014')).toEqual({ price: 66.81, source: 'daily' });
  });
});

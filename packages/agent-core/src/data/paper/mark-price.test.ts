import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../market/free/intraday-quote.js', () => ({
  fetchIntradayQuotes: vi.fn(),
}));

vi.mock('../market/services.js', () => ({
  getDailyQuote: vi.fn(),
}));

vi.mock('./trading-calendar.js', () => ({
  isTradingSession: vi.fn(),
}));

import { fetchIntradayQuotes } from '../market/free/intraday-quote.js';
import { getDailyQuote } from '../market/services.js';
import { resolvePaperMarkPrices } from './mark-price.js';
import { isTradingSession } from './trading-calendar.js';

describe('resolvePaperMarkPrices', () => {
  beforeEach(() => {
    vi.mocked(isTradingSession).mockReturnValue(true);
    vi.mocked(fetchIntradayQuotes).mockReset();
    vi.mocked(getDailyQuote).mockReset();
  });

  it('uses intraday quotes during trading session', async () => {
    vi.mocked(fetchIntradayQuotes).mockResolvedValue(
      new Map([
        [
          '510300',
          {
            symbol: '510300',
            name: '沪深300ETF',
            price: 5.04,
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
    expect(prices.get('510300')).toEqual({ price: 5.04, source: 'intraday' });
    expect(getDailyQuote).not.toHaveBeenCalled();
  });

  it('falls back to daily close when intraday is unavailable', async () => {
    vi.mocked(isTradingSession).mockReturnValue(false);
    vi.mocked(getDailyQuote).mockResolvedValue({
      tsCode: '510300.SH',
      quotes: [],
      latestClose: 4.942,
      latestPctChg: -2.93,
      dataSource: 'local-csv',
      asOf: '2026-06-23',
      cached: true,
    });

    const prices = await resolvePaperMarkPrices(['510300']);
    expect(prices.get('510300')).toEqual({ price: 4.942, source: 'daily' });
  });
});

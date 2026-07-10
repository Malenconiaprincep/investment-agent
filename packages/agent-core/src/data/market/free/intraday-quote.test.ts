import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./http.js', () => ({
  freeFetchJson: vi.fn(),
  toSecId: vi.fn((symbol: string) => `1.${symbol}`),
}));

import { freeFetchJson } from './http.js';
import { fetchIntradayQuotes } from './intraday-quote.js';

describe('fetchIntradayQuotes', () => {
  beforeEach(() => {
    vi.mocked(freeFetchJson).mockReset();
  });

  it('falls back to the secondary Eastmoney host when the primary host fails', async () => {
    vi.mocked(freeFetchJson)
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce({
        data: {
          diff: [
            {
              f2: 4.936,
              f3: 0.41,
              f4: 0.02,
              f5: 2_668_119,
              f6: 1_315_170_807,
              f12: '510300',
              f14: '沪深300ETF',
              f15: 4.946,
              f16: 4.908,
              f17: 4.918,
              f18: 4.916,
            },
          ],
        },
      });

    const quotes = await fetchIntradayQuotes(['510300']);

    expect(quotes.get('510300')).toMatchObject({
      price: 4.936,
      pctChg: 0.41,
      amount: 1_315_170_807,
    });
    expect(freeFetchJson).toHaveBeenCalledTimes(2);
    expect(vi.mocked(freeFetchJson).mock.calls[0]?.[0]).toContain(
      'push2.eastmoney.com',
    );
    expect(vi.mocked(freeFetchJson).mock.calls[1]?.[0]).toContain(
      'push2delay.eastmoney.com',
    );
  });
});

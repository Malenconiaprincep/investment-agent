import { describe, expect, it, vi } from 'vitest';

vi.mock('./http.js', () => ({
  toSecId: (symbol: string) => `1.${symbol}`,
  freeFetchJson: vi.fn(),
}));

vi.mock('./intraday-quote.js', () => ({
  fetchIntradayQuote: vi.fn(),
}));

import { freeFetchJson } from './http.js';
import { fetchOrderBookQuote } from './orderbook-quote.js';

describe('fetchOrderBookQuote', () => {
  it('requests fltt=2 so ETF prices stay in yuan', async () => {
    vi.mocked(freeFetchJson).mockResolvedValueOnce({
      data: { f43: 5.037, f58: '沪深300ETF', f39: 5.038 },
    });

    const quote = await fetchOrderBookQuote('510300');
    expect(quote?.lastPrice).toBeCloseTo(5.037);
    expect(quote?.ask1).toBeCloseTo(5.038);

    const url = String(vi.mocked(freeFetchJson).mock.calls[0]?.[0] ?? '');
    expect(url).toContain('fltt=2');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../market/free/intraday-quote.js', () => ({
  fetchIntradayQuotes: vi.fn(),
}));
vi.mock('../market/services.js', () => ({
  getDailyQuote: vi.fn(),
}));

import { fetchIntradayQuotes } from '../market/free/intraday-quote.js';
import { getDailyQuote } from '../market/services.js';
import { runEtfMorningRadar } from './morning-radar.js';

describe('runEtfMorningRadar', () => {
  beforeEach(() => {
    vi.mocked(fetchIntradayQuotes).mockReset();
    vi.mocked(getDailyQuote).mockReset();
  });

  it('returns a safe no-conclusion result when the live quote request fails', async () => {
    vi.mocked(fetchIntradayQuotes).mockRejectedValue(
      new TypeError('fetch failed', {
        cause: Object.assign(new Error('socket closed'), { code: 'ECONNRESET' }),
      }),
    );

    const result = await runEtfMorningRadar({ stage: 'confirm' });

    expect(result.summary).toContain('实时行情暂不可用');
    expect(result.summary).toContain('未作承接判断');
    expect(result.candidates).toEqual([]);
    expect(result.errors[0]).toContain('fetch failed');
    expect(result.errors[0]).toContain('ECONNRESET');
    expect(getDailyQuote).not.toHaveBeenCalled();
  });

  it('does not treat an empty quote response as a normal no-signal result', async () => {
    vi.mocked(fetchIntradayQuotes).mockResolvedValue(new Map());

    const result = await runEtfMorningRadar({ stage: 'open' });

    expect(result.summary).toContain('实时行情暂不可用');
    expect(result.errors).toContain('实时行情：上游接口未返回任何有效报价');
    expect(getDailyQuote).not.toHaveBeenCalled();
  });
});

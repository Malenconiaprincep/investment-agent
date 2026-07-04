import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/safe-fetch.js', () => ({
  safeFetch: vi.fn(),
}));

import { safeFetch } from '../../../lib/safe-fetch.js';
import { fetchDailyKlinesByTencentCode } from './tencent.js';

describe('fetchDailyKlinesByTencentCode', () => {
  beforeEach(() => {
    vi.mocked(safeFetch).mockReset();
  });

  it('uses Tencent qfqday rows for daily klines', async () => {
    vi.mocked(safeFetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            sh510300: {
              qfqday: [
                ['2026-07-03', '5.00', '5.10', '5.11', '4.98', '1000'],
                ['2026-07-04', '5.10', '5.20', '5.22', '5.09', '1200'],
              ],
              day: [['2026-07-04', '9.00', '9.10', '9.11', '8.98', '2000']],
            },
          },
        }),
      ) as never,
    );

    const result = await fetchDailyKlinesByTencentCode('sh510300', 2, '510300', {
      forceRefresh: true,
    });
    expect(result.adjustment).toBe('qfq');
    expect(result.quotes.map((quote) => quote.close)).toEqual([5.2, 5.1]);
  });

  it('does not silently fall back to unadjusted day rows', async () => {
    vi.mocked(safeFetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            sh512480: {
              day: [['2026-07-04', '9.00', '9.10', '9.11', '8.98', '2000']],
            },
          },
        }),
      ) as never,
    );

    await expect(
      fetchDailyKlinesByTencentCode('sh512480', 2, '512480', { forceRefresh: true }),
    ).rejects.toThrow(
      '拒绝使用普通 day',
    );
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./free/eastmoney.js', () => ({
  fetchAnnouncements: vi.fn(),
  fetchCompanyProfile: vi.fn(),
  fetchIndustryPeers: vi.fn(),
  fetchLatestFinancial: vi.fn(),
  fetchNews: vi.fn(),
  fetchStockSnapshot: vi.fn(),
  fetchStockSuggestions: vi.fn(),
}));

import { fetchStockSuggestions } from './free/eastmoney.js';
import { resolveStockSymbol } from './services.js';

describe('resolveStockSymbol', () => {
  beforeEach(() => {
    vi.mocked(fetchStockSuggestions).mockReset();
  });

  it('accepts a 6 digit code without searching', async () => {
    await expect(resolveStockSymbol('600519')).resolves.toBe('600519');
    expect(fetchStockSuggestions).not.toHaveBeenCalled();
  });

  it('resolves a stock name through Eastmoney suggestions', async () => {
    vi.mocked(fetchStockSuggestions).mockResolvedValue({
      data: [
        {
          symbol: '600519',
          name: '贵州茅台',
          pinyin: 'GZMT',
          classify: 'AStock',
          securityTypeName: '沪A',
          quoteId: '1.600519',
        },
      ],
      cached: false,
    });

    await expect(resolveStockSymbol('贵州茅台')).resolves.toBe('600519');
  });
});

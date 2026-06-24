import { describe, expect, it } from 'vitest';
import {
  getWatchlistExpiryCutoffIso,
  getWatchlistRetentionDays,
  isWatchlistItemExpired,
} from './retention.js';
import type { WatchlistItem } from './store.js';

function item(
  overrides: Partial<WatchlistItem> & Pick<WatchlistItem, 'sourceType' | 'createdAt'>,
): WatchlistItem {
  return {
    id: 'id-1',
    symbol: '600519',
    name: '贵州茅台',
    reason: null,
    sourceId: null,
    entryPrice: null,
    entryDate: null,
    active: true,
    ...overrides,
  };
}

describe('watchlist retention', () => {
  it('uses shorter retention for radar and screening sources', () => {
    const retention = { auto: 3, manual: 7 };
    const now = new Date('2026-06-24T12:00:00+08:00');

    const signalCutoff = getWatchlistExpiryCutoffIso({
      sourceType: 'signal',
      now,
      retention,
    });
    const manualCutoff = getWatchlistExpiryCutoffIso({
      sourceType: 'manual',
      now,
      retention,
    });

    expect(signalCutoff).toBe('2026-06-21T04:00:00.000Z');
    expect(manualCutoff).toBe('2026-06-17T04:00:00.000Z');
  });

  it('expires stale auto-track items but keeps recent ones', () => {
    const retention = getWatchlistRetentionDays();
    const now = new Date('2026-06-24T12:00:00+08:00');

    expect(
      isWatchlistItemExpired(
        item({
          sourceType: 'signal',
          createdAt: '2026-06-20T08:00:00.000Z',
        }),
        now,
        retention,
      ),
    ).toBe(true);

    expect(
      isWatchlistItemExpired(
        item({
          sourceType: 'signal',
          createdAt: '2026-06-23T08:00:00.000Z',
        }),
        now,
        retention,
      ),
    ).toBe(false);
  });
});

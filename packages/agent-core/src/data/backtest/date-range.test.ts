import { describe, expect, it } from 'vitest';

import { needsFullLocalHistoryForRange } from './date-range.js';

describe('needsFullLocalHistoryForRange', () => {
  it('loads all history for a long range that ends today', () => {
    expect(
      needsFullLocalHistoryForRange(
        { startDate: '20180102', endDate: '20260709' },
        { today: '20260710' },
      ),
    ).toBe(true);
  });

  it('keeps the bounded loader for a recent range', () => {
    expect(
      needsFullLocalHistoryForRange(
        { startDate: '20250102', endDate: '20260709' },
        { today: '20260710' },
      ),
    ).toBe(false);
  });

  it('loads all history when the entire range is historical', () => {
    expect(
      needsFullLocalHistoryForRange(
        { startDate: '20200102', endDate: '20201231' },
        { today: '20260710' },
      ),
    ).toBe(true);
  });
});

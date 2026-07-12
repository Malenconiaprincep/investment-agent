import { describe, expect, it } from 'vitest';
import {
  BUCKET_INITIAL_CASH,
  BUCKET_LABELS,
  ETF_EVERGREEN_BUCKET,
  PAPER_BUCKETS,
  isEtfPaperBucket,
  parsePaperBucket,
} from './bucket.js';

describe('paper buckets', () => {
  it('registers Evergreen as an isolated ETF paper bucket', () => {
    expect(PAPER_BUCKETS).toContain(ETF_EVERGREEN_BUCKET);
    expect(parsePaperBucket(ETF_EVERGREEN_BUCKET)).toBe(ETF_EVERGREEN_BUCKET);
    expect(isEtfPaperBucket(ETF_EVERGREEN_BUCKET)).toBe(true);
    expect(BUCKET_INITIAL_CASH[ETF_EVERGREEN_BUCKET]).toBe(100_000);
    expect(BUCKET_LABELS[ETF_EVERGREEN_BUCKET]).toContain('长青一号');
  });
});

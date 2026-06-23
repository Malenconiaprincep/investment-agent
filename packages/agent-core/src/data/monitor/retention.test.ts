import { describe, expect, it } from 'vitest';
import {
  getMonitorRetentionCutoffTradeDate,
  monitorRetentionCutoffInstant,
} from './retention.js';

function beijingDate(iso: string): Date {
  return new Date(iso);
}

describe('monitor retention', () => {
  it('keeps yesterday and today before evening purge hour', () => {
    const cutoff = getMonitorRetentionCutoffTradeDate(
      beijingDate('2026-06-24T15:00:00+08:00'),
    );
    expect(cutoff).toBe('2026-06-23');
  });

  it('keeps only today after evening purge hour', () => {
    const cutoff = getMonitorRetentionCutoffTradeDate(
      beijingDate('2026-06-24T21:00:00+08:00'),
    );
    expect(cutoff).toBe('2026-06-24');
  });

  it('builds beijing midnight cutoff instant', () => {
    expect(monitorRetentionCutoffInstant('2026-06-24')).toBe(
      '2026-06-24T00:00:00+08:00',
    );
  });
});

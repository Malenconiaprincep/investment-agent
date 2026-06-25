import { describe, expect, it } from 'vitest';
import {
  ETF_PAPER_MONITOR_INTERVAL_MINUTES_DEFAULT,
  getEtfPaperMonitorIntervalMs,
} from './trading-calendar.js';

describe('getEtfPaperMonitorIntervalMs', () => {
  it('defaults to 30 minutes', () => {
    expect(getEtfPaperMonitorIntervalMs(undefined)).toBe(
      ETF_PAPER_MONITOR_INTERVAL_MINUTES_DEFAULT * 60_000,
    );
  });

  it('respects custom minutes with a 5 minute floor', () => {
    expect(getEtfPaperMonitorIntervalMs('15')).toBe(15 * 60_000);
    expect(getEtfPaperMonitorIntervalMs('1')).toBe(
      ETF_PAPER_MONITOR_INTERVAL_MINUTES_DEFAULT * 60_000,
    );
  });
});

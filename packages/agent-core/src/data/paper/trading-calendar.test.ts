import { describe, expect, it } from 'vitest';
import {
  ETF_PAPER_MONITOR_INTERVAL_MINUTES_DEFAULT,
  formatPaperTradeDisplayTime,
  getEtfPaperMonitorIntervalMs,
  isBeijingTradingSessionFromIso,
  resolvePaperTradedAt,
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

describe('resolvePaperTradedAt', () => {
  it('keeps manual trades at actual execution time', () => {
    const iso = resolvePaperTradedAt({
      tradeDate: '2026-06-24',
      source: 'manual',
      side: 'buy',
    });
    expect(Math.abs(Date.now() - new Date(iso).getTime())).toBeLessThan(5_000);
  });
});

describe('formatPaperTradeDisplayTime', () => {
  it('shows actual time when auto trade happened in session', () => {
    const display = formatPaperTradeDisplayTime({
      tradeDate: '2026-06-24',
      tradedAt: '2026-06-24T06:22:53.702Z',
      source: 'auto',
      side: 'buy',
    });
    expect(display).toContain('14:22:53');
  });

  it('shows trade date default session time for off-hours auto trades', () => {
    const display = formatPaperTradeDisplayTime({
      tradeDate: '2026-06-25',
      tradedAt: '2026-06-24T16:01:59.914Z',
      source: 'auto',
      side: 'sell',
    });
    expect(display).toBe('2026/6/25 15:00:00');
  });
});

describe('isBeijingTradingSessionFromIso', () => {
  it('detects afternoon session', () => {
    expect(isBeijingTradingSessionFromIso('2026-06-24T06:22:53.702Z')).toBe(true);
  });

  it('rejects midnight', () => {
    expect(isBeijingTradingSessionFromIso('2026-06-24T16:01:59.914Z')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import {
  createDailyTaskDueCheck,
  isDailyTaskDueInWindow,
  type DailyTaskDueCursor,
} from './daily-task-due.js';

const task = { hour: 15, minute: 5 };

function at(hour: number, minute: number): Date {
  return new Date(2026, 6, 2, hour, minute, 30);
}

describe('daily task due window', () => {
  it('does not backfill fixed daily tasks on a late worker start', () => {
    const check = createDailyTaskDueCheck({
      now: at(15, 40),
      tradeDate: '2026-07-02',
      isTradingDay: true,
      previous: null,
    });

    expect(isDailyTaskDueInWindow(task, check.window)).toBe(false);
  });

  it('runs a fixed daily task when the worker crosses its scheduled minute', () => {
    const previous: DailyTaskDueCursor = {
      tradeDate: '2026-07-02',
      minuteOfDay: 15 * 60 + 4,
    };
    const check = createDailyTaskDueCheck({
      now: at(15, 5),
      tradeDate: '2026-07-02',
      isTradingDay: true,
      previous,
    });

    expect(isDailyTaskDueInWindow(task, check.window)).toBe(true);
  });

  it('does not backfill tasks after a long pause', () => {
    const previous: DailyTaskDueCursor = {
      tradeDate: '2026-07-02',
      minuteOfDay: 9 * 60,
    };
    const check = createDailyTaskDueCheck({
      now: at(15, 40),
      tradeDate: '2026-07-02',
      isTradingDay: true,
      previous,
    });

    expect(isDailyTaskDueInWindow(task, check.window)).toBe(false);
  });

  it('skips fixed tasks on non-trading days', () => {
    const check = createDailyTaskDueCheck({
      now: at(15, 5),
      tradeDate: '2026-07-04',
      isTradingDay: false,
      previous: null,
    });

    expect(isDailyTaskDueInWindow(task, check.window)).toBe(false);
  });
});

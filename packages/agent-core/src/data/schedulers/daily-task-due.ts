export type DailyTaskSchedule = {
  hour: number;
  minute: number;
};

export type DailyTaskDueCursor = {
  tradeDate: string;
  minuteOfDay: number;
};

export type DailyTaskDueWindow = {
  tradeDate: string;
  afterMinuteOfDay: number;
  throughMinuteOfDay: number;
};

export const DAILY_TASK_MAX_CHECK_GAP_MINUTES = 10;

export function getMinuteOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

export function createDailyTaskDueCheck(input: {
  now: Date;
  tradeDate: string;
  isTradingDay: boolean;
  previous: DailyTaskDueCursor | null;
  maxGapMinutes?: number;
}): { cursor: DailyTaskDueCursor; window: DailyTaskDueWindow | null } {
  const minuteOfDay = getMinuteOfDay(input.now);
  const cursor = {
    tradeDate: input.tradeDate,
    minuteOfDay,
  };

  if (!input.isTradingDay) {
    return { cursor, window: null };
  }

  const maxGapMinutes =
    input.maxGapMinutes ?? DAILY_TASK_MAX_CHECK_GAP_MINUTES;
  let afterMinuteOfDay = minuteOfDay - 1;

  if (input.previous?.tradeDate === input.tradeDate) {
    const elapsedMinutes = minuteOfDay - input.previous.minuteOfDay;
    if (elapsedMinutes > 0 && elapsedMinutes <= maxGapMinutes) {
      afterMinuteOfDay = input.previous.minuteOfDay;
    }
  }

  return {
    cursor,
    window: {
      tradeDate: input.tradeDate,
      afterMinuteOfDay: Math.max(-1, afterMinuteOfDay),
      throughMinuteOfDay: minuteOfDay,
    },
  };
}

export function isDailyTaskDueInWindow(
  task: DailyTaskSchedule,
  window: DailyTaskDueWindow | null,
): boolean {
  if (!window) return false;
  const dueMinuteOfDay = task.hour * 60 + task.minute;
  return (
    dueMinuteOfDay > window.afterMinuteOfDay &&
    dueMinuteOfDay <= window.throughMinuteOfDay
  );
}

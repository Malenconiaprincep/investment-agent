import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createDailyTaskDueCheck,
  isDailyTaskDueInWindow,
} from '../data/schedulers/daily-task-due.js';

type HarnessCheck = {
  name: string;
  ok: boolean;
};

function assertCheck(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function beijingTradeDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function at(hour: number, minute: number): Date {
  return new Date(2026, 6, 9, hour, minute, 30);
}

async function main() {
  const checks: HarnessCheck[] = [];
  const tempDataDir = mkdtempSync(path.join(os.tmpdir(), 'investment-scheduler-harness-'));
  const previousDataDir = process.env.INVESTMENT_AGENT_DATA_DIR;
  process.env.INVESTMENT_AGENT_DATA_DIR = tempDataDir;

  try {
    const preopenTask = { hour: 8, minute: 30 };
    const delayedTick = createDailyTaskDueCheck({
      now: at(8, 32),
      tradeDate: '2026-07-09',
      isTradingDay: true,
      previous: {
        tradeDate: '2026-07-09',
        minuteOfDay: 8 * 60 + 27,
      },
    });
    assertCheck(
      isDailyTaskDueInWindow(preopenTask, delayedTick.window),
      '08:27 -> 08:32 delayed tick should still trigger 08:30 preopen task',
    );
    checks.push({ name: 'delayed-preopen-window', ok: true });

    const lateStart = createDailyTaskDueCheck({
      now: at(8, 59),
      tradeDate: '2026-07-09',
      isTradingDay: true,
      previous: null,
    });
    assertCheck(
      !isDailyTaskDueInWindow(preopenTask, lateStart.window),
      'fresh late worker start should not backfill old fixed tasks by default',
    );
    checks.push({ name: 'no-unbounded-backfill', ok: true });

    const {
      appendScheduledTaskLog,
      readRecentScheduledTaskLogs,
    } = await import('../data/schedulers/scheduled-task-log.js');
    const tradeDate = beijingTradeDate();
    const runId = `screen-preopen:${tradeDate}:harness`;
    const ranAt = new Date().toISOString();

    appendScheduledTaskLog({
      runId,
      taskId: 'screen-preopen',
      label: '盘前智能选股通知',
      tradeDate,
      status: 'running',
      summary: '任务已开始',
      source: 'background-worker',
      ranAt,
    });
    appendScheduledTaskLog({
      runId,
      taskId: 'screen-preopen',
      label: '盘前智能选股通知',
      tradeDate,
      status: 'completed',
      summary: '数据 98 分 · 记录 harness · 候选 1 只 · 入池 1 只',
      elapsedMs: 81_000,
      source: 'background-worker',
      ranAt,
    });

    const logs = readRecentScheduledTaskLogs({
      tradeDate,
      taskId: 'screen-preopen',
    });
    assertCheck(logs.length === 1, 'running and completed entries should fold by runId');
    assertCheck(logs[0]?.status === 'completed', 'folded log should expose final status');
    checks.push({ name: 'running-log-folding', ok: true });

    console.log(
      JSON.stringify(
        {
          ok: true,
          checks,
        },
        null,
        2,
      ),
    );
  } finally {
    if (previousDataDir == null) {
      delete process.env.INVESTMENT_AGENT_DATA_DIR;
    } else {
      process.env.INVESTMENT_AGENT_DATA_DIR = previousDataDir;
    }
    rmSync(tempDataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

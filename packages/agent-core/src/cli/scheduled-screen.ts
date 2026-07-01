import 'dotenv/config';

import { runSectorScreenStream } from '../api/run-sector-screen-stream.js';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../mastra/config/paths.js';
import {
  isScheduledTaskEnabled,
  type ScheduledTaskId,
} from '../data/schedulers/task-settings.js';

const LOG_PATH = path.join(DATA_DIR, 'scheduled-screen.log');

type ScreenScheduleStage = 'morning' | 'midday' | 'noon' | 'afternoon';

const STAGES: Record<
  ScreenScheduleStage,
  { taskId: ScheduledTaskId; label: string; lookbackDays: number }
> = {
  morning: {
    taskId: 'screen-morning',
    label: '智能选股（早盘）',
    lookbackDays: 14,
  },
  midday: {
    taskId: 'screen-midday',
    label: '智能选股（午间）',
    lookbackDays: 7,
  },
  noon: {
    taskId: 'screen-noon',
    label: '智能选股（午后开盘前）',
    lookbackDays: 3,
  },
  afternoon: {
    taskId: 'screen-afternoon',
    label: '智能选股（尾盘前）',
    lookbackDays: 3,
  },
};

function resolveStage(raw: string | undefined): ScreenScheduleStage {
  if (raw === 'midday' || raw === 'noon' || raw === 'afternoon') return raw;
  return 'morning';
}

/** 自动选股示例：
 * 25 9 * * 1-5 cd /path/to/investment-agent && pnpm screen:schedule morning >> /tmp/screen-cron.log 2>&1
 * 35 11 * * 1-5 cd /path/to/investment-agent && pnpm screen:schedule midday >> /tmp/screen-cron.log 2>&1
 * 50 12 * * 1-5 cd /path/to/investment-agent && pnpm screen:schedule noon >> /tmp/screen-cron.log 2>&1
 * 35 14 * * 1-5 cd /path/to/investment-agent && pnpm screen:schedule afternoon >> /tmp/screen-cron.log 2>&1
 */
async function main() {
  mkdirSync(DATA_DIR, { recursive: true });
  const startedAt = new Date().toISOString();
  const stage = resolveStage(process.argv[2]);
  const config = STAGES[stage];

  if (!isScheduledTaskEnabled(config.taskId)) {
    const line = JSON.stringify({
      ranAt: startedAt,
      stage,
      skipped: true,
      reason: `${config.label}定时任务已关闭`,
    });
    appendFileSync(LOG_PATH, `${line}\n`, 'utf-8');
    process.stdout.write(line);
    return;
  }

  const outcome: {
    query?: string;
    passed?: boolean;
    sessionId?: string;
    sectorCount?: number;
    candidateCount?: number;
    elapsedMs?: number;
    watchlistAdded?: number;
  } = {};

  await runSectorScreenStream({ maxCandidates: 10, excludeSt: true, lookbackDays: config.lookbackDays }, (event) => {
    if (event.type === 'done') {
      outcome.query = event.query;
      outcome.passed = event.passed;
      outcome.sessionId = event.sessionId;
      outcome.sectorCount = event.sectors.length;
      outcome.candidateCount = event.candidates.length;
      outcome.elapsedMs = event.elapsedMs;
      outcome.watchlistAdded = event.watchlistSync?.added.length ?? 0;
    }
  });

  const line = JSON.stringify({
    ranAt: startedAt,
    stage,
    ...outcome,
    ok: outcome.passed ?? false,
  });

  appendFileSync(LOG_PATH, `${line}\n`, 'utf-8');
  process.stdout.write(line);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  appendFileSync(
    LOG_PATH,
    `${JSON.stringify({ ranAt: new Date().toISOString(), error: message })}\n`,
    'utf-8',
  );
  process.stderr.write(message);
  process.exit(1);
});

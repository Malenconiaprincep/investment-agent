import '../config/load-env.js';

import { runSectorScreenStream } from '../api/run-sector-screen-stream.js';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../mastra/config/paths.js';
import {
  isScheduledTaskEnabled,
  type ScheduledTaskId,
} from '../data/schedulers/task-settings.js';
import { appendScheduledTaskLog } from '../data/schedulers/scheduled-task-log.js';
import {
  runPreopenScreeningNotification,
  type PreopenScreeningRunResult,
} from '../data/screening/preopen-screening.js';
import { formatTradeDate, getBeijingNow } from '../data/paper/trading-calendar.js';

const LOG_PATH = path.join(DATA_DIR, 'scheduled-screen.log');

type ScreenScheduleStage = 'preopen' | 'morning' | 'midday' | 'noon' | 'afternoon';

const STAGES: Record<
  ScreenScheduleStage,
  { taskId: ScheduledTaskId; label: string; lookbackDays: number }
> = {
  preopen: {
    taskId: 'screen-preopen',
    label: '盘前智能选股通知',
    lookbackDays: 14,
  },
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
  if (raw === 'preopen') return raw;
  if (raw === 'midday' || raw === 'noon' || raw === 'afternoon') return raw;
  return 'morning';
}

function preopenOutcome(result: PreopenScreeningRunResult) {
  return {
    query: result.screening?.query,
    passed: result.screening?.passed,
    sessionId: result.screening?.sessionId,
    sectorCount: result.screening?.sectors.length,
    candidateCount: result.screening?.candidates.length,
    elapsedMs: result.screening?.elapsedMs,
    watchlistAdded: result.screening?.watchlistSync?.added.length ?? 0,
    dataQualityScore: result.dataQuality.score,
    dataQualityPassed: result.dataQuality.passed,
    dataQualityFail: result.dataQuality.summary.fail,
    dataQualityWarn: result.dataQuality.summary.warn,
    morningStance: result.morningBriefing?.stance.label,
    morningScore: result.morningBriefing?.stance.score,
    morningQualityScore: result.morningBriefingQuality?.score,
    globalMarketCount: result.morningBriefing?.markets.length,
    internationalNewsCount: result.morningBriefing?.internationalNews.length,
    skipped: result.skipped,
    reason: result.reason,
  };
}

function taskSummary(outcome: {
  sessionId?: string;
  candidateCount?: number;
  watchlistAdded?: number;
  dataQualityScore?: number;
  morningStance?: string;
  morningScore?: number;
  morningQualityScore?: number;
}): string | undefined {
  if (!outcome.sessionId) return undefined;
  const parts = [`记录 ${outcome.sessionId}`];
  if (outcome.morningStance) {
    parts.unshift(
      `早报 ${outcome.morningStance}${outcome.morningScore != null ? `(${outcome.morningScore})` : ''}`,
    );
  }
  if (outcome.morningQualityScore != null) {
    parts.unshift(`早报质量 ${outcome.morningQualityScore} 分`);
  }
  if (outcome.dataQualityScore != null) parts.unshift(`数据 ${outcome.dataQualityScore} 分`);
  parts.push(`候选 ${outcome.candidateCount ?? 0} 只`);
  parts.push(`入池 ${outcome.watchlistAdded ?? 0} 只`);
  return parts.join(' · ');
}

/** 自动选股示例：
 * 30 8 * * 1-5 cd /path/to/investment-agent && pnpm screen:schedule preopen >> /tmp/screen-cron.log 2>&1
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
    appendScheduledTaskLog({
      taskId: config.taskId,
      label: config.label,
      tradeDate: formatTradeDate(getBeijingNow()),
      status: 'disabled',
      reason: '任务已在设置中关闭',
      source: 'manual',
      ranAt: startedAt,
    });
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
    dataQualityScore?: number;
    dataQualityPassed?: boolean;
    dataQualityFail?: number;
    dataQualityWarn?: number;
    morningStance?: string;
    morningScore?: number;
    morningQualityScore?: number;
    globalMarketCount?: number;
    internationalNewsCount?: number;
    skipped?: boolean;
    reason?: string;
  } = {};

  if (stage === 'preopen') {
    Object.assign(
      outcome,
      preopenOutcome(
        await runPreopenScreeningNotification({
          maxCandidates: 10,
          lookbackDays: config.lookbackDays,
        }),
      ),
    );
  } else {
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
  }

  const line = JSON.stringify({
    ranAt: startedAt,
    stage,
    ...outcome,
    ok: outcome.passed ?? false,
  });

  appendFileSync(LOG_PATH, `${line}\n`, 'utf-8');
  appendScheduledTaskLog({
    taskId: config.taskId,
    label: config.label,
    tradeDate: formatTradeDate(getBeijingNow()),
    status: outcome.skipped ? 'skipped' : 'completed',
    reason: outcome.reason,
    summary: taskSummary(outcome),
    elapsedMs: Date.now() - Date.parse(startedAt),
    source: 'manual',
    ranAt: startedAt,
  });
  process.stdout.write(line);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  const stage = resolveStage(process.argv[2]);
  const config = STAGES[stage];
  const startedAt = new Date().toISOString();
  appendFileSync(
    LOG_PATH,
    `${JSON.stringify({ ranAt: startedAt, stage, error: message })}\n`,
    'utf-8',
  );
  appendScheduledTaskLog({
    taskId: config.taskId,
    label: config.label,
    tradeDate: formatTradeDate(getBeijingNow()),
    status: 'failed',
    reason: message,
    source: 'manual',
    ranAt: startedAt,
  });
  process.stderr.write(message);
  process.exit(1);
});

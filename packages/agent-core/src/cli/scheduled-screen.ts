import 'dotenv/config';

import { runSectorScreenStream } from '../api/run-sector-screen-stream.js';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../mastra/config/paths.js';
import { isScheduledTaskEnabled } from '../data/schedulers/task-settings.js';

const LOG_PATH = path.join(DATA_DIR, 'scheduled-screen.log');

/** 每个交易日 09:25 自动选股示例：
 * 25 9 * * 1-5 cd /path/to/investment-agent && pnpm screen:schedule >> /tmp/screen-cron.log 2>&1
 */
async function main() {
  mkdirSync(DATA_DIR, { recursive: true });
  const startedAt = new Date().toISOString();

  if (!isScheduledTaskEnabled('screen-morning')) {
    const line = JSON.stringify({
      ranAt: startedAt,
      skipped: true,
      reason: '智能选股定时任务已关闭',
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
  } = {};

  await runSectorScreenStream({ maxCandidates: 10, excludeSt: true, lookbackDays: 14 }, (event) => {
    if (event.type === 'done') {
      outcome.query = event.query;
      outcome.passed = event.passed;
      outcome.sessionId = event.sessionId;
      outcome.sectorCount = event.sectors.length;
      outcome.candidateCount = event.candidates.length;
      outcome.elapsedMs = event.elapsedMs;
    }
  });

  const line = JSON.stringify({
    ranAt: startedAt,
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

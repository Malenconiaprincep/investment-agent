import 'dotenv/config';

import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../mastra/config/paths.js';
import { runDailyWatchlistSnapshot } from '../data/watchlist/jobs.js';
import { formatTradeDate, getBeijingNow } from '../data/paper/trading-calendar.js';
import { appendScheduledTaskLog } from '../data/schedulers/scheduled-task-log.js';

const LOG_PATH = path.join(DATA_DIR, 'watchlist-daily.log');

/** 每个交易日 15:35：30 15 * * 1-5 cd /path && pnpm watchlist:snapshot */
async function main() {
  mkdirSync(DATA_DIR, { recursive: true });
  const startedAt = new Date().toISOString();
  const result = await runDailyWatchlistSnapshot();
  const line = JSON.stringify({ ...result, loggedAt: new Date().toISOString() });
  appendFileSync(LOG_PATH, `${line}\n`, 'utf-8');
  const errors = result.results.filter((item) => 'error' in item).length;
  const diamondSignals = result.results.filter(
    (item) => 'diamondStrength' in item && item.diamondStrength,
  ).length;
  appendScheduledTaskLog({
    taskId: 'watchlist-snapshot',
    label: '跟踪池快照',
    tradeDate: formatTradeDate(getBeijingNow()),
    status: result.count === 0 ? 'skipped' : 'completed',
    reason: result.count === 0 ? '跟踪池为空' : undefined,
    summary: `刷新 ${result.count} 只 · 钻石 ${diamondSignals} 只 · 清理 ${result.purge.removed} 只 · 保护 ${result.purge.protected} 只 · 失败 ${errors} 只`,
    elapsedMs: Date.now() - Date.parse(startedAt),
    source: 'manual',
    ranAt: startedAt,
  });
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

import 'dotenv/config';

import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../mastra/config/paths.js';
import { runDailyWatchlistSnapshot } from '../data/watchlist/jobs.js';

const LOG_PATH = path.join(DATA_DIR, 'watchlist-daily.log');

/** 每个交易日 15:35：30 15 * * 1-5 cd /path && pnpm watchlist:snapshot */
async function main() {
  mkdirSync(DATA_DIR, { recursive: true });
  const result = await runDailyWatchlistSnapshot();
  const line = JSON.stringify({ ...result, loggedAt: new Date().toISOString() });
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

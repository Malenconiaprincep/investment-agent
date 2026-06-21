import 'dotenv/config';

import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../mastra/config/paths.js';
import { generateWeeklyReview } from '../data/watchlist/weekly-review.js';

const LOG_PATH = path.join(DATA_DIR, 'weekly-review.log');

/** 每周一 8:00：0 8 * * 1 cd /path && pnpm watchlist:weekly */
async function main() {
  mkdirSync(DATA_DIR, { recursive: true });
  const review = await generateWeeklyReview();
  const line = JSON.stringify({ ranAt: new Date().toISOString(), id: review.id });
  appendFileSync(LOG_PATH, `${line}\n`, 'utf-8');
  process.stdout.write(JSON.stringify(review));
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

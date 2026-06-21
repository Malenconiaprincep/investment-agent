import 'dotenv/config';

import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { runPaperAutoPipeline } from '../data/paper/auto-pipeline.js';
import { DATA_DIR } from '../mastra/config/paths.js';

const LOG_PATH = path.join(DATA_DIR, 'scheduled-paper.log');

/** 每个交易日 15:05 自动模拟盘（收盘后）：
 * 5 15 * * 1-5 cd /path/to/investment-agent && pnpm paper:schedule >> /tmp/paper-cron.log 2>&1
 */
async function main() {
  mkdirSync(DATA_DIR, { recursive: true });
  const startedAt = new Date().toISOString();

  const result = await runPaperAutoPipeline();

  const line = JSON.stringify({ ranAt: startedAt, ...result });
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

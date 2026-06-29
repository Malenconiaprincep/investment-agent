import 'dotenv/config';

import { runEtfTailPick } from '../data/etf/tail-picker.js';
import { DATA_DIR } from '../mastra/config/paths.js';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const LOG_PATH = path.join(DATA_DIR, 'scheduled-etf-tail.log');

/** 本机 crontab：45 14 * * 1-5 cd /path/to/investment-agent && pnpm etf:tail-schedule */
async function main() {
  mkdirSync(DATA_DIR, { recursive: true });
  const startedAt = new Date().toISOString();
  const result = await runEtfTailPick();
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

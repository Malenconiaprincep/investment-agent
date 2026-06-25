import 'dotenv/config';

import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  runPaperAutoPipeline,
  runStockPaperAutoPipeline,
} from '../data/paper/auto-pipeline.js';
import { runEtfPaperAutoPipeline } from '../data/paper/etf-paper-pipeline.js';
import { DATA_DIR } from '../mastra/config/paths.js';

const LOG_PATH = path.join(DATA_DIR, 'scheduled-paper.log');

type PaperScheduleTarget = 'etf' | 'stock' | 'all';

function resolveTarget(arg?: string): PaperScheduleTarget {
  if (arg === 'etf' || arg === 'stock' || arg === 'all') return arg;
  return 'all';
}

/** 本机 crontab 示例（系统时区请设为 Asia/Shanghai）：
 * 30 14 * * 1-5 cd /path/to/investment-agent && pnpm paper:etf-schedule
 * 5 15 * * 1-5 cd /path/to/investment-agent && pnpm paper:stock-schedule
 */
async function main() {
  mkdirSync(DATA_DIR, { recursive: true });
  const startedAt = new Date().toISOString();
  const target = resolveTarget(process.argv[2]);

  let result: Record<string, unknown>;
  if (target === 'etf') {
    const etf = await runEtfPaperAutoPipeline();
    result = { tradeDate: etf.tradeDate, etf };
  } else if (target === 'stock') {
    const stock = await runStockPaperAutoPipeline();
    result = { tradeDate: stock.tradeDate, stock };
  } else {
    result = await runPaperAutoPipeline();
  }

  const line = JSON.stringify({ ranAt: startedAt, target, ...result });
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

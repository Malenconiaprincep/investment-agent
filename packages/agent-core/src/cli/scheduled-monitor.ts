#!/usr/bin/env tsx
import 'dotenv/config';
import { runMonitorPoll } from '../data/monitor/engine.js';

/** 盘中每 5–15 分钟：cd /path && pnpm monitor:poll */
async function main() {
  const force = process.argv.includes('--force');
  const result = await runMonitorPoll({ force });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

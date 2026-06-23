import 'dotenv/config';

import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { runMonitorPollManaged } from '../data/monitor/engine.js';
import {
  formatTradeDate,
  getBeijingNow,
  isTradingSession,
  isWeekday,
  TRADING_HOURS_LABEL,
} from '../data/paper/trading-calendar.js';
import { DATA_DIR } from '../mastra/config/paths.js';

const LOG_PATH = path.join(DATA_DIR, 'monitor-poll.log');

function parseIntervalMs(): number {
  const fromEnv = Number(process.env.MONITOR_POLL_INTERVAL_MS);
  if (Number.isFinite(fromEnv) && fromEnv >= 60_000) return fromEnv;

  const arg = process.argv.find((a) => a.startsWith('--interval='));
  if (arg) {
    const minutes = Number(arg.split('=')[1]);
    if (Number.isFinite(minutes) && minutes >= 1) return minutes * 60_000;
  }

  return 5 * 60_000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logLine(payload: Record<string, unknown>) {
  mkdirSync(DATA_DIR, { recursive: true });
  const line = JSON.stringify({ ...payload, loggedAt: new Date().toISOString() });
  appendFileSync(LOG_PATH, `${line}\n`, 'utf-8');
  process.stdout.write(`${line}\n`);
}

/** 本地常驻：盘中每 5 分钟轮询新闻 + 行情（无需 Vercel 部署） */
async function main() {
  const force = process.argv.includes('--force');
  const once = process.argv.includes('--once');
  const intervalMs = parseIntervalMs();

  logLine({
    event: 'monitor-watch-start',
    intervalMs,
    force,
    once,
    tradingHours: TRADING_HOURS_LABEL,
  });

  do {
    const now = getBeijingNow();
    const tradeDate = formatTradeDate(now);
    const shouldRun = force || (isWeekday(now) && isTradingSession(now));

    if (!shouldRun) {
      logLine({
        event: 'monitor-watch-skip',
        tradeDate,
        reason: isWeekday(now) ? '非交易时段' : '周末休市',
      });
    } else {
      try {
        const result = await runMonitorPollManaged({ force });
        logLine({
          event: 'monitor-watch-poll',
          tradeDate: result.tradeDate,
          marketOpen: result.marketOpen,
          alertsCreated: result.alertsCreated,
          newNewsCount: result.newNewsCount,
          symbolsScanned: result.symbolsScanned,
          summary: result.summary,
          elapsedMs: result.elapsedMs,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logLine({ event: 'monitor-watch-error', tradeDate, error: message });
        process.stderr.write(`${message}\n`);
      }
    }

    if (once) break;
    await sleep(intervalMs);
  } while (true);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  logLine({ event: 'monitor-watch-fatal', error: message });
  process.stderr.write(message);
  process.exit(1);
});

import { notifyMonitorRealtime } from '../notify/feishu-realtime.js';
import {
  formatTradeDate,
  getBeijingNow,
  isWeekday,
  TRADING_HOURS_LABEL,
} from '../paper/trading-calendar.js';
import { purgeExpiredWatchlistItems } from '../watchlist/retention.js';
import { runMonitorPollManaged } from './engine.js';
import { purgeExpiredMonitorData } from './store.js';

let started = false;
let timer: NodeJS.Timeout | null = null;

function parseIntervalMs(): number {
  const fromEnv = Number(
    process.env.MONITOR_BACKGROUND_INTERVAL_MS ??
      process.env.MONITOR_POLL_INTERVAL_MS,
  );
  if (Number.isFinite(fromEnv) && fromEnv >= 60_000) return fromEnv;
  return 5 * 60_000;
}

function isEnabled(): boolean {
  return process.env.MONITOR_BACKGROUND_ENABLED !== '0';
}

async function tick(intervalMs: number) {
  const now = getBeijingNow();
  const tradeDate = formatTradeDate(now);

  try {
    const purged = await purgeExpiredMonitorData();
    if (
      purged.alertsDeleted > 0 ||
      purged.newsEventsDeleted > 0 ||
      purged.pollRunsDeleted > 0
    ) {
      console.log(
        `[monitor-bg] 清理 ${purged.cutoffTradeDate} 之前数据：提醒 ${purged.alertsDeleted}、新闻 ${purged.newsEventsDeleted}`,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[monitor-bg] 清理过期数据失败：${message}`);
  }

  try {
    const watchlistPurge = await purgeExpiredWatchlistItems();
    if (watchlistPurge.removed > 0) {
      console.log(
        `[monitor-bg] 跟踪池清理 ${watchlistPurge.removed} 只过期标的：${watchlistPurge.removedSymbols.join('、')}`,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[monitor-bg] 跟踪池清理失败：${message}`);
  }

  if (!isWeekday(now)) {
    console.log(`[monitor-bg] ${tradeDate} 周末休市，跳过扫描`);
    return;
  }

  try {
    const result = await runMonitorPollManaged({
      minIntervalMs: Math.max(60_000, intervalMs - 10_000),
    });
    console.log(
      `[monitor-bg] ${result.summary}；推荐 ${result.recommendations.length} 条，自动交易 ${result.paperActions.length} 条`,
    );
    const pushed = await notifyMonitorRealtime({
      tradeDate,
      result,
    });
    if (pushed > 0) {
      console.log(`[monitor-bg] 飞书实时推送 ${pushed} 条`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[monitor-bg] 扫描失败：${message}`);
  }
}

export function startMonitorBackgroundWorker() {
  if (started || !isEnabled()) return;
  started = true;

  const intervalMs = parseIntervalMs();
  console.log(
    `[monitor-bg] 已启动后台消息雷达，间隔 ${Math.round(intervalMs / 1000)} 秒；${TRADING_HOURS_LABEL}`,
  );

  void tick(intervalMs);
  timer = setInterval(() => void tick(intervalMs), intervalMs);
  timer.unref?.();
}

import { runEtfTailPick } from '../etf/tail-picker.js';
import {
  notifyDailyTaskFailure,
  notifyEtfPaperMonitor,
  notifyEtfTailPick,
  notifyStockPaper,
} from '../notify/feishu-daily.js';
import { isFeishuNotifyEnabled } from '../notify/feishu.js';
import { runEtfPaperAutoPipeline } from '../paper/etf-paper-pipeline.js';
import { runStockPaperAutoPipeline } from '../paper/auto-pipeline.js';
import {
  ETF_PAPER_MONITOR_INTERVAL_MINUTES_DEFAULT,
  formatTradeDate,
  getBeijingNow,
  getEtfPaperMonitorIntervalMs,
  isTradingSession,
  isWeekday,
} from '../paper/trading-calendar.js';

type DailyTaskDef = {
  id: string;
  label: string;
  hour: number;
  minute: number;
  run: () => Promise<{ skipped?: boolean; reason?: string; summary?: string }>;
};

const completedKeys = new Set<string>();
let lastEtfPaperRunMs = 0;

function isEnabled(): boolean {
  return process.env.DAILY_TASKS_BACKGROUND_ENABLED !== '0';
}

function taskKey(id: string, tradeDate: string): string {
  return `${id}:${tradeDate}`;
}

function isDue(task: DailyTaskDef, now: Date): boolean {
  if (!isWeekday(now)) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const dueMinutes = task.hour * 60 + task.minute;
  return minutes >= dueMinutes;
}

const DAILY_TASKS: DailyTaskDef[] = [
  {
    id: 'etf-tail-pick',
    label: 'ETF 尾盘推荐',
    hour: 14,
    minute: 0,
    run: async () => {
      const result = await runEtfTailPick();
      if (result.status !== 'skipped') {
        await notifyEtfTailPick(result);
      }
      return { summary: result.summary, skipped: result.status === 'skipped' };
    },
  },
  {
    id: 'stock-paper',
    label: '股票模拟盘选股',
    hour: 15,
    minute: 5,
    run: async () => {
      const result = await runStockPaperAutoPipeline();
      if (!result.skipped) {
        await notifyStockPaper(result);
      }
      return result;
    },
  },
];

async function runEtfPaperMonitor(now = getBeijingNow()) {
  if (!isTradingSession(now)) return;

  const intervalMs = getEtfPaperMonitorIntervalMs();
  const nowMs = now.getTime();
  if (lastEtfPaperRunMs > 0 && nowMs - lastEtfPaperRunMs < intervalMs) return;

  lastEtfPaperRunMs = nowMs;
  try {
    const result = await runEtfPaperAutoPipeline();
    const label = 'ETF 模拟盘监听';
    if (result.skipped) {
      console.log(`[daily-tasks] ${label} 跳过：${result.reason ?? '非执行窗口'}`);
      return;
    }
    await notifyEtfPaperMonitor(result);
    const parts: string[] = [];
    if (result.isRebalanceDay) parts.push('调仓日');
    if (result.buys?.length) parts.push(`买入 ${result.buys.length} 笔`);
    if (result.sells?.length) parts.push(`卖出 ${result.sells.length} 笔`);
    if (result.stopLosses?.length) parts.push(`止损 ${result.stopLosses.length} 笔`);
    if (result.reason) parts.push(result.reason);
    console.log(
      `[daily-tasks] ${label} 完成${parts.length > 0 ? `：${parts.join(' · ')}` : ''}`,
    );
  } catch (error) {
    lastEtfPaperRunMs = 0;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[daily-tasks] ETF 模拟盘监听 失败：${message}`);
    await notifyDailyTaskFailure('ETF 模拟盘监听', message);
  }
}

async function runDueTasks(now = getBeijingNow()) {
  const tradeDate = formatTradeDate(now);

  await runEtfPaperMonitor(now);

  for (const task of DAILY_TASKS) {
    const key = taskKey(task.id, tradeDate);
    if (completedKeys.has(key) || !isDue(task, now)) continue;

    completedKeys.add(key);
    try {
      const result = await task.run();
      if (result.skipped) {
        console.log(
          `[daily-tasks] ${task.label} 跳过：${result.reason ?? '非执行窗口'}`,
        );
      } else {
        console.log(
          `[daily-tasks] ${task.label} 完成${result.summary ? `：${result.summary}` : ''}`,
        );
      }
    } catch (error) {
      completedKeys.delete(key);
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[daily-tasks] ${task.label} 失败：${message}`);
      await notifyDailyTaskFailure(task.label, message);
    }
  }
}

let started = false;
let timer: NodeJS.Timeout | null = null;

export function startDailyTasksBackgroundWorker() {
  if (started || !isEnabled()) return;
  started = true;

  const intervalMin =
    getEtfPaperMonitorIntervalMs() / 60_000 || ETF_PAPER_MONITOR_INTERVAL_MINUTES_DEFAULT;
  const schedule = [
    `14:00 ETF 尾盘推荐`,
    `交易时段每 ${intervalMin} 分钟 ETF 模拟盘监听`,
    `15:05 股票模拟盘选股`,
  ].join(' · ');

  console.log(`[daily-tasks] 已启动本机定时任务（北京时间）：${schedule}`);
  if (isFeishuNotifyEnabled()) {
    console.log('[daily-tasks] 飞书推送已启用');
  }

  void runDueTasks();
  timer = setInterval(() => void runDueTasks(), 60_000);
  timer.unref?.();
}

export function resetDailyTasksForTests() {
  completedKeys.clear();
  lastEtfPaperRunMs = 0;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  started = false;
}

/** 供 CLI / 测试直接触发 */
export async function runDailyTasksNow() {
  completedKeys.clear();
  lastEtfPaperRunMs = 0;
  await runDueTasks(getBeijingNow());
}

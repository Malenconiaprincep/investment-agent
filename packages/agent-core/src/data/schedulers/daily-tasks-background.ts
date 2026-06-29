import { runEtfTailPick } from '../etf/tail-picker.js';
import { runEtfMorningRadar } from '../etf/morning-radar.js';
import {
  notifyDailyTaskFailure,
  notifyEtfMorningRadar,
  notifyEtfPaperMonitor,
  notifyEtfTailPick,
  notifyStockPaper,
} from '../notify/feishu-daily.js';
import { notifyStockIntradayCandidates } from '../notify/feishu-realtime.js';
import { isFeishuNotifyEnabled } from '../notify/feishu.js';
import { runEtfPaperAutoPipeline } from '../paper/etf-paper-pipeline.js';
import { runStockPaperAutoPipeline } from '../paper/auto-pipeline.js';
import { runStockIntradayScan } from '../paper/stock-intraday-scan.js';
import { runSectorScreenStream } from '../../api/run-sector-screen-stream.js';
import {
  isScheduledTaskEnabled,
  type ScheduledTaskId,
} from './task-settings.js';
import {
  ETF_PAPER_MONITOR_INTERVAL_MINUTES_DEFAULT,
  formatTradeDate,
  getBeijingNow,
  getEtfPaperMonitorIntervalMs,
  getStockIntradayMonitorIntervalMs,
  isTradingSession,
  isWeekday,
  STOCK_INTRADAY_MONITOR_INTERVAL_MINUTES_DEFAULT,
} from '../paper/trading-calendar.js';

type DailyTaskDef = {
  id: ScheduledTaskId;
  label: string;
  hour: number;
  minute: number;
  run: () => Promise<{ skipped?: boolean; reason?: string; summary?: string }>;
};

const completedKeys = new Set<string>();
let lastEtfPaperRunMs = 0;
let lastStockIntradayRunMs = 0;

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
    id: 'screen-morning',
    label: '智能选股',
    hour: 9,
    minute: 25,
    run: async () => {
      const outcome: {
        query?: string;
        passed?: boolean;
        sessionId?: string;
        sectorCount?: number;
        candidateCount?: number;
        elapsedMs?: number;
      } = {};

      await runSectorScreenStream(
        { maxCandidates: 10, excludeSt: true, lookbackDays: 14 },
        (event) => {
          if (event.type === 'done') {
            outcome.query = event.query;
            outcome.passed = event.passed;
            outcome.sessionId = event.sessionId;
            outcome.sectorCount = event.sectors.length;
            outcome.candidateCount = event.candidates.length;
            outcome.elapsedMs = event.elapsedMs;
          }
        },
      );

      return {
        skipped: outcome.passed === undefined,
        summary: outcome.sessionId
          ? `记录 ${outcome.sessionId} · 候选 ${outcome.candidateCount ?? 0} 只`
          : undefined,
      };
    },
  },
  {
    id: 'etf-morning-radar',
    label: 'ETF 早盘异动雷达',
    hour: 9,
    minute: 35,
    run: async () => {
      const result = await runEtfMorningRadar({ stage: 'open' });
      await notifyEtfMorningRadar(result);
      return { summary: result.summary };
    },
  },
  {
    id: 'etf-morning-confirm',
    label: 'ETF 10点承接确认',
    hour: 10,
    minute: 0,
    run: async () => {
      const result = await runEtfMorningRadar({ stage: 'confirm' });
      await notifyEtfMorningRadar(result);
      return { summary: result.summary };
    },
  },
  {
    id: 'etf-tail-pick',
    label: 'ETF 尾盘推荐',
    hour: 14,
    minute: 45,
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

async function runStockIntradayMonitor(now = getBeijingNow()) {
  if (!isScheduledTaskEnabled('stock-intraday-monitor')) return;
  if (!isTradingSession(now)) return;

  const intervalMs = getStockIntradayMonitorIntervalMs();
  const nowMs = now.getTime();
  if (lastStockIntradayRunMs > 0 && nowMs - lastStockIntradayRunMs < intervalMs) {
    return;
  }

  lastStockIntradayRunMs = nowMs;
  const tradeDate = formatTradeDate(now);
  const label = '股票实时信号扫描';

  try {
    const result = await runStockIntradayScan({
      tradeDate,
      marketOpen: true,
    });
    if (result.skipped) {
      console.log(`[daily-tasks] ${label} 跳过：${result.reason ?? '非执行窗口'}`);
      return;
    }

    const pushed = await notifyStockIntradayCandidates({
      tradeDate,
      candidates: result.candidates,
    });

    console.log(
      `[daily-tasks] ${label} 完成：扫描 ${result.scanned} 只，达标 ${result.candidates.length} 只${pushed > 0 ? `，飞书推送 ${pushed} 只` : ''}`,
    );
  } catch (error) {
    lastStockIntradayRunMs = 0;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[daily-tasks] ${label} 失败：${message}`);
    await notifyDailyTaskFailure(label, message);
  }
}

async function runEtfPaperMonitor(now = getBeijingNow()) {
  if (!isScheduledTaskEnabled('etf-paper-monitor')) return;
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
  await runStockIntradayMonitor(now);

  for (const task of DAILY_TASKS) {
    const key = taskKey(task.id, tradeDate);
    if (completedKeys.has(key) || !isDue(task, now)) continue;
    if (!isScheduledTaskEnabled(task.id)) continue;

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

  const etfIntervalMin =
    getEtfPaperMonitorIntervalMs() / 60_000 || ETF_PAPER_MONITOR_INTERVAL_MINUTES_DEFAULT;
  const stockIntervalMin =
    getStockIntradayMonitorIntervalMs() / 60_000 ||
    STOCK_INTRADAY_MONITOR_INTERVAL_MINUTES_DEFAULT;
  const schedule = [
    `09:25 智能选股`,
    `09:35 ETF 早盘异动雷达`,
    `10:00 ETF 承接确认`,
    `14:45 ETF 尾盘推荐`,
    `交易时段每 ${etfIntervalMin} 分钟 ETF 模拟盘监听`,
    `交易时段每 ${stockIntervalMin} 分钟 股票实时信号扫描`,
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
  lastStockIntradayRunMs = 0;
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
  lastStockIntradayRunMs = 0;
  await runDueTasks(getBeijingNow());
}

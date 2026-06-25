import { runEtfTailPick } from '../etf/tail-picker.js';
import { runEtfPaperAutoPipeline } from '../paper/etf-paper-pipeline.js';
import { runStockPaperAutoPipeline } from '../paper/auto-pipeline.js';
import {
  formatTradeDate,
  getBeijingNow,
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
      return { summary: result.summary, skipped: result.status === 'skipped' };
    },
  },
  {
    id: 'etf-paper',
    label: 'ETF 模拟盘调仓',
    hour: 14,
    minute: 30,
    run: async () => runEtfPaperAutoPipeline(),
  },
  {
    id: 'stock-paper',
    label: '股票模拟盘选股',
    hour: 15,
    minute: 5,
    run: async () => runStockPaperAutoPipeline(),
  },
];

async function runDueTasks(now = getBeijingNow()) {
  const tradeDate = formatTradeDate(now);

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
    }
  }
}

let started = false;
let timer: NodeJS.Timeout | null = null;

export function startDailyTasksBackgroundWorker() {
  if (started || !isEnabled()) return;
  started = true;

  const schedule = DAILY_TASKS.map(
    (t) => `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')} ${t.label}`,
  ).join(' · ');

  console.log(`[daily-tasks] 已启动本机定时任务（北京时间）：${schedule}`);

  void runDueTasks();
  timer = setInterval(() => void runDueTasks(), 60_000);
  timer.unref?.();
}

export function resetDailyTasksForTests() {
  completedKeys.clear();
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  started = false;
}

/** 供 CLI / 测试直接触发 */
export async function runDailyTasksNow() {
  completedKeys.clear();
  await runDueTasks(getBeijingNow());
}

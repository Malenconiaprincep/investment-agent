import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { runEtfTailPick } from '../etf/tail-picker.js';
import { runEtfMorningRadar } from '../etf/morning-radar.js';
import {
  notifyDailyTaskFailure,
  notifyEtfMorningRadar,
  notifyEtfPaperMonitor,
  notifyEtfTailPick,
  notifyMarketDataReminder,
  notifyStockDailyCsvManualReminder,
  notifyStockBacktestPaper,
  notifyStockPaper,
} from '../notify/feishu-daily.js';
import { notifyStockIntradayCandidates } from '../notify/feishu-realtime.js';
import { isFeishuNotifyEnabled } from '../notify/feishu.js';
import {
  runEtfPaperAutoPipeline,
  runEtfTPlusPaperPipeline,
} from '../paper/etf-paper-pipeline.js';
import { ETF_EVERGREEN_BUCKET } from '../paper/bucket.js';
import { runStockPaperAutoPipeline } from '../paper/auto-pipeline.js';
import {
  runStockBacktestPaperPipeline,
  runStockBacktestNewsPaperPipeline,
} from '../paper/stock-backtest-pipeline.js';
import { runStockBacktestPaperExitMonitor } from '../paper/stock-backtest-exit.js';
import { checkMarketDataFreshness } from '../paper/market-data-freshness.js';
import { runStockIntradayScan } from '../paper/stock-intraday-scan.js';
import { buildEtfObservationReport } from '../paper/etf-observation.js';
import { runDailyWatchlistSnapshot } from '../watchlist/jobs.js';
import { runSectorScreenStream } from '../../api/run-sector-screen-stream.js';
import {
  runPreopenScreeningNotification,
  type PreopenScreeningRunResult,
} from '../screening/preopen-screening.js';
import { DATA_DIR } from '../../mastra/config/paths.js';
import {
  type DailyCsvUpdateResult,
  type DailyCsvUpdateProgressEvent,
  updateEtfDailyCsvPool,
  updateStockDailyCsvPool,
} from '../market/local-csv/etf-daily-update.js';
import {
  resolveMarketDataSyncOptions,
  syncMarketData,
  type MarketDataSyncResult,
} from '../../cli/sync-market-data.js';
import { generateDailyWikiReport } from '../wiki/daily-report.js';
import {
  isScheduledTaskEnabled,
  type ScheduledTaskId,
} from './task-settings.js';
import { appendScheduledTaskLog } from './scheduled-task-log.js';
import type {
  ScheduledTaskLogSource,
  ScheduledTaskLogStatus,
} from './scheduled-task-log.js';
import {
  createDailyTaskDueCheck,
  getMinuteOfDay,
  isDailyTaskDueInWindow,
  type DailyTaskDueCursor,
  type DailyTaskDueWindow,
} from './daily-task-due.js';
import {
  ETF_PAPER_MONITOR_INTERVAL_MINUTES_DEFAULT,
  formatTradeDate,
  getBeijingNow,
  getEtfPaperMonitorIntervalMs,
  getNextTradeDateLabel,
  getStockIntradayMonitorIntervalMs,
  isMarketTradingDay,
  isTradingSession,
  STOCK_INTRADAY_MONITOR_INTERVAL_MINUTES_DEFAULT,
} from '../paper/trading-calendar.js';

type DailyTaskDef = {
  id: ScheduledTaskId;
  label: string;
  hour: number;
  minute: number;
  timeoutMs?: number;
  run: () => Promise<{ skipped?: boolean; reason?: string; summary?: string }>;
};

export type StockDailyMarketDataSyncRunResult = {
  skipped: boolean;
  reason?: string;
  summary: string;
  startedAt: string;
  finishedAt: string;
  elapsedMs: number;
  result: MarketDataSyncResult;
};

export type StockDailyCsvUpdateRunResult = {
  skipped: boolean;
  reason?: string;
  summary: string;
  startedAt: string;
  finishedAt: string;
  elapsedMs: number;
  result: DailyCsvUpdateResult;
};

const completedKeys = new Set<string>();
let dueTasksRunning = false;
let dueTasksRerunRequested = false;
let lastEtfPaperRunMs = 0;
let lastEtfTPlusRunMs = 0;
let lastStockIntradayRunMs = 0;
let lastStockBacktestNewsExitRunMs = 0;
let lastStockBacktestExitRunMs = 0;
let lastDailyTaskDueCursor: DailyTaskDueCursor | null = null;
const SCREEN_LOG_PATH = path.join(DATA_DIR, 'scheduled-screen.log');
const DAILY_CSV_LOG_PATH = path.join(DATA_DIR, 'daily-csv-update.log');
const STOCK_DAILY_SYNC_TASK_ID: Extract<
  ScheduledTaskId,
  'stock-daily-csv-update'
> = 'stock-daily-csv-update';
const STOCK_DAILY_SYNC_LABEL = '股票日线更新';
const SCREEN_TASK_TIMEOUT_MS = 15 * 60 * 1000;

function isEnabled(): boolean {
  return process.env.DAILY_TASKS_BACKGROUND_ENABLED !== '0';
}

function taskKey(id: string, tradeDate: string): string {
  return `${id}:${tradeDate}`;
}

function formatBeijingLogTime(date = new Date()): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

function logInfo(message: string) {
  console.log(`[daily-tasks ${formatBeijingLogTime()}] ${message}`);
}

function logError(message: string) {
  console.error(`[daily-tasks ${formatBeijingLogTime()}] ${message}`);
}

function recordTaskLog(input: {
  runId?: string;
  taskId: ScheduledTaskId;
  label: string;
  tradeDate: string;
  status: ScheduledTaskLogStatus;
  reason?: string;
  summary?: string;
  elapsedMs?: number;
  startedAt?: string;
}) {
  appendScheduledTaskLog({
    runId: input.runId,
    taskId: input.taskId,
    label: input.label,
    tradeDate: input.tradeDate,
    status: input.status,
    reason: input.reason,
    summary: input.summary,
    elapsedMs: input.elapsedMs,
    source: 'background-worker',
    ranAt: input.startedAt,
  });
}

function timeoutErrorMessage(label: string, timeoutMs: number): string {
  return `${label} 执行超过 ${Math.round(timeoutMs / 60_000)} 分钟，已标记失败；后台调用可能仍会自行结束`;
}

async function runTaskWithTimeout<T>(
  task: Pick<DailyTaskDef, 'label' | 'timeoutMs'>,
  run: () => Promise<T>,
): Promise<T> {
  if (!task.timeoutMs || task.timeoutMs <= 0) return run();

  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(timeoutErrorMessage(task.label, task.timeoutMs ?? 0))),
          task.timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('执行超过');
}

function appendNextTradeDateSummary(summary: string, nextTradeDate?: string): string {
  return nextTradeDate ? `${summary} · 下次观察 ${nextTradeDate}` : summary;
}

function appendNextRebalanceDateSummary(
  summary: string,
  nextRebalanceDate?: string,
): string {
  return nextRebalanceDate ? `${summary} · 下次调仓 ${nextRebalanceDate}` : summary;
}

function appendScreenTaskLog(
  stage: 'preopen' | 'morning' | 'midday' | 'noon' | 'afternoon',
  startedAt: string,
  outcome: {
    query?: string;
    passed?: boolean;
    sessionId?: string;
    sectorCount?: number;
    candidateCount?: number;
    elapsedMs?: number;
    watchlistAdded?: number;
    dataQualityScore?: number;
    dataQualityPassed?: boolean;
    dataQualityFail?: number;
    dataQualityWarn?: number;
    morningStance?: string;
    morningScore?: number;
    morningQualityScore?: number;
    globalMarketCount?: number;
    internationalNewsCount?: number;
    skipped?: boolean;
    reason?: string;
  },
) {
  mkdirSync(DATA_DIR, { recursive: true });
  appendFileSync(
    SCREEN_LOG_PATH,
    `${JSON.stringify({
      ranAt: startedAt,
      ranAtBeijing: formatBeijingLogTime(new Date(startedAt)),
      source: 'background-worker',
      stage,
      ...outcome,
      ok: outcome.passed ?? false,
    })}\n`,
    'utf-8',
  );
}

function preopenOutcome(result: PreopenScreeningRunResult) {
  return {
    query: result.screening?.query,
    passed: result.screening?.passed,
    sessionId: result.screening?.sessionId,
    sectorCount: result.screening?.sectors.length,
    candidateCount: result.screening?.candidates.length,
    elapsedMs: result.screening?.elapsedMs,
    watchlistAdded: result.screening?.watchlistSync?.added.length ?? 0,
    dataQualityScore: result.dataQuality.score,
    dataQualityPassed: result.dataQuality.passed,
    dataQualityFail: result.dataQuality.summary.fail,
    dataQualityWarn: result.dataQuality.summary.warn,
    morningStance: result.morningBriefing?.stance.label,
    morningScore: result.morningBriefing?.stance.score,
    morningQualityScore: result.morningBriefingQuality?.score,
    globalMarketCount: result.morningBriefing?.markets.length,
    internationalNewsCount: result.morningBriefing?.internationalNews.length,
    skipped: result.skipped,
    reason: result.reason,
  };
}

function appendDailyCsvUpdateLog(input: {
  label: string;
  startedAt: string;
  finishedAt: string;
  elapsedMs: number;
  result: DailyCsvUpdateResult;
}) {
  mkdirSync(DATA_DIR, { recursive: true });
  const changedItems = input.result.items
    .filter((item) => item.addedRows > 0 || item.updatedRows > 0)
    .map((item) => ({
      symbol: item.symbol,
      name: item.name,
      attempts: item.attempts,
      beforeRows: item.beforeRows,
      afterRows: item.afterRows,
      addedRows: item.addedRows,
      updatedRows: item.updatedRows,
      latestDate: item.latestDate,
    }));
  const errorItems = input.result.items
    .filter((item) => item.error)
    .map((item) => ({
      symbol: item.symbol,
      name: item.name,
      attempts: item.attempts,
      error: item.error,
    }));

  appendFileSync(
    DAILY_CSV_LOG_PATH,
    `${JSON.stringify({
      label: input.label,
      assetType: input.result.assetType,
      ranAt: input.startedAt,
      ranAtBeijing: formatBeijingLogTime(new Date(input.startedAt)),
      finishedAt: input.finishedAt,
      elapsedMs: input.elapsedMs,
      tradeDate: input.result.tradeDate,
      symbolCount: input.result.items.length,
      addedRows: input.result.addedRows,
      updatedRows: input.result.updatedRows,
      errors: input.result.errors,
      changedItems,
      errorItems,
    })}\n`,
    'utf-8',
  );
}

function appendMarketDataSyncLog(input: {
  label: string;
  startedAt: string;
  finishedAt: string;
  elapsedMs: number;
  result: MarketDataSyncResult;
}) {
  mkdirSync(DATA_DIR, { recursive: true });
  appendFileSync(
    DAILY_CSV_LOG_PATH,
    `${JSON.stringify({
      label: input.label,
      assetType: 'stock',
      mode: 'baidu-market-sync',
      ranAt: input.startedAt,
      ranAtBeijing: formatBeijingLogTime(new Date(input.startedAt)),
      finishedAt: input.finishedAt,
      elapsedMs: input.elapsedMs,
      tradeDate: input.result.sourceLatestTradeDate,
      skipped: input.result.skipped ?? false,
      reason: input.result.reason,
      symbolCount:
        input.result.importedStockCsvFiles ||
        input.result.discoveredStockCsvFiles ||
        0,
      importedStockCsvFiles: input.result.importedStockCsvFiles,
      discoveredStockCsvFiles: input.result.discoveredStockCsvFiles,
      sourceLatestTradeDate: input.result.sourceLatestTradeDate,
      targetLatestTradeDate: input.result.targetLatestTradeDate,
      sourceDir: input.result.sourceDir,
      zipPath: input.result.zipPath,
      firstStockCsv: input.result.firstStockCsv,
      lastStockCsv: input.result.lastStockCsv,
      meta: input.result.meta,
      backups: input.result.backups,
      actions: input.result.actions,
    })}\n`,
    'utf-8',
  );
}

function marketDataSyncSummary(result: MarketDataSyncResult): string {
  return result.skipped
    ? `百度网盘源数据未更新：源 ${result.sourceLatestTradeDate} · 当前 ${result.targetLatestTradeDate ?? '-'}`
    : `百度网盘同步完成：导入 ${result.importedStockCsvFiles} 只 · 最新 ${result.sourceLatestTradeDate}`;
}

function dailyCsvUpdateSummary(result: DailyCsvUpdateResult): string {
  return `标的 ${result.items.length} 只 · 新增 ${result.addedRows} 行 · 修正 ${result.updatedRows} 行 · 失败 ${result.errors} 只 · 最新 ${result.tradeDate || '-'}`;
}

export function runStockDailyMarketDataSync(input?: {
  label?: string;
  startedAt?: string;
}): StockDailyMarketDataSyncRunResult {
  const label = input?.label ?? STOCK_DAILY_SYNC_LABEL;
  const startedAt = input?.startedAt ?? new Date().toISOString();
  const result = syncMarketData(resolveMarketDataSyncOptions());
  const finishedAt = new Date().toISOString();
  const elapsedMs = Date.parse(finishedAt) - Date.parse(startedAt);
  appendMarketDataSyncLog({
    label,
    startedAt,
    finishedAt,
    elapsedMs,
    result,
  });
  return {
    skipped: result.skipped ?? false,
    reason: result.reason,
    summary: marketDataSyncSummary(result),
    startedAt,
    finishedAt,
    elapsedMs,
    result,
  };
}

export async function runStockDailyMarketDataSyncManually(input?: {
  source?: ScheduledTaskLogSource;
}): Promise<StockDailyMarketDataSyncRunResult> {
  const source = input?.source ?? 'manual';
  const tradeDate = formatTradeDate(getBeijingNow());
  const startedAt = new Date().toISOString();

  try {
    const outcome = runStockDailyMarketDataSync({ startedAt });
    appendScheduledTaskLog({
      taskId: STOCK_DAILY_SYNC_TASK_ID,
      label: STOCK_DAILY_SYNC_LABEL,
      tradeDate,
      status: outcome.skipped ? 'skipped' : 'completed',
      reason: outcome.skipped ? outcome.reason ?? '源数据未更新' : undefined,
      summary: outcome.summary,
      elapsedMs: outcome.elapsedMs,
      source,
      ranAt: outcome.startedAt,
    });
    return outcome;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendScheduledTaskLog({
      taskId: STOCK_DAILY_SYNC_TASK_ID,
      label: STOCK_DAILY_SYNC_LABEL,
      tradeDate,
      status: 'failed',
      reason: message,
      elapsedMs: Date.now() - Date.parse(startedAt),
      source,
      ranAt: startedAt,
    });
    throw error;
  }
}

export async function runStockDailyCsvUpdate(input?: {
  label?: string;
  startedAt?: string;
  onProgress?: (event: DailyCsvUpdateProgressEvent) => void | Promise<void>;
}): Promise<StockDailyCsvUpdateRunResult> {
  const label = input?.label ?? STOCK_DAILY_SYNC_LABEL;
  const startedAt = input?.startedAt ?? new Date().toISOString();
  const result = await updateStockDailyCsvPool({
    includeLocal: true,
    includeActive: true,
    onProgress: input?.onProgress,
  });
  const finishedAt = new Date().toISOString();
  const elapsedMs = Date.parse(finishedAt) - Date.parse(startedAt);
  appendDailyCsvUpdateLog({
    label,
    startedAt,
    finishedAt,
    elapsedMs,
    result,
  });
  return {
    skipped: result.items.length === 0 || result.errors === result.items.length,
    reason:
      result.items.length === 0
        ? '没有找到需要更新的股票'
        : result.errors === result.items.length
          ? '股票日线全部更新失败'
          : undefined,
    summary: dailyCsvUpdateSummary(result),
    startedAt,
    finishedAt,
    elapsedMs,
    result,
  };
}

export async function runStockDailyCsvUpdateManually(input?: {
  source?: ScheduledTaskLogSource;
  onProgress?: (event: DailyCsvUpdateProgressEvent) => void | Promise<void>;
}): Promise<StockDailyCsvUpdateRunResult> {
  const source = input?.source ?? 'manual';
  const tradeDate = formatTradeDate(getBeijingNow());
  const startedAt = new Date().toISOString();

  try {
    const outcome = await runStockDailyCsvUpdate({
      startedAt,
      onProgress: input?.onProgress,
    });
    appendScheduledTaskLog({
      taskId: STOCK_DAILY_SYNC_TASK_ID,
      label: STOCK_DAILY_SYNC_LABEL,
      tradeDate,
      status: outcome.skipped ? 'skipped' : 'completed',
      reason: outcome.reason,
      summary: outcome.summary,
      elapsedMs: outcome.elapsedMs,
      source,
      ranAt: outcome.startedAt,
    });
    return outcome;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendScheduledTaskLog({
      taskId: STOCK_DAILY_SYNC_TASK_ID,
      label: STOCK_DAILY_SYNC_LABEL,
      tradeDate,
      status: 'failed',
      reason: message,
      elapsedMs: Date.now() - Date.parse(startedAt),
      source,
      ranAt: startedAt,
    });
    throw error;
  }
}

function createScreenTask(input: {
  id: Extract<
    ScheduledTaskId,
    'screen-morning' | 'screen-midday' | 'screen-noon' | 'screen-afternoon'
  >;
  stage: 'morning' | 'midday' | 'noon' | 'afternoon';
  label: string;
  hour: number;
  minute: number;
  lookbackDays: number;
}): DailyTaskDef {
  return {
    id: input.id,
    label: input.label,
    hour: input.hour,
    minute: input.minute,
    timeoutMs: SCREEN_TASK_TIMEOUT_MS,
    run: async () => {
      const startedAt = new Date().toISOString();
      const outcome: {
        query?: string;
        passed?: boolean;
        sessionId?: string;
        sectorCount?: number;
        candidateCount?: number;
        elapsedMs?: number;
        watchlistAdded?: number;
      } = {};

      await runSectorScreenStream(
        { maxCandidates: 10, excludeSt: true, lookbackDays: input.lookbackDays },
        (event) => {
          if (event.type === 'done') {
            outcome.query = event.query;
            outcome.passed = event.passed;
            outcome.sessionId = event.sessionId;
            outcome.sectorCount = event.sectors.length;
            outcome.candidateCount = event.candidates.length;
            outcome.elapsedMs = event.elapsedMs;
            outcome.watchlistAdded = event.watchlistSync?.added.length ?? 0;
          }
        },
      );
      appendScreenTaskLog(input.stage, startedAt, outcome);

      return {
        skipped: outcome.passed === undefined,
        summary: outcome.sessionId
          ? `记录 ${outcome.sessionId} · 候选 ${outcome.candidateCount ?? 0} 只 · 入池 ${outcome.watchlistAdded ?? 0} 只`
          : undefined,
      };
    },
  };
}

function createPreopenScreenTask(): DailyTaskDef {
  return {
    id: 'screen-preopen',
    label: '盘前智能选股通知',
    hour: 8,
    minute: 30,
    timeoutMs: SCREEN_TASK_TIMEOUT_MS,
    run: async () => {
      const startedAt = new Date().toISOString();
      const result = await runPreopenScreeningNotification({
        maxCandidates: 10,
        lookbackDays: 14,
      });
      const outcome = preopenOutcome(result);
      appendScreenTaskLog('preopen', startedAt, outcome);

      return {
        skipped: result.skipped,
        reason: result.reason,
        summary: result.screening?.sessionId
          ? `早报 ${result.morningBriefing?.stance.label ?? '-'}${result.morningBriefing?.stance.score != null ? `(${result.morningBriefing.stance.score})` : ''} · 早报质量 ${result.morningBriefingQuality?.score ?? '-'} 分 · 数据 ${result.dataQuality.score} 分 · 记录 ${result.screening.sessionId} · 候选 ${result.screening.candidates.length} 只 · 入池 ${result.screening.watchlistSync?.added.length ?? 0} 只`
          : `早报 ${result.morningBriefing?.stance.label ?? '-'} · 数据 ${result.dataQuality.score} 分 · ${result.reason ?? '未生成候选池'}`,
      };
    },
  };
}

const DAILY_TASKS: DailyTaskDef[] = [
  createPreopenScreenTask(),
  createScreenTask({
    id: 'screen-morning',
    stage: 'morning',
    label: '智能选股（早盘）',
    hour: 9,
    minute: 25,
    lookbackDays: 14,
  }),
  createScreenTask({
    id: 'screen-midday',
    stage: 'midday',
    label: '智能选股（午间）',
    hour: 11,
    minute: 35,
    lookbackDays: 7,
  }),
  createScreenTask({
    id: 'screen-noon',
    stage: 'noon',
    label: '智能选股（午后开盘前）',
    hour: 12,
    minute: 50,
    lookbackDays: 3,
  }),
  createScreenTask({
    id: 'screen-afternoon',
    stage: 'afternoon',
    label: '智能选股（尾盘前）',
    hour: 14,
    minute: 35,
    lookbackDays: 3,
  }),
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
  {
    id: 'market-data-reminder',
    label: '行情数据更新提醒',
    hour: 8,
    minute: 0,
    run: async () => {
      const freshness = checkMarketDataFreshness();
      await notifyMarketDataReminder(freshness);
      return {
        skipped: !freshness.isTradingDay || freshness.isFresh,
        reason: freshness.reminder ?? undefined,
        summary: freshness.isFresh
          ? `数据已就绪（最新 ${freshness.latestDataDate ?? '-'}）`
          : '已发送数据更新提醒',
      };
    },
  },
  {
    id: 'stock-backtest-paper',
    label: '回测策略模拟盘买入',
    hour: 8,
    minute: 0,
    run: async () => {
      const result = await runStockBacktestPaperPipeline();
      await notifyStockBacktestPaper(result);
      return result;
    },
  },
  {
    id: 'stock-backtest-news-paper',
    label: '回测策略+新闻模拟盘买入',
    hour: 8,
    minute: 0,
    run: async () => {
      const result = await runStockBacktestNewsPaperPipeline();
      await notifyStockBacktestPaper(result);
      return result;
    },
  },
  {
    id: 'etf-daily-csv-update',
    label: 'ETF 日线更新',
    hour: 15,
    minute: 30,
    run: async () => {
      const startedAt = new Date().toISOString();
      const result = await updateEtfDailyCsvPool();
      const finishedAt = new Date().toISOString();
      appendDailyCsvUpdateLog({
        label: 'ETF 日线更新',
        startedAt,
        finishedAt,
        elapsedMs: Date.parse(finishedAt) - Date.parse(startedAt),
        result,
      });
      return {
        skipped: result.errors === result.items.length,
        reason: result.errors === result.items.length ? 'ETF 日线全部更新失败' : undefined,
        summary: `标的 ${result.items.length} 只 · 新增 ${result.addedRows} 行 · 修正 ${result.updatedRows} 行 · 失败 ${result.errors} 只`,
      };
    },
  },
  {
    id: 'etf-observation-snapshot',
    label: 'ETF 观察快照',
    hour: 15,
    minute: 45,
    run: async () => {
      const report = await buildEtfObservationReport({ persist: true });
      const failed = report.latest.checks.filter((check) => check.status === 'fail');
      const warned = report.latest.checks.filter((check) => check.status === 'warn');
      return {
        skipped: false,
        summary: `总分 ${report.latest.score} · ${report.latest.overallStatus} · 已观察 ${report.elapsedDays}/56 天 · 失败 ${failed.length} 项 · 预警 ${warned.length} 项`,
      };
    },
  },
  {
    id: 'watchlist-snapshot',
    label: '跟踪池快照',
    hour: 15,
    minute: 35,
    run: async () => {
      const result = await runDailyWatchlistSnapshot();
      const errors = result.results.filter((item) => 'error' in item).length;
      const diamondSignals = result.results.filter(
        (item) => 'diamondStrength' in item && item.diamondStrength,
      ).length;
      return {
        skipped: result.count === 0,
        reason: result.count === 0 ? '跟踪池为空' : undefined,
        summary: `刷新 ${result.count} 只 · 钻石 ${diamondSignals} 只 · 清理 ${result.purge.removed} 只 · 保护 ${result.purge.protected} 只 · 失败 ${errors} 只`,
      };
    },
  },
  {
    id: STOCK_DAILY_SYNC_TASK_ID,
    label: '股票日线手动更新提醒',
    hour: 17,
    minute: 0,
    run: async () => {
      if (!isFeishuNotifyEnabled()) {
        return {
          skipped: true,
          reason: '飞书通知未配置',
          summary: '未发送手动更新提醒',
        };
      }
      const tradeDate = formatTradeDate(getBeijingNow());
      await notifyStockDailyCsvManualReminder(tradeDate);
      return {
        skipped: false,
        summary: `已发送 ${tradeDate} 股票日线手动更新提醒`,
      };
    },
  },
  {
    id: 'work-summary-snapshot',
    label: '工作总结与 Wiki 日报',
    hour: 17,
    minute: 20,
    run: async () => {
      const result = await generateDailyWikiReport({ persistWorkSummary: true });
      return {
        skipped: false,
        summary: `日报 ${result.report.date} · 评分 ${result.report.workSummary.current.overallScore}/${result.report.workSummary.current.grade} · ${result.report.paths.markdown}`,
      };
    },
  },
];

async function tickStockBacktestPaperExitMonitor(now = getBeijingNow()) {
  if (!isScheduledTaskEnabled('stock-backtest-exit-monitor')) return;
  if (!isTradingSession(now)) return;

  const intervalMs = getStockIntradayMonitorIntervalMs();
  const nowMs = now.getTime();
  if (
    lastStockBacktestNewsExitRunMs > 0 &&
    nowMs - lastStockBacktestNewsExitRunMs < intervalMs
  ) {
    return;
  }

  lastStockBacktestNewsExitRunMs = nowMs;
  const tradeDate = formatTradeDate(now);
  const label = '回测策略分仓出场监控';
  const startedAt = new Date().toISOString();

  try {
    const result = await runStockBacktestPaperExitMonitor();
    if (result.skipped) {
      logInfo(`${label} 跳过：${result.reason ?? '非执行窗口'}`);
      recordTaskLog({
        taskId: 'stock-backtest-exit-monitor',
        label,
        tradeDate,
        status: 'skipped',
        reason: result.reason ?? '非执行窗口',
        startedAt,
      });
      return;
    }
    if (result.sells.length === 0) return;

    const summary = `卖出 ${result.sells.length} 笔（${result.sells
      .map((s) => `${s.bucket}:${s.symbol}`)
      .join('、')}）`;
    logInfo(`${label} 完成：${summary}`);
    recordTaskLog({
      taskId: 'stock-backtest-exit-monitor',
      label,
      tradeDate,
      status: 'completed',
      summary,
      elapsedMs: Date.now() - Date.parse(startedAt),
      startedAt,
    });
  } catch (error) {
    lastStockBacktestNewsExitRunMs = 0;
    const message = error instanceof Error ? error.message : String(error);
    logError(`${label} 失败：${message}`);
    recordTaskLog({
      taskId: 'stock-backtest-exit-monitor',
      label,
      tradeDate,
      status: 'failed',
      reason: message,
      elapsedMs: Date.now() - Date.parse(startedAt),
      startedAt,
    });
    await notifyDailyTaskFailure(label, message);
  }
}

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
  const startedAt = new Date().toISOString();

  try {
    const result = await runStockIntradayScan({
      tradeDate,
      marketOpen: true,
    });
    if (result.skipped) {
      logInfo(`${label} 跳过：${result.reason ?? '非执行窗口'}`);
      recordTaskLog({
        taskId: 'stock-intraday-monitor',
        label,
        tradeDate,
        status: 'skipped',
        reason: result.reason ?? '非执行窗口',
        startedAt,
      });
      return;
    }

    const pushed = await notifyStockIntradayCandidates({
      tradeDate,
      candidates: result.candidates,
    });

    const summary = `扫描 ${result.scanned} 只，达标 ${result.candidates.length} 只${pushed > 0 ? `，飞书推送 ${pushed} 只` : ''}`;
    logInfo(`${label} 完成：${summary}`);
    recordTaskLog({
      taskId: 'stock-intraday-monitor',
      label,
      tradeDate,
      status: 'completed',
      summary,
      elapsedMs: Date.now() - Date.parse(startedAt),
      startedAt,
    });
  } catch (error) {
    lastStockIntradayRunMs = 0;
    const message = error instanceof Error ? error.message : String(error);
    logError(`${label} 失败：${message}`);
    recordTaskLog({
      taskId: 'stock-intraday-monitor',
      label,
      tradeDate,
      status: 'failed',
      reason: message,
      elapsedMs: Date.now() - Date.parse(startedAt),
      startedAt,
    });
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
  const tradeDate = formatTradeDate(now);
  const label = 'ETF 模拟盘监听';
  const startedAt = new Date().toISOString();
  try {
    const results = await Promise.all([
      runEtfPaperAutoPipeline(),
      runEtfPaperAutoPipeline({ bucket: ETF_EVERGREEN_BUCKET }),
    ]);
    if (results.every((result) => result.skipped)) {
      const reason = results[0]?.reason ?? '非执行窗口';
      logInfo(`${label} 跳过：${reason}`);
      recordTaskLog({
        taskId: 'etf-paper-monitor',
        label,
        tradeDate,
        status: 'skipped',
        reason,
        startedAt,
      });
      return;
    }
    await Promise.all(results.map((result) => notifyEtfPaperMonitor(result)));
    const summaries = results.map((result) => {
      const bucketLabel = result.bucket === ETF_EVERGREEN_BUCKET ? '长青一号' : 'ETF 仓';
      const parts: string[] = [];
      if (result.isRebalanceDay) parts.push('调仓日');
      if (result.buys?.length) parts.push(`买入 ${result.buys.length} 笔`);
      if (result.sells?.length) parts.push(`卖出 ${result.sells.length} 笔`);
      if (result.stopLosses?.length) parts.push(`止损 ${result.stopLosses.length} 笔`);
      if (result.error) parts.push(`失败 ${result.error}`);
      if (result.reason) parts.push(result.reason);
      return `${bucketLabel}：${appendNextRebalanceDateSummary(
        parts.length > 0 ? parts.join(' · ') : '无信号',
        result.nextRebalanceDate,
      )}`;
    });
    const summary = summaries.join('；');
    logInfo(`${label} 完成：${summary}`);
    recordTaskLog({
      taskId: 'etf-paper-monitor',
      label,
      tradeDate,
      status: 'completed',
      summary,
      elapsedMs: Date.now() - Date.parse(startedAt),
      startedAt,
    });
  } catch (error) {
    lastEtfPaperRunMs = 0;
    const message = error instanceof Error ? error.message : String(error);
    logError(`${label} 失败：${message}`);
    recordTaskLog({
      taskId: 'etf-paper-monitor',
      label,
      tradeDate,
      status: 'failed',
      reason: message,
      elapsedMs: Date.now() - Date.parse(startedAt),
      startedAt,
    });
    await notifyDailyTaskFailure('ETF 模拟盘监听', message);
  }
}

async function runEtfTPlusPaperMonitor(now = getBeijingNow()) {
  if (!isScheduledTaskEnabled('etf-t-plus-paper')) return;
  if (!isTradingSession(now)) return;

  const intervalMs = getEtfPaperMonitorIntervalMs();
  const nowMs = now.getTime();
  if (lastEtfTPlusRunMs > 0 && nowMs - lastEtfTPlusRunMs < intervalMs) return;

  lastEtfTPlusRunMs = nowMs;
  const tradeDate = formatTradeDate(now);
  const label = 'ETF 正T仓监听';
  const startedAt = new Date().toISOString();
  try {
    const result = await runEtfTPlusPaperPipeline();
    if (result.skipped) {
      logInfo(`${label} 跳过：${result.reason ?? '非执行窗口'}`);
      recordTaskLog({
        taskId: 'etf-t-plus-paper',
        label,
        tradeDate,
        status: 'skipped',
        reason: result.reason ?? '非执行窗口',
        startedAt,
      });
      return;
    }

    await notifyEtfPaperMonitor(result);
    const count = result.tPlusTrades?.length ?? 0;
    const entryCount = result.tPlusEntries?.length ?? 0;
    const summary = appendNextTradeDateSummary(
      count > 0
        ? `正T ${count} 笔 · ${result.tPlusTrades
            ?.map((trade) => `${trade.name}+${trade.profit.toFixed(2)}`)
            .join('、')}`
        : entryCount > 0
          ? `正T买入待卖 ${entryCount} 笔 · ${result.tPlusEntries
              ?.map((trade) => `${trade.name}@${trade.buyPrice.toFixed(3)}`)
              .join('、')}`
          : result.reason ?? '无正T机会',
      result.nextTradeDate ?? getNextTradeDateLabel(now),
    );
    logInfo(`${label} 完成：${summary}`);
    recordTaskLog({
      taskId: 'etf-t-plus-paper',
      label,
      tradeDate,
      status: 'completed',
      summary,
      elapsedMs: Date.now() - Date.parse(startedAt),
      startedAt,
    });
  } catch (error) {
    lastEtfTPlusRunMs = 0;
    const message = error instanceof Error ? error.message : String(error);
    logError(`${label} 失败：${message}`);
    recordTaskLog({
      taskId: 'etf-t-plus-paper',
      label,
      tradeDate,
      status: 'failed',
      reason: message,
      elapsedMs: Date.now() - Date.parse(startedAt),
      startedAt,
    });
    await notifyDailyTaskFailure(label, message);
  }
}

async function runDueTasks(
  now = getBeijingNow(),
  options?: { catchUpFixedTasks?: boolean },
) {
  const tradeDate = formatTradeDate(now);
  const isTradingDay = isMarketTradingDay(now);
  const dueCheck = createDailyTaskDueCheck({
    now,
    tradeDate,
    isTradingDay,
    previous: lastDailyTaskDueCursor,
  });
  lastDailyTaskDueCursor = dueCheck.cursor;
  const fixedTaskDueWindow: DailyTaskDueWindow | null =
    options?.catchUpFixedTasks && isTradingDay
      ? {
          tradeDate,
          afterMinuteOfDay: -1,
          throughMinuteOfDay: getMinuteOfDay(now),
        }
      : dueCheck.window;

  await runEtfPaperMonitor(now);
  await runEtfTPlusPaperMonitor(now);
  await tickStockBacktestPaperExitMonitor(now);
  await runStockIntradayMonitor(now);

  for (const task of DAILY_TASKS) {
    const key = taskKey(task.id, tradeDate);
    if (
      completedKeys.has(key) ||
      !isDailyTaskDueInWindow(task, fixedTaskDueWindow)
    ) {
      continue;
    }

    if (!isScheduledTaskEnabled(task.id)) {
      completedKeys.add(key);
      logInfo(`${task.label} 已关闭，跳过`);
      recordTaskLog({
        taskId: task.id,
        label: task.label,
        tradeDate,
        status: 'disabled',
        reason: '任务已在设置中关闭',
      });
      continue;
    }

    completedKeys.add(key);
    const startedAt = new Date().toISOString();
    const runId = `${task.id}:${tradeDate}:${startedAt}`;
    recordTaskLog({
      runId,
      taskId: task.id,
      label: task.label,
      tradeDate,
      status: 'running',
      summary: '任务已开始',
      startedAt,
    });
    try {
      const result = await runTaskWithTimeout(task, task.run);
      if (result.skipped) {
        logInfo(`${task.label} 跳过：${result.reason ?? '非执行窗口'}`);
        recordTaskLog({
          runId,
          taskId: task.id,
          label: task.label,
          tradeDate,
          status: 'skipped',
          reason: result.reason ?? '非执行窗口',
          summary: result.summary,
          elapsedMs: Date.now() - Date.parse(startedAt),
          startedAt,
        });
      } else {
        logInfo(`${task.label} 完成${result.summary ? `：${result.summary}` : ''}`);
        recordTaskLog({
          runId,
          taskId: task.id,
          label: task.label,
          tradeDate,
          status: 'completed',
          summary: result.summary,
          elapsedMs: Date.now() - Date.parse(startedAt),
          startedAt,
        });
      }
    } catch (error) {
      if (!isTimeoutError(error)) completedKeys.delete(key);
      const message = error instanceof Error ? error.message : String(error);
      logError(`${task.label} 失败：${message}`);
      recordTaskLog({
        runId,
        taskId: task.id,
        label: task.label,
        tradeDate,
        status: 'failed',
        reason: message,
        elapsedMs: Date.now() - Date.parse(startedAt),
        startedAt,
      });
      await notifyDailyTaskFailure(task.label, message);
    }
  }
}

async function runDueTasksTick(
  now = getBeijingNow(),
  options?: { catchUpFixedTasks?: boolean },
) {
  if (dueTasksRunning) {
    dueTasksRerunRequested = true;
    return;
  }

  dueTasksRunning = true;
  try {
    await runDueTasks(now, options);
  } finally {
    dueTasksRunning = false;
    if (dueTasksRerunRequested) {
      dueTasksRerunRequested = false;
      void runDueTasksTick();
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
    `08:30 盘前智能选股通知`,
    `09:25 智能选股（早盘）`,
    `11:35 智能选股（午间）`,
    `12:50 智能选股（午后开盘前）`,
    `14:35 智能选股（尾盘前）`,
    `09:35 ETF 早盘异动雷达`,
    `10:00 ETF 承接确认`,
    `14:45 ETF 尾盘推荐`,
    `交易时段每 ${etfIntervalMin} 分钟 ETF 模拟盘监听`,
    `交易时段每 ${etfIntervalMin} 分钟 ETF 正T仓监听`,
    `交易时段每 ${stockIntervalMin} 分钟 股票实时信号扫描`,
    `15:05 股票模拟盘选股`,
    `08:00 行情数据提醒 / 回测策略仓买入 / 回测+新闻仓买入`,
    `交易时段 回测策略分仓出场监控（策略仓+新闻仓）`,
    `15:30 ETF 日线更新`,
    `15:35 跟踪池快照`,
    `15:45 ETF 观察快照`,
    `17:00 股票日线手动更新提醒`,
    `17:20 工作总结与 Wiki 日报`,
  ].join(' · ');

  logInfo(`已启动本机定时任务（北京时间）：${schedule}`);
  if (isFeishuNotifyEnabled()) {
    logInfo('飞书推送已启用');
  }

  void runDueTasksTick();
  timer = setInterval(() => void runDueTasksTick(), 60_000);
  timer.unref?.();
}

export function resetDailyTasksForTests() {
  completedKeys.clear();
  dueTasksRunning = false;
  dueTasksRerunRequested = false;
  lastEtfPaperRunMs = 0;
  lastEtfTPlusRunMs = 0;
  lastStockIntradayRunMs = 0;
  lastStockBacktestNewsExitRunMs = 0;
  lastDailyTaskDueCursor = null;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  started = false;
}

/** 供 CLI / 测试直接触发 */
export async function runDailyTasksNow() {
  completedKeys.clear();
  dueTasksRunning = false;
  dueTasksRerunRequested = false;
  lastEtfPaperRunMs = 0;
  lastEtfTPlusRunMs = 0;
  lastStockIntradayRunMs = 0;
  lastDailyTaskDueCursor = null;
  await runDueTasksTick(getBeijingNow(), { catchUpFixedTasks: true });
}

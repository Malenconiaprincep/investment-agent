import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../../mastra/config/paths.js';
import { ETF_POOL_19 } from '../etf/pool.js';
import { listEtfTailPickRuns } from '../etf/store.js';
import type { EtfTailPickCandidate } from '../etf/rules.js';
import {
  getLocalEtfDailyCsvPath,
  parseLocalDailyCsv,
  readLocalDailyCsvLatestTradeDate,
} from '../market/local-csv/etf-daily.js';
import { getDailyQuote } from '../market/services.js';
import { readRecentScheduledTaskLogs } from '../schedulers/scheduled-task-log.js';
import {
  getPaperAccountSummary,
  listEquitySnapshots,
  listPaperTrades,
  type PaperTrade,
} from './store.js';
import { formatTradeDate, getBeijingNow } from './trading-calendar.js';

export type EtfObservationStatus = 'pass' | 'warn' | 'fail' | 'pending';

export type EtfObservationCheck = {
  id: 'data' | 'autoTrade' | 'drawdown' | 'behavior' | 'roughMarket';
  label: string;
  status: EtfObservationStatus;
  score: number;
  message: string;
  details: string[];
  metrics?: Record<string, number | string | null>;
};

export type EtfObservationSnapshot = {
  id: string;
  tradeDate: string;
  generatedAt: string;
  score: number;
  overallStatus: EtfObservationStatus;
  checks: EtfObservationCheck[];
  newRuleExecution: EtfNewRuleExecutionObservation;
  metrics: {
    returnPct: number;
    totalValue: number;
    maxDrawdownPct: number | null;
    downDays: number;
    observationDays: number;
  };
};

export type EtfNewRuleRecommendationObservation = {
  symbol: string;
  name: string;
  status: EtfTailPickCandidate['status'];
  signalPrice: number;
  buyZoneLow: number;
  buyZoneHigh: number;
  closePrice: number | null;
  signalToClosePct: number | null;
  note: string;
};

export type EtfNewRuleTradeObservation = {
  symbol: string;
  name: string;
  side: PaperTrade['side'];
  shares: number;
  tradePrice: number;
  closePrice: number | null;
  tradeToClosePct: number | null;
  note: string | null;
};

export type EtfNewRuleExecutionObservation = {
  tradeDate: string;
  effectiveDate: string;
  status: EtfObservationStatus;
  message: string;
  details: string[];
  recommendations: EtfNewRuleRecommendationObservation[];
  trades: EtfNewRuleTradeObservation[];
  metrics: {
    recommendationCount: number;
    tradeCount: number;
    maxSignalToCloseAbsPct: number | null;
    maxTradeToCloseAbsPct: number | null;
  };
};

export type EtfObservationReport = {
  generatedAt: string;
  observationStartDate: string | null;
  targetEndDate: string | null;
  elapsedDays: number;
  remainingDays: number | null;
  loggedDays: number;
  latest: EtfObservationSnapshot;
  history: EtfObservationSnapshot[];
};

const OBSERVATION_LOG_PATH = path.join(DATA_DIR, 'etf-observation-log.json');
const OBSERVATION_DAYS = 56;
const A_SHARE_NEW_TRADING_RULE_DATE = '2026-07-06';
const DATA_JUMP_WARN_PCT = 35;
const DRAWDOWN_WARN_PCT = -8;
const DRAWDOWN_FAIL_PCT = -12;

function toDateKey(value: string): string {
  const key = value.trim().replace(/-/g, '').slice(0, 8);
  if (!/^\d{8}$/.test(key)) return value.trim();
  return `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
}

function compactDateKey(value: string): string {
  return value.replace(/-/g, '').slice(0, 8);
}

function addDays(dateKey: string, days: number): string {
  const date = new Date(`${toDateKey(dateKey)}T00:00:00+08:00`);
  date.setDate(date.getDate() + days);
  return formatTradeDate(date);
}

function dayDiff(fromDate: string | null, toDate: string): number {
  if (!fromDate) return 0;
  const from = Date.parse(`${toDateKey(fromDate)}T00:00:00+08:00`);
  const to = Date.parse(`${toDateKey(toDate)}T00:00:00+08:00`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, Math.floor((to - from) / 86_400_000) + 1);
}

function previousWeekday(date: Date): Date {
  const d = new Date(date);
  do {
    d.setDate(d.getDate() - 1);
  } while (d.getDay() === 0 || d.getDay() === 6);
  return d;
}

function resolveExpectedDailyDate(now = getBeijingNow()): string {
  if (now.getDay() === 0 || now.getDay() === 6) {
    return formatTradeDate(previousWeekday(now));
  }
  const afterCloseUpdate = now.getHours() > 16 || (now.getHours() === 16 && now.getMinutes() >= 0);
  return afterCloseUpdate ? formatTradeDate(now) : formatTradeDate(previousWeekday(now));
}

function statusScore(status: EtfObservationStatus): number {
  if (status === 'pass') return 100;
  if (status === 'warn') return 70;
  if (status === 'pending') return 55;
  return 20;
}

function resolveOverallStatus(checks: EtfObservationCheck[]): EtfObservationStatus {
  if (checks.some((check) => check.status === 'fail')) return 'fail';
  if (checks.some((check) => check.status === 'warn')) return 'warn';
  if (checks.some((check) => check.status === 'pending')) return 'pending';
  return 'pass';
}

function calcScore(checks: EtfObservationCheck[]): number {
  if (checks.length === 0) return 0;
  return Math.round(
    checks.reduce((sum, check) => sum + check.score, 0) / checks.length,
  );
}

function readObservationHistory(): EtfObservationSnapshot[] {
  if (!existsSync(OBSERVATION_LOG_PATH)) return [];
  try {
    const parsed = JSON.parse(readFileSync(OBSERVATION_LOG_PATH, 'utf-8')) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is EtfObservationSnapshot => {
        return Boolean(
          item &&
            typeof item === 'object' &&
            typeof (item as EtfObservationSnapshot).tradeDate === 'string' &&
            Array.isArray((item as EtfObservationSnapshot).checks),
        );
      })
      .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  } catch {
    return [];
  }
}

function writeObservationHistory(history: EtfObservationSnapshot[]): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(
    OBSERVATION_LOG_PATH,
    `${JSON.stringify(history, null, 2)}\n`,
    'utf-8',
  );
}

function upsertObservationSnapshot(
  snapshot: EtfObservationSnapshot,
): EtfObservationSnapshot[] {
  const cutoff = addDays(snapshot.tradeDate, -OBSERVATION_DAYS - 14);
  const history = readObservationHistory()
    .filter((item) => item.tradeDate >= cutoff && item.tradeDate !== snapshot.tradeDate);
  history.push(snapshot);
  history.sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  writeObservationHistory(history);
  return history;
}

function calcMaxDrawdown(
  points: Array<{ tradeDate: string; totalValue: number }>,
): number | null {
  if (points.length < 2) return null;
  let peak = points[0].totalValue;
  let maxDrawdown = 0;
  for (const point of points) {
    if (point.totalValue > peak) peak = point.totalValue;
    if (peak <= 0) continue;
    const drawdown = ((point.totalValue - peak) / peak) * 100;
    if (drawdown < maxDrawdown) maxDrawdown = drawdown;
  }
  return Number(maxDrawdown.toFixed(2));
}

function countDownDays(points: Array<{ totalValue: number }>): number {
  let count = 0;
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].totalValue < points[index - 1].totalValue) count += 1;
  }
  return count;
}

function roundNullablePct(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(2));
}

function calcPct(from: number | null | undefined, to: number | null | undefined): number | null {
  if (!from || !to || from <= 0 || to <= 0) return null;
  return roundNullablePct(((to - from) / from) * 100);
}

function maxAbsPct(values: Array<number | null>): number | null {
  const finite = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (finite.length === 0) return null;
  return Number(Math.max(...finite.map((value) => Math.abs(value))).toFixed(2));
}

async function loadClosePriceBySymbol(
  symbols: string[],
  tradeDate: string,
): Promise<Map<string, number | null>> {
  const tradeKey = compactDateKey(tradeDate);
  const entries = await Promise.all(
    [...new Set(symbols)].map(async (symbol) => {
      try {
        const daily = await getDailyQuote(symbol, 10);
        const bar = daily.quotes.find(
          (quote) => compactDateKey(quote.tradeDate) === tradeKey,
        );
        return [symbol, bar?.close ?? null] as const;
      } catch {
        return [symbol, null] as const;
      }
    }),
  );
  return new Map(entries);
}

async function buildNewRuleExecutionObservation(input: {
  tradeDate: string;
  trades: PaperTrade[];
}): Promise<EtfNewRuleExecutionObservation> {
  const details = [
    '记录 14:45 ETF 尾盘推荐价、当天收盘价、模拟盘成交价之间的偏离，用来判断是否需要改成 15:05-15:30 盘后固定价格执行。',
  ];

  if (compactDateKey(input.tradeDate) < compactDateKey(A_SHARE_NEW_TRADING_RULE_DATE)) {
    return {
      tradeDate: input.tradeDate,
      effectiveDate: A_SHARE_NEW_TRADING_RULE_DATE,
      status: 'pending',
      message: `新规 ${A_SHARE_NEW_TRADING_RULE_DATE} 起观察，当前还未进入观察期。`,
      details,
      recommendations: [],
      trades: [],
      metrics: {
        recommendationCount: 0,
        tradeCount: 0,
        maxSignalToCloseAbsPct: null,
        maxTradeToCloseAbsPct: null,
      },
    };
  }

  const tailRun = (await listEtfTailPickRuns(20)).find(
    (run) => toDateKey(run.tradeDate) === input.tradeDate,
  );
  const candidates = (tailRun?.candidates ?? [])
    .filter((candidate) => candidate.status === 'passed' || candidate.status === 'near_pass')
    .slice(0, 8);
  const todayTrades = input.trades
    .filter((trade) => toDateKey(trade.tradeDate) === input.tradeDate)
    .slice(0, 20);
  const closeBySymbol = await loadClosePriceBySymbol(
    [
      ...candidates.map((candidate) => candidate.symbol),
      ...todayTrades.map((trade) => trade.symbol),
    ],
    input.tradeDate,
  );

  const recommendations = candidates.map((candidate) => {
    const closePrice = closeBySymbol.get(candidate.symbol) ?? null;
    const signalToClosePct = calcPct(candidate.price, closePrice);
    return {
      symbol: candidate.symbol,
      name: candidate.name,
      status: candidate.status,
      signalPrice: candidate.price,
      buyZoneLow: candidate.operationPlan.buyZoneLow,
      buyZoneHigh: candidate.operationPlan.buyZoneHigh,
      closePrice,
      signalToClosePct,
      note:
        closePrice == null
          ? '尚未拿到当天收盘价，等待日线更新。'
          : Math.abs(signalToClosePct ?? 0) > 1
            ? '尾盘信号价与收盘价偏离超过 1%，需要观察集合竞价滑点。'
            : '尾盘信号价与收盘价偏离可接受。',
    };
  });

  const trades = todayTrades.map((trade) => {
    const closePrice = closeBySymbol.get(trade.symbol) ?? null;
    return {
      symbol: trade.symbol,
      name: trade.name,
      side: trade.side,
      shares: trade.shares,
      tradePrice: trade.price,
      closePrice,
      tradeToClosePct: calcPct(trade.price, closePrice),
      note: trade.note,
    };
  });

  const maxSignalToCloseAbsPct = maxAbsPct(
    recommendations.map((item) => item.signalToClosePct),
  );
  const maxTradeToCloseAbsPct = maxAbsPct(trades.map((item) => item.tradeToClosePct));
  if (tailRun) {
    details.push(
      `已读取 ${tailRun.tradeDate} 尾盘推荐：通过 ${tailRun.passedCount} 个，接近通过 ${tailRun.nearPassCount} 个。`,
    );
  } else {
    details.push('当天还没有 ETF 尾盘推荐记录。');
  }
  if (todayTrades.length) {
    details.push(`当天 ETF 模拟盘成交 ${todayTrades.length} 笔。`);
  } else {
    details.push('当天暂无 ETF 模拟盘成交。');
  }

  let status: EtfObservationStatus = 'pending';
  let message = '等待尾盘推荐、收盘价和模拟成交样本沉淀。';
  const worst = Math.max(maxSignalToCloseAbsPct ?? 0, maxTradeToCloseAbsPct ?? 0);
  if (recommendations.length > 0 || trades.length > 0) {
    if (worst > 1) {
      status = 'warn';
      message = '尾盘信号/成交与收盘价偏离超过 1%，继续观察是否需要改用盘后固定价。';
    } else {
      status = 'pass';
      message = '尾盘信号/成交与收盘价偏离暂时可接受。';
    }
  }

  return {
    tradeDate: input.tradeDate,
    effectiveDate: A_SHARE_NEW_TRADING_RULE_DATE,
    status,
    message,
    details,
    recommendations,
    trades,
    metrics: {
      recommendationCount: recommendations.length,
      tradeCount: trades.length,
      maxSignalToCloseAbsPct,
      maxTradeToCloseAbsPct,
    },
  };
}

function checkEtfCsvData(input: {
  expectedDate: string;
  symbols: string[];
}): EtfObservationCheck {
  const missing: string[] = [];
  const stale: string[] = [];
  const jumps: string[] = [];
  let checked = 0;
  let latestDate: string | null = null;

  for (const symbol of input.symbols) {
    const filePath = getLocalEtfDailyCsvPath(symbol);
    if (!existsSync(filePath)) {
      missing.push(symbol);
      continue;
    }
    checked += 1;
    const latest = readLocalDailyCsvLatestTradeDate('etf', symbol);
    if (!latest) {
      missing.push(symbol);
      continue;
    }
    const latestFormatted = toDateKey(latest);
    if (!latestDate || latestFormatted > latestDate) latestDate = latestFormatted;
    if (compactDateKey(latestFormatted) < compactDateKey(input.expectedDate)) {
      stale.push(`${symbol} 最新 ${latestFormatted}`);
    }

    const bars = parseLocalDailyCsv(readFileSync(filePath, 'utf-8'), 180)
      .filter((bar) => bar.close != null && bar.close > 0)
      .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
    for (let index = 1; index < bars.length; index += 1) {
      const prev = bars[index - 1].close;
      const close = bars[index].close;
      if (!prev || !close) continue;
      const pct = ((close - prev) / prev) * 100;
      if (Math.abs(pct) >= DATA_JUMP_WARN_PCT) {
        jumps.push(
          `${symbol} ${toDateKey(bars[index].tradeDate)} ${pct.toFixed(2)}%`,
        );
      }
    }
  }

  const details: string[] = [
    `检查 ${checked}/${input.symbols.length} 个 ETF 前复权日线文件，期望最新交易日 ${input.expectedDate}。`,
  ];
  if (latestDate) details.push(`本地最新日期 ${latestDate}。`);
  if (missing.length) details.push(`缺失或空文件：${missing.slice(0, 8).join('、')}`);
  if (stale.length) details.push(`未更新：${stale.slice(0, 8).join('、')}`);
  if (jumps.length) {
    details.push(`疑似复权断点：${jumps.slice(0, 8).join('、')}`);
  }

  let status: EtfObservationStatus = 'pass';
  let message = 'ETF 前复权日线未发现明显断点，最新日期满足预期。';
  if (missing.length || jumps.length) {
    status = 'fail';
    message = 'ETF 日线存在缺失或疑似复权断点，需要先洗数据。';
  } else if (stale.length) {
    status = 'warn';
    message = '部分 ETF 日线尚未更新到预期交易日。';
  }

  return {
    id: 'data',
    label: '数据稳定',
    status,
    score: statusScore(status),
    message,
    details,
    metrics: {
      checked,
      missing: missing.length,
      stale: stale.length,
      jumps: jumps.length,
      latestDate,
      expectedDate: input.expectedDate,
    },
  };
}

async function checkAutoTradeStability(
  tradeDate: string,
): Promise<EtfObservationCheck> {
  const tradeDay = new Date(`${tradeDate}T00:00:00+08:00`).getDay();
  const isTradingWeekday = tradeDay !== 0 && tradeDay !== 6;
  const [summary, trades] = await Promise.all([
    getPaperAccountSummary('etf'),
    listPaperTrades(300, 'etf'),
  ]);
  const logs = readRecentScheduledTaskLogs({ limit: 300 }).filter(
    (log) =>
      log.taskId === 'etf-paper-monitor' || log.taskId === 'etf-daily-csv-update',
  );
  const todayLogs = logs.filter((log) => log.tradeDate === tradeDate);
  const failures = logs.filter((log) => log.status === 'failed');
  const duplicateKeys = new Map<string, number>();
  for (const trade of trades) {
    const key = [
      trade.tradeDate,
      trade.symbol,
      trade.side,
      trade.shares,
      trade.price.toFixed(4),
      trade.note ?? '',
    ].join('|');
    duplicateKeys.set(key, (duplicateKeys.get(key) ?? 0) + 1);
  }
  const duplicateCount = [...duplicateKeys.values()].filter((count) => count > 1).length;
  const missingNotes = trades.filter(
    (trade) => trade.source === 'auto' && !trade.note,
  ).length;
  const buyProtectionNotes = trades.filter((trade) =>
    trade.note?.includes('执行保护'),
  ).length;
  const cashOk = summary.account.cash >= -1;
  const valueOk =
    Math.abs(summary.totalValue - (summary.account.cash + summary.marketValue)) < 1;

  const details = [
    `ETF 仓现金 ${summary.account.cash.toFixed(2)}，持仓市值 ${summary.marketValue.toFixed(2)}，总资产 ${summary.totalValue.toFixed(2)}。`,
    `最近自动成交 ${trades.filter((trade) => trade.source === 'auto').length} 笔，执行保护备注 ${buyProtectionNotes} 笔。`,
  ];
  if (todayLogs.length) {
    details.push(
      `今日任务日志：${todayLogs
        .map((log) => `${log.label}${log.status === 'completed' ? '完成' : log.status}`)
        .join('、')}。`,
    );
  } else if (!isTradingWeekday) {
    details.push('今日非交易日，不要求 ETF 监听或日线更新任务日志。');
  } else {
    details.push('今日还没有 ETF 监听/日线更新任务日志。');
  }
  if (failures.length) {
    details.push(
      `近日日志失败：${failures
        .slice(0, 5)
        .map((log) => `${log.tradeDate} ${log.label}: ${log.reason ?? '失败'}`)
        .join('；')}`,
    );
  }
  if (duplicateCount > 0) details.push(`疑似重复成交组合 ${duplicateCount} 组。`);
  if (missingNotes > 0) details.push(`自动成交缺少原因备注 ${missingNotes} 笔。`);
  if (!cashOk || !valueOk) details.push('资金或净值计算存在异常。');

  let status: EtfObservationStatus = 'pass';
  let message = '自动交易链路未发现重复成交、资金异常或任务失败。';
  if (!cashOk || !valueOk || duplicateCount > 0) {
    status = 'fail';
    message = '自动交易存在资金、净值或重复成交异常。';
  } else if (failures.length > 0 || missingNotes > 0 || (todayLogs.length === 0 && isTradingWeekday)) {
    status = todayLogs.length === 0 && isTradingWeekday ? 'pending' : 'warn';
    message =
      todayLogs.length === 0 && isTradingWeekday
        ? '今日还未沉淀 ETF 自动任务日志，等待下一轮自动更新。'
        : '自动交易基本正常，但存在任务失败或成交备注不完整。';
  }

  return {
    id: 'autoTrade',
    label: '自动交易稳定',
    status,
    score: statusScore(status),
    message,
    details,
    metrics: {
      recentTrades: trades.length,
      duplicateCount,
      missingNotes,
      buyProtectionNotes,
      failedTaskLogs: failures.length,
      cash: summary.account.cash,
      totalValue: summary.totalValue,
    },
  };
}

function checkDrawdown(points: Array<{ tradeDate: string; totalValue: number }>): EtfObservationCheck {
  const maxDrawdownPct = calcMaxDrawdown(points);
  const details = [
    points.length > 0
      ? `已记录 ${points.length} 个 ETF 净值点，区间 ${points[0].tradeDate} 至 ${points.at(-1)?.tradeDate ?? points[0].tradeDate}。`
      : '暂无 ETF 净值快照。',
  ];
  if (maxDrawdownPct != null) details.push(`当前观察期最大回撤 ${maxDrawdownPct.toFixed(2)}%。`);

  let status: EtfObservationStatus = 'pending';
  let message = '净值样本还太少，先继续观察。';
  if (maxDrawdownPct != null) {
    if (maxDrawdownPct < DRAWDOWN_FAIL_PCT) {
      status = 'fail';
      message = 'ETF 仓最大回撤已超过 -12%，实盘体验风险偏高。';
    } else if (maxDrawdownPct < DRAWDOWN_WARN_PCT) {
      status = 'warn';
      message = 'ETF 仓最大回撤进入 -8% 到 -12% 观察区。';
    } else {
      status = 'pass';
      message = 'ETF 仓最大回撤仍在 -8% 以内。';
    }
  }

  return {
    id: 'drawdown',
    label: '回撤可接受',
    status,
    score: statusScore(status),
    message,
    details,
    metrics: { maxDrawdownPct, points: points.length },
  };
}

async function checkStrategyBehavior(): Promise<EtfObservationCheck> {
  const trades = await listPaperTrades(120, 'etf');
  const autoTrades = trades.filter((trade) => trade.source === 'auto');
  const missingReason = autoTrades.filter((trade) => !trade.note?.trim());
  const sellReasons = autoTrades.filter((trade) => trade.side === 'sell').map((trade) => trade.note ?? '');
  const buyReasons = autoTrades.filter((trade) => trade.side === 'buy').map((trade) => trade.note ?? '');
  const hasStopLoss = sellReasons.some((note) => note.includes('止损'));
  const hasRebalance = [...sellReasons, ...buyReasons].some((note) =>
    note.includes('调仓'),
  );

  const details = [
    `最近 ETF 自动买入 ${buyReasons.length} 笔，自动卖出 ${sellReasons.length} 笔。`,
  ];
  if (buyReasons[0]) details.push(`最近买入理由：${buyReasons[0]}`);
  if (sellReasons[0]) details.push(`最近卖出理由：${sellReasons[0]}`);
  if (hasStopLoss) details.push('观察期内已经出现止损执行记录。');
  if (hasRebalance) details.push('观察期内已经出现调仓执行记录。');
  if (missingReason.length) details.push(`缺少解释的自动成交 ${missingReason.length} 笔。`);

  let status: EtfObservationStatus = 'pass';
  let message = 'ETF 买卖理由可追溯，行为与动量轮动规则一致。';
  if (autoTrades.length === 0) {
    status = 'pending';
    message = '还没有 ETF 自动成交，等待后续调仓样本。';
  } else if (missingReason.length > 0) {
    status = 'warn';
    message = '存在自动成交缺少理由，后续复盘会不够清楚。';
  }

  return {
    id: 'behavior',
    label: '策略行为符合预期',
    status,
    score: statusScore(status),
    message,
    details,
    metrics: {
      autoTrades: autoTrades.length,
      buyTrades: buyReasons.length,
      sellTrades: sellReasons.length,
      missingReason: missingReason.length,
    },
  };
}

function checkRoughMarket(points: Array<{ totalValue: number }>): EtfObservationCheck {
  const maxDrawdownPct = calcMaxDrawdown(
    points.map((point, index) => ({
      tradeDate: String(index),
      totalValue: point.totalValue,
    })),
  );
  const downDays = countDownDays(points);
  const details = [
    `观察期下跌净值日 ${downDays} 天。`,
    maxDrawdownPct != null
      ? `观察期最大回撤 ${maxDrawdownPct.toFixed(2)}%。`
      : '净值样本不足，暂时无法确认是否经历不顺行情。',
  ];

  let status: EtfObservationStatus = 'pending';
  let message = '还没有足够的不顺行情样本，继续观察震荡/回撤时的处理。';
  if ((maxDrawdownPct != null && maxDrawdownPct <= -3) || downDays >= 3) {
    status = 'pass';
    message = '已经经历过一定回撤或多个下跌日，可观察系统是否按规则处理。';
  } else if (points.length >= 10) {
    status = 'warn';
    message = '观察期样本不少，但尚未经历明显回撤，结论要打折。';
  }

  return {
    id: 'roughMarket',
    label: '至少经历一次不顺行情',
    status,
    score: statusScore(status),
    message,
    details,
    metrics: { downDays, maxDrawdownPct },
  };
}

function resolveObservationStartDate(input: {
  snapshots: Array<{ tradeDate: string }>;
  trades: Array<{ tradeDate: string }>;
}): string | null {
  const envStart = process.env.ETF_OBSERVATION_START_DATE?.trim();
  if (envStart) return toDateKey(envStart);
  const dates = [
    ...input.snapshots.map((snapshot) => snapshot.tradeDate),
    ...input.trades.map((trade) => trade.tradeDate),
  ].filter(Boolean);
  if (dates.length === 0) return null;
  return dates.map(toDateKey).sort()[0];
}

export async function buildEtfObservationReport(options?: {
  persist?: boolean;
}): Promise<EtfObservationReport> {
  const now = getBeijingNow();
  const tradeDate = formatTradeDate(now);
  const expectedDate = resolveExpectedDailyDate(now);
  const [summary, snapshots, trades] = await Promise.all([
    getPaperAccountSummary('etf'),
    listEquitySnapshots(120, 'etf'),
    listPaperTrades(300, 'etf'),
  ]);
  const currentSnapshot = snapshots.find((item) => item.tradeDate === tradeDate);
  const equityPoints = [
    ...snapshots.map((snapshot) => ({
      tradeDate: snapshot.tradeDate,
      totalValue: snapshot.totalValue,
    })),
    ...(currentSnapshot
      ? []
      : [{ tradeDate, totalValue: summary.totalValue }]),
  ]
    .reduce<Array<{ tradeDate: string; totalValue: number }>>((acc, point) => {
      const index = acc.findIndex((item) => item.tradeDate === point.tradeDate);
      if (index >= 0) acc[index] = point;
      else acc.push(point);
      return acc;
    }, [])
    .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  const startDate = resolveObservationStartDate({ snapshots, trades });
  const targetEndDate = startDate ? addDays(startDate, OBSERVATION_DAYS - 1) : null;
  const elapsedDays = dayDiff(startDate, tradeDate);
  const remainingDays =
    targetEndDate == null ? null : Math.max(0, dayDiff(tradeDate, targetEndDate) - 1);
  const currentPositions = summary.positions.map((pos) => pos.symbol);
  const symbols = [
    ...new Set([
      ...ETF_POOL_19.map((item) => item.symbol),
      ...currentPositions,
      '510300',
      '512480',
    ]),
  ].sort((a, b) => a.localeCompare(b));

  const checks = [
    checkEtfCsvData({ expectedDate, symbols }),
    await checkAutoTradeStability(tradeDate),
    checkDrawdown(equityPoints),
    await checkStrategyBehavior(),
    checkRoughMarket(equityPoints),
  ];
  const newRuleExecution = await buildNewRuleExecutionObservation({
    tradeDate,
    trades,
  });
  const score = calcScore(checks);
  const snapshot: EtfObservationSnapshot = {
    id: `${tradeDate}-${Date.now()}`,
    tradeDate,
    generatedAt: new Date().toISOString(),
    score,
    overallStatus: resolveOverallStatus(checks),
    checks,
    newRuleExecution,
    metrics: {
      returnPct: summary.returnPct,
      totalValue: summary.totalValue,
      maxDrawdownPct: calcMaxDrawdown(equityPoints),
      downDays: countDownDays(equityPoints),
      observationDays: elapsedDays,
    },
  };

  const history = options?.persist
    ? upsertObservationSnapshot(snapshot)
    : readObservationHistory();
  const mergedHistory = history.some((item) => item.tradeDate === snapshot.tradeDate)
    ? history
    : [...history, snapshot].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));

  return {
    generatedAt: snapshot.generatedAt,
    observationStartDate: startDate,
    targetEndDate,
    elapsedDays,
    remainingDays,
    loggedDays: mergedHistory.length,
    latest: snapshot,
    history: mergedHistory.slice(-OBSERVATION_DAYS),
  };
}

export function getEtfObservationLogPath(): string {
  return OBSERVATION_LOG_PATH;
}

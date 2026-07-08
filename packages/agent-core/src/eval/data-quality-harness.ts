import {
  fetchLocalEtfDailyKlines,
  fetchLocalStockDailyKlines,
  listLocalEtfDailyCsvSymbols,
  listLocalStockDailyCsvSymbols,
  type LocalDailyKlineBar,
} from '../data/market/local-csv/etf-daily.js';
import {
  checkMarketDataFreshness,
  type MarketDataFreshness,
} from '../data/paper/market-data-freshness.js';
import {
  formatTradeDateKey,
  normalizeTradeDateKey,
} from '../data/backtest/date-range.js';

export type DataQualityAssetType = 'etf' | 'stock';
export type HarnessCheckStatus = 'pass' | 'warn' | 'fail';

export type DataQualityHarnessCheck = {
  id: string;
  label: string;
  status: HarnessCheckStatus;
  detail: string;
  expected?: string;
  actual?: string;
  evidence?: Record<string, unknown>;
};

export type DataQualityHarnessSummary = {
  pass: number;
  warn: number;
  fail: number;
};

export type DataQualityHarnessReport = {
  name: 'data-quality';
  ranAt: string;
  expectedDataDate: string;
  passed: boolean;
  score: number;
  summary: DataQualityHarnessSummary;
  freshness: MarketDataFreshness;
  checks: DataQualityHarnessCheck[];
};

export type DataQualityHarnessDeps = {
  getFreshness: (now: Date) => MarketDataFreshness;
  listSymbols: (assetType: DataQualityAssetType) => string[];
  readBars: (
    assetType: DataQualityAssetType,
    symbol: string,
    days: number,
  ) => LocalDailyKlineBar[];
};

export type DataQualityHarnessOptions = {
  now?: Date;
  lookbackDays?: number;
  etfSymbols?: string[];
  stockSymbols?: string[];
  maxGapWeekdays?: number;
  maxEtfMovePct?: number;
  maxStockMovePct?: number;
  deps?: DataQualityHarnessDeps;
};

type SymbolInput = {
  assetType: DataQualityAssetType;
  symbol: string;
  label: string;
};

const DEFAULT_ETF_SYMBOLS = ['510300'];
const DEFAULT_STOCK_SYMBOLS = ['000001'];

const defaultDeps: DataQualityHarnessDeps = {
  getFreshness: (now) => checkMarketDataFreshness(now),
  listSymbols: (assetType) =>
    assetType === 'etf'
      ? listLocalEtfDailyCsvSymbols()
      : listLocalStockDailyCsvSymbols(),
  readBars: (assetType, symbol, days) =>
    assetType === 'etf'
      ? fetchLocalEtfDailyKlines(symbol, days).quotes
      : fetchLocalStockDailyKlines(symbol, days).quotes,
};

function countSummary(checks: DataQualityHarnessCheck[]): DataQualityHarnessSummary {
  return checks.reduce<DataQualityHarnessSummary>(
    (summary, check) => ({
      ...summary,
      [check.status]: summary[check.status] + 1,
    }),
    { pass: 0, warn: 0, fail: 0 },
  );
}

function computeScore(summary: DataQualityHarnessSummary): number {
  const total = summary.pass + summary.warn + summary.fail;
  if (total === 0) return 0;
  return Number((((summary.pass * 100 + summary.warn * 65) / total)).toFixed(1));
}

function check(
  id: string,
  label: string,
  status: HarnessCheckStatus,
  detail: string,
  extra?: Omit<DataQualityHarnessCheck, 'id' | 'label' | 'status' | 'detail'>,
): DataQualityHarnessCheck {
  return { id, label, status, detail, ...extra };
}

function isFinitePositive(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function toUtcDate(key: string): Date | null {
  const normalized = normalizeTradeDateKey(key);
  if (!/^\d{8}$/.test(normalized)) return null;
  const year = Number(normalized.slice(0, 4));
  const month = Number(normalized.slice(4, 6)) - 1;
  const day = Number(normalized.slice(6, 8));
  return new Date(Date.UTC(year, month, day));
}

function countWeekdaySteps(newerKey: string, olderKey: string): number | null {
  const newer = toUtcDate(newerKey);
  const older = toUtcDate(olderKey);
  if (!newer || !older || older >= newer) return null;

  const cursor = new Date(older);
  let steps = 0;
  while (cursor < newer) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const weekday = cursor.getUTCDay();
    if (weekday >= 1 && weekday <= 5) steps += 1;
  }
  return steps;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '无';
  return formatTradeDateKey(value);
}

function latestBar(bars: LocalDailyKlineBar[]): LocalDailyKlineBar | null {
  return bars[0] ?? null;
}

function buildSymbolInputs(options: DataQualityHarnessOptions): SymbolInput[] {
  return [
    ...(options.etfSymbols ?? DEFAULT_ETF_SYMBOLS).map((symbol) => ({
      assetType: 'etf' as const,
      symbol,
      label: `ETF ${symbol}`,
    })),
    ...(options.stockSymbols ?? DEFAULT_STOCK_SYMBOLS).map((symbol) => ({
      assetType: 'stock' as const,
      symbol,
      label: `股票 ${symbol}`,
    })),
  ];
}

function inspectBars(input: {
  assetType: DataQualityAssetType;
  symbol: string;
  label: string;
  bars: LocalDailyKlineBar[];
  expectedDataDate: string;
  maxGapWeekdays: number;
  maxMovePct: number;
}): DataQualityHarnessCheck[] {
  const checks: DataQualityHarnessCheck[] = [];
  const prefix = `${input.assetType}.${input.symbol}`;
  const bars = input.bars;
  const latest = latestBar(bars);
  const expectedKey = normalizeTradeDateKey(input.expectedDataDate);
  const latestKey = latest ? normalizeTradeDateKey(latest.tradeDate) : null;

  checks.push(
    check(
      `${prefix}.rows`,
      `${input.label} 行情行数`,
      bars.length > 0 ? 'pass' : 'fail',
      bars.length > 0
        ? `读取到 ${bars.length} 根日线。`
        : '未读取到有效日线，后续策略不能使用该样本。',
      { expected: '> 0', actual: String(bars.length) },
    ),
  );

  if (!latest || !latestKey) return checks;

  checks.push(
    check(
      `${prefix}.latest-date`,
      `${input.label} 最新日期`,
      latestKey >= expectedKey ? 'pass' : 'fail',
      latestKey >= expectedKey
        ? `最新行情 ${formatDate(latestKey)} 已覆盖期望日期。`
        : `最新行情 ${formatDate(latestKey)} 早于期望日期 ${formatDate(expectedKey)}。`,
      { expected: formatDate(expectedKey), actual: formatDate(latestKey) },
    ),
  );

  const dateKeys = bars.map((bar) => normalizeTradeDateKey(bar.tradeDate));
  const duplicates = [...new Set(dateKeys.filter((date, index) => dateKeys.indexOf(date) !== index))];
  checks.push(
    check(
      `${prefix}.duplicate-dates`,
      `${input.label} 日期唯一性`,
      duplicates.length === 0 ? 'pass' : 'fail',
      duplicates.length === 0
        ? '未发现重复交易日。'
        : `发现重复交易日：${duplicates.slice(0, 5).map(formatDate).join('、')}`,
      { actual: duplicates.length === 0 ? '0' : duplicates.join(',') },
    ),
  );

  const outOfOrderPairs: string[] = [];
  for (let index = 0; index < dateKeys.length - 1; index += 1) {
    if (dateKeys[index] <= dateKeys[index + 1]) {
      outOfOrderPairs.push(`${dateKeys[index]} <= ${dateKeys[index + 1]}`);
    }
  }
  checks.push(
    check(
      `${prefix}.sort-order`,
      `${input.label} 日期排序`,
      outOfOrderPairs.length === 0 ? 'pass' : 'fail',
      outOfOrderPairs.length === 0
        ? '日线按最新到最旧排序。'
        : `日期不是严格倒序：${outOfOrderPairs.slice(0, 3).join('；')}`,
    ),
  );

  const invalidOhlc = bars
    .filter((bar) => {
      if (
        !isFinitePositive(bar.open) ||
        !isFinitePositive(bar.high) ||
        !isFinitePositive(bar.low) ||
        !isFinitePositive(bar.close)
      ) {
        return true;
      }
      return (
        bar.high < Math.max(bar.open, bar.close, bar.low) ||
        bar.low > Math.min(bar.open, bar.close, bar.high)
      );
    })
    .slice(0, 5);
  checks.push(
    check(
      `${prefix}.ohlc`,
      `${input.label} OHLC 合法性`,
      invalidOhlc.length === 0 ? 'pass' : 'fail',
      invalidOhlc.length === 0
        ? '开高低收均为正数，且 high/low 包含 open/close。'
        : `发现 ${invalidOhlc.length} 条 OHLC 异常样本。`,
      {
        evidence:
          invalidOhlc.length === 0
            ? undefined
            : {
                samples: invalidOhlc.map((bar) => ({
                  tradeDate: formatDate(bar.tradeDate),
                  open: bar.open,
                  high: bar.high,
                  low: bar.low,
                  close: bar.close,
                })),
              },
      },
    ),
  );

  const largeGaps: Array<{ newer: string; older: string; weekdaySteps: number }> = [];
  for (let index = 0; index < dateKeys.length - 1; index += 1) {
    const weekdaySteps = countWeekdaySteps(dateKeys[index], dateKeys[index + 1]);
    if (weekdaySteps != null && weekdaySteps > input.maxGapWeekdays) {
      largeGaps.push({
        newer: formatDate(dateKeys[index]),
        older: formatDate(dateKeys[index + 1]),
        weekdaySteps,
      });
    }
  }
  checks.push(
    check(
      `${prefix}.large-gaps`,
      `${input.label} 大间隔`,
      largeGaps.length === 0 ? 'pass' : 'warn',
      largeGaps.length === 0
        ? `近 ${bars.length} 根日线未发现超过 ${input.maxGapWeekdays} 个工作日的大间隔。`
        : `发现 ${largeGaps.length} 段大间隔，可能是停牌、缺数据或样本不连续。`,
      {
        expected: `<= ${input.maxGapWeekdays} weekdays`,
        evidence: largeGaps.length === 0 ? undefined : { samples: largeGaps.slice(0, 5) },
      },
    ),
  );

  const abnormalMoves: Array<{ tradeDate: string; movePct: number }> = [];
  for (let index = 0; index < bars.length - 1; index += 1) {
    const current = bars[index];
    const previous = bars[index + 1];
    const computedMove =
      isFinitePositive(current.close) && isFinitePositive(previous.close)
        ? ((current.close - previous.close) / previous.close) * 100
        : null;
    const move = current.pctChg ?? computedMove;
    if (move != null && Number.isFinite(move) && Math.abs(move) > input.maxMovePct) {
      abnormalMoves.push({
        tradeDate: formatDate(current.tradeDate),
        movePct: Number(move.toFixed(2)),
      });
    }
  }
  checks.push(
    check(
      `${prefix}.abnormal-moves`,
      `${input.label} 异常涨跌幅`,
      abnormalMoves.length === 0 ? 'pass' : 'warn',
      abnormalMoves.length === 0
        ? `未发现超过 ${input.maxMovePct}% 的单日异常涨跌。`
        : `发现 ${abnormalMoves.length} 条超过 ${input.maxMovePct}% 的单日涨跌，需要确认是否为复权、停牌恢复或脏数据。`,
      {
        expected: `abs(move) <= ${input.maxMovePct}%`,
        evidence: abnormalMoves.length === 0 ? undefined : { samples: abnormalMoves.slice(0, 5) },
      },
    ),
  );

  const missingTurnover = bars.filter(
    (bar) => !isFinitePositive(bar.vol) || !isFinitePositive(bar.amount),
  );
  checks.push(
    check(
      `${prefix}.turnover`,
      `${input.label} 成交量额`,
      missingTurnover.length === 0 ? 'pass' : 'warn',
      missingTurnover.length === 0
        ? '成交量与成交额字段完整。'
        : `有 ${missingTurnover.length} 根日线缺少有效成交量或成交额，部分成交活跃度规则可能失真。`,
      { actual: String(missingTurnover.length) },
    ),
  );

  return checks;
}

export function runDataQualityHarness(
  options: DataQualityHarnessOptions = {},
): DataQualityHarnessReport {
  const now = options.now ?? new Date();
  const deps = options.deps ?? defaultDeps;
  const lookbackDays = Math.max(2, Math.floor(options.lookbackDays ?? 40));
  const maxGapWeekdays = Math.max(1, Math.floor(options.maxGapWeekdays ?? 5));
  const maxEtfMovePct = Math.max(1, options.maxEtfMovePct ?? 12);
  const maxStockMovePct = Math.max(1, options.maxStockMovePct ?? 30);

  const freshness = deps.getFreshness(now);
  const expectedDataDate = freshness.expectedDataDate;
  const checks: DataQualityHarnessCheck[] = [];

  checks.push(
    check(
      'freshness.expected-date',
      '本地行情新鲜度',
      freshness.isFresh ? 'pass' : 'fail',
      freshness.isFresh
        ? `本地行情已覆盖期望日期 ${formatDate(expectedDataDate)}。`
        : (freshness.reminder ??
            `本地行情未覆盖期望日期 ${formatDate(expectedDataDate)}。`),
      {
        expected: formatDate(expectedDataDate),
        actual: formatDate(freshness.latestDataDate),
        evidence: {
          isTradingDay: freshness.isTradingDay,
          benchmarkLatestDate: formatDate(freshness.benchmarkLatestDate),
          stockSampleLatestDate: formatDate(freshness.stockSampleLatestDate),
        },
      },
    ),
  );

  const etfUniverse = deps.listSymbols('etf');
  const stockUniverse = deps.listSymbols('stock');
  const emptyUniverses = [
    etfUniverse.length === 0 ? 'ETF' : null,
    stockUniverse.length === 0 ? '股票' : null,
  ].filter((item): item is string => Boolean(item));
  checks.push(
    check(
      'csv.universe',
      '本地 CSV 样本池',
      emptyUniverses.length === 0
        ? 'pass'
        : emptyUniverses.length === 2
          ? 'fail'
          : 'warn',
      emptyUniverses.length === 0
        ? `发现 ${etfUniverse.length} 个 ETF CSV、${stockUniverse.length} 个股票 CSV。`
        : `${emptyUniverses.join('、')} CSV 样本池为空，相关策略覆盖会受限。`,
      {
        evidence: {
          etfCount: etfUniverse.length,
          stockCount: stockUniverse.length,
        },
      },
    ),
  );

  for (const symbolInput of buildSymbolInputs(options)) {
    try {
      const bars = deps.readBars(
        symbolInput.assetType,
        symbolInput.symbol,
        lookbackDays,
      );
      checks.push(
        ...inspectBars({
          ...symbolInput,
          bars,
          expectedDataDate,
          maxGapWeekdays,
          maxMovePct:
            symbolInput.assetType === 'etf' ? maxEtfMovePct : maxStockMovePct,
        }),
      );
    } catch (error) {
      checks.push(
        check(
          `${symbolInput.assetType}.${symbolInput.symbol}.read`,
          `${symbolInput.label} CSV 读取`,
          'fail',
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  }

  const summary = countSummary(checks);
  return {
    name: 'data-quality',
    ranAt: now.toISOString(),
    expectedDataDate,
    passed: summary.fail === 0,
    score: computeScore(summary),
    summary,
    freshness,
    checks,
  };
}

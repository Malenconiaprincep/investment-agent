import { runDiamondBacktest, type BacktestSymbolInput } from './diamond.js';
import type { EtfNewsFilterMode } from './etf-news.js';
import type { BacktestRunResult } from './types.js';

export type StockNewsCompareInput = {
  symbols: BacktestSymbolInput[];
  universe?: 'manual' | 'retail-stock';
  days?: number;
  startDate?: string;
  endDate?: string;
  initialCapital?: number;
  maxConcurrentPositions?: number;
  newsLookbackDays?: number;
  stopLossPct?: number;
  takeProfitPct?: number;
};

export type StockNewsCompareRow = {
  key: EtfNewsFilterMode;
  label: string;
  runId?: string;
  returnPct: number | null;
  benchmarkPct: number | null;
  excessPct: number | null;
  maxDrawdownPct: number | null;
  winRatePct: number | null;
  avgReturnPct: number | null;
  tradeCount: number;
  validTradeCount: number;
  rawSignalCount: number | null;
  newsBlockedCount: number | null;
  tradesWithNewsCount: number;
  bullishTradeCount: number;
  bearishTradeCount: number;
  neutralTradeCount: number;
  portfolioSkippedCount: number | null;
  sources: string[];
  warnings: string[];
};

export type StockNewsCompareResult = {
  generatedAt: string;
  strategyName: string;
  startDate?: string;
  endDate?: string;
  variants: StockNewsCompareRow[];
  bestByExcess: StockNewsCompareRow | null;
  runs: Record<EtfNewsFilterMode, BacktestRunResult>;
  notes: string[];
};

const VARIANTS: Array<{ key: EtfNewsFilterMode; label: string }> = [
  { key: 'off', label: '原策略：不使用新闻' },
  { key: 'avoid_bearish', label: '新闻辅助：拦截明显利空' },
  { key: 'require_bullish', label: '新闻增强：要求相关新闻净分为正' },
];

function round(value: number | null | undefined, digits = 2): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function finalReturnPct(result: BacktestRunResult): number | null {
  return round(result.equityCurve?.at(-1)?.returnPct);
}

function extractNewsSources(result: BacktestRunResult): string[] {
  const note = result.notes.find((item) => item.startsWith('新闻来源：'));
  if (!note) return [];
  return note
    .replace(/^新闻来源：/, '')
    .replace(/。$/, '')
    .split('、')
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractWarnings(result: BacktestRunResult): string[] {
  return result.notes.filter((note) => {
    return (
      note.includes('未拉到') ||
      note.includes('覆盖不足') ||
      note.includes('加载失败') ||
      note.includes('已跳过') ||
      note.includes('需配置 BACKTEST_NEWS_HISTORICAL')
    );
  });
}

function toRow(
  variant: { key: EtfNewsFilterMode; label: string },
  result: BacktestRunResult,
): StockNewsCompareRow {
  const returnPct = finalReturnPct(result);
  const benchmarkPct = round(result.benchmark?.finalReturnPct);
  const newsLabels = result.trades
    .map((trade) => trade.signal.metadata?.newsLabel)
    .filter((label): label is string => typeof label === 'string');
  return {
    key: variant.key,
    label: variant.label,
    runId: result.runId,
    returnPct,
    benchmarkPct,
    excessPct:
      returnPct != null && benchmarkPct != null
        ? round(returnPct - benchmarkPct)
        : null,
    maxDrawdownPct: round(result.metrics.maxDrawdownPct),
    winRatePct: round(result.metrics.winRatePct),
    avgReturnPct: round(result.metrics.avgReturnPct),
    tradeCount: result.metrics.tradeCount,
    validTradeCount: result.metrics.validTradeCount,
    rawSignalCount:
      typeof result.config?.rawSignalCount === 'number'
        ? result.config.rawSignalCount
        : null,
    newsBlockedCount:
      typeof result.config?.newsBlockedCount === 'number'
        ? result.config.newsBlockedCount
        : null,
    tradesWithNewsCount: newsLabels.filter((label) => label !== '无相关').length,
    bullishTradeCount: newsLabels.filter((label) => label === '利好').length,
    bearishTradeCount: newsLabels.filter((label) => label === '利空').length,
    neutralTradeCount: newsLabels.filter((label) => label === '中性').length,
    portfolioSkippedCount:
      typeof result.config?.portfolioSkippedCount === 'number'
        ? result.config.portfolioSkippedCount
        : null,
    sources: extractNewsSources(result),
    warnings: extractWarnings(result),
  };
}

function pickBest(rows: StockNewsCompareRow[]): StockNewsCompareRow | null {
  const ranked = rows
    .filter((row) => row.excessPct != null || row.returnPct != null)
    .sort((a, b) => {
      const aValue = a.excessPct ?? a.returnPct ?? -Infinity;
      const bValue = b.excessPct ?? b.returnPct ?? -Infinity;
      return bValue - aValue;
    });
  return ranked[0] ?? null;
}

export async function runStockNewsCompare(
  input: StockNewsCompareInput,
): Promise<StockNewsCompareResult> {
  const runs = {} as Record<EtfNewsFilterMode, BacktestRunResult>;
  const variants: StockNewsCompareRow[] = [];

  for (const variant of VARIANTS) {
    const result = await runDiamondBacktest({
      symbols: input.symbols,
      universe: input.universe,
      strategy: 'red-diamond-momentum',
      days: input.days,
      startDate: input.startDate,
      endDate: input.endDate,
      initialCapital: input.initialCapital,
      maxConcurrentPositions: input.maxConcurrentPositions,
      newsFilter: variant.key,
      newsLookbackDays: input.newsLookbackDays,
      stopLossPct: input.stopLossPct,
      takeProfitPct: input.takeProfitPct,
    });
    runs[variant.key] = result;
    variants.push(toRow(variant, result));
  }

  const warningCount = variants.reduce((sum, row) => sum + row.warnings.length, 0);
  return {
    generatedAt: new Date().toISOString(),
    strategyName: 'News-Enhanced Event Momentum Strategy',
    startDate: runs.off.startDate,
    endDate: runs.off.endDate,
    variants,
    bestByExcess: pickBest(variants),
    runs,
    notes: [
      '同一股票池、同一区间、同一红钻动量入场/退出规则下，对比新闻关闭、利空拦截、利好确认三种模式。',
      '新闻层只做辅助过滤，不改动原始信号和退出规则；重点观察收益、回撤、胜率、交易数和新闻拦截数。',
      warningCount > 0
        ? '注意：部分对照组提示新闻覆盖不足，历史长区间结果应优先看新闻拦截数是否真实大于 0。'
        : '新闻数据已进入对照组，可结合拦截数判断新闻辅助是否真的产生作用。',
    ],
  };
}

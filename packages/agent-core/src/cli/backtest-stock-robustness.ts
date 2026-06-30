import 'dotenv/config';

import { runDiamondBacktest } from '../data/backtest/diamond.js';
import type { BacktestRunResult } from '../data/backtest/types.js';

type StockVariant = {
  name: string;
  label: string;
  maxConcurrentPositions: number;
  stockMarketFilter: 'off' | 'avoid_bearish' | 'require_bullish';
  minBenchmarkMomentum20Pct?: number;
  defensiveBenchmarkMomentum20Pct?: number;
  stopLossPct: number;
  takeProfitPct: number;
  excludeRiskyStockNames?: boolean;
  minEntryPrice?: number;
  minAvgTurnoverAmount?: number;
};

type WindowSpec = {
  name: string;
  startDate: string;
  endDate: string;
};

type WindowResult = {
  window: string;
  startDate: string;
  endDate: string;
  variant: string;
  label: string;
  returnPct: number | null;
  benchmarkPct: number | null;
  excessPct: number | null;
  maxDrawdownPct: number | null;
  winRatePct: number | null;
  tradeCount: number;
  rawSignalCount: number | null;
  qualityBlockedCount: number | null;
  marketBlockedCount: number | null;
  portfolioSkippedCount: number | null;
};

type VariantSummary = {
  variant: string;
  label: string;
  windows: number;
  positiveWindows: number;
  positiveWindowPct: number | null;
  beatBenchmarkWindows: number;
  beatBenchmarkPct: number | null;
  avgReturnPct: number | null;
  medianReturnPct: number | null;
  avgExcessPct: number | null;
  worstReturnPct: number | null;
  worstReturnWindow: string | null;
  worstMaxDrawdownPct: number | null;
  worstDrawdownWindow: string | null;
  avgWinRatePct: number | null;
  avgTradeCount: number | null;
  totalQualityBlockedCount: number;
  totalMarketBlockedCount: number;
  score: number | null;
};

const fixedWindows: WindowSpec[] = [
  { name: '2018 单边熊市', startDate: '2018-01-02', endDate: '2018-12-28' },
  { name: '2020 疫情急跌', startDate: '2020-01-20', endDate: '2020-03-23' },
  { name: '2022 熊市', startDate: '2022-01-04', endDate: '2022-10-31' },
  { name: '2023 弱震荡', startDate: '2023-01-03', endDate: '2023-12-29' },
  { name: '2025-2026 样本外', startDate: '2025-07-01', endDate: '2026-06-24' },
];

const smokeWindows: WindowSpec[] = [
  { name: '2025-2026 样本外', startDate: '2025-07-01', endDate: '2026-06-24' },
];

const variants: StockVariant[] = [
  {
    name: 'default',
    label: '默认：强势确认 + 中期不强时沪深300动量 >= 3%',
    maxConcurrentPositions: 5,
    stockMarketFilter: 'require_bullish',
    stopLossPct: 0.08,
    takeProfitPct: 0.2,
  },
  {
    name: 'base-bullish',
    label: '旧强势确认：沪深300站上MA20且20日动量不负',
    maxConcurrentPositions: 5,
    stockMarketFilter: 'require_bullish',
    defensiveBenchmarkMomentum20Pct: 0,
    stopLossPct: 0.08,
    takeProfitPct: 0.2,
  },
  {
    name: 'no-quality',
    label: '关闭质量过滤：强势确认 + 不过滤ST/低价/成交额',
    maxConcurrentPositions: 5,
    stockMarketFilter: 'require_bullish',
    stopLossPct: 0.08,
    takeProfitPct: 0.2,
    excludeRiskyStockNames: false,
    minEntryPrice: 0,
    minAvgTurnoverAmount: 0,
  },
  {
    name: 'bmom1',
    label: '强势增强：沪深300 20日动量 >= 1%',
    maxConcurrentPositions: 5,
    stockMarketFilter: 'require_bullish',
    minBenchmarkMomentum20Pct: 1,
    stopLossPct: 0.08,
    takeProfitPct: 0.2,
  },
  {
    name: 'bmom2',
    label: '强势增强：沪深300 20日动量 >= 2%',
    maxConcurrentPositions: 5,
    stockMarketFilter: 'require_bullish',
    minBenchmarkMomentum20Pct: 2,
    stopLossPct: 0.08,
    takeProfitPct: 0.2,
  },
  {
    name: 'bmom3',
    label: '强势增强：沪深300 20日动量 >= 3%',
    maxConcurrentPositions: 5,
    stockMarketFilter: 'require_bullish',
    minBenchmarkMomentum20Pct: 3,
    stopLossPct: 0.08,
    takeProfitPct: 0.2,
  },
  {
    name: 'adaptive2',
    label: '自适应防守：中期不强时沪深300动量 >= 2%',
    maxConcurrentPositions: 5,
    stockMarketFilter: 'require_bullish',
    defensiveBenchmarkMomentum20Pct: 2,
    stopLossPct: 0.08,
    takeProfitPct: 0.2,
  },
  {
    name: 'adaptive3',
    label: '自适应防守：中期不强时沪深300动量 >= 3%',
    maxConcurrentPositions: 5,
    stockMarketFilter: 'require_bullish',
    defensiveBenchmarkMomentum20Pct: 3,
    stopLossPct: 0.08,
    takeProfitPct: 0.2,
  },
  {
    name: 'bmom2-max4',
    label: '防守增强：沪深300动量 >= 2% + 4仓',
    maxConcurrentPositions: 4,
    stockMarketFilter: 'require_bullish',
    minBenchmarkMomentum20Pct: 2,
    stopLossPct: 0.08,
    takeProfitPct: 0.2,
  },
  {
    name: 'high-quality',
    label: '高质量：强势确认 + 5元以上 + 1亿成交额',
    maxConcurrentPositions: 5,
    stockMarketFilter: 'require_bullish',
    stopLossPct: 0.08,
    takeProfitPct: 0.2,
    excludeRiskyStockNames: true,
    minEntryPrice: 5,
    minAvgTurnoverAmount: 100_000_000,
  },
  {
    name: 'mid-quality',
    label: '中高质量：强势确认 + 4元以上 + 5000万成交额',
    maxConcurrentPositions: 5,
    stockMarketFilter: 'require_bullish',
    stopLossPct: 0.08,
    takeProfitPct: 0.2,
    excludeRiskyStockNames: true,
    minEntryPrice: 4,
    minAvgTurnoverAmount: 50_000_000,
  },
  {
    name: 'legacy',
    label: '旧口径：关闭大盘过滤 + 不过滤ST/低价/成交额',
    maxConcurrentPositions: 5,
    stockMarketFilter: 'off',
    stopLossPct: 0.08,
    takeProfitPct: 0.2,
    excludeRiskyStockNames: false,
    minEntryPrice: 0,
    minAvgTurnoverAmount: 0,
  },
  {
    name: 'avoid-bear',
    label: '进攻：仅避开大盘弱熊',
    maxConcurrentPositions: 5,
    stockMarketFilter: 'avoid_bearish',
    stopLossPct: 0.08,
    takeProfitPct: 0.2,
  },
  {
    name: 'stop6',
    label: '急跌保护：弱熊过滤 + 6%止损',
    maxConcurrentPositions: 5,
    stockMarketFilter: 'avoid_bearish',
    stopLossPct: 0.06,
    takeProfitPct: 0.2,
  },
  {
    name: 'max4',
    label: '集中：弱熊过滤 + 4仓',
    maxConcurrentPositions: 4,
    stockMarketFilter: 'avoid_bearish',
    stopLossPct: 0.08,
    takeProfitPct: 0.2,
  },
];

function fmt(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(2));
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return fmt(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return fmt(sorted[middle]);
  return fmt((sorted[middle - 1] + sorted[middle]) / 2);
}

function finalReturnPct(result: BacktestRunResult): number | null {
  return fmt(result.equityCurve?.at(-1)?.returnPct);
}

function toWindowResult(
  window: WindowSpec,
  variant: StockVariant,
  result: BacktestRunResult,
): WindowResult {
  const returnPct = finalReturnPct(result);
  const benchmarkPct = fmt(result.benchmark?.finalReturnPct);
  return {
    window: window.name,
    startDate: result.startDate ?? window.startDate,
    endDate: result.endDate ?? window.endDate,
    variant: variant.name,
    label: variant.label,
    returnPct,
    benchmarkPct,
    excessPct:
      returnPct != null && benchmarkPct != null
        ? fmt(returnPct - benchmarkPct)
        : null,
    maxDrawdownPct: fmt(result.metrics.maxDrawdownPct),
    winRatePct: fmt(result.metrics.winRatePct),
    tradeCount: result.metrics.validTradeCount,
    rawSignalCount:
      typeof result.config?.rawSignalCount === 'number'
        ? result.config.rawSignalCount
        : null,
    qualityBlockedCount:
      typeof result.config?.qualityBlockedCount === 'number'
        ? result.config.qualityBlockedCount
        : null,
    marketBlockedCount:
      typeof result.config?.marketBlockedCount === 'number'
        ? result.config.marketBlockedCount
        : null,
    portfolioSkippedCount:
      typeof result.config?.portfolioSkippedCount === 'number'
        ? result.config.portfolioSkippedCount
        : null,
  };
}

function scoreSummary(input: {
  avgReturnPct: number | null;
  avgExcessPct: number | null;
  positiveWindowPct: number | null;
  beatBenchmarkPct: number | null;
  worstMaxDrawdownPct: number | null;
  avgWinRatePct: number | null;
}): number | null {
  if (
    input.avgReturnPct == null ||
    input.avgExcessPct == null ||
    input.positiveWindowPct == null ||
    input.beatBenchmarkPct == null ||
    input.worstMaxDrawdownPct == null
  ) {
    return null;
  }

  return fmt(
    input.avgReturnPct * 0.8 +
      input.avgExcessPct * 0.8 +
      input.positiveWindowPct * 0.12 +
      input.beatBenchmarkPct * 0.12 +
      (input.avgWinRatePct ?? 0) * 0.04 +
      input.worstMaxDrawdownPct * 0.7,
  );
}

function summarizeVariant(
  variant: StockVariant,
  rows: WindowResult[],
): VariantSummary {
  const returnValues = rows.flatMap((row) =>
    row.returnPct == null ? [] : [row.returnPct],
  );
  const excessValues = rows.flatMap((row) =>
    row.excessPct == null ? [] : [row.excessPct],
  );
  const drawdowns = rows.flatMap((row) =>
    row.maxDrawdownPct == null ? [] : [row.maxDrawdownPct],
  );
  const winRates = rows.flatMap((row) =>
    row.winRatePct == null ? [] : [row.winRatePct],
  );
  const tradeCounts = rows.map((row) => row.tradeCount);
  const positiveWindows = rows.filter((row) => (row.returnPct ?? -Infinity) > 0).length;
  const beatBenchmarkWindows = rows.filter((row) => (row.excessPct ?? -Infinity) > 0).length;
  const worstReturn = [...rows]
    .filter((row) => row.returnPct != null)
    .sort((a, b) => (a.returnPct as number) - (b.returnPct as number))[0];
  const worstDrawdown = [...rows]
    .filter((row) => row.maxDrawdownPct != null)
    .sort((a, b) => (a.maxDrawdownPct as number) - (b.maxDrawdownPct as number))[0];
  const positiveWindowPct =
    rows.length > 0 ? fmt((positiveWindows / rows.length) * 100) : null;
  const beatBenchmarkPct =
    rows.length > 0 ? fmt((beatBenchmarkWindows / rows.length) * 100) : null;
  const avgReturnPct = avg(returnValues);
  const avgExcessPct = avg(excessValues);
  const avgWinRatePct = avg(winRates);
  const worstMaxDrawdownPct = drawdowns.length > 0 ? fmt(Math.min(...drawdowns)) : null;

  return {
    variant: variant.name,
    label: variant.label,
    windows: rows.length,
    positiveWindows,
    positiveWindowPct,
    beatBenchmarkWindows,
    beatBenchmarkPct,
    avgReturnPct,
    medianReturnPct: median(returnValues),
    avgExcessPct,
    worstReturnPct: worstReturn?.returnPct ?? null,
    worstReturnWindow: worstReturn?.window ?? null,
    worstMaxDrawdownPct,
    worstDrawdownWindow: worstDrawdown?.window ?? null,
    avgWinRatePct,
    avgTradeCount: avg(tradeCounts),
    totalQualityBlockedCount: rows.reduce(
      (sum, row) => sum + (row.qualityBlockedCount ?? 0),
      0,
    ),
    totalMarketBlockedCount: rows.reduce(
      (sum, row) => sum + (row.marketBlockedCount ?? 0),
      0,
    ),
    score: scoreSummary({
      avgReturnPct,
      avgExcessPct,
      positiveWindowPct,
      beatBenchmarkPct,
      worstMaxDrawdownPct,
      avgWinRatePct,
    }),
  };
}

function parseArgValue(args: string[], flag: string): string | undefined {
  const arg = args.find((item) => item.startsWith(`${flag}=`));
  return arg?.split('=').slice(1).join('=').trim() || undefined;
}

function pickWindows(args: string[]): WindowSpec[] {
  const value = parseArgValue(args, '--windows') ?? 'fixed';
  if (value === 'smoke') return smokeWindows;
  if (value === 'fixed') return fixedWindows;
  const names = new Set(value.split(',').map((item) => item.trim()).filter(Boolean));
  const picked = fixedWindows.filter((window) => names.has(window.name));
  return picked.length > 0 ? picked : fixedWindows;
}

function pickVariants(args: string[]): StockVariant[] {
  const value = parseArgValue(args, '--variants');
  if (!value) return variants;
  const names = new Set(value.split(',').map((item) => item.trim()).filter(Boolean));
  const picked = variants.filter((variant) => names.has(variant.name));
  return picked.length > 0 ? picked : variants;
}

async function runWindow(
  window: WindowSpec,
  variant: StockVariant,
): Promise<WindowResult> {
  const result = await runDiamondBacktest({
    symbols: [],
    universe: 'retail-stock',
    strategy: 'red-diamond-momentum',
    startDate: window.startDate,
    endDate: window.endDate,
    initialCapital: 100_000,
    maxConcurrentPositions: variant.maxConcurrentPositions,
    stockMarketFilter: variant.stockMarketFilter,
    minBenchmarkMomentum20Pct: variant.minBenchmarkMomentum20Pct,
    defensiveBenchmarkMomentum20Pct: variant.defensiveBenchmarkMomentum20Pct,
    stopLossPct: variant.stopLossPct,
    takeProfitPct: variant.takeProfitPct,
    excludeRiskyStockNames: variant.excludeRiskyStockNames,
    minEntryPrice: variant.minEntryPrice,
    minAvgTurnoverAmount: variant.minAvgTurnoverAmount,
  });
  return toWindowResult(window, variant, result);
}

async function main() {
  const args = process.argv.slice(2);
  const selectedWindows = pickWindows(args);
  const selectedVariants = pickVariants(args);
  const details = args.includes('--details');
  const rows: WindowResult[] = [];

  for (const window of selectedWindows) {
    for (const variant of selectedVariants) {
      const row = await runWindow(window, variant);
      rows.push(row);
      if (details) process.stderr.write(`${JSON.stringify(row)}\n`);
    }
  }

  const summaries = selectedVariants
    .map((variant) =>
      summarizeVariant(
        variant,
        rows.filter((row) => row.variant === variant.name),
      ),
    )
    .sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));

  process.stdout.write(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        benchmark: '510300 沪深300ETF同期买入持有',
        windows: selectedWindows,
        summaries,
        ...(details ? { rows } : {}),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

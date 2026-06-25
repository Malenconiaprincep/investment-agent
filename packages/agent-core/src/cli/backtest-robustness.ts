import 'dotenv/config';

import { runEtfMomentumBacktest } from '../data/backtest/etf-momentum.js';
import type { BacktestRunResult } from '../data/backtest/types.js';

type Variant = {
  name: string;
  topN: number;
  momentumDays: number;
  rebalanceDays: number;
  trendMaDays: number;
  bearRegimeMaxExposure?: number;
  weakRegimeMaxExposure?: number | null;
  bullBenchmarkSlotMomentumPct?: number;
  bullBenchmarkSlotCount?: number;
  cashFallbackInWeakRegime?: boolean;
  exitOnTrendBreak?: boolean;
};

type WindowSpec = {
  name: string;
  startDate: string;
  endDate: string;
  calendarDays: number;
};

type WindowResult = {
  window: string;
  startDate: string;
  endDate: string;
  returnPct: number | null;
  benchmarkPct: number | null;
  excessPct: number | null;
  maxDrawdownPct: number | null;
  tradeCount: number;
};

type VariantSummary = {
  variant: string;
  topN: number;
  momentumDays: number;
  rebalanceDays: number;
  trendMaDays: number;
  bearRegimeMaxExposure?: number;
  weakRegimeMaxExposure?: number | null;
  bullBenchmarkSlotMomentumPct?: number;
  bullBenchmarkSlotCount?: number;
  cashFallbackInWeakRegime?: boolean;
  exitOnTrendBreak?: boolean;
  windows: number;
  positiveWindows: number;
  positiveWindowPct: number | null;
  beatBenchmarkWindows: number;
  beatBenchmarkPct: number | null;
  avgReturnPct: number | null;
  medianReturnPct: number | null;
  worstReturnPct: number | null;
  worstReturnWindow: string | null;
  avgExcessPct: number | null;
  worstMaxDrawdownPct: number | null;
  worstDrawdownWindow: string | null;
  score: number | null;
};

const variants: Variant[] = [
  {
    name: 'Default Top4/20/10/MA20 + Weak cap 70% + Bear cap 25% + Bull benchmark 8%',
    topN: 4,
    momentumDays: 20,
    rebalanceDays: 10,
    trendMaDays: 20,
    weakRegimeMaxExposure: 0.7,
  },
  {
    name: 'Default + weak cash fallback',
    topN: 4,
    momentumDays: 20,
    rebalanceDays: 10,
    trendMaDays: 20,
    weakRegimeMaxExposure: 0.7,
    cashFallbackInWeakRegime: true,
  },
  {
    name: 'Default + trend-break exit',
    topN: 4,
    momentumDays: 20,
    rebalanceDays: 10,
    trendMaDays: 20,
    weakRegimeMaxExposure: 0.7,
    exitOnTrendBreak: true,
  },
  {
    name: 'Default + weak cash fallback + trend-break exit',
    topN: 4,
    momentumDays: 20,
    rebalanceDays: 10,
    trendMaDays: 20,
    weakRegimeMaxExposure: 0.7,
    cashFallbackInWeakRegime: true,
    exitOnTrendBreak: true,
  },
  {
    name: 'Weak70 + Bear20 + Bull8',
    topN: 4,
    momentumDays: 20,
    rebalanceDays: 10,
    trendMaDays: 20,
    weakRegimeMaxExposure: 0.7,
    bearRegimeMaxExposure: 0.2,
    bullBenchmarkSlotMomentumPct: 8,
  },
  {
    name: 'Weak70 + Bear30 + Bull8',
    topN: 4,
    momentumDays: 20,
    rebalanceDays: 10,
    trendMaDays: 20,
    weakRegimeMaxExposure: 0.7,
    bearRegimeMaxExposure: 0.3,
    bullBenchmarkSlotMomentumPct: 8,
  },
  {
    name: 'Weak70 + Bear25 + Bull6',
    topN: 4,
    momentumDays: 20,
    rebalanceDays: 10,
    trendMaDays: 20,
    weakRegimeMaxExposure: 0.7,
    bearRegimeMaxExposure: 0.25,
    bullBenchmarkSlotMomentumPct: 6,
  },
  {
    name: 'Weak70 + Bear25 + Bull10',
    topN: 4,
    momentumDays: 20,
    rebalanceDays: 10,
    trendMaDays: 20,
    weakRegimeMaxExposure: 0.7,
    bearRegimeMaxExposure: 0.25,
    bullBenchmarkSlotMomentumPct: 10,
  },
  {
    name: 'Previous Top4/20/10/MA20 + Bear cap 50%',
    topN: 4,
    momentumDays: 20,
    rebalanceDays: 10,
    trendMaDays: 20,
    bearRegimeMaxExposure: 0.5,
    bullBenchmarkSlotMomentumPct: 0,
  },
  {
    name: 'Top4/20/10/MA20 + Bull benchmark 6%',
    topN: 4,
    momentumDays: 20,
    rebalanceDays: 10,
    trendMaDays: 20,
    bearRegimeMaxExposure: 0.5,
    bullBenchmarkSlotMomentumPct: 6,
  },
  {
    name: 'Top4/20/10/MA20 + Bull benchmark 8%',
    topN: 4,
    momentumDays: 20,
    rebalanceDays: 10,
    trendMaDays: 20,
    bearRegimeMaxExposure: 0.5,
    bullBenchmarkSlotMomentumPct: 8,
  },
  {
    name: 'Top4/20/10/MA20 + Bull benchmark 10%',
    topN: 4,
    momentumDays: 20,
    rebalanceDays: 10,
    trendMaDays: 20,
    bearRegimeMaxExposure: 0.5,
    bullBenchmarkSlotMomentumPct: 10,
  },
  {
    name: 'Top4/20/10/MA20 + Bear cap 35%',
    topN: 4,
    momentumDays: 20,
    rebalanceDays: 10,
    trendMaDays: 20,
    bearRegimeMaxExposure: 0.35,
    bullBenchmarkSlotMomentumPct: 0,
  },
  {
    name: 'Top4/20/10/MA20 + Bear cap 25%',
    topN: 4,
    momentumDays: 20,
    rebalanceDays: 10,
    trendMaDays: 20,
    bearRegimeMaxExposure: 0.25,
    bullBenchmarkSlotMomentumPct: 0,
  },
  {
    name: 'Top4/20/10/MA20 + Bear cap 0%',
    topN: 4,
    momentumDays: 20,
    rebalanceDays: 10,
    trendMaDays: 20,
    bearRegimeMaxExposure: 0,
    bullBenchmarkSlotMomentumPct: 0,
  },
  {
    name: 'Top4/20/10/MA20 + Bear cap 35% + Bull benchmark 8%',
    topN: 4,
    momentumDays: 20,
    rebalanceDays: 10,
    trendMaDays: 20,
    bearRegimeMaxExposure: 0.35,
    bullBenchmarkSlotMomentumPct: 8,
  },
  {
    name: 'Top4/20/10/MA20 + Bear cap 35% + Bull benchmark 10%',
    topN: 4,
    momentumDays: 20,
    rebalanceDays: 10,
    trendMaDays: 20,
    bearRegimeMaxExposure: 0.35,
    bullBenchmarkSlotMomentumPct: 10,
  },
  {
    name: 'Top4/20/10/MA20 + Bear cap 25% + Bull benchmark 10%',
    topN: 4,
    momentumDays: 20,
    rebalanceDays: 10,
    trendMaDays: 20,
    bearRegimeMaxExposure: 0.25,
    bullBenchmarkSlotMomentumPct: 10,
  },
  {
    name: 'Top4/20/10/MA20 + Bear cap 25% + Bull benchmark 8% x2',
    topN: 4,
    momentumDays: 20,
    rebalanceDays: 10,
    trendMaDays: 20,
    bearRegimeMaxExposure: 0.25,
    bullBenchmarkSlotMomentumPct: 8,
    bullBenchmarkSlotCount: 2,
  },
  {
    name: 'Top4/20/10/MA20 + Bear cap 25% + Bull benchmark 10% x2',
    topN: 4,
    momentumDays: 20,
    rebalanceDays: 10,
    trendMaDays: 20,
    bearRegimeMaxExposure: 0.25,
    bullBenchmarkSlotMomentumPct: 10,
    bullBenchmarkSlotCount: 2,
  },
  {
    name: 'Top4/20/10/MA20 + Bear cap 25% + Bull benchmark 12% x2',
    topN: 4,
    momentumDays: 20,
    rebalanceDays: 10,
    trendMaDays: 20,
    bearRegimeMaxExposure: 0.25,
    bullBenchmarkSlotMomentumPct: 12,
    bullBenchmarkSlotCount: 2,
  },
  {
    name: 'Top4/20/10/MA20 + Weak cap 80% + Bear cap 25% + Bull benchmark 8%',
    topN: 4,
    momentumDays: 20,
    rebalanceDays: 10,
    trendMaDays: 20,
    weakRegimeMaxExposure: 0.8,
    bearRegimeMaxExposure: 0.25,
    bullBenchmarkSlotMomentumPct: 8,
  },
  {
    name: 'Top4/20/10/MA20 + Weak cap 60% + Bear cap 25% + Bull benchmark 8%',
    topN: 4,
    momentumDays: 20,
    rebalanceDays: 10,
    trendMaDays: 20,
    weakRegimeMaxExposure: 0.6,
    bearRegimeMaxExposure: 0.25,
    bullBenchmarkSlotMomentumPct: 8,
  },
  {
    name: 'Top4/20/10/MA20 + Weak cap 50% + Bear cap 25% + Bull benchmark 8%',
    topN: 4,
    momentumDays: 20,
    rebalanceDays: 10,
    trendMaDays: 20,
    weakRegimeMaxExposure: 0.5,
    bearRegimeMaxExposure: 0.25,
    bullBenchmarkSlotMomentumPct: 8,
  },
  {
    name: 'Top4/20/10/MA20 + Bear cap 0% + Bull benchmark 8%',
    topN: 4,
    momentumDays: 20,
    rebalanceDays: 10,
    trendMaDays: 20,
    bearRegimeMaxExposure: 0,
    bullBenchmarkSlotMomentumPct: 8,
  },
  {
    name: 'Top2/20/10/MA20',
    topN: 2,
    momentumDays: 20,
    rebalanceDays: 10,
    trendMaDays: 20,
  },
  {
    name: 'Top3/20/10/MA20',
    topN: 3,
    momentumDays: 20,
    rebalanceDays: 10,
    trendMaDays: 20,
  },
  {
    name: 'Top3/20/5/MA20',
    topN: 3,
    momentumDays: 20,
    rebalanceDays: 5,
    trendMaDays: 20,
  },
  {
    name: 'Top3/30/10/MA20',
    topN: 3,
    momentumDays: 30,
    rebalanceDays: 10,
    trendMaDays: 20,
  },
  {
    name: 'Top3/60/10/MA60',
    topN: 3,
    momentumDays: 60,
    rebalanceDays: 10,
    trendMaDays: 60,
  },
];

const anchoredWindows: WindowSpec[] = [
  {
    name: '2018 bear',
    startDate: '2018-01-02',
    endDate: '2018-12-28',
    calendarDays: 360,
  },
  {
    name: '2019 rebound',
    startDate: '2019-01-02',
    endDate: '2019-04-30',
    calendarDays: 118,
  },
  {
    name: '2020 crash',
    startDate: '2020-01-20',
    endDate: '2020-03-23',
    calendarDays: 63,
  },
  {
    name: '2020-2021 trend',
    startDate: '2020-03-24',
    endDate: '2021-02-18',
    calendarDays: 331,
  },
  {
    name: '2022 bear',
    startDate: '2022-01-04',
    endDate: '2022-10-31',
    calendarDays: 300,
  },
  {
    name: '2023 sideways',
    startDate: '2023-01-03',
    endDate: '2023-12-29',
    calendarDays: 360,
  },
  {
    name: '2024 spike',
    startDate: '2024-09-24',
    endDate: '2024-10-31',
    calendarDays: 37,
  },
  {
    name: '2025 out-of-sample',
    startDate: '2025-01-02',
    endDate: '2026-06-24',
    calendarDays: 538,
  },
];

function toDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function buildRollingWindows(input: {
  startDate: string;
  endDate: string;
  windowDays: number;
  stepDays: number;
}): WindowSpec[] {
  const windows: WindowSpec[] = [];
  const start = toDate(input.startDate);
  const end = toDate(input.endDate);
  for (
    let currentStart = start;
    addDays(currentStart, input.windowDays) <= end;
    currentStart = addDays(currentStart, input.stepDays)
  ) {
    const currentEnd = addDays(currentStart, input.windowDays);
    windows.push({
      name: `${input.windowDays}d ${dateKey(currentStart)}~${dateKey(currentEnd)}`,
      startDate: dateKey(currentStart),
      endDate: dateKey(currentEnd),
      calendarDays: input.windowDays,
    });
  }
  return windows;
}

function maxDrawdownPct(result: BacktestRunResult): number | null {
  const points = result.equityCurve ?? [];
  if (points.length === 0) return null;

  let peak = points[0].equity;
  let maxDrawdown = 0;
  for (const point of points) {
    peak = Math.max(peak, point.equity);
    if (peak <= 0) continue;
    maxDrawdown = Math.min(maxDrawdown, ((point.equity - peak) / peak) * 100);
  }
  return round(maxDrawdown);
}

function round(value: number | null | undefined, digits = 2): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function summarizeVariant(
  variant: Variant,
  results: WindowResult[],
): VariantSummary {
  const returns = results.flatMap((item) =>
    item.returnPct == null ? [] : [item.returnPct],
  );
  const excess = results.flatMap((item) =>
    item.excessPct == null ? [] : [item.excessPct],
  );
  const drawdowns = results.flatMap((item) =>
    item.maxDrawdownPct == null ? [] : [item.maxDrawdownPct],
  );
  const positiveWindows = results.filter((item) => (item.returnPct ?? -Infinity) > 0).length;
  const beatBenchmarkWindows = results.filter(
    (item) => (item.excessPct ?? -Infinity) > 0,
  ).length;
  const worstReturn = [...results]
    .filter((item) => item.returnPct != null)
    .sort((a, b) => (a.returnPct ?? Infinity) - (b.returnPct ?? Infinity))[0];
  const worstDrawdown = [...results]
    .filter((item) => item.maxDrawdownPct != null)
    .sort((a, b) => (a.maxDrawdownPct ?? Infinity) - (b.maxDrawdownPct ?? Infinity))[0];

  const avgReturnPct = round(avg(returns));
  const avgExcessPct = round(avg(excess));
  const positiveWindowPct = round((positiveWindows / Math.max(1, results.length)) * 100);
  const beatBenchmarkPct = round((beatBenchmarkWindows / Math.max(1, results.length)) * 100);
  const worstMaxDrawdownPct = round(Math.min(...drawdowns));
  const score =
    avgReturnPct == null || avgExcessPct == null || positiveWindowPct == null
      ? null
      : round(
          avgReturnPct
          + avgExcessPct * 0.8
          + positiveWindowPct * 0.25
          + (beatBenchmarkPct ?? 0) * 0.15
          + (worstMaxDrawdownPct ?? 0) * 1.2,
        );

  return {
    variant: variant.name,
    topN: variant.topN,
    momentumDays: variant.momentumDays,
    rebalanceDays: variant.rebalanceDays,
    trendMaDays: variant.trendMaDays,
    bearRegimeMaxExposure: variant.bearRegimeMaxExposure,
    weakRegimeMaxExposure: variant.weakRegimeMaxExposure ?? null,
    bullBenchmarkSlotMomentumPct: variant.bullBenchmarkSlotMomentumPct,
    bullBenchmarkSlotCount: variant.bullBenchmarkSlotCount,
    cashFallbackInWeakRegime: variant.cashFallbackInWeakRegime,
    exitOnTrendBreak: variant.exitOnTrendBreak,
    windows: results.length,
    positiveWindows,
    positiveWindowPct,
    beatBenchmarkWindows,
    beatBenchmarkPct,
    avgReturnPct,
    medianReturnPct: round(median(returns)),
    worstReturnPct: worstReturn?.returnPct ?? null,
    worstReturnWindow: worstReturn?.window ?? null,
    avgExcessPct,
    worstMaxDrawdownPct,
    worstDrawdownWindow: worstDrawdown?.window ?? null,
    score,
  };
}

async function runWindow(
  window: WindowSpec,
  variant: Variant,
): Promise<WindowResult> {
  const result = await runEtfMomentumBacktest({
    startDate: window.startDate,
    endDate: window.endDate,
    topN: variant.topN,
    momentumDays: variant.momentumDays,
    rebalanceDays: variant.rebalanceDays,
    trendMaDays: variant.trendMaDays,
    bearRegimeMaxExposure: variant.bearRegimeMaxExposure,
    weakRegimeMaxExposure: variant.weakRegimeMaxExposure ?? null,
    bullBenchmarkSlotMomentumPct: variant.bullBenchmarkSlotMomentumPct,
    bullBenchmarkSlotCount: variant.bullBenchmarkSlotCount,
    cashFallbackInWeakRegime: variant.cashFallbackInWeakRegime,
    exitOnTrendBreak: variant.exitOnTrendBreak,
  });
  const returnPct = result.equityCurve?.at(-1)?.returnPct ?? null;
  const benchmarkPct = result.benchmark?.finalReturnPct ?? null;
  return {
    window: window.name,
    startDate: result.startDate ?? window.startDate,
    endDate: result.endDate ?? window.endDate,
    returnPct,
    benchmarkPct,
    excessPct:
      returnPct != null && benchmarkPct != null
        ? round(returnPct - benchmarkPct)
        : null,
    maxDrawdownPct: maxDrawdownPct(result),
    tradeCount: result.metrics.tradeCount,
  };
}

async function main() {
  const includeDetails = process.argv.includes('--details');
  const rollingWindows = [
    ...buildRollingWindows({
      startDate: '2018-01-02',
      endDate: '2026-06-24',
      windowDays: 90,
      stepDays: 45,
    }),
    ...buildRollingWindows({
      startDate: '2018-01-02',
      endDate: '2026-06-24',
      windowDays: 180,
      stepDays: 90,
    }),
    ...buildRollingWindows({
      startDate: '2018-01-02',
      endDate: '2026-06-24',
      windowDays: 360,
      stepDays: 180,
    }),
  ];
  const windows = [...anchoredWindows, ...rollingWindows];

  const details: Record<string, WindowResult[]> = {};
  const summaries: VariantSummary[] = [];
  for (const variant of variants) {
    const results: WindowResult[] = [];
    for (const window of windows) {
      results.push(await runWindow(window, variant));
    }
    if (includeDetails) details[variant.name] = results;
    summaries.push(summarizeVariant(variant, results));
  }
  summaries.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));

  process.stdout.write(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        windowCount: windows.length,
        anchoredWindowCount: anchoredWindows.length,
        rollingWindowCount: rollingWindows.length,
        scoring:
          'score = avgReturn + 0.8*avgExcess + 0.25*positiveWindowPct + 0.15*beatBenchmarkPct + 1.2*worstMaxDrawdownPct',
        summaries,
        ...(includeDetails ? { details } : {}),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(message);
  process.exit(1);
});

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
};

type WindowResult = {
  returnPct: number | null;
  benchmarkPct: number | null;
  excessPct: number | null;
  maxDrawdownPct: number | null;
};

type SplitResult = {
  split: string;
  trainStart: string;
  trainEnd: string;
  testStart: string;
  testEnd: string;
  selectedVariant: string;
  selectedTrainScore: number | null;
  selectedTest: WindowResult;
  defaultTest: WindowResult;
};

const DEFAULT_VARIANT: Variant = {
  name: 'Default Top4/20/10/MA20 + Weak cap 70% + Bear cap 25% + Bull benchmark 8%',
  topN: 4,
  momentumDays: 20,
  rebalanceDays: 10,
  trendMaDays: 20,
  weakRegimeMaxExposure: 0.7,
};

const variants: Variant[] = [
  DEFAULT_VARIANT,
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
    name: 'Top3/30/10/MA20',
    topN: 3,
    momentumDays: 30,
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
    name: 'Top3/60/10/MA60',
    topN: 3,
    momentumDays: 60,
    rebalanceDays: 10,
    trendMaDays: 60,
  },
];

const resultCache = new Map<string, Promise<WindowResult>>();

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

function round(value: number | null | undefined, digits = 2): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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
      name: `${dateKey(currentStart)}~${dateKey(currentEnd)}`,
      startDate: dateKey(currentStart),
      endDate: dateKey(currentEnd),
    });
  }
  return windows;
}

function buildWalkForwardSplits(input: {
  startDate: string;
  endDate: string;
  trainDays: number;
  testDays: number;
  stepDays: number;
}): Array<{
  trainStart: string;
  trainEnd: string;
  testStart: string;
  testEnd: string;
}> {
  const splits: Array<{
    trainStart: string;
    trainEnd: string;
    testStart: string;
    testEnd: string;
  }> = [];
  const start = toDate(input.startDate);
  const end = toDate(input.endDate);
  for (
    let testStart = addDays(start, input.trainDays);
    addDays(testStart, input.testDays) <= end;
    testStart = addDays(testStart, input.stepDays)
  ) {
    const testEnd = addDays(testStart, input.testDays);
    const trainStart = addDays(testStart, -input.trainDays);
    splits.push({
      trainStart: dateKey(trainStart),
      trainEnd: dateKey(testStart),
      testStart: dateKey(testStart),
      testEnd: dateKey(testEnd),
    });
  }
  return splits;
}

async function runWindow(variant: Variant, window: WindowSpec): Promise<WindowResult> {
  const cacheKey = [
    variant.name,
    window.startDate,
    window.endDate,
    variant.topN,
    variant.momentumDays,
    variant.rebalanceDays,
    variant.trendMaDays,
    variant.bearRegimeMaxExposure ?? 0.25,
    variant.weakRegimeMaxExposure ?? 'off',
    variant.bullBenchmarkSlotMomentumPct ?? 8,
    variant.bullBenchmarkSlotCount ?? 1,
    variant.cashFallbackInWeakRegime ? 'weak-cash' : 'benchmark-fill',
    variant.exitOnTrendBreak ? 'trend-exit' : 'scheduled-exit',
  ].join('|');
  const cached = resultCache.get(cacheKey);
  if (cached) return cached;

  const promise = runEtfMomentumBacktest({
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
  }).then((result) => {
    const returnPct = result.equityCurve?.at(-1)?.returnPct ?? null;
    const benchmarkPct = result.benchmark?.finalReturnPct ?? null;
    return {
      returnPct,
      benchmarkPct,
      excessPct:
        returnPct != null && benchmarkPct != null
          ? round(returnPct - benchmarkPct)
          : null,
      maxDrawdownPct: maxDrawdownPct(result),
    };
  });
  resultCache.set(cacheKey, promise);
  return promise;
}

function scoreWindow(result: WindowResult): number | null {
  if (result.returnPct == null || result.excessPct == null || result.maxDrawdownPct == null) {
    return null;
  }
  return round(
    result.returnPct
    + result.excessPct * 0.7
    + result.maxDrawdownPct * 1.1,
  );
}

function scoreTraining(results: WindowResult[]): number | null {
  const scores = results.flatMap((result) => {
    const score = scoreWindow(result);
    return score == null ? [] : [score];
  });
  const positivePct =
    (results.filter((result) => (result.returnPct ?? -Infinity) > 0).length
      / Math.max(1, results.length))
    * 100;
  const beatBenchmarkPct =
    (results.filter((result) => (result.excessPct ?? -Infinity) > 0).length
      / Math.max(1, results.length))
    * 100;
  const worstDrawdown = Math.min(
    ...results.flatMap((result) =>
      result.maxDrawdownPct == null ? [] : [result.maxDrawdownPct],
    ),
  );
  const base = avg(scores);
  if (base == null || !Number.isFinite(worstDrawdown)) return null;
  return round(base + positivePct * 0.12 + beatBenchmarkPct * 0.08 + worstDrawdown * 0.4);
}

async function selectVariant(input: {
  trainStart: string;
  trainEnd: string;
}): Promise<{ variant: Variant; trainScore: number | null }> {
  const trainWindows = [
    {
      name: `${input.trainStart}~${input.trainEnd}`,
      startDate: input.trainStart,
      endDate: input.trainEnd,
    },
    ...buildRollingWindows({
      startDate: input.trainStart,
      endDate: input.trainEnd,
      windowDays: 180,
      stepDays: 90,
    }),
    ...buildRollingWindows({
      startDate: input.trainStart,
      endDate: input.trainEnd,
      windowDays: 360,
      stepDays: 180,
    }),
  ];

  const ranked: Array<{ variant: Variant; trainScore: number | null }> = [];
  for (const variant of variants) {
    const results: WindowResult[] = [];
    for (const window of trainWindows) {
      results.push(await runWindow(variant, window));
    }
    ranked.push({ variant, trainScore: scoreTraining(results) });
  }

  ranked.sort((a, b) => (b.trainScore ?? -Infinity) - (a.trainScore ?? -Infinity));
  return ranked[0] ?? { variant: DEFAULT_VARIANT, trainScore: null };
}

function summarize(results: WindowResult[]) {
  const returns = results.flatMap((result) =>
    result.returnPct == null ? [] : [result.returnPct],
  );
  const excess = results.flatMap((result) =>
    result.excessPct == null ? [] : [result.excessPct],
  );
  const drawdowns = results.flatMap((result) =>
    result.maxDrawdownPct == null ? [] : [result.maxDrawdownPct],
  );
  return {
    tests: results.length,
    positiveTests: results.filter((result) => (result.returnPct ?? -Infinity) > 0).length,
    positiveTestPct: round(
      (results.filter((result) => (result.returnPct ?? -Infinity) > 0).length
        / Math.max(1, results.length))
      * 100,
    ),
    beatBenchmarkTests: results.filter((result) => (result.excessPct ?? -Infinity) > 0).length,
    beatBenchmarkPct: round(
      (results.filter((result) => (result.excessPct ?? -Infinity) > 0).length
        / Math.max(1, results.length))
      * 100,
    ),
    avgReturnPct: round(avg(returns)),
    avgExcessPct: round(avg(excess)),
    worstReturnPct: returns.length > 0 ? round(Math.min(...returns)) : null,
    worstMaxDrawdownPct: drawdowns.length > 0 ? round(Math.min(...drawdowns)) : null,
  };
}

async function main() {
  const includeDetails = process.argv.includes('--details');
  const splits = buildWalkForwardSplits({
    startDate: '2018-01-02',
    endDate: '2026-06-24',
    trainDays: 720,
    testDays: 180,
    stepDays: 180,
  });

  const splitResults: SplitResult[] = [];
  for (const [index, split] of splits.entries()) {
    const selected = await selectVariant({
      trainStart: split.trainStart,
      trainEnd: split.trainEnd,
    });
    const testWindow = {
      name: `${split.testStart}~${split.testEnd}`,
      startDate: split.testStart,
      endDate: split.testEnd,
    };
    const selectedTest = await runWindow(selected.variant, testWindow);
    const defaultTest = await runWindow(DEFAULT_VARIANT, testWindow);
    splitResults.push({
      split: `split-${index + 1}`,
      ...split,
      selectedVariant: selected.variant.name,
      selectedTrainScore: selected.trainScore,
      selectedTest,
      defaultTest,
    });
  }

  const selectedTests = splitResults.map((result) => result.selectedTest);
  const defaultTests = splitResults.map((result) => result.defaultTest);
  const selectedCounts = splitResults.reduce<Record<string, number>>((counts, result) => {
    counts[result.selectedVariant] = (counts[result.selectedVariant] ?? 0) + 1;
    return counts;
  }, {});
  const fixedVariantSummaries: Record<string, ReturnType<typeof summarize>> = {};
  for (const variant of variants) {
    const tests: WindowResult[] = [];
    for (const split of splits) {
      tests.push(
        await runWindow(variant, {
          name: `${split.testStart}~${split.testEnd}`,
          startDate: split.testStart,
          endDate: split.testEnd,
        }),
      );
    }
    fixedVariantSummaries[variant.name] = summarize(tests);
  }

  process.stdout.write(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        methodology:
          'Walk-forward: train on prior 720 calendar days, choose best variant by rolling-window score, test next 180 days, step 180 days.',
        splitCount: splitResults.length,
        selectedVariantCounts: selectedCounts,
        selectedSummary: summarize(selectedTests),
        defaultSummary: summarize(defaultTests),
        fixedVariantSummaries,
        ...(includeDetails ? { splits: splitResults } : {}),
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

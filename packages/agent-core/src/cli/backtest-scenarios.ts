import 'dotenv/config';

import { getDailyQuote } from '../data/market/services.js';
import { runEtfMomentumBacktest } from '../data/backtest/etf-momentum.js';
import { todayDateKey, formatTradeDateKey } from '../data/backtest/date-range.js';
import type { BacktestRunResult } from '../data/backtest/types.js';

type Scenario = {
  name: string;
  startDate: string;
  endDate: string;
};

type Variant = {
  name: string;
  topN: number;
  momentumDays: number;
  rebalanceDays: number;
  trendMaDays: number;
};

type BenchmarkBar = {
  tradeDate: string;
  close: number;
};

type BenchmarkWindow = {
  start: number;
  end: number;
  returnPct: number;
  avgAbsDailyReturnPct: number;
  startDate: string;
  endDate: string;
};

const scenarios: Scenario[] = [
  {
    name: '近1个月急涨急跌窗口',
    startDate: '2026-05-24',
    endDate: '2026-06-24',
  },
  {
    name: '近3个月',
    startDate: '2026-03-26',
    endDate: '2026-06-24',
  },
  {
    name: '近6个月',
    startDate: '2025-12-24',
    endDate: '2026-06-24',
  },
  {
    name: '近1年',
    startDate: '2025-06-24',
    endDate: '2026-06-24',
  },
  {
    name: '2026上半年',
    startDate: '2026-01-01',
    endDate: '2026-06-24',
  },
  {
    name: '2025下半年',
    startDate: '2025-07-01',
    endDate: '2025-12-31',
  },
  // 固定历史压力场景（人工标注）
  {
    name: '压力测试：2022熊市段',
    startDate: '2022-01-04',
    endDate: '2022-10-31',
  },
  {
    name: '震荡测试：2023全年',
    startDate: '2023-01-03',
    endDate: '2023-12-29',
  },
  {
    name: '急涨急跌：2024年9-10月',
    startDate: '2024-09-24',
    endDate: '2024-10-31',
  },
  {
    name: '单边熊市：2018全年',
    startDate: '2018-01-02',
    endDate: '2018-12-28',
  },
  {
    name: '快速反弹：2019Q1',
    startDate: '2019-01-02',
    endDate: '2019-04-30',
  },
  {
    name: '疫情急跌：2020年1-3月',
    startDate: '2020-01-20',
    endDate: '2020-03-23',
  },
  {
    name: '大反弹/趋势：2020-2021',
    startDate: '2020-03-24',
    endDate: '2021-02-18',
  },
  {
    name: '样本外验证：2025至今',
    startDate: '2025-01-02',
    endDate: formatTradeDateKey(todayDateKey()),
  },
];

const variants: Variant[] = [
  {
    name: '最终策略 Top3/20日动量/10日调仓/MA20+牛市MA10',
    topN: 3,
    momentumDays: 20,
    rebalanceDays: 10,
    trendMaDays: 20,
  },
  {
    name: '旧版 Top2/20日动量/10日调仓/MA20',
    topN: 2,
    momentumDays: 20,
    rebalanceDays: 10,
    trendMaDays: 20,
  },
  {
    name: '更快换仓 Top3/20日动量/5日调仓/MA20',
    topN: 3,
    momentumDays: 20,
    rebalanceDays: 5,
    trendMaDays: 20,
  },
  {
    name: '更分散 Top3/20日动量/10日调仓/MA20',
    topN: 3,
    momentumDays: 20,
    rebalanceDays: 10,
    trendMaDays: 20,
  },
  {
    name: '更长动量 Top3/60日动量/10日调仓/MA60',
    topN: 3,
    momentumDays: 60,
    rebalanceDays: 10,
    trendMaDays: 60,
  },
];

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
  return Number(maxDrawdown.toFixed(2));
}

function fmt(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(2));
}

function normalizeDate(value: string): string {
  return value.replace(/-/g, '').slice(0, 8);
}

function formatDate(value: string): string {
  const key = normalizeDate(value);
  return `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
}

function windowReturnPct(bars: BenchmarkBar[], startIndex: number, endIndex: number): number {
  const start = bars[startIndex]?.close;
  const end = bars[endIndex]?.close;
  if (!start || !end) return 0;
  return ((end - start) / start) * 100;
}

function windowAvgAbsDailyReturnPct(
  bars: BenchmarkBar[],
  startIndex: number,
  endIndex: number,
): number {
  const values: number[] = [];
  for (let index = startIndex + 1; index <= endIndex; index += 1) {
    const prev = bars[index - 1]?.close;
    const current = bars[index]?.close;
    if (!prev || !current) continue;
    values.push(Math.abs(((current - prev) / prev) * 100));
  }
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function buildRegimeScenarios(): Promise<Scenario[]> {
  const data = await getDailyQuote('510300', 800);
  const bars = data.quotes
    .flatMap((bar): BenchmarkBar[] => {
      if (bar.close == null || bar.close <= 0) return [];
      return [
        {
          tradeDate: normalizeDate(bar.tradeDate),
          close: bar.close,
        },
      ];
    })
    .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));

  const windowSize = 60;
  if (bars.length <= windowSize) return [];

  const windows: BenchmarkWindow[] = [];
  for (let start = 0; start + windowSize < bars.length; start += 1) {
    const end = start + windowSize;
    const returnPct = windowReturnPct(bars, start, end);
    const avgAbsDailyReturnPct = windowAvgAbsDailyReturnPct(bars, start, end);
    windows.push({
      start,
      end,
      returnPct,
      avgAbsDailyReturnPct,
      startDate: bars[start].tradeDate,
      endDate: bars[end].tradeDate,
    });
  }

  const bull = [...windows].sort((a, b) => b.returnPct - a.returnPct)[0];
  const bear = [...windows].sort((a, b) => a.returnPct - b.returnPct)[0];
  const sideways = [...windows].sort(
    (a, b) => Math.abs(a.returnPct) - Math.abs(b.returnPct),
  )[0];
  const volatile = [...windows].sort(
    (a, b) => b.avgAbsDailyReturnPct - a.avgAbsDailyReturnPct,
  )[0];

  return [
    {
      name: `市场状态：牛市强趋势（沪深300ETF ${fmt(bull.returnPct)}%）`,
      startDate: formatDate(bull.startDate),
      endDate: formatDate(bull.endDate),
    },
    {
      name: `市场状态：熊市/回撤（沪深300ETF ${fmt(bear.returnPct)}%）`,
      startDate: formatDate(bear.startDate),
      endDate: formatDate(bear.endDate),
    },
    {
      name: `市场状态：震荡市（沪深300ETF ${fmt(sideways.returnPct)}%）`,
      startDate: formatDate(sideways.startDate),
      endDate: formatDate(sideways.endDate),
    },
    {
      name: `市场状态：高波动（平均日振幅 ${fmt(volatile.avgAbsDailyReturnPct)}%）`,
      startDate: formatDate(volatile.startDate),
      endDate: formatDate(volatile.endDate),
    },
  ];
}

async function runScenario(scenario: Scenario, variant: Variant) {
  const result = await runEtfMomentumBacktest({
    startDate: scenario.startDate,
    endDate: scenario.endDate,
    topN: variant.topN,
    momentumDays: variant.momentumDays,
    rebalanceDays: variant.rebalanceDays,
    trendMaDays: variant.trendMaDays,
  });
  const finalReturn = result.equityCurve?.at(-1)?.returnPct ?? null;
  const benchmarkReturn = result.benchmark?.finalReturnPct ?? null;
  return {
    scenario: scenario.name,
    startDate: result.startDate,
    endDate: result.endDate,
    variant: variant.name,
    returnPct: fmt(finalReturn),
    benchmarkPct: fmt(benchmarkReturn),
    excessPct:
      finalReturn != null && benchmarkReturn != null
        ? fmt(finalReturn - benchmarkReturn)
        : null,
    maxDrawdownPct: maxDrawdownPct(result),
    winRatePct: fmt(result.metrics.winRatePct),
    trades: `${result.metrics.validTradeCount}/${result.metrics.tradeCount}`,
    bestTradePct: fmt(result.metrics.bestReturnPct),
    worstTradePct: fmt(result.metrics.worstReturnPct),
    currentTop: result.currentDecisions
      ?.filter((item) => item.action === 'buy')
      .map((item) => `${item.name}(${item.symbol})`),
  };
}

async function main() {
  const allScenarios = [...scenarios, ...(await buildRegimeScenarios())];
  const rows: Awaited<ReturnType<typeof runScenario>>[] = [];
  for (const scenario of allScenarios) {
    for (const variant of variants) {
      rows.push(await runScenario(scenario, variant));
    }
  }

  const byScenario = allScenarios.map((scenario) => {
    const items = rows
      .filter((row) => row.scenario === scenario.name)
      .sort((a, b) => (b.excessPct ?? -Infinity) - (a.excessPct ?? -Infinity));
    return {
      scenario: scenario.name,
      best: items[0],
      variants: items,
    };
  });

  process.stdout.write(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        baseline: 'benchmarkPct 为沪深300ETF同期买入持有收益',
        scenarios: byScenario,
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

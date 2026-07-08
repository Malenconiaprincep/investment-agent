import '../config/load-env.js';

import { runEtfMomentumBacktest } from '../data/backtest/etf-momentum.js';
import { formatTradeDateKey, todayDateKey } from '../data/backtest/date-range.js';
import type { BacktestRunResult } from '../data/backtest/types.js';

type Variant = {
  name: string;
  shortName: string;
  thesis: string;
  topN: number;
  momentumDays: number;
  rebalanceDays: number;
  trendMaDays: number;
  weakRegimeMaxExposure?: number | null;
  bearRegimeMaxExposure?: number;
  bullBenchmarkSlotMomentumPct?: number;
  bullBenchmarkSlotCount?: number;
  cashFallbackInWeakRegime?: boolean;
  exitOnTrendBreak?: boolean;
  maxPerTheme?: number | null;
};

type Scenario = {
  name: string;
  startDate: string;
  endDate: string;
};

type Row = {
  scenario: string;
  startDate: string;
  endDate: string;
  variant: string;
  returnPct: number | null;
  benchmarkPct: number | null;
  excessPct: number | null;
  maxDrawdownPct: number | null;
  winRatePct: number | null;
  trades: string;
  worstTradePct: number | null;
  bestTradePct: number | null;
};

type Summary = {
  variant: string;
  thesis: string;
  scenarios: number;
  positiveScenarios: number;
  beatBenchmarkScenarios: number;
  avgReturnPct: number | null;
  avgExcessPct: number | null;
  worstReturnPct: number | null;
  worstMaxDrawdownPct: number | null;
  avgWinRatePct: number | null;
  totalValidTrades: number;
  score: number | null;
};

const variants: Variant[] = [
  {
    name: '方案A 当前基准：Top4/20日动量/10日调仓/弱市70%+熊市25%+宽基槽位+主题最多2只',
    shortName: 'A 当前基准',
    thesis: '保留当前模拟盘逻辑，固定10个交易日轮动，弱市降仓但仍允许沪深300兜底。',
    topN: 4,
    momentumDays: 20,
    rebalanceDays: 10,
    trendMaDays: 20,
    weakRegimeMaxExposure: 0.7,
    maxPerTheme: 2,
  },
  {
    name: '方案B 弱市现金防守：基准规则 + 弱市不足槽位保留现金',
    shortName: 'B 弱市现金',
    thesis: '弱市里不再强行用沪深300填满槽位，减少弱行情中的无效暴露。',
    topN: 4,
    momentumDays: 20,
    rebalanceDays: 10,
    trendMaDays: 20,
    weakRegimeMaxExposure: 0.7,
    cashFallbackInWeakRegime: true,
    maxPerTheme: 2,
  },
  {
    name: '方案C 主动风控：弱市现金防守 + 弱市趋势破位提前退出',
    shortName: 'C 主动风控',
    thesis: '在方案B基础上，弱市中持仓跌破入场趋势均线就提前退出，不等10日调仓。',
    topN: 4,
    momentumDays: 20,
    rebalanceDays: 10,
    trendMaDays: 20,
    weakRegimeMaxExposure: 0.7,
    cashFallbackInWeakRegime: true,
    exitOnTrendBreak: true,
    maxPerTheme: 2,
  },
];

const scenarios: Scenario[] = [
  {
    name: '2018单边熊市',
    startDate: '2018-01-02',
    endDate: '2018-12-28',
  },
  {
    name: '2019快速反弹',
    startDate: '2019-01-02',
    endDate: '2019-04-30',
  },
  {
    name: '2020疫情急跌',
    startDate: '2020-01-20',
    endDate: '2020-03-23',
  },
  {
    name: '2020-2021趋势反弹',
    startDate: '2020-03-24',
    endDate: '2021-02-18',
  },
  {
    name: '2022熊市段',
    startDate: '2022-01-04',
    endDate: '2022-10-31',
  },
  {
    name: '2023震荡全年',
    startDate: '2023-01-03',
    endDate: '2023-12-29',
  },
  {
    name: '2024急涨急跌',
    startDate: '2024-09-24',
    endDate: '2024-10-31',
  },
  {
    name: '2025至今样本外',
    startDate: '2025-01-02',
    endDate: formatTradeDateKey(todayDateKey()),
  },
];

function fmt(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(2));
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
  return fmt(maxDrawdown);
}

function avg(values: Array<number | null>): number | null {
  const clean = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (clean.length === 0) return null;
  return fmt(clean.reduce((sum, value) => sum + value, 0) / clean.length);
}

function min(values: Array<number | null>): number | null {
  const clean = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (clean.length === 0) return null;
  return fmt(Math.min(...clean));
}

function pct(value: number | null): string {
  if (value == null) return '-';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function numberText(value: number | null): string {
  return value == null ? '-' : value.toFixed(2);
}

function parseValidTrades(value: string): number {
  return Number(value.split('/')[0] ?? 0) || 0;
}

async function runOne(scenario: Scenario, variant: Variant): Promise<Row> {
  const result = await runEtfMomentumBacktest({
    startDate: scenario.startDate,
    endDate: scenario.endDate,
    topN: variant.topN,
    momentumDays: variant.momentumDays,
    rebalanceDays: variant.rebalanceDays,
    trendMaDays: variant.trendMaDays,
    weakRegimeMaxExposure: variant.weakRegimeMaxExposure,
    bearRegimeMaxExposure: variant.bearRegimeMaxExposure,
    bullBenchmarkSlotMomentumPct: variant.bullBenchmarkSlotMomentumPct,
    bullBenchmarkSlotCount: variant.bullBenchmarkSlotCount,
    cashFallbackInWeakRegime: variant.cashFallbackInWeakRegime,
    exitOnTrendBreak: variant.exitOnTrendBreak,
    maxPerTheme: variant.maxPerTheme,
  });
  const returnPct = result.equityCurve?.at(-1)?.returnPct ?? null;
  const benchmarkPct = result.benchmark?.finalReturnPct ?? null;
  return {
    scenario: scenario.name,
    startDate: result.startDate ?? scenario.startDate,
    endDate: result.endDate ?? scenario.endDate,
    variant: variant.shortName,
    returnPct: fmt(returnPct),
    benchmarkPct: fmt(benchmarkPct),
    excessPct:
      returnPct != null && benchmarkPct != null ? fmt(returnPct - benchmarkPct) : null,
    maxDrawdownPct: maxDrawdownPct(result),
    winRatePct: fmt(result.metrics.winRatePct),
    trades: `${result.metrics.validTradeCount}/${result.metrics.tradeCount}`,
    worstTradePct: fmt(result.metrics.worstReturnPct),
    bestTradePct: fmt(result.metrics.bestReturnPct),
  };
}

function summarize(rows: Row[]): Summary[] {
  return variants.map((variant) => {
    const items = rows.filter((row) => row.variant === variant.shortName);
    const avgReturnPct = avg(items.map((row) => row.returnPct));
    const avgExcessPct = avg(items.map((row) => row.excessPct));
    const worstMaxDrawdownPct = min(items.map((row) => row.maxDrawdownPct));
    const worstReturnPct = min(items.map((row) => row.returnPct));
    const avgWinRatePct = avg(items.map((row) => row.winRatePct));
    const score =
      avgReturnPct != null && avgExcessPct != null && worstMaxDrawdownPct != null
        ? fmt(avgReturnPct + avgExcessPct + worstMaxDrawdownPct * 0.5)
        : null;
    return {
      variant: variant.shortName,
      thesis: variant.thesis,
      scenarios: items.length,
      positiveScenarios: items.filter((row) => (row.returnPct ?? -Infinity) > 0).length,
      beatBenchmarkScenarios: items.filter((row) => (row.excessPct ?? -Infinity) > 0).length,
      avgReturnPct,
      avgExcessPct,
      worstReturnPct,
      worstMaxDrawdownPct,
      avgWinRatePct,
      totalValidTrades: items.reduce((sum, row) => sum + parseValidTrades(row.trades), 0),
      score,
    };
  });
}

function toMarkdown(rows: Row[], summaries: Summary[]): string {
  const lines: string[] = [];
  lines.push(`# ETF 三方案回测对照`);
  lines.push('');
  lines.push(`生成时间：${new Date().toISOString()}`);
  lines.push('');
  lines.push(`## 方案`);
  for (const summary of summaries) {
    lines.push(`- **${summary.variant}**：${summary.thesis}`);
  }
  lines.push('');
  lines.push(`## 汇总`);
  lines.push(
    `| 方案 | 正收益窗口 | 跑赢基准窗口 | 平均收益 | 平均超额 | 最差收益 | 最差回撤 | 平均胜率 | 有效交易 | 综合分 |`,
  );
  lines.push(`|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|`);
  for (const item of summaries) {
    lines.push(
      `| ${item.variant} | ${item.positiveScenarios}/${item.scenarios} | ${item.beatBenchmarkScenarios}/${item.scenarios} | ${pct(item.avgReturnPct)} | ${pct(item.avgExcessPct)} | ${pct(item.worstReturnPct)} | ${pct(item.worstMaxDrawdownPct)} | ${pct(item.avgWinRatePct)} | ${item.totalValidTrades} | ${numberText(item.score)} |`,
    );
  }
  lines.push('');
  lines.push(`## 分场景`);
  lines.push(
    `| 场景 | 区间 | 方案 | 收益 | 沪深300ETF | 超额 | 最大回撤 | 胜率 | 交易 | 最差单笔 | 最好单笔 |`,
  );
  lines.push(`|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|`);
  for (const scenario of scenarios) {
    const items = rows.filter((row) => row.scenario === scenario.name);
    for (const row of items) {
      lines.push(
        `| ${row.scenario} | ${row.startDate} ~ ${row.endDate} | ${row.variant} | ${pct(row.returnPct)} | ${pct(row.benchmarkPct)} | ${pct(row.excessPct)} | ${pct(row.maxDrawdownPct)} | ${pct(row.winRatePct)} | ${row.trades} | ${pct(row.worstTradePct)} | ${pct(row.bestTradePct)} |`,
      );
    }
  }
  lines.push('');
  lines.push('说明：综合分用于粗排，约等于平均收益 + 平均超额 + 0.5 * 最差回撤；不是投资建议。');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const rows: Row[] = [];
  for (const scenario of scenarios) {
    for (const variant of variants) {
      rows.push(await runOne(scenario, variant));
    }
  }
  const summaries = summarize(rows).sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));

  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ generatedAt: new Date().toISOString(), summaries, rows }, null, 2));
    return;
  }
  process.stdout.write(toMarkdown(rows, summaries));
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

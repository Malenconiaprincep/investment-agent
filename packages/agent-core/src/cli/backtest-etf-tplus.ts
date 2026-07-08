import '../config/load-env.js';

import { runEtfMomentumBacktest } from '../data/backtest/etf-momentum.js';
import { formatTradeDateKey, todayDateKey } from '../data/backtest/date-range.js';
import type { BacktestRunResult } from '../data/backtest/types.js';

type Variant = {
  name: string;
  tPlusEnabled?: boolean;
};

type Scenario = {
  name: string;
  startDate: string;
  endDate: string;
};

type Row = {
  scenario: string;
  variant: string;
  returnPct: number | null;
  benchmarkPct: number | null;
  excessPct: number | null;
  maxDrawdownPct: number | null;
  winRatePct: number | null;
  trades: string;
  tPlusTradeCount: number;
  tPlusTotalProfitPct: number | null;
};

const scenarios: Scenario[] = [
  { name: '2018单边熊市', startDate: '2018-01-02', endDate: '2018-12-28' },
  { name: '2019快速反弹', startDate: '2019-01-02', endDate: '2019-04-30' },
  { name: '2020疫情急跌', startDate: '2020-01-20', endDate: '2020-03-23' },
  { name: '2020-2021趋势反弹', startDate: '2020-03-24', endDate: '2021-02-18' },
  { name: '2022熊市段', startDate: '2022-01-04', endDate: '2022-10-31' },
  { name: '2023震荡全年', startDate: '2023-01-03', endDate: '2023-12-29' },
  { name: '2024急涨急跌', startDate: '2024-09-24', endDate: '2024-10-31' },
  { name: '2025至今样本外', startDate: '2025-01-02', endDate: formatTradeDateKey(todayDateKey()) },
];

const variants: Variant[] = [
  { name: '基准轮动' },
  { name: '基准轮动 + 正T', tPlusEnabled: true },
];

function fmt(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(2));
}

function pct(value: number | null): string {
  if (value == null) return '-';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
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

async function runOne(scenario: Scenario, variant: Variant): Promise<Row> {
  const result = await runEtfMomentumBacktest({
    startDate: scenario.startDate,
    endDate: scenario.endDate,
    topN: 4,
    momentumDays: 20,
    rebalanceDays: 10,
    trendMaDays: 20,
    weakRegimeMaxExposure: 0.7,
    maxPerTheme: 2,
    tPlusEnabled: variant.tPlusEnabled,
    tPlusBuyDipPct: 1.5,
    tPlusMinProfitPct: 0.6,
    tPlusBudgetPct: 0.2,
    tPlusMaxTradesPerDay: 2,
  });
  const returnPct = result.equityCurve?.at(-1)?.returnPct ?? null;
  const benchmarkPct = result.benchmark?.finalReturnPct ?? null;
  return {
    scenario: scenario.name,
    variant: variant.name,
    returnPct: fmt(returnPct),
    benchmarkPct: fmt(benchmarkPct),
    excessPct: returnPct != null && benchmarkPct != null ? fmt(returnPct - benchmarkPct) : null,
    maxDrawdownPct: maxDrawdownPct(result),
    winRatePct: fmt(result.metrics.winRatePct),
    trades: `${result.metrics.validTradeCount}/${result.metrics.tradeCount}`,
    tPlusTradeCount: result.config?.tPlusTradeCount ?? 0,
    tPlusTotalProfitPct: result.config?.tPlusTotalProfitPct ?? null,
  };
}

function toMarkdown(rows: Row[]): string {
  const lines: string[] = [];
  lines.push('# ETF 正T叠加回测');
  lines.push('');
  lines.push('规则：主仓仍按 ETF 动量轮动；持仓 ETF 当天低点较昨收跌至少 1.5%，且收盘较触发买价反弹至少 0.6%，才用该持仓市值最多 20% 做一次正T；每日最多2笔，扣佣金和滑点。');
  lines.push('');
  lines.push('## 汇总');
  lines.push('| 方案 | 平均收益 | 平均超额 | 平均回撤 | 正收益窗口 | 跑赢基准窗口 | T交易 | T贡献 |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const variant of variants) {
    const items = rows.filter((row) => row.variant === variant.name);
    lines.push(
      `| ${variant.name} | ${pct(avg(items.map((row) => row.returnPct)))} | ${pct(avg(items.map((row) => row.excessPct)))} | ${pct(avg(items.map((row) => row.maxDrawdownPct)))} | ${items.filter((row) => (row.returnPct ?? -Infinity) > 0).length}/${items.length} | ${items.filter((row) => (row.excessPct ?? -Infinity) > 0).length}/${items.length} | ${items.reduce((sum, row) => sum + row.tPlusTradeCount, 0)} | ${pct(avg(items.map((row) => row.tPlusTotalProfitPct)))} |`,
    );
  }
  lines.push('');
  lines.push('## 分场景');
  lines.push('| 场景 | 方案 | 收益 | 沪深300ETF | 超额 | 最大回撤 | 胜率 | 轮动交易 | T交易 | T贡献 |');
  lines.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const scenario of scenarios) {
    for (const row of rows.filter((item) => item.scenario === scenario.name)) {
      lines.push(
        `| ${row.scenario} | ${row.variant} | ${pct(row.returnPct)} | ${pct(row.benchmarkPct)} | ${pct(row.excessPct)} | ${pct(row.maxDrawdownPct)} | ${pct(row.winRatePct)} | ${row.trades} | ${row.tPlusTradeCount} | ${pct(row.tPlusTotalProfitPct)} |`,
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  const rows: Row[] = [];
  for (const scenario of scenarios) {
    for (const variant of variants) {
      rows.push(await runOne(scenario, variant));
    }
  }
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2));
    return;
  }
  process.stdout.write(toMarkdown(rows));
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

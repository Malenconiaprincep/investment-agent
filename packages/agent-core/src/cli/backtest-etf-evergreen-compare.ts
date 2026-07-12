import '../config/load-env.js';

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runEtfStableV2Backtest } from '../data/backtest/etf-stable-v2.js';
import { runEtfMomentumBacktest } from '../data/backtest/etf-momentum.js';
import { runEtfEvergreenV3Backtest } from '../data/backtest/etf-evergreen-v3.js';
import type { BacktestRunResult } from '../data/backtest/types.js';
import { PACKAGE_ROOT } from '../mastra/config/paths.js';

type Scenario = {
  id: string;
  label: string;
  category: 'full' | 'recent' | 'stress' | 'year' | 'rolling';
  startDate: string;
  endDate: string;
};

type Variant = {
  id: string;
  label: string;
  executable: boolean;
  tPlusProxy: boolean;
  run: (scenario: Scenario) => Promise<BacktestRunResult>;
};

type ScenarioRow = {
  scenarioId: string;
  scenario: string;
  category: Scenario['category'];
  startDate: string;
  endDate: string;
  variantId: string;
  variant: string;
  returnPct: number;
  benchmarkPct: number;
  excessPct: number;
  maxDrawdownPct: number;
  averageInvestedPct: number;
  allCashDayPct: number;
  tradeCount: number;
  tPlusTradeCount: number;
  tPlusProfitPct: number;
};

function argValue(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function maxDrawdownPct(result: BacktestRunResult): number {
  const points = result.equityCurve ?? [];
  if (points.length === 0) return 0;
  let peak = points[0]!.equity;
  let drawdown = 0;
  for (const point of points) {
    peak = Math.max(peak, point.equity);
    if (peak > 0) drawdown = Math.min(drawdown, ((point.equity - peak) / peak) * 100);
  }
  return Number(drawdown.toFixed(2));
}

function exposureStats(result: BacktestRunResult) {
  const snapshots = result.portfolioSnapshots ?? [];
  if (snapshots.length === 0) return { averageInvestedPct: 0, allCashDayPct: 100 };
  let investedPct = 0;
  let allCashDays = 0;
  for (const snapshot of snapshots) {
    const pct = snapshot.totalValue > 0
      ? snapshot.investedMarketValue / snapshot.totalValue * 100
      : 0;
    investedPct += pct;
    if (pct < 0.01) allCashDays += 1;
  }
  return {
    averageInvestedPct: Number((investedPct / snapshots.length).toFixed(2)),
    allCashDayPct: Number((allCashDays / snapshots.length * 100).toFixed(2)),
  };
}

function calendarDate(delta: { months?: number; years?: number }, base: Date) {
  const date = new Date(base);
  if (delta.months) date.setUTCMonth(date.getUTCMonth() - delta.months);
  if (delta.years) date.setUTCFullYear(date.getUTCFullYear() - delta.years);
  return date.toISOString().slice(0, 10);
}

function buildScenarios(endDate: string): Scenario[] {
  const baseDate = new Date(`${endDate}T00:00:00.000Z`);
  const scenarios: Scenario[] = [
    { id: 'full', label: '全历史', category: 'full', startDate: '2014-01-02', endDate },
    { id: 'recent-3m', label: '最近3个月', category: 'recent', startDate: calendarDate({ months: 3 }, baseDate), endDate },
    { id: 'recent-6m', label: '最近6个月', category: 'recent', startDate: calendarDate({ months: 6 }, baseDate), endDate },
    { id: 'recent-1y', label: '最近1年', category: 'recent', startDate: calendarDate({ years: 1 }, baseDate), endDate },
    { id: 'recent-2y', label: '最近2年', category: 'recent', startDate: calendarDate({ years: 2 }, baseDate), endDate },
    { id: 'stress-2015', label: '2015 高波动牛熊切换', category: 'stress', startDate: '2015-01-01', endDate: '2015-12-31' },
    { id: 'stress-2018', label: '2018 单边熊市', category: 'stress', startDate: '2018-01-01', endDate: '2018-12-31' },
    { id: 'stress-2020-crash', label: '2020 疫情急跌', category: 'stress', startDate: '2020-01-02', endDate: '2020-03-31' },
    { id: 'stress-2020-trend', label: '2020-2021 趋势行情', category: 'stress', startDate: '2020-04-01', endDate: '2021-02-18' },
    { id: 'stress-2022', label: '2022 熊市', category: 'stress', startDate: '2022-01-01', endDate: '2022-12-31' },
    { id: 'stress-2023', label: '2023 震荡市', category: 'stress', startDate: '2023-01-01', endDate: '2023-12-31' },
    { id: 'stress-2024', label: '2024 急涨急跌', category: 'stress', startDate: '2024-01-01', endDate: '2024-12-31' },
    { id: 'stress-recent-era', label: '近年观察：2025至今', category: 'stress', startDate: '2025-01-01', endDate },
  ];
  const endYear = Number(endDate.slice(0, 4));
  for (let year = 2014; year <= endYear; year += 1) {
    scenarios.push({
      id: `year-${year}`,
      label: `${year} 自然年`,
      category: 'year',
      startDate: `${year}-01-01`,
      endDate: year === endYear ? endDate : `${year}-12-31`,
    });
  }
  for (let year = 2014; year <= endYear; year += 2) {
    const rollingEndYear = Math.min(year + 1, endYear);
    scenarios.push({
      id: `rolling-${year}-${rollingEndYear}`,
      label: `${year}-${rollingEndYear} 固定参数滚动窗口`,
      category: 'rolling',
      startDate: `${year}-01-01`,
      endDate: rollingEndYear === endYear ? endDate : `${rollingEndYear}-12-31`,
    });
  }
  return scenarios;
}

const variants: Variant[] = [
  {
    id: 'evergreen-v3-60-40',
    label: '长青 V3（增长60%/防守40%）',
    executable: true,
    tPlusProxy: false,
    run: (scenario) => runEtfEvergreenV3Backtest({
      startDate: scenario.startDate,
      endDate: scenario.endDate,
      growthWeightPct: 0.6,
    }),
  },
  {
    id: 'multi-asset-v2-fixed',
    label: '多资产 V2（解锁修复+宽基核心）',
    executable: true,
    tPlusProxy: false,
    run: (scenario) => runEtfStableV2Backtest({
      startDate: scenario.startDate,
      endDate: scenario.endDate,
      benchmarkCoreWeightPct: 0.5,
    }),
  },
  {
    id: 'rotation-t1-full',
    label: 'T+1 基准轮动（100%风险预算）',
    executable: true,
    tPlusProxy: false,
    run: (scenario) => runEtfMomentumBacktest({
      startDate: scenario.startDate,
      endDate: scenario.endDate,
      signalExecution: 'next_open',
      netRebalance: true,
    }),
  },
  {
    id: 'rotation-t1-vol12',
    label: 'T+1 波动率目标轮动（12%/35%）',
    executable: true,
    tPlusProxy: false,
    run: (scenario) => runEtfMomentumBacktest({
      startDate: scenario.startDate,
      endDate: scenario.endDate,
      signalExecution: 'next_open',
      netRebalance: true,
      targetVolPct: 12,
      minExposure: 0.35,
    }),
  },
  {
    id: 'rotation-t1-vol15',
    label: 'T+1 波动率目标轮动（15%/45%）',
    executable: true,
    tPlusProxy: false,
    run: (scenario) => runEtfMomentumBacktest({
      startDate: scenario.startDate,
      endDate: scenario.endDate,
      signalExecution: 'next_open',
      netRebalance: true,
      targetVolPct: 15,
      minExposure: 0.45,
    }),
  },
  {
    id: 'rotation-t1-risk40',
    label: 'T+1 风险调整轮动（单ETF波动≤40%）',
    executable: true,
    tPlusProxy: false,
    run: (scenario) => runEtfMomentumBacktest({
      startDate: scenario.startDate,
      endDate: scenario.endDate,
      signalExecution: 'next_open',
      netRebalance: true,
      riskAdjustedMomentum: true,
      maxAssetVolPct: 40,
    }),
  },
  {
    id: 'rotation-t1-risk35-vol15',
    label: 'T+1 风险调整+15%目标波动',
    executable: true,
    tPlusProxy: false,
    run: (scenario) => runEtfMomentumBacktest({
      startDate: scenario.startDate,
      endDate: scenario.endDate,
      signalExecution: 'next_open',
      netRebalance: true,
      riskAdjustedMomentum: true,
      maxAssetVolPct: 35,
      targetVolPct: 15,
      minExposure: 0.45,
    }),
  },
  {
    id: 'rotation-t1-risk40-guard',
    label: 'T+1 风险调整轮动 + 可恢复回撤保护',
    executable: true,
    tPlusProxy: false,
    run: (scenario) => runEtfMomentumBacktest({
      startDate: scenario.startDate,
      endDate: scenario.endDate,
      signalExecution: 'next_open',
      netRebalance: true,
      riskAdjustedMomentum: true,
      maxAssetVolPct: 40,
      drawdownGuardEnabled: true,
    }),
  },
  {
    id: 'rotation-t1-risk40-80',
    label: 'T+1 风险调整轮动（80%上限）',
    executable: true,
    tPlusProxy: false,
    run: (scenario) => runEtfMomentumBacktest({
      startDate: scenario.startDate,
      endDate: scenario.endDate,
      signalExecution: 'next_open',
      netRebalance: true,
      riskAdjustedMomentum: true,
      maxAssetVolPct: 40,
      maxExposure: 0.8,
    }),
  },
  {
    id: 'rotation-t1-risk40-stop8',
    label: 'T+1 风险调整轮动（-8%止损）',
    executable: true,
    tPlusProxy: false,
    run: (scenario) => runEtfMomentumBacktest({
      startDate: scenario.startDate,
      endDate: scenario.endDate,
      signalExecution: 'next_open',
      netRebalance: true,
      riskAdjustedMomentum: true,
      maxAssetVolPct: 40,
      stopLossPct: -8,
      stopCooldownDays: 15,
    }),
  },
  {
    id: 'rotation-t1-risk40-stop6',
    label: 'T+1 风险调整轮动（-6%止损）',
    executable: true,
    tPlusProxy: false,
    run: (scenario) => runEtfMomentumBacktest({
      startDate: scenario.startDate,
      endDate: scenario.endDate,
      signalExecution: 'next_open',
      netRebalance: true,
      riskAdjustedMomentum: true,
      maxAssetVolPct: 40,
      stopLossPct: -6,
      stopCooldownDays: 20,
    }),
  },
  {
    id: 'rotation-t1-risk40-core2',
    label: 'T+1 风险调整轮动 + 50%宽基核心',
    executable: true,
    tPlusProxy: false,
    run: (scenario) => runEtfMomentumBacktest({
      startDate: scenario.startDate,
      endDate: scenario.endDate,
      signalExecution: 'next_open',
      netRebalance: true,
      riskAdjustedMomentum: true,
      maxAssetVolPct: 40,
      bullBenchmarkSlotCount: 2,
      bullBenchmarkSlotMomentumPct: 4,
    }),
  },
  {
    id: 'rotation-t1-risk40-core2-stop6',
    label: 'T+1 风险调整+50%宽基核心+止损',
    executable: true,
    tPlusProxy: false,
    run: (scenario) => runEtfMomentumBacktest({
      startDate: scenario.startDate,
      endDate: scenario.endDate,
      signalExecution: 'next_open',
      netRebalance: true,
      riskAdjustedMomentum: true,
      maxAssetVolPct: 40,
      bullBenchmarkSlotCount: 2,
      bullBenchmarkSlotMomentumPct: 4,
      stopLossPct: -6,
      stopCooldownDays: 20,
    }),
  },
  {
    id: 'rotation-t1-risk40-permanent-core',
    label: 'T+1 风险调整 + 25%永久宽基/强势50%',
    executable: true,
    tPlusProxy: false,
    run: (scenario) => runEtfMomentumBacktest({
      startDate: scenario.startDate,
      endDate: scenario.endDate,
      signalExecution: 'next_open',
      netRebalance: true,
      riskAdjustedMomentum: true,
      maxAssetVolPct: 40,
      minimumBenchmarkSlotCount: 1,
      bullBenchmarkSlotCount: 2,
      bullBenchmarkSlotMomentumPct: 4,
      stopLossPct: -6,
      stopCooldownDays: 20,
    }),
  },
  {
    id: 'rotation-t1-risk40-core50-75',
    label: 'T+1 风险调整 + 50%宽基/强势75%',
    executable: true,
    tPlusProxy: false,
    run: (scenario) => runEtfMomentumBacktest({
      startDate: scenario.startDate,
      endDate: scenario.endDate,
      signalExecution: 'next_open',
      netRebalance: true,
      riskAdjustedMomentum: true,
      maxAssetVolPct: 40,
      minimumBenchmarkSlotCount: 2,
      bullBenchmarkSlotCount: 3,
      bullBenchmarkSlotMomentumPct: 4,
      stopLossPct: -6,
      stopCooldownDays: 20,
    }),
  },
  {
    id: 'rotation-t1-60',
    label: 'T+1 稳健轮动（60/50/15）',
    executable: true,
    tPlusProxy: false,
    run: (scenario) => runEtfMomentumBacktest({
      startDate: scenario.startDate,
      endDate: scenario.endDate,
      signalExecution: 'next_open',
      netRebalance: true,
      maxExposure: 0.6,
      weakRegimeMaxExposure: 0.5,
      bearRegimeMaxExposure: 0.15,
    }),
  },
  {
    id: 'rotation-t1-60-tplus',
    label: 'T+1 稳健轮动 + 正T代理',
    executable: false,
    tPlusProxy: true,
    run: (scenario) => runEtfMomentumBacktest({
      startDate: scenario.startDate,
      endDate: scenario.endDate,
      signalExecution: 'next_open',
      netRebalance: true,
      maxExposure: 0.6,
      weakRegimeMaxExposure: 0.5,
      bearRegimeMaxExposure: 0.15,
      tPlusEnabled: true,
    }),
  },
];

function annualizedReturnPct(row: ScenarioRow): number {
  const start = new Date(row.startDate.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'));
  const end = new Date(row.endDate.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'));
  const years = Math.max(1 / 252, (end.getTime() - start.getTime()) / (365 * 86_400_000));
  return Number((((1 + row.returnPct / 100) ** (1 / years) - 1) * 100).toFixed(2));
}

function renderMarkdown(report: ReturnType<typeof buildReport>): string {
  const lines = [
    `# ETF 全场景公平回测（截至 ${report.endDate}）`,
    '',
    '> 主策略统一采用 T 日收盘信号、T+1 开盘成交、滑点、佣金、最低佣金和整手约束。正T仍是日线 OHLC 代理，只作实验展示，不参与正式准入。',
    '',
    `- 验证状态：**${report.status}**`,
    `- 场景数量：${report.scenarioCount}`,
    '',
    '## 候选汇总',
    '',
    '| 方案 | 可执行 | 全历史年化 | 全历史回撤 | 正收益场景 | 跑赢基准场景 | 平均超额 | 准入 |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |',
    ...report.summaries.map((item) =>
      `| ${item.label} | ${item.executable ? '是' : '否（正T代理）'} | ${item.fullAnnualizedPct.toFixed(2)}% | ${item.fullMaxDrawdownPct.toFixed(2)}% | ${item.positiveCount}/${item.evaluationCount} | ${item.beatCount}/${item.evaluationCount} | ${item.averageExcessPct.toFixed(2)}% | ${item.gatePassed ? '通过' : '观察'} |`,
    ),
    '',
    '## 最近窗口',
    '',
    '| 区间 | 方案 | 收益 | 沪深300ETF | 超额 | 最大回撤 | 平均仓位 | 全现金日 |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...report.rows
      .filter((row) => row.category === 'recent')
      .map((row) =>
        `| ${row.scenario} | ${row.variant} | ${row.returnPct.toFixed(2)}% | ${row.benchmarkPct.toFixed(2)}% | ${row.excessPct.toFixed(2)}% | ${row.maxDrawdownPct.toFixed(2)}% | ${row.averageInvestedPct.toFixed(2)}% | ${row.allCashDayPct.toFixed(2)}% |`,
      ),
    '',
    '## 压力场景',
    '',
    '| 场景 | 方案 | 收益 | 基准 | 超额 | 最大回撤 | 成交 | 正T贡献 |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...report.rows
      .filter((row) => row.category === 'stress')
      .map((row) =>
        `| ${row.scenario} | ${row.variant} | ${row.returnPct.toFixed(2)}% | ${row.benchmarkPct.toFixed(2)}% | ${row.excessPct.toFixed(2)}% | ${row.maxDrawdownPct.toFixed(2)}% | ${row.tradeCount} | ${row.tPlusProfitPct.toFixed(2)}% |`,
      ),
    '',
    '## 固定参数滚动窗口',
    '',
    '> 下列窗口均使用同一组固定参数，属于跨时期稳健性检查，不冒充真正的事前样本外收益。',
    '',
    '| 窗口 | 方案 | 收益 | 基准 | 超额 | 最大回撤 |',
    '| --- | --- | ---: | ---: | ---: | ---: |',
    ...report.rows
      .filter((row) => row.category === 'rolling')
      .map((row) =>
        `| ${row.scenario} | ${row.variant} | ${row.returnPct.toFixed(2)}% | ${row.benchmarkPct.toFixed(2)}% | ${row.excessPct.toFixed(2)}% | ${row.maxDrawdownPct.toFixed(2)}% |`,
      ),
    '',
    '## 准入规则',
    '',
    '- 只允许 T+1 可执行主策略参与正式准入；正T日线代理必须先积累分钟级或模拟成交证据。',
    '- 全历史净年化至少 8%，最大回撤不深于 -20%。',
    '- 年度、近期和压力场景中至少 60% 跑赢沪深300，至少 60% 为正收益。',
    '- 最近1年和2年不能同时跑输沪深300。',
    '',
    '## 结论',
    '',
    ...report.lessons.map((lesson) => `- ${lesson}`),
    '',
  ];
  return lines.join('\n');
}

function buildReport(endDate: string, scenarios: Scenario[], rows: ScenarioRow[]) {
  const reportVariants = variants.filter((variant) => rows.some((row) => row.variantId === variant.id));
  const summaries = reportVariants.map((variant) => {
    const items = rows.filter((row) => row.variantId === variant.id && row.category !== 'full');
    const full = rows.find((row) => row.variantId === variant.id && row.category === 'full')!;
    const recent1y = rows.find((row) => row.variantId === variant.id && row.scenarioId === 'recent-1y')!;
    const recent2y = rows.find((row) => row.variantId === variant.id && row.scenarioId === 'recent-2y')!;
    const beatCount = items.filter((row) => row.excessPct > 0).length;
    const positiveCount = items.filter((row) => row.returnPct > 0).length;
    const averageExcessPct = Number(
      (items.reduce((sum, row) => sum + row.excessPct, 0) / Math.max(1, items.length)).toFixed(2),
    );
    const fullAnnualizedPct = annualizedReturnPct(full);
    const gatePassed = variant.executable
      && !variant.tPlusProxy
      && fullAnnualizedPct >= 8
      && full.maxDrawdownPct >= -20
      && beatCount / Math.max(1, items.length) >= 0.6
      && positiveCount / Math.max(1, items.length) >= 0.6
      && !(recent1y.excessPct < 0 && recent2y.excessPct < 0);
    return {
      id: variant.id,
      label: variant.label,
      executable: variant.executable,
      evaluationCount: items.length,
      beatCount,
      positiveCount,
      averageExcessPct,
      fullAnnualizedPct,
      fullMaxDrawdownPct: full.maxDrawdownPct,
      gatePassed,
    };
  });
  const passed = summaries.filter((item) => item.gatePassed);
  return {
    generatedAt: new Date().toISOString(),
    endDate,
    scenarioCount: scenarios.length,
    status: passed.length > 0 ? 'paper_candidate' : 'needs_iteration',
    summaries,
    rows,
    lessons: [
      passed.length > 0
        ? `正式准入候选：${passed.map((item) => item.label).join('、')}；仍只允许模拟盘观察。`
        : '没有可执行候选同时通过收益、回撤、跨场景和近期超额门槛；长青一号继续暂停自动新开仓。',
      '正T代理单列展示，不能用日线最低价与收盘价推导的利润替代真实分钟成交。',
      '多资产 V2 的永久硬风控已修复，但若近期超额和跨起点稳定性仍不合格，不恢复为默认策略。',
    ],
  };
}

async function main() {
  const endDate = argValue('to') ?? '2026-07-10';
  const scenarios = buildScenarios(endDate);
  const rows: ScenarioRow[] = [];
  const finalVariantIds = new Set([
    'evergreen-v3-60-40',
    'multi-asset-v2-fixed',
    'rotation-t1-risk40-stop6',
    'rotation-t1-60',
    'rotation-t1-60-tplus',
  ]);
  const selectedVariants = argValue('research') === '1'
    ? variants
    : variants.filter((variant) => finalVariantIds.has(variant.id));
  for (const scenario of scenarios) {
    for (const variant of selectedVariants) {
      const result = await variant.run(scenario);
      const exposure = exposureStats(result);
      const returnPct = result.equityCurve?.at(-1)?.returnPct ?? 0;
      const benchmarkPct = result.benchmark?.finalReturnPct ?? 0;
      rows.push({
        scenarioId: scenario.id,
        scenario: scenario.label,
        category: scenario.category,
        startDate: result.startDate ?? scenario.startDate,
        endDate: result.endDate ?? scenario.endDate,
        variantId: variant.id,
        variant: variant.label,
        returnPct: Number(returnPct.toFixed(2)),
        benchmarkPct: Number(benchmarkPct.toFixed(2)),
        excessPct: Number((returnPct - benchmarkPct).toFixed(2)),
        maxDrawdownPct: maxDrawdownPct(result),
        averageInvestedPct: exposure.averageInvestedPct,
        allCashDayPct: exposure.allCashDayPct,
        tradeCount: result.metrics.validTradeCount,
        tPlusTradeCount: result.config?.tPlusTradeCount ?? 0,
        tPlusProfitPct: result.config?.tPlusTotalProfitPct ?? 0,
      });
    }
  }
  const report = buildReport(endDate, scenarios, rows);
  const repoRoot = path.resolve(PACKAGE_ROOT, '../..');
  const outputDir = path.join(repoRoot, 'docs/backtests');
  mkdirSync(outputDir, { recursive: true });
  const baseName = argValue('output') ?? `etf-evergreen-compare-${endDate.replace(/-/g, '')}`;
  const jsonPath = path.join(outputDir, `${baseName}.json`);
  const markdownPath = path.join(outputDir, `${baseName}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  writeFileSync(markdownPath, `${renderMarkdown(report)}\n`, 'utf-8');
  process.stdout.write(JSON.stringify({ ...report, jsonPath, markdownPath }, null, 2));
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});

import '../config/load-env.js';

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  runEtfStableV2Backtest,
  type EtfStableV2BacktestResult,
} from '../data/backtest/etf-stable-v2.js';
import { saveBacktestRun } from '../data/backtest/store.js';
import { formatTradeDateKey, todayDateKey } from '../data/backtest/date-range.js';
import { PACKAGE_ROOT } from '../mastra/config/paths.js';

type Scenario = {
  name: string;
  startDate: string;
  endDate: string;
};

type ScenarioResult = {
  name: string;
  startDate: string;
  endDate: string;
  returnPct: number;
  annualizedReturnPct: number | null;
  benchmarkPct: number | null;
  maxDrawdownPct: number | null;
  rolling12mPositivePct: number | null;
  tradeCount: number;
};

type RobustnessResult = {
  rebalanceDays: number;
  targetVolPct: number;
  annualizedReturnPct: number | null;
  maxDrawdownPct: number | null;
  calmarRatio: number | null;
  rolling12mPositivePct: number | null;
  passedReleaseGate: boolean;
};

type ValidationSummary = {
  status: 'paper_observe' | 'paper_candidate' | 'reject';
  robustnessPassPct: number;
  reasons: string[];
};

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function hasArg(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

function normalizeDate(value: string | undefined, fallback: string): string {
  const raw = value?.replace(/-/g, '');
  return raw && /^\d{8}$/.test(raw)
    ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
    : fallback;
}

function fixedScenarios(endDate: string): Scenario[] {
  return [
    { name: '2015 高波动牛熊切换', startDate: '2015-01-05', endDate: '2015-12-31' },
    { name: '2018 单边熊市', startDate: '2018-01-02', endDate: '2018-12-28' },
    { name: '2020 疫情急跌', startDate: '2020-01-02', endDate: '2020-03-31' },
    { name: '2020-2021 趋势行情', startDate: '2020-04-01', endDate: '2021-02-18' },
    { name: '2022 熊市', startDate: '2022-01-04', endDate: '2022-12-30' },
    { name: '2023 震荡市', startDate: '2023-01-03', endDate: '2023-12-29' },
    { name: '2024 急涨急跌', startDate: '2024-01-02', endDate: '2024-12-31' },
    { name: '样本外：2025 至今', startDate: '2025-01-02', endDate },
  ];
}

function scenarioRow(name: string, result: EtfStableV2BacktestResult): ScenarioResult {
  return {
    name,
    startDate: result.startDate ?? '',
    endDate: result.endDate ?? '',
    returnPct: result.stableMetrics.totalReturnPct,
    annualizedReturnPct: result.stableMetrics.annualizedReturnPct,
    benchmarkPct: result.benchmark?.finalReturnPct ?? null,
    maxDrawdownPct: result.stableMetrics.maxDrawdownPct,
    rolling12mPositivePct: result.stableMetrics.rolling12mPositivePct,
    tradeCount: result.trades.length,
  };
}

function pct(value: number | null | undefined): string {
  return value == null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function number(value: number | null | undefined, digits = 2): string {
  return value == null ? '—' : value.toFixed(digits);
}

function renderReport(input: {
  result: EtfStableV2BacktestResult;
  scenarios: ScenarioResult[];
  costStress: EtfStableV2BacktestResult;
  robustness: RobustnessResult[];
  validation: ValidationSummary;
  runId: string | null;
}): string {
  const { result, scenarios, costStress } = input;
  const metrics = result.stableMetrics;
  const topAttribution = result.attribution.bySymbol.slice(0, 6);
  const bottomAttribution = result.attribution.bySymbol.slice(-4).reverse();
  return [
    `# 长青一号（ETF Stable V2）历史回测（${result.startDate} ~ ${result.endDate}）`,
    '',
    '> 本报告使用 T 日收盘信号、T+1 开盘执行，包含滑点、佣金、最低佣金和整手约束。历史结果仅是策略验证，不构成收益保证。',
    '',
    '## 结论',
    '',
    `- 综合状态：**${input.validation.status}**`,
    `- 基础历史门槛：${result.review.status}；参数邻域通过率 ${input.validation.robustnessPassPct.toFixed(2)}%。`,
    ...input.validation.reasons.map((reason) => `- ${reason}`),
    `- 回测记录：${input.runId ?? '本次未写入数据库'}`,
    '',
    '## 核心指标',
    '',
    '| 指标 | 长青一号（Stable V2） | 沪深300ETF基准 |',
    '| --- | ---: | ---: |',
    `| 累计收益 | ${pct(metrics.totalReturnPct)} | ${pct(result.benchmark?.finalReturnPct)} |`,
    `| 复合年化 | ${pct(metrics.annualizedReturnPct)} | — |`,
    `| 年化波动 | ${pct(metrics.annualizedVolPct)} | — |`,
    `| 最大回撤 | ${pct(metrics.maxDrawdownPct)} | — |`,
    `| Sharpe | ${number(metrics.sharpeRatio, 3)} | — |`,
    `| Sortino | ${number(metrics.sortinoRatio, 3)} | — |`,
    `| Calmar | ${number(metrics.calmarRatio, 3)} | — |`,
    `| 滚动12个月正收益率 | ${pct(metrics.rolling12mPositivePct)} | — |`,
    `| 正收益年份比例 | ${pct(metrics.positiveYearPct)} | — |`,
    `| 平均风险资产仓位 | ${pct(metrics.averageRiskAssetPct)} | — |`,
    `| 累计换手 | ${pct(metrics.turnoverPct)} | — |`,
    `| 累计交易成本 | ¥${metrics.totalTradingCost.toFixed(2)}（${pct(metrics.tradingCostPct)}） | — |`,
    '',
    '## 年度收益',
    '',
    '| 年份 | 收益 |',
    '| --- | ---: |',
    ...result.annualReturns.map((row) => `| ${row.year} | ${pct(row.returnPct)} |`),
    '',
    '## 固定压力场景',
    '',
    '> 每个场景在区间起点以全现金独立启动，重新建立风险状态；因此可能与全历史回测中的同一自然年度不同。',
    '',
    '| 场景 | 区间 | 策略收益 | 沪深300ETF | 最大回撤 | 成交数 |',
    '| --- | --- | ---: | ---: | ---: | ---: |',
    ...scenarios.map(
      (row) =>
        `| ${row.name} | ${row.startDate} ~ ${row.endDate} | ${pct(row.returnPct)} | ${pct(row.benchmarkPct)} | ${pct(row.maxDrawdownPct)} | ${row.tradeCount} |`,
    ),
    '',
    '## 成本压力',
    '',
    `- 基准成本：佣金 ${(Number(result.config?.commissionRate ?? 0) * 100).toFixed(3)}%，滑点 ${(Number(result.config?.slippageRate ?? 0) * 100).toFixed(3)}%，最低佣金 ¥${result.config?.minimumCommission ?? 0}。`,
    `- 双倍成本：累计收益 ${pct(costStress.stableMetrics.totalReturnPct)}，年化 ${pct(costStress.stableMetrics.annualizedReturnPct)}，最大回撤 ${pct(costStress.stableMetrics.maxDrawdownPct)}。`,
    '',
    '## 参数邻域稳健性',
    '',
    '> 下表只检查默认参数附近是否大面积失效，不使用结果反向挑选最优参数。',
    '',
    '| 调仓日 | 波动率上限 | 年化 | 最大回撤 | Calmar | 滚动12月为正 | 门槛 |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | --- |',
    ...input.robustness.map(
      (row) =>
        `| ${row.rebalanceDays} | ${row.targetVolPct}% | ${pct(row.annualizedReturnPct)} | ${pct(row.maxDrawdownPct)} | ${number(row.calmarRatio, 3)} | ${pct(row.rolling12mPositivePct)} | ${row.passedReleaseGate ? '通过' : '观察'} |`,
    ),
    '',
    '## 收益归因',
    '',
    '贡献最高：',
    ...topAttribution.map(
      (item) => `- ${item.name}（${item.symbol}）：已实现 ¥${item.realizedPnl.toFixed(2)}，${item.tradeCount} 笔。`,
    ),
    '',
    '拖累最大：',
    ...bottomAttribution.map(
      (item) => `- ${item.name}（${item.symbol}）：已实现 ¥${item.realizedPnl.toFixed(2)}，${item.tradeCount} 笔。`,
    ),
    '',
    '## 门槛检查',
    '',
    ...result.review.passedChecks.map((item) => `- ✅ ${item}`),
    ...result.review.failedChecks.map((item) => `- ❌ ${item}`),
    '',
    '## 本轮经验',
    '',
    ...result.review.lessons.map((item) => `- ${item}`),
    '',
    '## 下一轮',
    '',
    ...result.review.nextActions.map((item) => `- ${item}`),
    '',
    '## 已知限制',
    '',
    '- 使用当前存续 ETF 固定池，存在存续标的选择偏差。',
    '- 日线无法模拟盘中流动性枯竭、涨跌停、跨境 ETF 实时 IOPV 溢价和大额冲击成本。',
    '- 前复权数据适合收益研究，但与真实现金分红、税费到账路径不完全一致。',
    '- 策略参数经过历史验证仍可能失效；任何参数改动必须经过固定场景、滚动窗口和样本外验证。',
    '',
  ].join('\n');
}

async function main() {
  const today = formatTradeDateKey(todayDateKey());
  const startDate = normalizeDate(argValue('from'), '2014-01-01');
  const endDate = normalizeDate(argValue('to'), today);
  const result = await runEtfStableV2Backtest({ startDate, endDate });
  const scenarioResults: ScenarioResult[] = [];
  for (const scenario of fixedScenarios(endDate)) {
    if (scenario.startDate > endDate) continue;
    const scenarioEnd = scenario.endDate > endDate ? endDate : scenario.endDate;
    const run = await runEtfStableV2Backtest({
      startDate: scenario.startDate,
      endDate: scenarioEnd,
    });
    scenarioResults.push(scenarioRow(scenario.name, run));
  }
  const costStress = await runEtfStableV2Backtest({
    startDate,
    endDate,
    commissionRate: Number(result.config?.commissionRate ?? 0.0003) * 2,
    slippageRate: Number(result.config?.slippageRate ?? 0.0005) * 2,
    minimumCommission: Number(result.config?.minimumCommission ?? 5) * 2,
  });
  const robustness: RobustnessResult[] = [];
  for (const rebalanceDays of [15, 20, 25]) {
    for (const targetPortfolioVolPct of [10, 12, 14]) {
      const run = await runEtfStableV2Backtest({
        startDate,
        endDate,
        rebalanceDays,
        targetPortfolioVolPct,
      });
      const metrics = run.stableMetrics;
      robustness.push({
        rebalanceDays,
        targetVolPct: targetPortfolioVolPct,
        annualizedReturnPct: metrics.annualizedReturnPct,
        maxDrawdownPct: metrics.maxDrawdownPct,
        calmarRatio: metrics.calmarRatio,
        rolling12mPositivePct: metrics.rolling12mPositivePct,
        passedReleaseGate:
          (metrics.annualizedReturnPct ?? -Infinity) >= 8
          && Math.abs(metrics.maxDrawdownPct ?? -100) <= 15
          && (metrics.rolling12mPositivePct ?? 0) >= 70
          && (metrics.calmarRatio ?? 0) >= 0.8,
      });
    }
  }
  const robustnessPassPct = robustness.length > 0
    ? (robustness.filter((item) => item.passedReleaseGate).length / robustness.length) * 100
    : 0;
  const outOfSample = scenarioResults.find((item) => item.name.startsWith('样本外'));
  const validation: ValidationSummary = {
    status:
      result.review.status === 'reject'
        ? 'reject'
        : result.review.status === 'eligible_for_paper'
          && robustnessPassPct >= 60
          && (costStress.stableMetrics.annualizedReturnPct ?? -Infinity) >= 8
          && (outOfSample?.annualizedReturnPct ?? -Infinity) >= 8
          ? 'paper_candidate'
          : 'paper_observe',
    robustnessPassPct: Number(robustnessPassPct.toFixed(2)),
    reasons: [
      robustnessPassPct < 60
        ? '默认参数附近的严格门槛通过率不足 60%，说明结果仍有参数敏感性。'
        : '默认参数附近多数严格门槛通过。',
      (costStress.stableMetrics.annualizedReturnPct ?? -Infinity) < 8
        ? '双倍成本年化低于 8%，交易成本仍是主要风险。'
        : '双倍成本仍达到 8% 年化门槛。',
      (outOfSample?.annualizedReturnPct ?? -Infinity) < 8
        ? '2025 至今样本外年化低于 8%，当前市场阶段尚未证明目标收益。'
        : '2025 至今样本外年化达到 8%。',
    ],
  };
  (result as EtfStableV2BacktestResult & { validation: ValidationSummary }).validation = validation;
  const saved = hasArg('no-save')
    ? null
    : await saveBacktestRun(result, {
        source: 'etf-stable-v2-cli',
        args: process.argv.slice(2),
      });

  const repoRoot = path.resolve(PACKAGE_ROOT, '../..');
  const outputDir = path.join(repoRoot, 'docs/backtests');
  mkdirSync(outputDir, { recursive: true });
  const reportDate = today.replace(/-/g, '');
  const baseName = argValue('output') ?? `etf-stable-v2-${reportDate}`;
  const markdownPath = path.join(outputDir, `${baseName}.md`);
  const jsonPath = path.join(outputDir, `${baseName}.json`);
  const report = renderReport({
    result,
    scenarios: scenarioResults,
    costStress,
    robustness,
    validation,
    runId: saved?.id ?? null,
  });
  writeFileSync(markdownPath, report, 'utf-8');
  writeFileSync(
    jsonPath,
    `${JSON.stringify({
      result,
      scenarios: scenarioResults,
      costStress: costStress.stableMetrics,
      robustness,
      validation,
    }, null, 2)}\n`,
    'utf-8',
  );
  process.stdout.write(
    `${JSON.stringify({
      runId: saved?.id ?? null,
      markdownPath,
      jsonPath,
      metrics: result.stableMetrics,
      review: result.review,
      scenarios: scenarioResults,
      costStress: costStress.stableMetrics,
      robustness,
      validation,
    }, null, 2)}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});

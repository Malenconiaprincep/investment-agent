import '../config/load-env.js';

import { writeFileSync } from 'node:fs';

import { runDiamondBacktest } from '../data/backtest/diamond.js';
import { saveBacktestRun } from '../data/backtest/store.js';

type YearWindow = {
  name: string;
  from: string;
  to: string;
};

type YearRow = {
  name: string;
  from: string;
  to: string;
  runId: string;
  final: number | null;
  bench: number | null;
  excess: number | null;
  mdd: number | null;
  trades: number;
  win: number | null;
  avg: number | null;
  median: number | null;
  worst: number | null;
  best: number | null;
  raw: number | null;
  qualityBlocked: number | null;
  marketBlocked: number | null;
  portfolioSkipped: number | null;
  idlePct: number | null;
};

const windows: YearWindow[] = [
  { name: '2018', from: '2018-01-02', to: '2018-12-28' },
  { name: '2019', from: '2019-01-02', to: '2019-12-31' },
  { name: '2020', from: '2020-01-02', to: '2020-12-31' },
  { name: '2021', from: '2021-01-04', to: '2021-12-31' },
  { name: '2022', from: '2022-01-04', to: '2022-12-30' },
  { name: '2023', from: '2023-01-03', to: '2023-12-29' },
  { name: '2024', from: '2024-01-02', to: '2024-12-31' },
  { name: '2025', from: '2025-01-02', to: '2025-12-31' },
  { name: '2026 YTD', from: '2026-01-02', to: '2026-07-03' },
  { name: '2018-2026', from: '2018-01-02', to: '2026-07-03' },
];

function round(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(2));
}

function pct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function valueOrDash(value: number | null | undefined): string {
  return value == null ? '—' : String(value);
}

async function runWindow(window: YearWindow): Promise<YearRow> {
  process.stderr.write(`running ${window.name} ${window.from} ${window.to}\n`);
  const result = await runDiamondBacktest({
    symbols: [],
    universe: 'retail-stock',
    strategy: 'red-diamond-momentum',
    startDate: window.from,
    endDate: window.to,
    initialCapital: 100_000,
  });
  const record = await saveBacktestRun(result, {
    source: 'yearly-stock-momentum-report',
    args: [
      'diamond-momentum',
      'all',
      '--universe=retail-stock',
      `--from=${window.from}`,
      `--to=${window.to}`,
      '--capital=100000',
    ],
  });

  const final = round(result.equityCurve?.at(-1)?.returnPct);
  const bench = round(result.benchmark?.finalReturnPct);
  return {
    name: window.name,
    from: result.startDate ?? window.from,
    to: result.endDate ?? window.to,
    runId: record.id,
    final,
    bench,
    excess: final != null && bench != null ? round(final - bench) : null,
    mdd: round(result.metrics.maxDrawdownPct),
    trades: result.trades.length,
    win: round(result.metrics.winRatePct),
    avg: round(result.metrics.avgReturnPct),
    median: round(result.metrics.medianReturnPct),
    worst: round(result.metrics.worstReturnPct),
    best: round(result.metrics.bestReturnPct),
    raw: result.config?.rawSignalCount ?? null,
    qualityBlocked: result.config?.qualityBlockedCount ?? null,
    marketBlocked: result.config?.marketBlockedCount ?? null,
    portfolioSkipped: result.config?.portfolioSkippedCount ?? null,
    idlePct: round(result.config?.stockIdleDayPct),
  };
}

function buildReport(rows: YearRow[]): string {
  const generatedAt = new Date().toISOString();
  const lines = [
    '# A 股动量启动策略年度回测汇总',
    '',
    `- 生成时间：${generatedAt}`,
    '- 策略：动量启动信号 + 延迟 2 个交易日确认 + 8 元最低价 + 大盘强势过滤 + 5 仓组合',
    '- 资金：100,000 元；股票池：本地全市场普通 A 股，排除 688/689 科创板',
    '- 结果已写入回测记录库；表内 runId 可在回测历史中打开。',
    '',
    '| 年度 | 区间 | 策略收益 | 沪深300ETF | 超额 | 最大回撤 | 交易数 | 胜率 | 单笔均值 | 单笔中位 | 最差单笔 | 最好单笔 | 原始信号 | 质量过滤 | 大盘过滤 | 组合过滤 | 空仓日占比 | runId |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  ];

  for (const row of rows) {
    lines.push(
      `| ${row.name} | ${row.from} ~ ${row.to} | ${pct(row.final)} | ${pct(row.bench)} | ${pct(row.excess)} | ${pct(row.mdd)} | ${row.trades} | ${pct(row.win)} | ${pct(row.avg)} | ${pct(row.median)} | ${pct(row.worst)} | ${pct(row.best)} | ${valueOrDash(row.raw)} | ${valueOrDash(row.qualityBlocked)} | ${valueOrDash(row.marketBlocked)} | ${valueOrDash(row.portfolioSkipped)} | ${pct(row.idlePct)} | ${row.runId} |`,
    );
  }

  const yearlyRows = rows.filter((row) => row.name !== '2018-2026');
  const best = [...yearlyRows].sort(
    (a, b) => (b.excess ?? -Infinity) - (a.excess ?? -Infinity),
  )[0];
  const weakest = [...yearlyRows].sort(
    (a, b) => (a.excess ?? Infinity) - (b.excess ?? Infinity),
  )[0];
  const drawdown = [...yearlyRows].sort(
    (a, b) => (a.mdd ?? Infinity) - (b.mdd ?? Infinity),
  )[0];
  const positiveYears = yearlyRows.filter((row) => (row.final ?? -Infinity) > 0).length;
  const beatYears = yearlyRows.filter((row) => (row.excess ?? -Infinity) > 0).length;

  lines.push(
    '',
    '## 观察',
    '',
    `- 正收益年份：${positiveYears}/${yearlyRows.length}；跑赢沪深300ETF年份：${beatYears}/${yearlyRows.length}。`,
    `- 年度超额最好：${best?.name ?? '—'}，超额 ${pct(best?.excess)}。`,
    `- 年度超额最弱：${weakest?.name ?? '—'}，超额 ${pct(weakest?.excess)}。`,
    `- 年度最大回撤压力：${drawdown?.name ?? '—'}，最大回撤 ${pct(drawdown?.mdd)}。`,
    '- 注意：回测按日线收盘确认，模拟盘实际按次日盘口价成交，实盘会有滑点和无法成交风险。',
    '',
  );

  return lines.join('\n');
}

async function main() {
  const rows: YearRow[] = [];
  for (const window of windows) {
    const row = await runWindow(window);
    rows.push(row);
    process.stdout.write(`${JSON.stringify(row)}\n`);
  }

  const reportPath =
    '/Users/wangbo/workspace/study/investment-agent/docs/backtests/stock-momentum-yearly-2026-07-03.md';
  writeFileSync(reportPath, buildReport(rows));
  process.stdout.write(JSON.stringify({ savedReport: reportPath, rows: rows.length }));
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});

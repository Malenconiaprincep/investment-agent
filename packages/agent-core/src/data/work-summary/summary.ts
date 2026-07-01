import { readFileSync } from 'node:fs';
import { listBacktestRuns, type BacktestRunRecord } from '../backtest/store.js';
import { listEtfTailPickRuns } from '../etf/store.js';
import { getLatestMonitorPollRun, listMonitorAlerts } from '../monitor/store.js';
import {
  getPaperDualSummary,
  listEquitySnapshots,
  listPaperTrades,
} from '../paper/store.js';
import { listResearchReports } from '../reports/store.js';
import { listScreeningSessions } from '../screening/store.js';
import {
  listDiamondSignals,
  listLatestSnapshots,
  listWatchlistItems,
  listWeeklyReviews,
} from '../watchlist/store.js';
import { getEvalReportPath, type EvalReport } from '../../eval/report-store.js';

export type WorkSummaryDataSourceStatus = 'good' | 'stale' | 'empty';
export type WorkSummaryHealthStatus = 'strong' | 'watch' | 'weak' | 'empty';

export type WorkSummaryDataSource = {
  key: string;
  label: string;
  count: number;
  latestAt: string | null;
  status: WorkSummaryDataSourceStatus;
};

export type WorkSummaryScore = {
  overall: number;
  grade: 'A' | 'B' | 'C' | 'D';
  components: Array<{
    key: string;
    label: string;
    score: number;
    detail: string;
  }>;
};

export type WorkSummaryLoopStep = {
  key: string;
  label: string;
  score: number;
  status: WorkSummaryHealthStatus;
  headline: string;
  detail: string;
};

export type WorkSummaryStrategyHealth = {
  key: string;
  label: string;
  score: number;
  status: WorkSummaryHealthStatus;
  evidence: string;
  suggestion: string;
};

export type WorkSummaryReport = {
  generatedAt: string;
  score: WorkSummaryScore;
  conclusion: string;
  coverage: {
    score: number;
    sources: WorkSummaryDataSource[];
  };
  performance: {
    paperReturnPct: number | null;
    paperTotalValue: number | null;
    paperInitialCash: number | null;
    equityTrend: 'up' | 'down' | 'flat' | 'unknown';
    backtestAvgReturnPct: number | null;
    profitableBacktestCount: number;
    backtestCount: number;
    bestBacktest: BacktestRunRecord | null;
    worstBacktest: BacktestRunRecord | null;
  };
  risk: {
    score: number;
    openPositionCount: number;
    unacknowledgedAlerts: number;
    urgentAlerts: number;
    worstWatchlistReturnPct: number | null;
    exposurePct: number | null;
  };
  loop: WorkSummaryLoopStep[];
  strategyHealth: WorkSummaryStrategyHealth[];
  optimizationQueue: string[];
  dailyFocus: string[];
  weeklyFocus: string[];
  monthlyFocus: string[];
  evalReport: EvalReport | null;
};

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function latestDate(values: Array<string | null | undefined>): string | null {
  const dates = values.filter((value): value is string => Boolean(value));
  if (dates.length === 0) return null;
  return dates.sort((a, b) => b.localeCompare(a))[0] ?? null;
}

function daysSince(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.floor((now.getTime() - time) / 86_400_000);
}

function sourceStatus(
  count: number,
  latestAt: string | null,
  now: Date,
  staleDays = 7,
): WorkSummaryDataSourceStatus {
  if (count <= 0) return 'empty';
  const age = daysSince(latestAt, now);
  if (age != null && age > staleDays) return 'stale';
  return 'good';
}

function sourceScore(status: WorkSummaryDataSourceStatus): number {
  if (status === 'good') return 100;
  if (status === 'stale') return 55;
  return 0;
}

function healthStatus(score: number): WorkSummaryHealthStatus {
  if (score >= 75) return 'strong';
  if (score >= 50) return 'watch';
  if (score > 0) return 'weak';
  return 'empty';
}

function gradeForScore(score: number): WorkSummaryScore['grade'] {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  return 'D';
}

function formatPct(value: number | null): string {
  if (value == null) return '无数据';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function readEvalReport(): EvalReport | null {
  try {
    return JSON.parse(readFileSync(getEvalReportPath(), 'utf-8')) as EvalReport;
  } catch {
    return null;
  }
}

function rankBacktests(backtests: BacktestRunRecord[]) {
  const withReturn = backtests.filter(
    (run): run is BacktestRunRecord & { finalReturnPct: number } =>
      typeof run.finalReturnPct === 'number' && Number.isFinite(run.finalReturnPct),
  );
  const sorted = [...withReturn].sort((a, b) => b.finalReturnPct - a.finalReturnPct);
  return {
    values: withReturn.map((run) => run.finalReturnPct),
    best: sorted[0] ?? null,
    worst: sorted.at(-1) ?? null,
    profitable: withReturn.filter((run) => run.finalReturnPct > 0).length,
  };
}

function buildConclusion(score: number, paperReturnPct: number | null, riskScore: number) {
  if (score >= 80 && (paperReturnPct ?? 0) >= 0 && riskScore >= 70) {
    return '系统闭环运转良好，可以继续放大有效策略样本，同时保持风险阈值。';
  }
  if (score >= 60) {
    return '系统已有可复盘证据，但收益、风险或验证覆盖仍需补强，当前更适合稳态观察和小步迭代。';
  }
  return '系统复盘证据不足或表现偏弱，优先补齐数据闭环、确认信号有效性，再考虑扩大自动执行。';
}

export async function buildWorkSummaryReport(): Promise<WorkSummaryReport> {
  const now = new Date();
  const [
    watchlist,
    latestSnapshots,
    diamondSignals,
    monitorAlerts,
    latestMonitorRun,
    paper,
    etfEquity,
    stockEquity,
    paperTrades,
    backtests,
    reports,
    screenings,
    etfRuns,
    weeklyReviews,
  ] = await Promise.all([
    listWatchlistItems(),
    listLatestSnapshots(),
    listDiamondSignals(80),
    listMonitorAlerts({ limit: 100 }),
    getLatestMonitorPollRun(),
    getPaperDualSummary(),
    listEquitySnapshots(90, 'etf'),
    listEquitySnapshots(90, 'stock'),
    listPaperTrades(100),
    listBacktestRuns(40),
    listResearchReports({ limit: 60 }),
    listScreeningSessions({ limit: 50 }),
    listEtfTailPickRuns(30),
    listWeeklyReviews(12),
  ]);
  const evalReport = readEvalReport();

  const paperReturnPct = paper.combined.returnPct;
  const marketValue = paper.etf.marketValue + paper.stock.marketValue;
  const paperInitialCash = paper.combined.initialCash;
  const exposurePct =
    paper.combined.totalValue > 0
      ? Number(((marketValue / paper.combined.totalValue) * 100).toFixed(2))
      : null;
  const openPositionCount = paper.etf.positions.length + paper.stock.positions.length;
  const equityReturns = [...etfEquity, ...stockEquity].map((point) => point.returnPct);
  const firstEquityReturn = equityReturns[0];
  const lastEquityReturn = equityReturns.at(-1);
  const equityTrend =
    firstEquityReturn == null || lastEquityReturn == null
      ? 'unknown'
      : lastEquityReturn > firstEquityReturn + 0.5
        ? 'up'
        : lastEquityReturn < firstEquityReturn - 0.5
          ? 'down'
          : 'flat';

  const backtestRank = rankBacktests(backtests);
  const backtestAvgReturnPct = avg(backtestRank.values);
  const unacknowledgedAlerts = monitorAlerts.filter((alert) => !alert.acknowledged).length;
  const urgentAlerts = monitorAlerts.filter((alert) => alert.severity === 'urgent').length;
  const worstWatchlistReturnPct = latestSnapshots
    .map((snapshot) => snapshot.vsEntryPct)
    .filter((value): value is number => typeof value === 'number')
    .sort((a, b) => a - b)[0] ?? null;

  const sources: WorkSummaryDataSource[] = [
    {
      key: 'signals',
      label: '信号',
      count: diamondSignals.length,
      latestAt: latestDate(diamondSignals.map((item) => item.createdAt)),
      status: 'empty',
    },
    {
      key: 'monitor',
      label: '监控雷达',
      count: monitorAlerts.length + (latestMonitorRun ? 1 : 0),
      latestAt: latestDate([
        latestMonitorRun?.createdAt,
        ...monitorAlerts.map((item) => item.createdAt),
      ]),
      status: 'empty',
    },
    {
      key: 'watchlist',
      label: '跟踪池',
      count: watchlist.length,
      latestAt: latestDate(watchlist.map((item) => item.createdAt)),
      status: 'empty',
    },
    {
      key: 'paper',
      label: '模拟盘',
      count: paperTrades.length + openPositionCount,
      latestAt: latestDate(paperTrades.map((item) => item.tradedAt)),
      status: 'empty',
    },
    {
      key: 'backtest',
      label: '回测',
      count: backtests.length,
      latestAt: latestDate(backtests.map((item) => item.createdAt)),
      status: 'empty',
    },
    {
      key: 'reports',
      label: '研报',
      count: reports.length,
      latestAt: latestDate(reports.map((item) => item.createdAt)),
      status: 'empty',
    },
    {
      key: 'screenings',
      label: '智能选股',
      count: screenings.length,
      latestAt: latestDate(screenings.map((item) => item.createdAt)),
      status: 'empty',
    },
    {
      key: 'etf',
      label: 'ETF 轮动',
      count: etfRuns.length,
      latestAt: latestDate(etfRuns.map((item) => item.generatedAt)),
      status: 'empty',
    },
    {
      key: 'eval',
      label: 'Eval/Harness',
      count: evalReport ? 1 : 0,
      latestAt: evalReport?.ranAt ?? null,
      status: 'empty',
    },
  ].map((source) => ({
    ...source,
    status: sourceStatus(source.count, source.latestAt, now, source.key === 'eval' ? 14 : 7),
  }));

  const coverageScore = clampScore(
    sources.reduce((sum, source) => sum + sourceScore(source.status), 0) / sources.length,
  );
  const returnScore = clampScore(
    55 +
      Math.max(-25, Math.min(25, (paperReturnPct ?? 0) * 4)) +
      Math.max(-20, Math.min(20, (backtestAvgReturnPct ?? 0) * 1.5)),
  );
  const riskScore = clampScore(
    85 -
      urgentAlerts * 12 -
      Math.max(0, unacknowledgedAlerts - 5) * 2 -
      (worstWatchlistReturnPct != null && worstWatchlistReturnPct < -8 ? 12 : 0) -
      (exposurePct != null && exposurePct > 85 ? 8 : 0),
  );
  const validationScore = clampScore(
    35 +
      Math.min(30, backtests.length * 6) +
      Math.min(20, screenings.filter((item) => item.passed).length * 4) +
      (evalReport ? Math.min(15, evalReport.passRate * 0.15) : 0),
  );
  const iterationScore = clampScore(
    25 +
      Math.min(25, weeklyReviews.length * 8) +
      Math.min(25, reports.filter((item) => item.passed).length * 2) +
      (evalReport ? Math.min(25, evalReport.passRate * 0.25) : 0),
  );
  const overall = clampScore(
    coverageScore * 0.2 +
      returnScore * 0.25 +
      riskScore * 0.2 +
      validationScore * 0.2 +
      iterationScore * 0.15,
  );

  const score: WorkSummaryScore = {
    overall,
    grade: gradeForScore(overall),
    components: [
      {
        key: 'coverage',
        label: '数据闭环',
        score: coverageScore,
        detail: `${sources.filter((source) => source.status === 'good').length}/${sources.length} 个数据源近期有效`,
      },
      {
        key: 'return',
        label: '收益贡献',
        score: returnScore,
        detail: `模拟盘 ${formatPct(paperReturnPct)}，回测均值 ${formatPct(backtestAvgReturnPct)}`,
      },
      {
        key: 'risk',
        label: '风险控制',
        score: riskScore,
        detail: `${urgentAlerts} 个紧急告警，最差跟踪收益 ${formatPct(worstWatchlistReturnPct)}`,
      },
      {
        key: 'validation',
        label: '策略验证',
        score: validationScore,
        detail: `${backtests.length} 次回测，${screenings.length} 次选股，Eval ${evalReport ? formatPct(evalReport.passRate) : '无数据'}`,
      },
      {
        key: 'iteration',
        label: '迭代复盘',
        score: iterationScore,
        detail: `${weeklyReviews.length} 份周复盘，${reports.filter((item) => item.passed).length} 份合格研报`,
      },
    ],
  };

  const loop: WorkSummaryLoopStep[] = [
    {
      key: 'signal',
      label: '信号产生',
      score: clampScore(sourceScore(sources.find((s) => s.key === 'signals')?.status ?? 'empty')),
      status: healthStatus(sourceScore(sources.find((s) => s.key === 'signals')?.status ?? 'empty')),
      headline: `${diamondSignals.length} 条近期钻石信号`,
      detail: diamondSignals[0]
        ? `最新信号 ${diamondSignals[0].name} ${diamondSignals[0].strength === 'red' ? '红钻' : '蓝钻'}，评分 ${diamondSignals[0].score}`
        : '暂无可复盘信号，需要先产生或扫描信号。',
    },
    {
      key: 'monitor',
      label: '监控跟踪',
      score: clampScore(coverageScore - urgentAlerts * 5),
      status: healthStatus(clampScore(coverageScore - urgentAlerts * 5)),
      headline: `${watchlist.length} 只跟踪标的，${monitorAlerts.length} 条监控告警`,
      detail: latestMonitorRun
        ? `最近监控扫描 ${latestMonitorRun.tradeDate}，扫描 ${latestMonitorRun.symbolsScanned} 个标的。`
        : '尚未形成监控扫描记录。',
    },
    {
      key: 'execution',
      label: '模拟执行',
      score: returnScore,
      status: healthStatus(returnScore),
      headline: `模拟盘收益 ${formatPct(paperReturnPct)}`,
      detail: `当前 ${openPositionCount} 个持仓，仓位约 ${exposurePct == null ? '无数据' : `${exposurePct.toFixed(1)}%`}。`,
    },
    {
      key: 'risk-return',
      label: '收益/风险统计',
      score: clampScore((returnScore + riskScore) / 2),
      status: healthStatus(clampScore((returnScore + riskScore) / 2)),
      headline: `风险分 ${riskScore}，收益分 ${returnScore}`,
      detail: `权益趋势 ${equityTrend === 'up' ? '改善' : equityTrend === 'down' ? '走弱' : equityTrend === 'flat' ? '横盘' : '未知'}，未确认告警 ${unacknowledgedAlerts} 条。`,
    },
    {
      key: 'system-score',
      label: '系统评分',
      score: overall,
      status: healthStatus(overall),
      headline: `总分 ${overall}，评级 ${score.grade}`,
      detail: `由数据闭环、收益贡献、风险控制、策略验证和迭代复盘共同加权。`,
    },
    {
      key: 'review',
      label: '问题复盘',
      score: clampScore((riskScore + coverageScore) / 2),
      status: healthStatus(clampScore((riskScore + coverageScore) / 2)),
      headline:
        urgentAlerts > 0 || unacknowledgedAlerts > 0
          ? `${urgentAlerts} 个紧急告警，${unacknowledgedAlerts} 个未确认告警`
          : '暂无高优先级风险暴露',
      detail:
        coverageScore < 80
          ? '优先识别缺失数据源，避免把无数据误判成策略有效。'
          : '复盘重点转向信号误报、止损执行和收益归因。',
    },
    {
      key: 'optimization',
      label: '策略优化建议',
      score: iterationScore,
      status: healthStatus(iterationScore),
      headline: `${weeklyReviews.length} 份周复盘，Eval ${evalReport ? formatPct(evalReport.passRate) : '缺失'}`,
      detail: evalReport?.failures.length
        ? `Eval 有 ${evalReport.failures.length} 个失败项，应优先修复。`
        : '复盘与评测可作为下一轮策略迭代依据。',
    },
    {
      key: 'next-iteration',
      label: '下一轮迭代',
      score: clampScore((validationScore + iterationScore) / 2),
      status: healthStatus(clampScore((validationScore + iterationScore) / 2)),
      headline:
        backtests.length >= 5
          ? '已有回测样本，可进入参数对比'
          : '先补足回测样本，再扩大自动执行',
      detail: '下一轮重点比较调整前后的评分、模拟盘收益、风险告警和 Eval 通过率。',
    },
  ];

  const strategyHealth: WorkSummaryStrategyHealth[] = [
    {
      key: 'paper',
      label: '模拟盘执行',
      score: returnScore,
      status: healthStatus(returnScore),
      evidence: `累计收益 ${formatPct(paperReturnPct)}，最近成交 ${paperTrades.length} 条。`,
      suggestion:
        paperReturnPct != null && paperReturnPct < 0
          ? '复查自动买入来源、止损执行和单票仓位，先降低亏损来源权重。'
          : '继续沉淀成交来源标签，把盈利/亏损按信号类型归因。',
    },
    {
      key: 'backtest',
      label: '策略回测',
      score: validationScore,
      status: healthStatus(validationScore),
      evidence: `${backtests.length} 次记录，正收益 ${backtestRank.profitable}/${backtestRank.values.length}，均值 ${formatPct(backtestAvgReturnPct)}。`,
      suggestion:
        backtests.length < 5
          ? '增加不同市场阶段、不同持有期和参数组合的回测样本。'
          : '保留正收益且交易数足够的参数组合，淘汰稳定跑输的组合。',
    },
    {
      key: 'screening',
      label: '选股与信号',
      score: clampScore(35 + Math.min(35, screenings.length * 5) + Math.min(30, diamondSignals.length * 2)),
      status: healthStatus(clampScore(35 + Math.min(35, screenings.length * 5) + Math.min(30, diamondSignals.length * 2))),
      evidence: `${screenings.length} 次选股，${diamondSignals.length} 条钻石信号。`,
      suggestion: '把选股结果进入跟踪池后的 1/3/5/10 日表现作为信号胜率口径。',
    },
    {
      key: 'etf',
      label: 'ETF 轮动',
      score: clampScore(30 + Math.min(45, etfRuns.length * 8) + (paper.etf.returnPct > 0 ? 20 : 0)),
      status: healthStatus(clampScore(30 + Math.min(45, etfRuns.length * 8) + (paper.etf.returnPct > 0 ? 20 : 0))),
      evidence: `${etfRuns.length} 次尾盘/轮动筛选，ETF 仓收益 ${formatPct(paper.etf.returnPct)}。`,
      suggestion: '对比 ETF 动量回测与模拟盘滑点，检查调仓频率和趋势过滤是否匹配实盘节奏。',
    },
    {
      key: 'eval',
      label: 'Eval/Harness',
      score: evalReport ? clampScore(evalReport.passRate) : 0,
      status: healthStatus(evalReport ? clampScore(evalReport.passRate) : 0),
      evidence: evalReport
        ? `最近通过率 ${formatPct(evalReport.passRate)}，失败 ${evalReport.failures.length} 项。`
        : '暂无 Eval 报告。',
      suggestion: evalReport?.failures.length
        ? '优先修复失败用例，再调整策略参数，避免把系统缺陷误判成策略失效。'
        : '新增收益归因、风险暴露和信号失效相关 harness 用例。',
    },
  ];

  const optimizationQueue = [
    ...(coverageScore < 70 ? ['补齐信号、模拟盘、回测、Eval 的日级数据覆盖，先让闭环可观测。'] : []),
    ...(paperReturnPct < 0 ? ['复盘模拟盘亏损成交，按来源拆分消息雷达、ETF 轮动、手动交易的贡献。'] : []),
    ...(urgentAlerts > 0 ? ['处理紧急监控告警，确认是否触发减仓、止损或移出跟踪池。'] : []),
    ...(backtests.length < 5 ? ['增加回测样本，至少覆盖牛/熊/震荡和不同持有期。'] : []),
    ...(!evalReport ? ['运行 eval/harness，建立系统调整前后的质量基线。'] : []),
    ...(evalReport?.failures.length ? ['修复 eval/harness 失败项，避免策略迭代建立在不稳定能力上。'] : []),
  ].slice(0, 6);

  return {
    generatedAt: now.toISOString(),
    score,
    conclusion: buildConclusion(overall, paperReturnPct, riskScore),
    coverage: {
      score: coverageScore,
      sources,
    },
    performance: {
      paperReturnPct,
      paperTotalValue: paper.combined.totalValue,
      paperInitialCash,
      equityTrend,
      backtestAvgReturnPct,
      profitableBacktestCount: backtestRank.profitable,
      backtestCount: backtestRank.values.length,
      bestBacktest: backtestRank.best,
      worstBacktest: backtestRank.worst,
    },
    risk: {
      score: riskScore,
      openPositionCount,
      unacknowledgedAlerts,
      urgentAlerts,
      worstWatchlistReturnPct,
      exposurePct,
    },
    loop,
    strategyHealth,
    optimizationQueue:
      optimizationQueue.length > 0
        ? optimizationQueue
        : ['当前闭环没有明显阻断项，下一步重点是扩大样本、做参数 A/B 对比和收益归因。'],
    dailyFocus: [
      '查看未确认监控告警与持仓止损线。',
      '记录新增信号进入跟踪池后的表现。',
      '确认模拟盘成交是否符合策略触发原因。',
    ],
    weeklyFocus: [
      '按策略来源统计收益、胜率、最大回撤和误报率。',
      '复盘表现最差的跟踪标的和回测组合。',
      '把有效信号沉淀为可测试规则。',
    ],
    monthlyFocus: [
      '淘汰持续跑输且样本充足的信号或参数。',
      '对 ETF 轮动、动量选股和消息雷达做横向收益归因。',
      '比较系统调整前后的 Eval、回测和模拟盘变化。',
    ],
    evalReport,
  };
}

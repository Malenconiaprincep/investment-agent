import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { getBacktestRun, listBacktestRuns } from '../backtest/store.js';
import {
  getPaperAccountSummary,
  listEquitySnapshots,
  listPaperTrades,
} from '../paper/store.js';
import { ETF_EVERGREEN_BUCKET } from '../paper/bucket.js';
import { generateEtfEvergreenCapitalReadiness } from './capital-readiness.js';
import { PACKAGE_ROOT } from '../../mastra/config/paths.js';
import type {
  EtfStableV2BacktestResult,
  StableV2Metrics,
} from '../backtest/etf-stable-v2.js';

export type EtfStableWeeklyReview = {
  generatedAt: string;
  weekStart: string;
  weekEnd: string;
  paper: {
    currentValue: number;
    stableStartedAt: string;
    stableBaselineValue: number;
    stableCumulativeReturnPct: number;
    accountCumulativeReturnPct: number;
    weekReturnPct: number | null;
    weekMaxDrawdownPct: number | null;
    currentDrawdownPct: number;
    accountCurrentDrawdownPct: number;
    tradeCount: number;
    missingReasonCount: number;
  };
  backtest: {
    runId: string | null;
    generatedAt: string | null;
    metrics: StableV2Metrics | null;
    status: string | null;
    validation: {
      status: string;
      generatedAt: string | null;
      reportPath: string;
      candidate?: string;
      annualizedReturnPct?: number;
      maxDrawdownPct?: number;
      beatCount?: number;
      positiveCount?: number;
      evaluationCount?: number;
    } | null;
  };
  comparison: {
    previousWeekReturnPct: number | null;
    returnTrend: 'improving' | 'stable' | 'deteriorating' | 'no_history';
  };
  shadowPlan: {
    strategy: string;
    signalDate: string;
    executionDate: string;
    generatedAt: string;
    cashReservePct: number;
    targetTotalPct: number;
    targets: Array<{
      symbol: string;
      name: string;
      targetWeightPct: number;
      assetClass?: string;
    }>;
  } | null;
  capitalReadiness: {
    decision: string;
    canAcceptRealCapital: boolean;
    minimumRemainingTradingDays: number;
    estimatedEarliestReviewDate: string;
    blockers: string[];
  };
  observations: string[];
  lessons: string[];
  nextActions: string[];
  immutableRules: string[];
  markdownPath: string;
  jsonPath: string;
};

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function weekRange(asOf: Date): { weekStart: string; weekEnd: string } {
  const end = new Date(asOf);
  const start = new Date(asOf);
  start.setUTCDate(start.getUTCDate() - 6);
  return { weekStart: dateKey(start), weekEnd: dateKey(end) };
}

function maxDrawdownPct(values: number[]): number | null {
  if (values.length === 0) return null;
  let peak = values[0]!;
  let drawdown = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    if (peak > 0) drawdown = Math.min(drawdown, ((value - peak) / peak) * 100);
  }
  return Number(drawdown.toFixed(2));
}

function latestPreviousReview(reviewDir: string, weekEnd: string): EtfStableWeeklyReview | null {
  if (!existsSync(reviewDir)) return null;
  const file = readdirSync(reviewDir)
    .filter((name) => /^etf-stable-weekly-\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .filter((name) => name.slice('etf-stable-weekly-'.length, -'.json'.length) < weekEnd)
    .sort()
    .at(-1);
  if (!file) return null;
  try {
    return JSON.parse(readFileSync(path.join(reviewDir, file), 'utf-8')) as EtfStableWeeklyReview;
  } catch {
    return null;
  }
}

function pct(value: number | null): string {
  return value == null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function loadOrCreateStableBaseline(
  reviewDir: string,
  input: { startedAt: string; currentValue: number },
): { startedAt: string; value: number; createdAt: string } {
  const baselinePath = path.join(reviewDir, 'etf-evergreen-baseline.json');
  if (existsSync(baselinePath)) {
    try {
      const parsed = JSON.parse(readFileSync(baselinePath, 'utf-8')) as {
        startedAt?: string;
        value?: number;
        createdAt?: string;
      };
      if (
        parsed.startedAt
        && typeof parsed.value === 'number'
        && Number.isFinite(parsed.value)
        && parsed.value > 0
      ) {
        const baseline = {
          startedAt: parsed.startedAt,
          value: parsed.value,
          createdAt: parsed.createdAt ?? new Date().toISOString(),
        };
        if (!parsed.createdAt) {
          writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, 'utf-8');
        }
        return baseline;
      }
    } catch {
      // invalid baseline is replaced below
    }
  }
  const baseline = {
    startedAt: input.startedAt,
    value: input.currentValue,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, 'utf-8');
  return baseline;
}

async function latestStableBacktest(): Promise<{
  runId: string | null;
  generatedAt: string | null;
  metrics: StableV2Metrics | null;
  status: string | null;
  validation: {
    status: string;
    generatedAt: string | null;
    reportPath: string;
    candidate?: string;
    annualizedReturnPct?: number;
    maxDrawdownPct?: number;
    beatCount?: number;
    positiveCount?: number;
    evaluationCount?: number;
  } | null;
}> {
  const repoRoot = path.resolve(PACKAGE_ROOT, '../..');
  const comparisonDir = path.join(repoRoot, 'docs/backtests');
  const comparisonFile = existsSync(comparisonDir)
    ? readdirSync(comparisonDir)
      .filter((name) => /^etf-evergreen-compare-\d{8}\.json$/.test(name))
      .sort()
      .at(-1)
    : null;
  let validation: {
    status: string;
    generatedAt: string | null;
    reportPath: string;
    candidate?: string;
    annualizedReturnPct?: number;
    maxDrawdownPct?: number;
    beatCount?: number;
    positiveCount?: number;
    evaluationCount?: number;
  } | null = null;
  if (comparisonFile) {
    const reportPath = path.join(comparisonDir, comparisonFile);
    try {
      const parsed = JSON.parse(readFileSync(reportPath, 'utf-8')) as {
        status?: string;
        generatedAt?: string;
        summaries?: Array<{
          id?: string;
          label?: string;
          fullAnnualizedPct?: number;
          fullMaxDrawdownPct?: number;
          beatCount?: number;
          positiveCount?: number;
          evaluationCount?: number;
        }>;
      };
      if (parsed.status) {
        const candidate = parsed.summaries?.find((item) => item.id === 'evergreen-v3-60-40');
        validation = {
          status: parsed.status,
          generatedAt: parsed.generatedAt ?? null,
          reportPath,
          candidate: candidate?.label,
          annualizedReturnPct: candidate?.fullAnnualizedPct,
          maxDrawdownPct: candidate?.fullMaxDrawdownPct,
          beatCount: candidate?.beatCount,
          positiveCount: candidate?.positiveCount,
          evaluationCount: candidate?.evaluationCount,
        };
      }
    } catch {
      // Invalid comparison reports are ignored; the persisted run remains the fallback.
    }
  }
  const record = (await listBacktestRuns(100)).find(
    (item) => item.strategy === 'etf-stable-v2',
  );
  if (!record) {
    return {
      runId: null,
      generatedAt: null,
      metrics: null,
      status: validation?.status ?? null,
      validation,
    };
  }
  const detail = await getBacktestRun(record.id);
  const result = detail?.result as
    | (EtfStableV2BacktestResult & { validation?: { status?: string } })
    | undefined;
  return {
    runId: record.id,
    generatedAt: record.generatedAt,
    metrics: result?.stableMetrics ?? null,
    status: validation?.status ?? result?.validation?.status ?? result?.review?.status ?? null,
    validation,
  };
}

function renderReview(review: Omit<EtfStableWeeklyReview, 'markdownPath' | 'jsonPath'>): string {
  return [
    `# 长青一号周复盘（${review.weekStart} ~ ${review.weekEnd}）`,
    '',
    '> 复盘用于发现策略、数据和执行偏差，不会根据一周输赢自动修改参数。',
    '',
    '## 模拟盘事实',
    '',
    `- 当前资产：¥${review.paper.currentValue.toFixed(2)}`,
    `- Stable V2 起点：${review.paper.stableStartedAt}，基准资产 ¥${review.paper.stableBaselineValue.toFixed(2)}`,
    `- Stable V2 累计收益：${pct(review.paper.stableCumulativeReturnPct)}`,
    `- 长青一号全历史累计收益：${pct(review.paper.accountCumulativeReturnPct)}`,
    `- 本周收益：${pct(review.paper.weekReturnPct)}`,
    `- 本周最大回撤：${pct(review.paper.weekMaxDrawdownPct)}`,
    `- 当前相对历史峰值回撤：${pct(review.paper.currentDrawdownPct)}`,
    `- 长青一号历史峰值回撤：${pct(review.paper.accountCurrentDrawdownPct)}`,
    `- 本周成交 ${review.paper.tradeCount} 笔，其中 ${review.paper.missingReasonCount} 笔缺少可复盘理由。`,
    '',
    '## 历史验证锚点',
    '',
    review.backtest.metrics
      ? `- 防守袖套持久化回测 ${review.backtest.runId}：年化 ${pct(review.backtest.metrics.annualizedReturnPct)}，最大回撤 ${pct(review.backtest.metrics.maxDrawdownPct)}。`
      : '- 尚无持久化的 Stable V2 回测；本周结论降级为数据观察。',
    review.backtest.validation
      ? `- V3 全场景验证：${review.backtest.validation.status}；年化 ${pct(review.backtest.validation.annualizedReturnPct ?? null)}，最大回撤 ${pct(review.backtest.validation.maxDrawdownPct ?? null)}，跑赢 ${review.backtest.validation.beatCount ?? '—'}/${review.backtest.validation.evaluationCount ?? '—'}，正收益 ${review.backtest.validation.positiveCount ?? '—'}/${review.backtest.validation.evaluationCount ?? '—'}。`
      : '- 尚无全场景公平验证报告，禁止据此恢复自动开仓。',
    '',
    '## V3 影子目标',
    '',
    ...(review.shadowPlan
      ? [
          `- 策略：${review.shadowPlan.strategy}，信号日 ${review.shadowPlan.signalDate}，计划执行日 ${review.shadowPlan.executionDate}。`,
          `- ETF目标合计 ${review.shadowPlan.targetTotalPct.toFixed(2)}%，主动现金储备 ${review.shadowPlan.cashReservePct.toFixed(2)}%。`,
          ...review.shadowPlan.targets.map((target) =>
            `- ${target.symbol} ${target.name}：${target.targetWeightPct.toFixed(2)}%${target.assetClass ? `（${target.assetClass}）` : ''}`,
          ),
        ]
      : ['- 尚未生成长青 V3 影子目标；自动开仓继续暂停。']),
    '',
    '## 真实资金准入',
    '',
    `- 当前结论：${review.capitalReadiness.canAcceptRealCapital ? '允许首批小额资金' : '不接受真实资金'}。`,
    `- 最少还需 ${review.capitalReadiness.minimumRemainingTradingDays} 个有效交易日；最早复核估算日 ${review.capitalReadiness.estimatedEarliestReviewDate}。`,
    `- 未通过环节：${review.capitalReadiness.blockers.join('、') || '无'}。`,
    '',
    '## 与上周比较',
    '',
    `- 上周收益：${pct(review.comparison.previousWeekReturnPct)}`,
    `- 趋势判断：${review.comparison.returnTrend}`,
    '',
    '## 观察',
    '',
    ...review.observations.map((item) => `- ${item}`),
    '',
    '## 沉淀经验',
    '',
    ...review.lessons.map((item) => `- ${item}`),
    '',
    '## 下一步验证',
    '',
    ...review.nextActions.map((item) => `- ${item}`),
    '',
    '## 不可绕过的规则',
    '',
    ...review.immutableRules.map((item) => `- ${item}`),
    '',
  ].join('\n');
}

export async function generateEtfStableWeeklyReview(options?: {
  asOf?: Date;
}): Promise<EtfStableWeeklyReview> {
  const asOf = options?.asOf ?? new Date();
  const { weekStart, weekEnd } = weekRange(asOf);
  const repoRoot = path.resolve(PACKAGE_ROOT, '../..');
  const reviewDir = path.join(repoRoot, 'docs/reviews');
  mkdirSync(reviewDir, { recursive: true });

  const [summary, snapshots, trades, backtest, capitalReadiness] = await Promise.all([
    getPaperAccountSummary(ETF_EVERGREEN_BUCKET),
    listEquitySnapshots(5_000, ETF_EVERGREEN_BUCKET),
    listPaperTrades(2_000, ETF_EVERGREEN_BUCKET),
    latestStableBacktest(),
    generateEtfEvergreenCapitalReadiness({ asOfDate: weekEnd }),
  ]);
  const baseline = loadOrCreateStableBaseline(reviewDir, {
    startedAt: weekEnd,
    currentValue: summary.totalValue,
  });
  const stableSnapshots = snapshots.filter(
    (snapshot) => snapshot.createdAt >= baseline.createdAt,
  );
  const effectiveWeekStart = weekStart > baseline.startedAt ? weekStart : baseline.startedAt;
  const weekSnapshots = stableSnapshots.filter(
    (snapshot) => snapshot.tradeDate >= effectiveWeekStart && snapshot.tradeDate <= weekEnd,
  );
  const priorSnapshot = stableSnapshots
    .filter((snapshot) => snapshot.tradeDate < effectiveWeekStart)
    .at(-1);
  const startValue = priorSnapshot?.totalValue ?? baseline.value;
  const endValue = summary.totalValue;
  const weekReturnPct = startValue && startValue > 0
    ? Number((((endValue - startValue) / startValue) * 100).toFixed(2))
    : null;
  const accountPeak = Math.max(
    summary.account.initialCash,
    summary.totalValue,
    ...snapshots.map((snapshot) => snapshot.totalValue),
  );
  const accountCurrentDrawdownPct = accountPeak > 0
    ? Number((((summary.totalValue - accountPeak) / accountPeak) * 100).toFixed(2))
    : 0;
  const stablePeak = Math.max(
    baseline.value,
    summary.totalValue,
    ...stableSnapshots.map((snapshot) => snapshot.totalValue),
  );
  const currentDrawdownPct = stablePeak > 0
    ? Number((((summary.totalValue - stablePeak) / stablePeak) * 100).toFixed(2))
    : 0;
  const weekTrades = trades.filter(
    (trade) => trade.tradeDate >= weekStart && trade.tradeDate <= weekEnd,
  );
  const missingReasonCount = weekTrades.filter(
    (trade) => !trade.note || !/(建仓|调仓|权重|止损|Stable|动量)/i.test(trade.note),
  ).length;
  const previous = latestPreviousReview(reviewDir, weekEnd);
  const previousWeekReturnPct = previous?.paper.weekReturnPct ?? null;
  const returnTrend = previousWeekReturnPct == null || weekReturnPct == null
    ? 'no_history'
    : weekReturnPct > previousWeekReturnPct + 0.5
      ? 'improving'
      : weekReturnPct < previousWeekReturnPct - 0.5
        ? 'deteriorating'
        : 'stable';

  const observations: string[] = [];
  const rawShadowPlan = 'shadowPlan' in summary ? summary.shadowPlan : null;
  const shadowPlan = rawShadowPlan
    ? {
        strategy: rawShadowPlan.strategy,
        signalDate: rawShadowPlan.signalDate,
        executionDate: rawShadowPlan.executionDate,
        generatedAt: rawShadowPlan.generatedAt,
        cashReservePct: rawShadowPlan.cashReservePct ?? 0,
        targetTotalPct: Number(rawShadowPlan.targets.reduce(
          (sum, target) => sum + target.targetWeightPct,
          0,
        ).toFixed(4)),
        targets: rawShadowPlan.targets.map((target) => ({
          symbol: target.symbol,
          name: target.name,
          targetWeightPct: target.targetWeightPct,
          assetClass: target.assetClass,
        })),
      }
    : null;
  if (weekSnapshots.length === 0) {
    observations.push(
      baseline.startedAt === weekEnd
        ? 'Stable V2 今日刚建立独立基线，尚未形成首个切换后收盘快照；本期只记录起点，不评价收益。'
        : '本周缺少 ETF 权益快照，无法可靠计算周收益路径；应先修复数据闭环。',
    );
  } else {
    observations.push(`本周记录 ${weekSnapshots.length} 个权益快照，数据足以做周级路径复盘。`);
  }
  if (accountCurrentDrawdownPct <= -6) {
    observations.push('组合已触发至少一级回撤保护，应核对下一次计划是否降低风险资产权重。');
  }
  if (backtest.validation?.status === 'needs_iteration') {
    observations.push('全场景公平验证未通过，长青一号自动新开仓保持暂停；本周记录 V3 影子目标、净值和数据质量。');
  } else if (backtest.validation?.status === 'paper_candidate') {
    observations.push('长青 V3 已通过历史准入门槛，当前进入影子观察；双袖套执行一致性核验完成前仍不自动下单。');
  }
  if (shadowPlan) {
    observations.push(`已记录 ${shadowPlan.targets.length} 个 V3 影子目标；ETF目标合计 ${shadowPlan.targetTotalPct.toFixed(2)}%，主动现金储备 ${shadowPlan.cashReservePct.toFixed(2)}%。`);
  }
  observations.push('长青 V3 复盘只读取长青一号独立仓，不混入旧 ETF 仓的持仓、成交或历史损益。');
  if (missingReasonCount > 0) {
    observations.push('存在成交缺少结构化理由，收益归因可信度需要降级。');
  }
  if (backtest.metrics && backtest.metrics.tradingCostPct > 15) {
    observations.push('历史累计交易成本较高，本周应重点核对是否发生无必要的小额再平衡。');
  }

  const lessons: string[] = [
    weekSnapshots.length === 0
      ? '切换日没有足够路径样本，收益和策略有效性均不作判断。'
      : weekReturnPct != null && weekReturnPct < 0
        ? '本周亏损不能单独证明策略失效；先区分市场风险、信号选择、仓位和执行滑点。'
        : weekReturnPct != null && weekReturnPct > 0
          ? '本周正收益不能单独证明参数有效；仍要检查收益是否集中于单一 ETF。'
          : '本周尚无模拟成交，零收益只代表影子观察起点，不评价策略有效性。',
    returnTrend === 'deteriorating'
      ? '表现较上周恶化，下一周优先验证风险状态和实际成交偏差，不直接放宽仓位。'
      : '周度表现未显著恶化，保持参数冻结以积累可比较样本。',
    '只有重复出现且能在历史固定场景中复现的问题，才进入参数候选清单。',
  ];
  const nextActions = [
    backtest.validation?.status === 'needs_iteration'
      ? '继续改进候选策略并重跑全历史、近期窗口、压力年份和逐年场景；未全部过门槛前不恢复自动开仓。'
      : '连续记录 V3 影子目标和下一交易日价格，让增长/防守虚拟账本并行累计60个有效交易日；期间不下真实或聚合模拟订单。',
    accountCurrentDrawdownPct <= -6
      ? '下次运行前核对回撤档位、现金/国债目标权重与实际持仓是否一致。'
      : '继续观察风险资产实际权重是否围绕目标权重运行。',
    missingReasonCount > 0
      ? '补齐缺失成交理由，并统一记录信号日、执行日、目标权重和成交价来源。'
      : '保持成交理由字段完整，累积可用于归因的样本。',
    '月底比较过去 4 份周复盘，提炼重复问题并建立一次带 changeset 的验证实验。',
  ];
  const immutableRules = [
    '不承诺固定收益，不因短期目标压力增加杠杆。',
    '日线信号只能在下一交易日执行，禁止使用同日收盘价回填成交。',
    '策略参数不能根据一周或单一年份结果自动修改。',
    '任何参数、ETF 池或风控变化都要先写 changeset，再跑全区间、固定场景、双倍成本和样本外验证。',
  ];

  const reportWithoutPaths = {
    generatedAt: new Date().toISOString(),
    weekStart,
    weekEnd,
    paper: {
      currentValue: summary.totalValue,
      stableStartedAt: baseline.startedAt,
      stableBaselineValue: baseline.value,
      stableCumulativeReturnPct: Number(
        (((summary.totalValue - baseline.value) / baseline.value) * 100).toFixed(2),
      ),
      accountCumulativeReturnPct: summary.returnPct,
      weekReturnPct,
      weekMaxDrawdownPct: maxDrawdownPct(weekSnapshots.map((item) => item.totalValue)),
      currentDrawdownPct,
      accountCurrentDrawdownPct,
      tradeCount: weekTrades.length,
      missingReasonCount,
    },
    backtest,
    comparison: { previousWeekReturnPct, returnTrend },
    shadowPlan,
    capitalReadiness: {
      decision: capitalReadiness.decision,
      canAcceptRealCapital: capitalReadiness.canAcceptRealCapital,
      minimumRemainingTradingDays: capitalReadiness.minimumRemainingTradingDays,
      estimatedEarliestReviewDate: capitalReadiness.estimatedEarliestReviewDate,
      blockers: capitalReadiness.blockers,
    },
    observations,
    lessons,
    nextActions,
    immutableRules,
  } satisfies Omit<EtfStableWeeklyReview, 'markdownPath' | 'jsonPath'>;
  const baseName = `etf-stable-weekly-${weekEnd}`;
  const markdownPath = path.join(reviewDir, `${baseName}.md`);
  const jsonPath = path.join(reviewDir, `${baseName}.json`);
  const existed = existsSync(jsonPath);
  const review: EtfStableWeeklyReview = {
    ...reportWithoutPaths,
    markdownPath,
    jsonPath,
  };
  writeFileSync(markdownPath, renderReview(reportWithoutPaths), 'utf-8');
  writeFileSync(jsonPath, `${JSON.stringify(review, null, 2)}\n`, 'utf-8');
  if (!existed) {
    appendFileSync(
      path.join(reviewDir, 'etf-stable-lessons.jsonl'),
      `${JSON.stringify({
        weekEnd,
        lessons,
        nextActions,
        backtestRunId: backtest.runId,
      })}\n`,
      'utf-8',
    );
  }
  return review;
}

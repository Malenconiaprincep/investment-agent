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
  };
  comparison: {
    previousWeekReturnPct: number | null;
    returnTrend: 'improving' | 'stable' | 'deteriorating' | 'no_history';
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
  const baselinePath = path.join(reviewDir, 'etf-stable-baseline.json');
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
}> {
  const record = (await listBacktestRuns(100)).find(
    (item) => item.strategy === 'etf-stable-v2',
  );
  if (!record) return { runId: null, generatedAt: null, metrics: null, status: null };
  const detail = await getBacktestRun(record.id);
  const result = detail?.result as
    | (EtfStableV2BacktestResult & { validation?: { status?: string } })
    | undefined;
  return {
    runId: record.id,
    generatedAt: record.generatedAt,
    metrics: result?.stableMetrics ?? null,
    status: result?.validation?.status ?? result?.review?.status ?? null,
  };
}

function renderReview(review: Omit<EtfStableWeeklyReview, 'markdownPath' | 'jsonPath'>): string {
  return [
    `# ETF Stable V2 周复盘（${review.weekStart} ~ ${review.weekEnd}）`,
    '',
    '> 复盘用于发现策略、数据和执行偏差，不会根据一周输赢自动修改参数。',
    '',
    '## 模拟盘事实',
    '',
    `- 当前资产：¥${review.paper.currentValue.toFixed(2)}`,
    `- Stable V2 起点：${review.paper.stableStartedAt}，基准资产 ¥${review.paper.stableBaselineValue.toFixed(2)}`,
    `- Stable V2 累计收益：${pct(review.paper.stableCumulativeReturnPct)}`,
    `- 账户全历史累计收益（含旧策略）：${pct(review.paper.accountCumulativeReturnPct)}`,
    `- 本周收益：${pct(review.paper.weekReturnPct)}`,
    `- 本周最大回撤：${pct(review.paper.weekMaxDrawdownPct)}`,
    `- 当前相对历史峰值回撤：${pct(review.paper.currentDrawdownPct)}`,
    `- 账户全历史峰值回撤（含旧策略）：${pct(review.paper.accountCurrentDrawdownPct)}`,
    `- 本周成交 ${review.paper.tradeCount} 笔，其中 ${review.paper.missingReasonCount} 笔缺少可复盘理由。`,
    '',
    '## 历史验证锚点',
    '',
    review.backtest.metrics
      ? `- 最近回测 ${review.backtest.runId}：年化 ${pct(review.backtest.metrics.annualizedReturnPct)}，最大回撤 ${pct(review.backtest.metrics.maxDrawdownPct)}，状态 ${review.backtest.status}。`
      : '- 尚无持久化的 Stable V2 回测；本周结论降级为数据观察。',
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

  const [summary, snapshots, trades, backtest] = await Promise.all([
    getPaperAccountSummary('etf'),
    listEquitySnapshots(5_000, 'etf'),
    listPaperTrades(2_000, 'etf'),
    latestStableBacktest(),
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
  observations.push('Stable V2 复盘从切换日单独建立资产基线，旧策略损益只作为账户背景，不计入 V2 收益。');
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
        : '本周正收益不能单独证明参数有效；仍要检查收益是否集中于单一 ETF。',
    returnTrend === 'deteriorating'
      ? '表现较上周恶化，下一周优先验证风险状态和实际成交偏差，不直接放宽仓位。'
      : '周度表现未显著恶化，保持参数冻结以积累可比较样本。',
    '只有重复出现且能在历史固定场景中复现的问题，才进入参数候选清单。',
  ];
  const nextActions = [
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

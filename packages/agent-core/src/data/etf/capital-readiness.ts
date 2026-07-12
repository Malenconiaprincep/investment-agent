import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { getDailyQuote } from '../market/services.js';
import {
  getPaperAccountSummary,
  type PaperShadowPlan,
} from '../paper/store.js';
import { ETF_EVERGREEN_BUCKET } from '../paper/bucket.js';
import { PACKAGE_ROOT } from '../../mastra/config/paths.js';

export const ETF_CAPITAL_ACCEPTANCE = Object.freeze({
  minHistoricalAnnualizedPct: 8,
  maxHistoricalDrawdownPct: -20,
  minScenarioPassRatio: 0.6,
  minShadowExecutionDays: 20,
  minShadowPriceCoveragePct: 95,
  maxShadowAverageGapPct: 2,
  minPaperTradingDays: 60,
  minPaperTrades: 30,
  minWeeklyReviews: 8,
  maxPaperDrawdownPct: -10,
  initialCapitalTranchePct: 10,
});

export type ShadowPlanRecord = PaperShadowPlan & {
  recordedAt: string;
};

export type ShadowExecutionEvidence = {
  executionDate: string;
  signalDate: string;
  generatedAt: string;
  targetCount: number;
  pricedTargetCount: number;
  priceCoveragePct: number;
  weightedAverageAbsGapPct: number | null;
  valid: boolean;
  prices: Array<{
    symbol: string;
    name: string;
    targetWeightPct: number;
    signalClose: number | null;
    executionOpen: number | null;
    executionClose: number | null;
    gapPct: number | null;
  }>;
};

export type ShadowSleeveLedgerReport = {
  generatedAt: string;
  tradingDays: number;
  orderCount: number;
  rebalanceCount: number;
  firstTradeDate: string | null;
  lastTradeDate: string | null;
  totalValue: number;
  returnPct: number;
  maxDrawdownPct: number | null;
  equityCurve: Array<{ tradeDate: string; totalValue: number; returnPct: number }>;
  sleeves: Record<string, {
    initialCapital: number;
    cash: number;
    totalValue: number;
    positionCount: number;
    lastRebalanceDate: string | null;
  }>;
};

const repoRoot = path.resolve(PACKAGE_ROOT, '../..');
const reviewDir = path.join(repoRoot, 'docs/reviews');
const backtestPath = path.join(repoRoot, 'docs/backtests/etf-evergreen-compare-20260710.json');
const auditPath = path.join(repoRoot, 'docs/data-quality/fund-etf-data-20260710.json');
const plansPath = path.join(reviewDir, 'etf-evergreen-shadow-plans.json');
const evidencePath = path.join(reviewDir, 'etf-evergreen-shadow-evidence.json');
const readinessJsonPath = path.join(reviewDir, 'etf-evergreen-capital-readiness.json');
const readinessMarkdownPath = path.join(reviewDir, 'etf-evergreen-capital-readiness.md');
const ledgerPath = path.join(reviewDir, 'etf-evergreen-shadow-ledger.json');

function readJson<T>(filePath: string, fallback: T): T {
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function dateKey(value: string) {
  return value.replace(/-/g, '').slice(0, 8);
}

function round(value: number, digits = 2) {
  return Number(value.toFixed(digits));
}

function addWeekdays(startDate: string, weekdays: number) {
  const date = new Date(`${startDate.slice(0, 4)}-${startDate.slice(4, 6)}-${startDate.slice(6, 8)}T00:00:00.000Z`);
  let remaining = Math.max(0, Math.floor(weekdays));
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return date.toISOString().slice(0, 10);
}

function calendarDaysBetween(fromDate: string, toDate: string) {
  const parse = (value: string) => new Date(
    `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00.000Z`,
  ).getTime();
  return Math.floor((parse(toDate) - parse(fromDate)) / 86_400_000);
}

function weekBucket(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return date.toISOString().slice(0, 10);
}

function maxDrawdownPct(values: number[]) {
  if (values.length === 0) return 0;
  let peak = values[0]!;
  let drawdown = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    if (peak > 0) drawdown = Math.min(drawdown, (value / peak - 1) * 100);
  }
  return round(drawdown);
}

export function recordEtfEvergreenShadowPlan(plan: PaperShadowPlan) {
  const records = readJson<ShadowPlanRecord[]>(plansPath, []);
  const next: ShadowPlanRecord = { ...plan, recordedAt: new Date().toISOString() };
  const index = records.findIndex((item) => item.executionDate === plan.executionDate);
  if (index >= 0) records[index] = next;
  else records.push(next);
  records.sort((a, b) => a.executionDate.localeCompare(b.executionDate));
  writeJson(plansPath, records);
  return next;
}

async function buildExecutionEvidence(
  plan: ShadowPlanRecord,
  symbolCatalog: Map<string, { name: string }>,
): Promise<ShadowExecutionEvidence | null> {
  const currentWeights = new Map(plan.targets.map((target) => [target.symbol, target.targetWeightPct]));
  const priceUniverse = [...symbolCatalog.entries()].map(([symbol, item]) => ({
    symbol,
    name: item.name,
    targetWeightPct: currentWeights.get(symbol) ?? 0,
  }));
  const prices = await Promise.all(priceUniverse.map(async (target) => {
    try {
      const quote = await getDailyQuote(target.symbol, 500);
      const signal = quote.quotes.find((bar) => dateKey(bar.tradeDate) === dateKey(plan.signalDate));
      const execution = quote.quotes.find(
        (bar) => dateKey(bar.tradeDate) === dateKey(plan.executionDate),
      );
      const signalClose = signal?.close && signal.close > 0 ? signal.close : null;
      const executionOpen = execution?.open && execution.open > 0 ? execution.open : null;
      const executionClose = execution?.close && execution.close > 0 ? execution.close : null;
      const gapPct = signalClose && executionOpen
        ? round((executionOpen / signalClose - 1) * 100, 4)
        : null;
      return {
        symbol: target.symbol,
        name: target.name,
        targetWeightPct: target.targetWeightPct,
        signalClose,
        executionOpen,
        executionClose,
        gapPct,
      };
    } catch {
      return {
        symbol: target.symbol,
        name: target.name,
        targetWeightPct: target.targetWeightPct,
        signalClose: null,
        executionOpen: null,
        executionClose: null,
        gapPct: null,
      };
    }
  }));
  const priced = prices.filter(
    (item) => item.targetWeightPct > 0 && item.executionOpen != null,
  );
  if (priced.length === 0) return null;
  const targetWeight = plan.targets.reduce((sum, item) => sum + item.targetWeightPct, 0);
  const pricedWeight = prices
    .filter((item) => item.executionOpen != null)
    .reduce((sum, item) => sum + item.targetWeightPct, 0);
  const gapItems = prices.filter((item) => item.gapPct != null);
  const gapWeight = gapItems.reduce((sum, item) => sum + item.targetWeightPct, 0);
  const weightedAverageAbsGapPct = gapWeight > 0
    ? round(gapItems.reduce(
        (sum, item) => sum + Math.abs(item.gapPct!) * item.targetWeightPct,
        0,
      ) / gapWeight, 4)
    : null;
  const priceCoveragePct = targetWeight > 0 ? round(pricedWeight / targetWeight * 100) : 0;
  return {
    executionDate: plan.executionDate,
    signalDate: plan.signalDate,
    generatedAt: new Date().toISOString(),
    targetCount: plan.targets.length,
    pricedTargetCount: priced.length,
    priceCoveragePct,
    weightedAverageAbsGapPct,
    valid: dateKey(plan.executionDate) > dateKey(plan.signalDate)
      && priceCoveragePct >= ETF_CAPITAL_ACCEPTANCE.minShadowPriceCoveragePct
      && weightedAverageAbsGapPct != null,
    prices,
  };
}

export async function backfillEtfEvergreenShadowEvidence(asOfDate: string) {
  const plans = readJson<ShadowPlanRecord[]>(plansPath, []);
  const evidence = readJson<ShadowExecutionEvidence[]>(evidencePath, []);
  const byDate = new Map(evidence.map((item) => [item.executionDate, item]));
  const symbolCatalog = new Map<string, { name: string }>();
  for (const plan of plans) {
    for (const target of plan.targets) {
      symbolCatalog.set(target.symbol, { name: target.name });
    }
    for (const sleeve of Object.values(plan.sleeves ?? {})) {
      for (const target of sleeve.targets) {
        symbolCatalog.set(target.symbol, { name: target.name });
      }
    }
  }
  for (const plan of plans) {
    if (dateKey(plan.executionDate) > dateKey(asOfDate)) continue;
    const item = await buildExecutionEvidence(plan, symbolCatalog);
    if (item) byDate.set(plan.executionDate, item);
  }
  const next = [...byDate.values()].sort((a, b) => a.executionDate.localeCompare(b.executionDate));
  writeJson(evidencePath, next);
  return next;
}

export function rebuildDualSleeveShadowLedger(
  plans: ShadowPlanRecord[],
  evidence: ShadowExecutionEvidence[],
): ShadowSleeveLedgerReport {
  type Position = {
    symbol: string;
    name: string;
    shares: number;
    avgCost: number;
    assetClass?: string;
  };
  type SleeveState = {
    initialCapital: number;
    cash: number;
    positions: Map<string, Position>;
    lastRebalanceIndex: number | null;
    lastRebalanceDate: string | null;
    pendingStops: Set<string>;
    cooldownUntil: Map<string, number>;
  };
  const states: Record<'growth' | 'defensive', SleeveState> = {
    growth: {
      initialCapital: 60_000,
      cash: 60_000,
      positions: new Map(),
      lastRebalanceIndex: null,
      lastRebalanceDate: null,
      pendingStops: new Set(),
      cooldownUntil: new Map(),
    },
    defensive: {
      initialCapital: 40_000,
      cash: 40_000,
      positions: new Map(),
      lastRebalanceIndex: null,
      lastRebalanceDate: null,
      pendingStops: new Set(),
      cooldownUntil: new Map(),
    },
  };
  const planByDate = new Map(plans.map((plan) => [plan.executionDate, plan]));
  const validEvidence = evidence
    .filter((item) => item.valid && planByDate.get(item.executionDate)?.sleeves)
    .sort((a, b) => a.executionDate.localeCompare(b.executionDate));
  const equityCurve: ShadowSleeveLedgerReport['equityCurve'] = [];
  let orderCount = 0;
  let rebalanceCount = 0;
  let firstTradeDate: string | null = null;

  const executionPrice = (raw: number, side: 'buy' | 'sell') =>
    raw * (side === 'buy' ? 1.0005 : 0.9995);
  const commission = (amount: number) => Math.max(5, amount * 0.0003);

  validEvidence.forEach((day, dayIndex) => {
    const plan = planByDate.get(day.executionDate)!;
    const prices = new Map(day.prices.map((item) => [item.symbol, item]));
    for (const sleeveName of ['growth', 'defensive'] as const) {
      const sleevePlan = plan.sleeves?.[sleeveName];
      if (!sleevePlan) continue;
      const state = states[sleeveName];
      for (const symbol of state.pendingStops) {
        const position = state.positions.get(symbol);
        const open = prices.get(symbol)?.executionOpen;
        if (!position || !open) continue;
        const price = executionPrice(open, 'sell');
        const gross = position.shares * price;
        state.cash += Math.max(0, gross - commission(gross));
        state.positions.delete(symbol);
        state.cooldownUntil.set(symbol, dayIndex + sleevePlan.stopCooldownDays);
        state.pendingStops.delete(symbol);
        orderCount += 1;
      }

      const due = state.lastRebalanceIndex == null
        || dayIndex - state.lastRebalanceIndex >= sleevePlan.rebalanceDays;
      if (due) {
        const openEquity = state.cash + [...state.positions.values()].reduce((sum, position) => {
          const open = prices.get(position.symbol)?.executionOpen;
          return sum + position.shares * (open ?? position.avgCost);
        }, 0);
        const desiredShares = new Map<string, number>();
        for (const target of sleevePlan.targets) {
          if ((state.cooldownUntil.get(target.symbol) ?? -1) > dayIndex) continue;
          const open = prices.get(target.symbol)?.executionOpen;
          if (!open || open <= 0) continue;
          const buyPrice = executionPrice(open, 'buy');
          const shares = Math.floor(
            (openEquity * target.targetWeightPct / 100) / buyPrice / 100,
          ) * 100;
          desiredShares.set(target.symbol, Math.max(0, shares));
        }

        for (const position of [...state.positions.values()]) {
          const desired = desiredShares.get(position.symbol) ?? 0;
          const sellShares = Math.max(0, position.shares - desired);
          const open = prices.get(position.symbol)?.executionOpen;
          if (sellShares < 100 || !open) continue;
          const price = executionPrice(open, 'sell');
          const gross = sellShares * price;
          state.cash += Math.max(0, gross - commission(gross));
          position.shares -= sellShares;
          if (position.shares === 0) state.positions.delete(position.symbol);
          orderCount += 1;
        }

        for (const target of sleevePlan.targets) {
          const desired = desiredShares.get(target.symbol) ?? 0;
          const existing = state.positions.get(target.symbol);
          let buyShares = Math.max(0, desired - (existing?.shares ?? 0));
          const open = prices.get(target.symbol)?.executionOpen;
          if (buyShares < 100 || !open) continue;
          const price = executionPrice(open, 'buy');
          while (buyShares >= 100) {
            const gross = buyShares * price;
            const totalCost = gross + commission(gross);
            if (totalCost <= state.cash) break;
            buyShares -= 100;
          }
          if (buyShares < 100) continue;
          const gross = buyShares * price;
          const totalCost = gross + commission(gross);
          const previousCost = existing ? existing.avgCost * existing.shares : 0;
          const newShares = (existing?.shares ?? 0) + buyShares;
          state.cash -= totalCost;
          state.positions.set(target.symbol, {
            symbol: target.symbol,
            name: target.name,
            shares: newShares,
            avgCost: (previousCost + totalCost) / newShares,
            assetClass: target.assetClass,
          });
          orderCount += 1;
        }
        state.lastRebalanceIndex = dayIndex;
        state.lastRebalanceDate = day.executionDate;
        rebalanceCount += 1;
        if (!firstTradeDate && orderCount > 0) firstTradeDate = day.executionDate;
      }

      for (const position of state.positions.values()) {
        if (position.assetClass === 'cash') continue;
        const close = prices.get(position.symbol)?.executionClose;
        if (!close || position.avgCost <= 0) continue;
        const returnPct = (close / position.avgCost - 1) * 100;
        if (returnPct <= sleevePlan.stopLossPct) state.pendingStops.add(position.symbol);
      }
    }
    const totalValue = (['growth', 'defensive'] as const).reduce((total, sleeveName) => {
      const state = states[sleeveName];
      return total + state.cash + [...state.positions.values()].reduce((sum, position) => {
        const close = prices.get(position.symbol)?.executionClose;
        return sum + position.shares * (close ?? position.avgCost);
      }, 0);
    }, 0);
    equityCurve.push({
      tradeDate: day.executionDate,
      totalValue: round(totalValue),
      returnPct: round((totalValue / 100_000 - 1) * 100),
    });
  });

  const sleeveSummary = Object.fromEntries(
    (['growth', 'defensive'] as const).map((sleeveName) => {
      const state = states[sleeveName];
      const lastEvidence = validEvidence.at(-1);
      const prices = new Map(lastEvidence?.prices.map((item) => [item.symbol, item]) ?? []);
      const totalValue = state.cash + [...state.positions.values()].reduce((sum, position) => {
        const close = prices.get(position.symbol)?.executionClose;
        return sum + position.shares * (close ?? position.avgCost);
      }, 0);
      return [sleeveName, {
        initialCapital: state.initialCapital,
        cash: round(state.cash),
        totalValue: round(totalValue),
        positionCount: state.positions.size,
        lastRebalanceDate: state.lastRebalanceDate,
      }];
    }),
  );
  const lastEquity = equityCurve.at(-1)?.totalValue ?? 100_000;
  const report: ShadowSleeveLedgerReport = {
    generatedAt: new Date().toISOString(),
    tradingDays: equityCurve.length,
    orderCount,
    rebalanceCount,
    firstTradeDate,
    lastTradeDate: equityCurve.at(-1)?.tradeDate ?? null,
    totalValue: lastEquity,
    returnPct: round((lastEquity / 100_000 - 1) * 100),
    maxDrawdownPct: equityCurve.length > 0
      ? maxDrawdownPct(equityCurve.map((item) => item.totalValue))
      : null,
    equityCurve,
    sleeves: sleeveSummary,
  };
  return report;
}

export async function generateEtfEvergreenCapitalReadiness(input?: { asOfDate?: string }) {
  const now = new Date();
  const asOfDate = dateKey(input?.asOfDate ?? now.toISOString().slice(0, 10));
  const evidence = await backfillEtfEvergreenShadowEvidence(asOfDate);
  const validEvidence = evidence.filter((item) => item.valid);
  const plans = readJson<ShadowPlanRecord[]>(plansPath, []);
  const ledger = rebuildDualSleeveShadowLedger(plans, evidence);
  writeJson(ledgerPath, ledger);
  const backtest = readJson<{
    status?: string;
    summaries?: Array<{
      id: string;
      fullAnnualizedPct: number;
      fullMaxDrawdownPct: number;
      beatCount: number;
      positiveCount: number;
      evaluationCount: number;
      gatePassed: boolean;
    }>;
  }>(backtestPath, {});
  const candidate = backtest.summaries?.find((item) => item.id === 'evergreen-v3-60-40');
  const audit = readJson<{
    latestTradeDate?: string;
    strategyPoolMissing?: string[];
  }>(auditPath, {});
  const account = await getPaperAccountSummary(ETF_EVERGREEN_BUCKET);
  const benchmarkLatest = await getDailyQuote('510300', 2).catch(() => null);
  const liveLatestTradeDate = benchmarkLatest?.quotes[0]?.tradeDate
    ? dateKey(benchmarkLatest.quotes[0].tradeDate)
    : null;
  const dataAgeDays = liveLatestTradeDate
    ? calendarDaysBetween(liveLatestTradeDate, asOfDate)
    : null;
  const firstTradeDate = ledger.firstTradeDate;
  const paperTradingDays = ledger.tradingDays;
  const weeklyReviewCount = existsSync(reviewDir)
    ? new Set(readdirSync(reviewDir)
      .filter((name) => /^etf-stable-weekly-\d{4}-\d{2}-\d{2}\.json$/.test(name))
      .map((name) => weekBucket(name.slice('etf-stable-weekly-'.length, -'.json'.length))))
      .size
    : 0;
  const averageShadowGapPct = validEvidence.length > 0
    ? round(validEvidence.reduce(
        (sum, item) => sum + (item.weightedAverageAbsGapPct ?? 0),
        0,
      ) / validEvidence.length, 4)
    : null;
  const gates = {
    historical: {
      passed: backtest.status === 'paper_candidate' && candidate?.gatePassed === true,
      annualizedReturnPct: candidate?.fullAnnualizedPct ?? null,
      maxDrawdownPct: candidate?.fullMaxDrawdownPct ?? null,
      beatScenarioRatio: candidate
        ? round(candidate.beatCount / candidate.evaluationCount, 4)
        : null,
      positiveScenarioRatio: candidate
        ? round(candidate.positiveCount / candidate.evaluationCount, 4)
        : null,
    },
    data: {
      passed: (audit.strategyPoolMissing?.length ?? 1) === 0
        && dataAgeDays != null
        && dataAgeDays >= 0
        && dataAgeDays <= 4,
      latestTradeDate: liveLatestTradeDate ?? audit.latestTradeDate ?? null,
      dataAgeDays,
      strategyPoolMissing: audit.strategyPoolMissing ?? [],
    },
    shadowExecution: {
      passed: validEvidence.length >= ETF_CAPITAL_ACCEPTANCE.minShadowExecutionDays
        && averageShadowGapPct != null
        && averageShadowGapPct <= ETF_CAPITAL_ACCEPTANCE.maxShadowAverageGapPct,
      validDays: validEvidence.length,
      requiredDays: ETF_CAPITAL_ACCEPTANCE.minShadowExecutionDays,
      averageAbsGapPct: averageShadowGapPct,
    },
    paperExecution: {
      passed: paperTradingDays >= ETF_CAPITAL_ACCEPTANCE.minPaperTradingDays
        && ledger.orderCount >= ETF_CAPITAL_ACCEPTANCE.minPaperTrades,
      tradingDays: paperTradingDays,
      requiredTradingDays: ETF_CAPITAL_ACCEPTANCE.minPaperTradingDays,
      tradeCount: ledger.orderCount,
      requiredTrades: ETF_CAPITAL_ACCEPTANCE.minPaperTrades,
    },
    observedRisk: {
      passed: firstTradeDate != null
        && ledger.maxDrawdownPct != null
        && ledger.maxDrawdownPct >= ETF_CAPITAL_ACCEPTANCE.maxPaperDrawdownPct,
      maxDrawdownPct: ledger.maxDrawdownPct,
      limitPct: ETF_CAPITAL_ACCEPTANCE.maxPaperDrawdownPct,
    },
    reviewDiscipline: {
      passed: weeklyReviewCount >= ETF_CAPITAL_ACCEPTANCE.minWeeklyReviews,
      weeklyReviewCount,
      requiredWeeklyReviews: ETF_CAPITAL_ACCEPTANCE.minWeeklyReviews,
    },
  };
  const allPassed = Object.values(gates).every((gate) => gate.passed);
  const shadowRemaining = Math.max(
    0,
    ETF_CAPITAL_ACCEPTANCE.minShadowExecutionDays - validEvidence.length,
  );
  const paperRemaining = Math.max(
    0,
    ETF_CAPITAL_ACCEPTANCE.minPaperTradingDays - paperTradingDays,
  );
  const minimumRemainingTradingDays = Math.max(shadowRemaining, paperRemaining);
  const estimatedEarliestReviewDate = addWeekdays(asOfDate, minimumRemainingTradingDays);
  const blockers = Object.entries(gates)
    .filter(([, gate]) => !gate.passed)
    .map(([name]) => name);
  const report = {
    generatedAt: new Date().toISOString(),
    asOfDate,
    decision: allPassed ? 'eligible_for_small_tranche' : 'not_ready',
    canAcceptRealCapital: allPassed,
    allowedInitialCapitalTranchePct: allPassed
      ? ETF_CAPITAL_ACCEPTANCE.initialCapitalTranchePct
      : 0,
    minimumRemainingTradingDays,
    estimatedEarliestReviewDate,
    estimateNote: '日期只按工作日估算，未扣除未来交易所休市日；最终以实际有效交易日计数为准。',
    blockers,
    gates,
    account: {
      totalValue: account.totalValue,
      returnPct: account.returnPct,
      positionCount: account.positions.length,
    },
    dualSleeveLedger: {
      tradingDays: ledger.tradingDays,
      orderCount: ledger.orderCount,
      rebalanceCount: ledger.rebalanceCount,
      totalValue: ledger.totalValue,
      returnPct: ledger.returnPct,
      maxDrawdownPct: ledger.maxDrawdownPct,
    },
    acceptance: ETF_CAPITAL_ACCEPTANCE,
    paths: {
      plansPath,
      evidencePath,
      ledgerPath,
      readinessJsonPath,
      readinessMarkdownPath,
    },
  };
  writeJson(readinessJsonPath, report);
  const formattedAsOf = `${asOfDate.slice(0, 4)}-${asOfDate.slice(4, 6)}-${asOfDate.slice(6, 8)}`;
  writeFileSync(readinessMarkdownPath, [
    `# 长青 V3 资金准入报告（${formattedAsOf}）`,
    '',
    `- 当前结论：**${report.canAcceptRealCapital ? '允许首批小额资金' : '不接受真实资金'}**`,
    `- 最少还需有效交易日：${minimumRemainingTradingDays}`,
    `- 最早复核估算日：${estimatedEarliestReviewDate}`,
    `- 首批上限：${report.allowedInitialCapitalTranchePct}%`,
    '',
    '## 六道门',
    '',
    `- 历史验证：${gates.historical.passed ? '通过' : '未通过'}；年化 ${gates.historical.annualizedReturnPct ?? '—'}%，回撤 ${gates.historical.maxDrawdownPct ?? '—'}%。`,
    `- 数据质量：${gates.data.passed ? '通过' : '未通过'}；最新交易日 ${gates.data.latestTradeDate ?? '—'}。`,
    `- 影子执行：${gates.shadowExecution.passed ? '通过' : '未通过'}；${gates.shadowExecution.validDays}/${gates.shadowExecution.requiredDays} 个有效日。`,
    `- 双袖套模拟：${gates.paperExecution.passed ? '通过' : '未通过'}；${gates.paperExecution.tradingDays}/${gates.paperExecution.requiredTradingDays} 个交易日，${gates.paperExecution.tradeCount}/${gates.paperExecution.requiredTrades} 笔成交。`,
    `- 实盘风险：${gates.observedRisk.passed ? '通过' : '未通过'}；观察回撤 ${gates.observedRisk.maxDrawdownPct == null ? '—' : `${gates.observedRisk.maxDrawdownPct}%`}，上限 ${gates.observedRisk.limitPct}%。`,
    `- 复盘纪律：${gates.reviewDiscipline.passed ? '通过' : '未通过'}；${gates.reviewDiscipline.weeklyReviewCount}/${gates.reviewDiscipline.requiredWeeklyReviews} 周。`,
    '',
    '## 不可放宽',
    '',
    '- 未全部通过时，不接受真实资金。',
    '- 首次通过只允许计划资金的 10%，不允许一次性满仓。',
    '- 任一数据中断、执行偏差或风险越线，立即退回观察状态并重新累计。',
    '- 收益目标不是保证，历史通过不能替代真实执行证据。',
    '',
  ].join('\n'), 'utf-8');
  return report;
}

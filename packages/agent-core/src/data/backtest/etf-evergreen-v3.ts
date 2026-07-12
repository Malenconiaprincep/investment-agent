import { buildTradeGroups, summarizeTrades } from './engine.js';
import {
  buildEtfMomentumT1LivePlan,
  runEtfMomentumT1Backtest,
} from './etf-momentum-t1.js';
import {
  buildEtfStableV2LivePlan,
  runEtfStableV2Backtest,
} from './etf-stable-v2.js';
import type {
  BacktestPortfolioSnapshot,
  BacktestPositionSnapshot,
  BacktestRunResult,
  BacktestTrade,
} from './types.js';

export type RunEtfEvergreenV3Input = {
  startDate: string;
  endDate: string;
  initialCapital?: number;
  growthWeightPct?: number;
};

export type EtfEvergreenV3Result = BacktestRunResult & {
  evergreenMetrics: {
    growthWeightPct: number;
    defensiveWeightPct: number;
    totalReturnPct: number;
    annualizedReturnPct: number;
    maxDrawdownPct: number;
    totalTradingCost: number;
    tradingCostPct: number;
  };
};

export type EtfEvergreenV3LivePlan = {
  strategy: 'etf-evergreen-v3';
  signalDate: string;
  executionDate: string;
  tradeDate: string;
  topN: number;
  rebalanceDays: number;
  regimeExposureScale: number;
  weakRegime: boolean;
  bearRegime: boolean;
  cashReservePct: number;
  hotThemes?: string[];
  rotationSummary: string;
  sleeves: {
    growth: {
      rebalanceDays: number;
      stopLossPct: number;
      stopCooldownDays: number;
      targets: Array<{
        symbol: string;
        name: string;
        targetWeightPct: number;
        assetClass: string;
      }>;
    };
    defensive: {
      rebalanceDays: number;
      stopLossPct: number;
      stopCooldownDays: number;
      targets: Array<{
        symbol: string;
        name: string;
        targetWeightPct: number;
        assetClass: string;
      }>;
    };
  };
  targets: Array<{
    symbol: string;
    name: string;
    isBenchmarkFill: boolean;
    targetWeightPct: number;
    assetClass: string;
    reason: string;
    matchedThemes?: string[];
    themeBoost?: number;
    newsLabel?: string;
  }>;
};

function round(value: number, digits = 2) {
  return Number(value.toFixed(digits));
}

function mergePositions(
  defensive: BacktestPositionSnapshot[],
  growth: BacktestPositionSnapshot[],
  totalValue: number,
): BacktestPositionSnapshot[] {
  const merged = new Map<string, BacktestPositionSnapshot>();
  for (const positions of [defensive, growth]) {
    for (const position of positions) {
      const marketValue = position.marketValue;
      const costAmount = position.costAmount;
      const existing = merged.get(position.symbol);
      if (existing) {
        existing.marketValue += marketValue;
        existing.costAmount += costAmount;
        existing.shares += position.shares;
        existing.weightPct = totalValue > 0 ? existing.marketValue / totalValue * 100 : 0;
        existing.returnPct = existing.costAmount > 0
          ? (existing.marketValue / existing.costAmount - 1) * 100
          : null;
      } else {
        merged.set(position.symbol, {
          ...position,
          shares: position.shares,
          costAmount,
          marketValue,
          weightPct: totalValue > 0 ? marketValue / totalValue * 100 : 0,
          returnPct: costAmount > 0 ? (marketValue / costAmount - 1) * 100 : null,
        });
      }
    }
  }
  return [...merged.values()].map((position) => ({
    ...position,
    shares: position.shares,
    costAmount: round(position.costAmount),
    marketValue: round(position.marketValue),
    weightPct: round(position.weightPct),
    returnPct: position.returnPct == null ? null : round(position.returnPct),
  }));
}

function maxDrawdownPct(points: Array<{ equity: number }>) {
  let peak = points[0]?.equity ?? 0;
  let drawdown = 0;
  for (const point of points) {
    peak = Math.max(peak, point.equity);
    if (peak > 0) drawdown = Math.min(drawdown, point.equity / peak - 1);
  }
  return round(drawdown * 100);
}

function annualizedReturnPct(input: {
  startDate: string;
  endDate: string;
  startEquity: number;
  endEquity: number;
}) {
  const normalize = (value: string) => value.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
  const years = Math.max(
    1 / 252,
    (new Date(normalize(input.endDate)).getTime() - new Date(normalize(input.startDate)).getTime())
      / (365.25 * 86_400_000),
  );
  return round(((input.endEquity / input.startEquity) ** (1 / years) - 1) * 100);
}

function sleeveTrade(trade: BacktestTrade, sleeve: 'defensive' | 'growth'): BacktestTrade {
  return {
    ...trade,
    strategy: 'etf-evergreen-v3',
    signal: {
      ...trade.signal,
      strategy: 'etf-evergreen-v3',
      metadata: { ...trade.signal.metadata, evergreenSleeve: sleeve },
    },
  };
}

export async function buildEtfEvergreenV3LivePlan(input: {
  executionDate: string;
  portfolioDrawdownPct?: number;
  excludedSymbols?: Set<string>;
  rotationContext?: {
    matchedThemesBySymbol?: Record<string, string[]>;
    themeBoostBySymbol?: Record<string, number>;
    newsBySymbol?: Record<string, { label?: string }>;
  } | null;
}): Promise<EtfEvergreenV3LivePlan> {
  const growthWeight = 0.6;
  const defensiveWeight = 0.4;
  const [defensive, growth] = await Promise.all([
    buildEtfStableV2LivePlan({
      executionDate: input.executionDate,
      portfolioDrawdownPct: input.portfolioDrawdownPct,
      excludedSymbols: input.excludedSymbols,
      rotationContext: input.rotationContext,
    }),
    buildEtfMomentumT1LivePlan({
      executionDate: input.executionDate,
      excludedSymbols: input.excludedSymbols,
    }),
  ]);
  if (defensive.signalDate !== growth.signalDate) {
    throw new Error(
      `V3 袖套信号日期不一致：防守 ${defensive.signalDate}，增长 ${growth.signalDate}`,
    );
  }
  const merged = new Map<string, EtfEvergreenV3LivePlan['targets'][number]>();
  for (const [sleeve, targets, sleeveWeight] of [
    ['防守', defensive.targets, defensiveWeight],
    ['增长', growth.targets, growthWeight],
  ] as const) {
    for (const target of targets) {
      const weightedPct = target.targetWeightPct * sleeveWeight;
      const existing = merged.get(target.symbol);
      if (existing) {
        existing.targetWeightPct = round(existing.targetWeightPct + weightedPct, 4);
        existing.reason = `${existing.reason}；${sleeve}袖套：${target.reason}`;
        existing.assetClass = `${existing.assetClass}+${target.assetClass}`;
        existing.isBenchmarkFill = existing.isBenchmarkFill && target.isBenchmarkFill;
      } else {
        merged.set(target.symbol, {
          ...target,
          targetWeightPct: round(weightedPct, 4),
          assetClass: `${sleeve}:${target.assetClass}`,
          reason: `${sleeve}袖套：${target.reason}`,
        });
      }
    }
  }
  const targets = [...merged.values()]
    .filter((target) => target.targetWeightPct >= 0.01)
    .sort((a, b) => b.targetWeightPct - a.targetWeightPct);
  const targetTotalPct = targets.reduce((sum, target) => sum + target.targetWeightPct, 0);
  return {
    strategy: 'etf-evergreen-v3',
    signalDate: growth.signalDate,
    executionDate: growth.executionDate,
    tradeDate: growth.tradeDate,
    topN: merged.size,
    rebalanceDays: 20,
    regimeExposureScale: 1,
    weakRegime: defensive.weakRegime && growth.weakRegime,
    bearRegime: defensive.bearRegime && growth.bearRegime,
    cashReservePct: round(Math.max(0, 100 - targetTotalPct), 4),
    hotThemes: defensive.hotThemes,
    rotationSummary: 'V3 影子计划：60%风险调整增长袖套 + 40%多资产防守袖套；新闻只作归因。',
    sleeves: {
      growth: {
        rebalanceDays: 10,
        stopLossPct: -6,
        stopCooldownDays: 20,
        targets: growth.targets.map((target) => ({
          symbol: target.symbol,
          name: target.name,
          targetWeightPct: target.targetWeightPct,
          assetClass: target.assetClass,
        })),
      },
      defensive: {
        rebalanceDays: 20,
        stopLossPct: -12,
        stopCooldownDays: 10,
        targets: defensive.targets.map((target) => ({
          symbol: target.symbol,
          name: target.name,
          targetWeightPct: target.targetWeightPct,
          assetClass: target.assetClass,
        })),
      },
    },
    targets,
  };
}

export async function runEtfEvergreenV3Backtest(
  input: RunEtfEvergreenV3Input,
): Promise<EtfEvergreenV3Result> {
  const initialCapital = input.initialCapital ?? 100_000;
  const growthWeight = Math.min(0.8, Math.max(0.4, input.growthWeightPct ?? 0.6));
  const defensiveWeight = 1 - growthWeight;
  const growthCapital = initialCapital * growthWeight;
  const defensiveCapital = initialCapital - growthCapital;
  const [defensive, growth] = await Promise.all([
    runEtfStableV2Backtest({
      startDate: input.startDate,
      endDate: input.endDate,
      initialCapital: defensiveCapital,
      benchmarkCoreWeightPct: 0.5,
    }),
    runEtfMomentumT1Backtest({
      startDate: input.startDate,
      endDate: input.endDate,
      initialCapital: growthCapital,
      riskAdjustedMomentum: true,
      maxAssetVolPct: 40,
      stopLossPct: -6,
      stopCooldownDays: 20,
      cashFallbackInWeakRegime: true,
    }),
  ]);
  const defensiveEquity = new Map(
    defensive.equityCurve?.map((point) => [point.tradeDate, point]) ?? [],
  );
  const growthEquity = new Map(
    growth.equityCurve?.map((point) => [point.tradeDate, point]) ?? [],
  );
  const defensiveSnapshots = new Map(
    defensive.portfolioSnapshots?.map((point) => [point.tradeDate, point]) ?? [],
  );
  const growthSnapshots = new Map(
    growth.portfolioSnapshots?.map((point) => [point.tradeDate, point]) ?? [],
  );
  const dates = [...defensiveEquity.keys()]
    .filter((tradeDate) => growthEquity.has(tradeDate))
    .sort();
  const equityCurve = dates.map((tradeDate) => {
    const defensivePoint = defensiveEquity.get(tradeDate)!;
    const growthPoint = growthEquity.get(tradeDate)!;
    const equity = defensivePoint.equity + growthPoint.equity;
    return {
      tradeDate,
      equity: round(equity, 4),
      returnPct: round((equity / initialCapital - 1) * 100),
      closedTrades: defensivePoint.closedTrades + growthPoint.closedTrades,
    };
  });
  const portfolioSnapshots: BacktestPortfolioSnapshot[] = dates.flatMap((tradeDate) => {
    const defensivePoint = defensiveSnapshots.get(tradeDate);
    const growthPoint = growthSnapshots.get(tradeDate);
    if (!defensivePoint || !growthPoint) return [];
    const cash = defensivePoint.cash + growthPoint.cash;
    const investedMarketValue = defensivePoint.investedMarketValue
      + growthPoint.investedMarketValue;
    const totalValue = cash + investedMarketValue;
    return [{
      tradeDate,
      cash: round(cash),
      investedMarketValue: round(investedMarketValue),
      totalValue: round(totalValue),
      returnPct: round((totalValue / initialCapital - 1) * 100),
      closedTrades: defensivePoint.closedTrades + growthPoint.closedTrades,
      positions: mergePositions(
        defensivePoint.positions,
        growthPoint.positions,
        totalValue,
      ),
    }];
  });
  const trades = [
    ...defensive.trades.map((trade) => sleeveTrade(trade, 'defensive')),
    ...growth.trades.map((trade) => sleeveTrade(trade, 'growth')),
  ].sort((a, b) => a.entryDate.localeCompare(b.entryDate));
  const startPoint = equityCurve[0];
  const endPoint = equityCurve.at(-1);
  const totalReturnPct = endPoint ? round((endPoint.equity / initialCapital - 1) * 100) : 0;
  const totalTradingCost = round(
    defensive.stableMetrics.totalTradingCost + (growth.config?.totalTradingCost ?? 0),
  );
  const combinedMetrics = summarizeTrades(trades);
  combinedMetrics.maxDrawdownPct = maxDrawdownPct(equityCurve);

  return {
    strategy: 'etf-evergreen-v3',
    generatedAt: new Date().toISOString(),
    requestedDays: dates.length,
    startDate: dates[0] ?? input.startDate,
    endDate: dates.at(-1) ?? input.endDate,
    holdDays: [10, 20],
    symbols: [...new Map(
      [...defensive.symbols, ...growth.symbols].map((item) => [item.symbol, item]),
    ).values()],
    trades,
    metrics: combinedMetrics,
    groups: buildTradeGroups(trades, [
      { key: 'all', label: '全部交易', predicate: () => true },
      {
        key: 'defensive',
        label: '防守袖套',
        predicate: (trade) => trade.signal.metadata?.evergreenSleeve === 'defensive',
      },
      {
        key: 'growth',
        label: '增长袖套',
        predicate: (trade) => trade.signal.metadata?.evergreenSleeve === 'growth',
      },
    ]),
    equityCurve,
    portfolioSnapshots,
    benchmark: growth.benchmark,
    config: {
      strategyVersion: 'etf-evergreen-v3',
      signalExecution: 'next_open',
      commissionRate: growth.config?.commissionRate,
      slippageRate: growth.config?.slippageRate,
      minimumCommission: growth.config?.minimumCommission,
      initialCapital,
      growthSleeveWeightPct: growthWeight,
      defensiveSleeveWeightPct: defensiveWeight,
      maxAssetVolPct: 40,
      riskAdjustedMomentum: true,
      stopLossPct: -6,
      stopCooldownDays: 20,
      totalTradingCost,
      tradingCostPct: round((totalTradingCost / initialCapital) * 100),
    },
    notes: [
      `长青 V3 采用双袖套独立账本：${Math.round(growthWeight * 100)}% 本金运行风险调整 T+1 轮动，${Math.round(defensiveWeight * 100)}% 本金运行多资产防守；组合层只汇总现金、市值和整手份额，不缩放成交份额。`,
      '增长袖套使用单ETF近20日年化波动率不高于40%的风险调整动量，-6%止损并冷却20个交易日；弱市候选不足时进入货币ETF，不再强制补沪深300。',
      '未使用正T代理收益；未分配风险预算进入511880货币ETF，并计入T+1、滑点、佣金、最低佣金和整手约束。',
      '完整基金库用于验证上市时间、流动性、退市与复权异常；最终候选不直接在1500只主题ETF中追逐极端动量。',
    ],
    evergreenMetrics: {
      growthWeightPct: round(growthWeight * 100),
      defensiveWeightPct: round(defensiveWeight * 100),
      totalReturnPct,
      annualizedReturnPct: startPoint && endPoint
        ? annualizedReturnPct({
            startDate: startPoint.tradeDate,
            endDate: endPoint.tradeDate,
            startEquity: startPoint.equity,
            endEquity: endPoint.equity,
          })
        : 0,
      maxDrawdownPct: maxDrawdownPct(equityCurve),
      totalTradingCost,
      tradingCostPct: round((totalTradingCost / initialCapital) * 100),
    },
  };
}

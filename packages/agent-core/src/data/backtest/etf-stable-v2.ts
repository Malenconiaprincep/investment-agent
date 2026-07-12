import {
  ETF_STABLE_V2_BENCHMARK_SYMBOL,
  ETF_STABLE_V2_CASH_SYMBOL,
  ETF_STABLE_V2_UNIVERSE,
  isStableDefensiveAsset,
  isStableRiskAsset,
  type StableEtfAssetClass,
  type StableEtfUniverseItem,
} from '../etf/stable-universe.js';
import {
  ETF_COMMISSION_RATE,
  ETF_LOT_SIZE,
  ETF_SLIPPAGE_RATE,
} from '../etf/trading-cost.js';
import { getDailyQuote } from '../market/services.js';
import {
  hasLocalEtfDailyCsv,
  LOCAL_ETF_LOAD_ALL_DAYS,
} from '../market/local-csv/etf-daily.js';
import { calcMaxDrawdownPct, summarizeTrades } from './engine.js';
import {
  computeKlineDaysForRange,
  formatTradeDateKey,
  isTradeDateInRange,
  normalizeTradeDateKey,
  resolveBacktestDateRange,
  todayDateKey,
} from './date-range.js';
import type {
  BacktestEquityPoint,
  BacktestPortfolioSnapshot,
  BacktestRunResult,
  BacktestSignal,
  BacktestSymbolSummary,
  BacktestTrade,
} from './types.js';

export type StableV2Regime = 'bull' | 'neutral' | 'weak' | 'bear';
export type StableV2DrawdownStage = 'normal' | 'soft' | 'defensive' | 'hard';

export type StableV2Bar = {
  tradeDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type StableV2History = {
  item: StableEtfUniverseItem;
  bars: StableV2Bar[];
  byDate: Map<string, StableV2Bar & { index: number }>;
};

export type StableV2Config = {
  rebalanceDays: number;
  momentumWindows: [number, number, number];
  momentumWeights: [number, number, number];
  trendMaDays: number;
  volatilityDays: number;
  targetPortfolioVolPct: number;
  maxPositions: number;
  maxTacticalWeightPct: number;
  benchmarkCoreWeightPct: number;
  drawdownSoftPct: number;
  drawdownDefensivePct: number;
  drawdownHardPct: number;
  hardMinimumDays: number;
  recoveryConfirmDays: number;
  recoveryStepDays: number;
  positionStopLossPct: number;
  stopCooldownDays: number;
  commissionRate: number;
  slippageRate: number;
  minimumCommission: number;
  rebalanceDriftPct: number;
  initialCapital: number;
};

export type RunEtfStableV2BacktestInput = Partial<StableV2Config> & {
  days?: number;
  startDate?: string;
  endDate?: string;
  histories?: StableV2History[];
};

export type StableV2Candidate = {
  history: StableV2History;
  score: number;
  rawMomentumPct: number;
  momentum20Pct: number;
  momentum60Pct: number;
  momentum120Pct: number;
  annualizedVolPct: number;
  trendMa: number;
  close: number;
};

export type StableV2Target = {
  symbol: string;
  name: string;
  assetClass: StableEtfAssetClass;
  riskCluster: string;
  targetWeight: number;
  score: number;
  annualizedVolPct: number;
  reason: string;
};

export type StableV2Allocation = {
  signalDate: string;
  regime: StableV2Regime;
  riskAllocation: number;
  drawdownPct: number;
  drawdownStage: StableV2DrawdownStage;
  controlDrawdownPct: number;
  targetPortfolioVolPct: number;
  estimatedPortfolioVolPct: number | null;
  targets: StableV2Target[];
  rejected: Array<{ symbol: string; reason: string }>;
};

export type StableV2AnnualReturn = {
  year: string;
  returnPct: number;
};

export type StableV2RollingWindow = {
  startDate: string;
  endDate: string;
  returnPct: number;
  maxDrawdownPct: number;
};

export type StableV2Attribution = {
  bySymbol: Array<{
    symbol: string;
    name: string;
    assetClass: StableEtfAssetClass;
    realizedPnl: number;
    tradeCount: number;
  }>;
  byAssetClass: Array<{
    assetClass: StableEtfAssetClass;
    realizedPnl: number;
    tradeCount: number;
  }>;
};

export type StableV2Metrics = {
  totalReturnPct: number;
  annualizedReturnPct: number | null;
  annualizedVolPct: number | null;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  maxDrawdownPct: number | null;
  calmarRatio: number | null;
  positiveYearPct: number | null;
  rolling12mPositivePct: number | null;
  turnoverPct: number;
  totalTradingCost: number;
  tradingCostPct: number;
  averageInvestedPct: number;
  averageRiskAssetPct: number;
};

export type StableV2Review = {
  status: 'eligible_for_paper' | 'observe' | 'reject';
  summary: string;
  passedChecks: string[];
  failedChecks: string[];
  lessons: string[];
  nextActions: string[];
};

export type StableV2RebalanceLog = {
  signalDate: string;
  executionDate: string | null;
  regime: StableV2Regime;
  riskAllocationPct: number;
  cashReservePct: number;
  drawdownPct: number;
  controlDrawdownPct: number;
  drawdownStage: StableV2Allocation['drawdownStage'];
  estimatedPortfolioVolPct: number | null;
  targets: Array<{ symbol: string; weightPct: number; reason: string }>;
};

export type EtfStableV2BacktestResult = BacktestRunResult & {
  stableMetrics: StableV2Metrics;
  annualReturns: StableV2AnnualReturn[];
  rolling12m: StableV2RollingWindow[];
  attribution: StableV2Attribution;
  review: StableV2Review;
  rebalanceLog: StableV2RebalanceLog[];
};

export type EtfStableV2LivePlan = {
  strategy: 'etf-stable-v2';
  signalDate: string;
  executionDate: string;
  tradeDate: string;
  topN: number;
  rebalanceDays: number;
  regimeExposureScale: number;
  weakRegime: boolean;
  bearRegime: boolean;
  regime: StableV2Regime;
  riskAllocationPct: number;
  cashReservePct: number;
  drawdownPct: number;
  drawdownStage: StableV2Allocation['drawdownStage'];
  estimatedPortfolioVolPct: number | null;
  hotThemes?: string[];
  rotationSummary?: string;
  targets: Array<{
    symbol: string;
    name: string;
    isBenchmarkFill: boolean;
    targetWeightPct: number;
    assetClass: StableEtfAssetClass;
    reason: string;
    matchedThemes?: string[];
    themeBoost?: number;
    newsLabel?: string;
  }>;
};

export const ETF_STABLE_V2_DEFAULT_CONFIG: Readonly<StableV2Config> = {
  rebalanceDays: 20,
  momentumWindows: [20, 60, 120],
  momentumWeights: [0.25, 0.35, 0.4],
  trendMaDays: 120,
  volatilityDays: 20,
  targetPortfolioVolPct: 12,
  maxPositions: 4,
  maxTacticalWeightPct: 0.2,
  benchmarkCoreWeightPct: 0.5,
  drawdownSoftPct: -6,
  drawdownDefensivePct: -9,
  drawdownHardPct: -12,
  hardMinimumDays: 20,
  recoveryConfirmDays: 5,
  recoveryStepDays: 10,
  positionStopLossPct: -12,
  stopCooldownDays: 10,
  commissionRate: ETF_COMMISSION_RATE,
  slippageRate: ETF_SLIPPAGE_RATE,
  minimumCommission: 5,
  rebalanceDriftPct: 0.03,
  initialCapital: 100_000,
};

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleStdDev(values: number[]): number | null {
  if (values.length < 2) return null;
  const avg = mean(values)!;
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0)
    / (values.length - 1);
  return Math.sqrt(variance);
}

function resolveConfig(input: RunEtfStableV2BacktestInput = {}): StableV2Config {
  const defaults = ETF_STABLE_V2_DEFAULT_CONFIG;
  const positiveInt = (value: number | undefined, fallback: number, min: number, max: number) =>
    value != null && Number.isFinite(value)
      ? Math.floor(clamp(value, min, max))
      : fallback;
  const finite = (value: number | undefined, fallback: number, min: number, max: number) =>
    value != null && Number.isFinite(value) ? clamp(value, min, max) : fallback;

  const windows = input.momentumWindows ?? defaults.momentumWindows;
  return {
    rebalanceDays: positiveInt(input.rebalanceDays, defaults.rebalanceDays, 1, 60),
    momentumWindows: [
      positiveInt(windows[0], defaults.momentumWindows[0], 5, 60),
      positiveInt(windows[1], defaults.momentumWindows[1], 20, 120),
      positiveInt(windows[2], defaults.momentumWindows[2], 60, 250),
    ],
    momentumWeights: input.momentumWeights ?? defaults.momentumWeights,
    trendMaDays: positiveInt(input.trendMaDays, defaults.trendMaDays, 20, 250),
    volatilityDays: positiveInt(input.volatilityDays, defaults.volatilityDays, 10, 120),
    targetPortfolioVolPct: finite(
      input.targetPortfolioVolPct,
      defaults.targetPortfolioVolPct,
      4,
      25,
    ),
    maxPositions: positiveInt(input.maxPositions, defaults.maxPositions, 2, 8),
    maxTacticalWeightPct: finite(
      input.maxTacticalWeightPct,
      defaults.maxTacticalWeightPct,
      0,
      0.4,
    ),
    benchmarkCoreWeightPct: finite(
      input.benchmarkCoreWeightPct,
      defaults.benchmarkCoreWeightPct,
      0,
      0.7,
    ),
    drawdownSoftPct: finite(input.drawdownSoftPct, defaults.drawdownSoftPct, -20, -1),
    drawdownDefensivePct: finite(
      input.drawdownDefensivePct,
      defaults.drawdownDefensivePct,
      -30,
      -2,
    ),
    drawdownHardPct: finite(input.drawdownHardPct, defaults.drawdownHardPct, -40, -3),
    hardMinimumDays: positiveInt(
      input.hardMinimumDays,
      defaults.hardMinimumDays,
      5,
      120,
    ),
    recoveryConfirmDays: positiveInt(
      input.recoveryConfirmDays,
      defaults.recoveryConfirmDays,
      2,
      30,
    ),
    recoveryStepDays: positiveInt(
      input.recoveryStepDays,
      defaults.recoveryStepDays,
      5,
      60,
    ),
    positionStopLossPct: finite(
      input.positionStopLossPct,
      defaults.positionStopLossPct,
      -40,
      -3,
    ),
    stopCooldownDays: positiveInt(
      input.stopCooldownDays,
      defaults.stopCooldownDays,
      0,
      60,
    ),
    commissionRate: finite(input.commissionRate, defaults.commissionRate, 0, 0.01),
    slippageRate: finite(input.slippageRate, defaults.slippageRate, 0, 0.02),
    minimumCommission: finite(
      input.minimumCommission,
      defaults.minimumCommission,
      0,
      100,
    ),
    rebalanceDriftPct: finite(
      input.rebalanceDriftPct,
      defaults.rebalanceDriftPct,
      0,
      0.2,
    ),
    initialCapital: finite(input.initialCapital, defaults.initialCapital, 1_000, 1e10),
  };
}

export function createStableV2History(
  item: StableEtfUniverseItem,
  bars: StableV2Bar[],
): StableV2History {
  const normalized = bars
    .filter((bar) => bar.close > 0)
    .map((bar) => ({
      tradeDate: normalizeTradeDateKey(bar.tradeDate),
      open: bar.open > 0 ? bar.open : bar.close,
      high: bar.high > 0 ? bar.high : bar.close,
      low: bar.low > 0 ? bar.low : bar.close,
      close: bar.close,
    }))
    .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  return {
    item,
    bars: normalized,
    byDate: new Map(normalized.map((bar, index) => [bar.tradeDate, { ...bar, index }])),
  };
}

function percentageReturn(history: StableV2History, endIndex: number, days: number): number | null {
  const current = history.bars[endIndex]?.close;
  const past = history.bars[endIndex - days]?.close;
  if (!current || !past || past <= 0) return null;
  return ((current - past) / past) * 100;
}

function movingAverage(history: StableV2History, endIndex: number, days: number): number | null {
  if (endIndex < days - 1) return null;
  return mean(history.bars.slice(endIndex - days + 1, endIndex + 1).map((bar) => bar.close));
}

function annualizedVolatilityPct(
  history: StableV2History,
  endIndex: number,
  days: number,
): number | null {
  if (endIndex < days) return null;
  const returns: number[] = [];
  for (let index = endIndex - days + 1; index <= endIndex; index += 1) {
    const previous = history.bars[index - 1]?.close;
    const current = history.bars[index]?.close;
    if (!previous || !current || previous <= 0) return null;
    returns.push(current / previous - 1);
  }
  const daily = sampleStdDev(returns);
  return daily == null ? null : daily * Math.sqrt(252) * 100;
}

function scoreCandidate(
  history: StableV2History,
  signalDate: string,
  config: StableV2Config,
): StableV2Candidate | null {
  const current = history.byDate.get(signalDate);
  if (!current) return null;
  const [shortDays, mediumDays, longDays] = config.momentumWindows;
  const required = Math.max(longDays, config.trendMaDays, config.volatilityDays);
  if (current.index < required) return null;

  const short = percentageReturn(history, current.index, shortDays);
  const medium = percentageReturn(history, current.index, mediumDays);
  const long = percentageReturn(history, current.index, longDays);
  const trendMa = movingAverage(history, current.index, config.trendMaDays);
  const vol = annualizedVolatilityPct(history, current.index, config.volatilityDays);
  if (short == null || medium == null || long == null || trendMa == null || vol == null) {
    return null;
  }
  const rawMomentum =
    short * config.momentumWeights[0]
    + medium * config.momentumWeights[1]
    + long * config.momentumWeights[2];
  const volatilityFloor = isStableRiskAsset(history.item.assetClass) ? 8 : 3;
  return {
    history,
    score: rawMomentum / Math.max(vol, volatilityFloor),
    rawMomentumPct: rawMomentum,
    momentum20Pct: short,
    momentum60Pct: medium,
    momentum120Pct: long,
    annualizedVolPct: vol,
    trendMa,
    close: current.close,
  };
}

function resolveRegime(candidates: StableV2Candidate[]): StableV2Regime {
  const core = candidates.filter((candidate) => candidate.history.item.assetClass === 'equity_core');
  if (core.length === 0) return 'bear';
  const positive = core.filter(
    (candidate) =>
      candidate.close >= candidate.trendMa
      && candidate.momentum60Pct > 0
      && candidate.rawMomentumPct > 0,
  );
  const breadth = positive.length / core.length;
  const averageMomentum = mean(core.map((candidate) => candidate.momentum60Pct)) ?? 0;
  if (breadth >= 0.66 && averageMomentum > 0) return 'bull';
  if (breadth >= 0.4) return 'neutral';
  if (breadth > 0 || averageMomentum > -3) return 'weak';
  return 'bear';
}

function drawdownStage(
  drawdownPct: number,
  config: StableV2Config,
): StableV2Allocation['drawdownStage'] {
  if (drawdownPct <= config.drawdownHardPct) return 'hard';
  if (drawdownPct <= config.drawdownDefensivePct) return 'defensive';
  if (drawdownPct <= config.drawdownSoftPct) return 'soft';
  return 'normal';
}

export type StableV2RiskControlState = {
  stage: StableV2DrawdownStage;
  stageDays: number;
  recoveryDays: number;
  anchorPeakEquity: number;
};

const DRAWDOWN_STAGE_RANK: Record<StableV2DrawdownStage, number> = {
  normal: 0,
  soft: 1,
  defensive: 2,
  hard: 3,
};

function nextRecoveryStage(stage: StableV2DrawdownStage): StableV2DrawdownStage {
  if (stage === 'hard') return 'defensive';
  if (stage === 'defensive') return 'soft';
  if (stage === 'soft') return 'normal';
  return 'normal';
}

/**
 * Performance drawdown remains anchored to the true all-time equity peak. Risk control uses a
 * separate anchor so a hard cash allocation can recover after a confirmed market trend instead
 * of waiting for a cash ETF to regain the old portfolio peak.
 */
export function advanceStableV2RiskControl(input: {
  state: StableV2RiskControlState;
  equity: number;
  recoveryEligible: boolean;
  config?: StableV2Config;
}): StableV2RiskControlState & { controlDrawdownPct: number; changed: boolean } {
  const config = input.config ?? { ...ETF_STABLE_V2_DEFAULT_CONFIG };
  let anchorPeakEquity = Math.max(input.state.anchorPeakEquity, input.equity);
  let controlDrawdownPct = anchorPeakEquity > 0
    ? ((input.equity - anchorPeakEquity) / anchorPeakEquity) * 100
    : 0;
  const thresholdStage = drawdownStage(controlDrawdownPct, config);
  let stage = input.state.stage;
  let stageDays = input.state.stageDays + 1;
  let recoveryDays = input.recoveryEligible ? input.state.recoveryDays + 1 : 0;

  if (DRAWDOWN_STAGE_RANK[thresholdStage] > DRAWDOWN_STAGE_RANK[stage]) {
    stage = thresholdStage;
    stageDays = 0;
    recoveryDays = 0;
  } else if (stage !== 'normal') {
    const minimumDays = stage === 'hard' ? config.hardMinimumDays : config.recoveryStepDays;
    if (
      stageDays >= minimumDays
      && recoveryDays >= config.recoveryConfirmDays
    ) {
      stage = nextRecoveryStage(stage);
      stageDays = 0;
      recoveryDays = 0;
      if (input.state.stage === 'hard') {
        anchorPeakEquity = input.equity;
        controlDrawdownPct = 0;
      }
    }
  } else if (thresholdStage !== 'normal') {
    stage = thresholdStage;
    stageDays = 0;
    recoveryDays = 0;
  }

  return {
    stage,
    stageDays,
    recoveryDays,
    anchorPeakEquity,
    controlDrawdownPct,
    changed: stage !== input.state.stage,
  };
}

function baseRiskAllocation(regime: StableV2Regime): number {
  if (regime === 'bull') return 0.75;
  if (regime === 'neutral') return 0.5;
  if (regime === 'weak') return 0.25;
  return 0;
}

function applyDrawdownRiskCap(
  allocation: number,
  stage: StableV2Allocation['drawdownStage'],
): number {
  if (stage === 'hard') return 0;
  if (stage === 'defensive') return Math.min(allocation, 0.25);
  if (stage === 'soft') return Math.min(allocation, 0.5);
  return allocation;
}

function selectRiskCandidates(
  candidates: StableV2Candidate[],
  maxCount: number,
  excludedSymbols: Set<string>,
): StableV2Candidate[] {
  const selected: StableV2Candidate[] = [];
  const clusters = new Set<string>();
  let tacticalCount = 0;
  const eligible = candidates
    .filter((candidate) => isStableRiskAsset(candidate.history.item.assetClass))
    .filter((candidate) => !excludedSymbols.has(candidate.history.item.symbol))
    .filter(
      (candidate) =>
        candidate.close >= candidate.trendMa
        && candidate.momentum60Pct > 0
        && candidate.rawMomentumPct > 0,
    )
    .sort((a, b) => b.score - a.score);

  for (const candidate of eligible) {
    if (selected.length >= maxCount) break;
    const item = candidate.history.item;
    if (clusters.has(item.riskCluster)) continue;
    if (item.assetClass === 'equity_tactical' && tacticalCount >= 1) continue;
    selected.push(candidate);
    clusters.add(item.riskCluster);
    if (item.assetClass === 'equity_tactical') tacticalCount += 1;
  }
  return selected;
}

function selectDefensiveCandidates(
  candidates: StableV2Candidate[],
  maxCount: number,
  hardRiskOff: boolean,
): StableV2Candidate[] {
  const cash = candidates.find(
    (candidate) => candidate.history.item.symbol === ETF_STABLE_V2_CASH_SYMBOL,
  );
  if (hardRiskOff) return cash ? [cash] : [];

  const trending = candidates
    .filter((candidate) => isStableDefensiveAsset(candidate.history.item.assetClass))
    .filter((candidate) => candidate.history.item.assetClass !== 'cash')
    .filter(
      (candidate) =>
        candidate.rawMomentumPct > 0
        && candidate.close >= candidate.trendMa,
    )
    .sort((a, b) => b.score - a.score);

  const selected = trending.slice(0, Math.max(0, maxCount - 1));
  if (cash) selected.push(cash);
  if (selected.length === 0 && trending[0]) selected.push(trending[0]);
  return selected.slice(0, maxCount);
}

function cappedInverseVolWeights(
  candidates: StableV2Candidate[],
  totalWeight: number,
  maxTacticalWeight: number,
): Map<string, number> {
  const weights = new Map<string, number>();
  if (totalWeight <= 0 || candidates.length === 0) return weights;
  const remaining = new Set(candidates.map((candidate) => candidate.history.item.symbol));
  let unallocated = totalWeight;

  for (let pass = 0; pass < candidates.length + 2 && remaining.size > 0; pass += 1) {
    const active = candidates.filter((candidate) => remaining.has(candidate.history.item.symbol));
    const inverseVolTotal = active.reduce(
      (sum, candidate) => sum + 1 / Math.max(candidate.annualizedVolPct, 3),
      0,
    );
    if (inverseVolTotal <= 0) break;
    let cappedAny = false;
    for (const candidate of active) {
      const item = candidate.history.item;
      const proposed = unallocated
        * ((1 / Math.max(candidate.annualizedVolPct, 3)) / inverseVolTotal);
      const cap = item.assetClass === 'equity_tactical'
        ? Math.min(item.maxWeight, maxTacticalWeight)
        : item.maxWeight;
      if (proposed > cap + 1e-10) {
        weights.set(item.symbol, cap);
        unallocated -= cap;
        remaining.delete(item.symbol);
        cappedAny = true;
      }
    }
    if (cappedAny) continue;
    for (const candidate of active) {
      const item = candidate.history.item;
      const weight = unallocated
        * ((1 / Math.max(candidate.annualizedVolPct, 3)) / inverseVolTotal);
      weights.set(item.symbol, (weights.get(item.symbol) ?? 0) + weight);
    }
    unallocated = 0;
    break;
  }

  if (unallocated > 1e-8) {
    const cash = candidates.find(
      (candidate) => candidate.history.item.symbol === ETF_STABLE_V2_CASH_SYMBOL,
    );
    if (cash) {
      weights.set(
        cash.history.item.symbol,
        (weights.get(cash.history.item.symbol) ?? 0) + unallocated,
      );
    }
  }
  return weights;
}

function estimatePortfolioVolPct(
  histories: StableV2History[],
  signalDate: string,
  weights: Map<string, number>,
  lookbackDays = 60,
): number | null {
  const selected = histories.filter((history) => (weights.get(history.item.symbol) ?? 0) > 0);
  if (selected.length === 0) return 0;
  const currentIndices = selected.map((history) => history.byDate.get(signalDate)?.index ?? -1);
  if (currentIndices.some((index) => index < lookbackDays)) return null;

  const portfolioReturns: number[] = [];
  for (let offset = lookbackDays - 1; offset >= 0; offset -= 1) {
    let daily = 0;
    let valid = true;
    for (let assetIndex = 0; assetIndex < selected.length; assetIndex += 1) {
      const history = selected[assetIndex]!;
      const index = currentIndices[assetIndex]! - offset;
      const previous = history.bars[index - 1]?.close;
      const current = history.bars[index]?.close;
      if (!previous || !current) {
        valid = false;
        break;
      }
      daily += (weights.get(history.item.symbol) ?? 0) * (current / previous - 1);
    }
    if (valid) portfolioReturns.push(daily);
  }
  const dailyVol = sampleStdDev(portfolioReturns);
  return dailyVol == null ? null : dailyVol * Math.sqrt(252) * 100;
}

export function buildStableV2Allocation(input: {
  histories: StableV2History[];
  signalDate: string;
  drawdownPct?: number;
  controlDrawdownPct?: number;
  drawdownStageOverride?: StableV2DrawdownStage;
  excludedSymbols?: Set<string>;
  config?: StableV2Config;
}): StableV2Allocation {
  const config = input.config ?? { ...ETF_STABLE_V2_DEFAULT_CONFIG };
  const drawdownPct = input.drawdownPct ?? 0;
  const excludedSymbols = input.excludedSymbols ?? new Set<string>();
  const candidates = input.histories
    .map((history) => scoreCandidate(history, input.signalDate, config))
    .filter((candidate): candidate is StableV2Candidate => candidate != null);
  const rejected = input.histories
    .filter((history) => !candidates.some((candidate) => candidate.history === history))
    .map((history) => ({ symbol: history.item.symbol, reason: '历史长度不足或当日缺少有效行情' }));
  const regime = resolveRegime(candidates);
  const controlDrawdownPct = input.controlDrawdownPct ?? drawdownPct;
  const stage = input.drawdownStageOverride ?? drawdownStage(controlDrawdownPct, config);
  let riskAllocation = applyDrawdownRiskCap(baseRiskAllocation(regime), stage);
  const benchmarkCandidate = candidates.find(
    (candidate) => candidate.history.item.symbol === ETF_STABLE_V2_BENCHMARK_SYMBOL,
  );
  const benchmarkEligible = benchmarkCandidate != null
    && !excludedSymbols.has(ETF_STABLE_V2_BENCHMARK_SYMBOL)
    && benchmarkCandidate.close >= benchmarkCandidate.trendMa
    && benchmarkCandidate.momentum60Pct > 0
    && benchmarkCandidate.rawMomentumPct > 0;
  const desiredBenchmarkCoreWeight = benchmarkEligible
    ? regime === 'bull'
      ? config.benchmarkCoreWeightPct
      : regime === 'neutral'
        ? config.benchmarkCoreWeightPct / 2
        : 0
    : 0;

  const provisionalRiskCount = Math.min(
    Math.max(0, Math.round(riskAllocation * config.maxPositions)),
    Math.max(0, config.maxPositions - 1),
  );
  const satelliteExclusions = new Set(excludedSymbols);
  if (desiredBenchmarkCoreWeight > 0) {
    satelliteExclusions.add(ETF_STABLE_V2_BENCHMARK_SYMBOL);
  }
  const satelliteCount = Math.max(
    0,
    provisionalRiskCount - (desiredBenchmarkCoreWeight > 0 ? 1 : 0),
  );
  const satelliteCandidates = selectRiskCandidates(
    candidates,
    satelliteCount,
    satelliteExclusions,
  );
  let riskCandidates = desiredBenchmarkCoreWeight > 0 && benchmarkCandidate
    ? [benchmarkCandidate, ...satelliteCandidates]
    : satelliteCandidates;
  if (riskCandidates.length === 0) riskAllocation = 0;
  const defensiveCount = Math.max(1, config.maxPositions - riskCandidates.length);
  let defensiveCandidates = selectDefensiveCandidates(
    candidates,
    defensiveCount,
    stage === 'hard',
  );

  const buildRiskWeights = (totalRiskWeight: number): Map<string, number> => {
    if (totalRiskWeight <= 0 || riskCandidates.length === 0) return new Map();
    const benchmarkWeight = benchmarkCandidate && riskCandidates.includes(benchmarkCandidate)
      ? Math.min(
          totalRiskWeight,
          desiredBenchmarkCoreWeight,
          benchmarkCandidate.history.item.maxWeight,
        )
      : 0;
    const satelliteWeight = Math.max(0, totalRiskWeight - benchmarkWeight);
    const weights = cappedInverseVolWeights(
      satelliteCandidates,
      satelliteWeight,
      config.maxTacticalWeightPct,
    );
    if (benchmarkWeight > 0) {
      weights.set(ETF_STABLE_V2_BENCHMARK_SYMBOL, benchmarkWeight);
    }
    return weights;
  };
  let riskWeights = buildRiskWeights(riskAllocation);
  const allocatedRisk = [...riskWeights.values()].reduce((sum, value) => sum + value, 0);
  let defensiveWeights = cappedInverseVolWeights(
    defensiveCandidates,
    Math.max(0, 1 - allocatedRisk),
    config.maxTacticalWeightPct,
  );
  let combined = new Map([...riskWeights, ...defensiveWeights]);
  let estimatedVol = estimatePortfolioVolPct(input.histories, input.signalDate, combined);

  for (let iteration = 0; iteration < 2; iteration += 1) {
    if (
      estimatedVol == null
      || estimatedVol <= config.targetPortfolioVolPct
      || riskCandidates.length === 0
    ) {
      break;
    }
    const volatilityScale = clamp(config.targetPortfolioVolPct / estimatedVol, 0, 1);
    riskAllocation *= volatilityScale;
    riskWeights = buildRiskWeights(riskAllocation);
    const nextRisk = [...riskWeights.values()].reduce((sum, value) => sum + value, 0);
    defensiveWeights = cappedInverseVolWeights(
      defensiveCandidates,
      Math.max(0, 1 - nextRisk),
      config.maxTacticalWeightPct,
    );
    combined = new Map([...riskWeights, ...defensiveWeights]);
    estimatedVol = estimatePortfolioVolPct(input.histories, input.signalDate, combined);
  }

  const candidateBySymbol = new Map(candidates.map((candidate) => [candidate.history.item.symbol, candidate]));
  const targets = [...combined.entries()]
    .filter(([, weight]) => weight > 0.0001)
    .map(([symbol, weight]): StableV2Target => {
      const candidate = candidateBySymbol.get(symbol)!;
      const item = candidate.history.item;
      const role = isStableRiskAsset(item.assetClass) ? '风险资产' : '防守资产';
      return {
        symbol,
        name: item.name,
        assetClass: item.assetClass,
        riskCluster: item.riskCluster,
        targetWeight: weight,
        score: candidate.score,
        annualizedVolPct: candidate.annualizedVolPct,
        reason: `${role}；多周期动量 ${candidate.rawMomentumPct.toFixed(2)}%；波动率 ${candidate.annualizedVolPct.toFixed(2)}%`,
      };
    })
    .sort((a, b) => b.targetWeight - a.targetWeight);

  return {
    signalDate: input.signalDate,
    regime,
    riskAllocation: targets
      .filter((target) => isStableRiskAsset(target.assetClass))
      .reduce((sum, target) => sum + target.targetWeight, 0),
    drawdownPct,
    drawdownStage: stage,
    controlDrawdownPct,
    targetPortfolioVolPct: config.targetPortfolioVolPct,
    estimatedPortfolioVolPct: estimatedVol,
    targets,
    rejected,
  };
}

type StablePosition = {
  history: StableV2History;
  shares: number;
  costBasis: number;
  entryDate: string;
  entryPrice: number;
  signal: BacktestSignal;
};

type PendingAllocation = {
  allocation: StableV2Allocation;
  executionDate: string;
};

type RealizedContribution = {
  symbol: string;
  name: string;
  assetClass: StableEtfAssetClass;
  pnl: number;
};

type SimulationResult = {
  trades: BacktestTrade[];
  equityCurve: BacktestEquityPoint[];
  portfolioSnapshots: BacktestPortfolioSnapshot[];
  rebalanceLog: StableV2RebalanceLog[];
  realized: RealizedContribution[];
  totalTradingCost: number;
  turnoverAmount: number;
  averageInvestedPct: number;
  averageRiskAssetPct: number;
};

function findBarAtOrBefore(
  history: StableV2History,
  tradeDate: string,
): (StableV2Bar & { index: number }) | undefined {
  const exact = history.byDate.get(tradeDate);
  if (exact) return exact;
  let low = 0;
  let high = history.bars.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (history.bars[middle]!.tradeDate <= tradeDate) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found >= 0 ? { ...history.bars[found]!, index: found } : undefined;
}

function buyCost(input: {
  price: number;
  shares: number;
  config: StableV2Config;
}): { executionPrice: number; totalCost: number; tradingCost: number } {
  const executionPrice = input.price * (1 + input.config.slippageRate);
  const grossAmount = executionPrice * input.shares;
  const commission = Math.max(
    input.config.minimumCommission,
    grossAmount * input.config.commissionRate,
  );
  const slippage = input.price * input.shares * input.config.slippageRate;
  return {
    executionPrice,
    totalCost: grossAmount + commission,
    tradingCost: commission + slippage,
  };
}

function sellProceeds(input: {
  price: number;
  shares: number;
  config: StableV2Config;
}): {
  executionPrice: number;
  netProceeds: number;
  tradingCost: number;
} {
  const executionPrice = input.price * (1 - input.config.slippageRate);
  const grossAmount = executionPrice * input.shares;
  const commission = Math.max(
    input.config.minimumCommission,
    grossAmount * input.config.commissionRate,
  );
  const slippage = input.price * input.shares * input.config.slippageRate;
  return {
    executionPrice,
    netProceeds: Math.max(0, grossAmount - commission),
    tradingCost: commission + slippage,
  };
}

function markPosition(
  position: StablePosition,
  tradeDate: string,
  priceField: 'open' | 'close' = 'close',
): number {
  const bar = findBarAtOrBefore(position.history, tradeDate);
  if (!bar) return position.costBasis;
  return position.shares * bar[priceField];
}

function portfolioValue(
  cash: number,
  positions: Map<string, StablePosition>,
  tradeDate: string,
  priceField: 'open' | 'close' = 'close',
): number {
  let value = cash;
  for (const position of positions.values()) {
    value += markPosition(position, tradeDate, priceField);
  }
  return value;
}

function makeSignal(input: {
  target: StableV2Target;
  signalDate: string;
  executionDate: string;
  executionPrice: number;
  allocation: StableV2Allocation;
  config: StableV2Config;
}): BacktestSignal {
  return {
    symbol: input.target.symbol,
    name: input.target.name,
    assetType: 'etf',
    strategy: 'etf-stable-v2',
    tradeDate: input.signalDate,
    entryPrice: round(input.executionPrice, 4),
    score: round(input.target.score, 4),
    metadata: {
      strategyVersion: 'stable-v2.0',
      executionDate: input.executionDate,
      signalExecution: 'next_open',
      targetWeightPct: round(input.target.targetWeight * 100),
      assetClass: input.target.assetClass,
      riskCluster: input.target.riskCluster,
      regime: input.allocation.regime,
      drawdownStage: input.allocation.drawdownStage,
      drawdownPct: round(input.allocation.drawdownPct),
      annualizedVolPct: round(input.target.annualizedVolPct),
      rebalanceDays: input.config.rebalanceDays,
      momentumWindows: input.config.momentumWindows,
      reason: input.target.reason,
    },
  };
}

function executeTargetAllocation(input: {
  pending: PendingAllocation;
  positions: Map<string, StablePosition>;
  cash: number;
  trades: BacktestTrade[];
  realized: RealizedContribution[];
  config: StableV2Config;
  historyBySymbol: Map<string, StableV2History>;
}): {
  cash: number;
  totalTradingCost: number;
  turnoverAmount: number;
} {
  const { pending, positions, config } = input;
  const executionDate = pending.executionDate;
  let cash = input.cash;
  let totalTradingCost = 0;
  let turnoverAmount = 0;
  const equityAtOpen = portfolioValue(cash, positions, executionDate, 'open');
  const targets = new Map(pending.allocation.targets.map((target) => [target.symbol, target]));
  const desiredShares = new Map<string, number>();

  for (const target of pending.allocation.targets) {
    const bar = input.historyBySymbol.get(target.symbol)?.byDate.get(executionDate);
    if (!bar || bar.open <= 0) continue;
    const existing = positions.get(target.symbol);
    const currentWeight = existing && equityAtOpen > 0
      ? (existing.shares * bar.open) / equityAtOpen
      : 0;
    if (
      existing
      && Math.abs(currentWeight - target.targetWeight) < config.rebalanceDriftPct
    ) {
      desiredShares.set(target.symbol, existing.shares);
      continue;
    }
    const shares = Math.floor(
      (equityAtOpen * target.targetWeight) / bar.open / ETF_LOT_SIZE,
    ) * ETF_LOT_SIZE;
    desiredShares.set(target.symbol, Math.max(0, shares));
  }

  for (const [symbol, position] of [...positions.entries()]) {
    const desired = desiredShares.get(symbol) ?? 0;
    const sharesToSell = Math.max(0, position.shares - desired);
    if (sharesToSell < ETF_LOT_SIZE) continue;
    const bar = position.history.byDate.get(executionDate);
    if (!bar) continue;
    const soldRatio = sharesToSell / position.shares;
    const soldBasis = position.costBasis * soldRatio;
    const sale = sellProceeds({ price: bar.open, shares: sharesToSell, config });
    const pnl = sale.netProceeds - soldBasis;
    const exitReason: BacktestTrade['exitReason'] = desired === 0 ? 'signal_lost' : 'fixed_hold';
    input.trades.push({
      symbol,
      name: position.history.item.name,
      assetType: 'etf',
      strategy: 'etf-stable-v2',
      entryDate: position.entryDate,
      entryPrice: round(position.entryPrice, 4),
      exitDate: executionDate,
      exitPrice: round(sale.executionPrice, 4),
      holdDays: Math.max(
        0,
        (bar.index - (position.history.byDate.get(position.entryDate)?.index ?? bar.index)),
      ),
      returnPct: soldBasis > 0 ? round((pnl / soldBasis) * 100) : null,
      exitReason,
      signal: position.signal,
    });
    input.realized.push({
      symbol,
      name: position.history.item.name,
      assetClass: position.history.item.assetClass,
      pnl,
    });
    cash += sale.netProceeds;
    totalTradingCost += sale.tradingCost;
    turnoverAmount += sale.netProceeds;
    if (sharesToSell >= position.shares) {
      positions.delete(symbol);
    } else {
      position.shares -= sharesToSell;
      position.costBasis -= soldBasis;
    }
  }

  const sortedTargets = pending.allocation.targets
    .slice()
    .sort((a, b) => b.targetWeight - a.targetWeight);
  for (const target of sortedTargets) {
    const history = positions.get(target.symbol)?.history
      ?? input.historyBySymbol.get(target.symbol);
    if (!history) continue;
    const bar = history.byDate.get(executionDate);
    if (!bar || bar.open <= 0) continue;
    const existing = positions.get(target.symbol);
    const desired = desiredShares.get(target.symbol) ?? 0;
    let sharesToBuy = desired - (existing?.shares ?? 0);
    sharesToBuy = Math.floor(sharesToBuy / ETF_LOT_SIZE) * ETF_LOT_SIZE;
    if (sharesToBuy < ETF_LOT_SIZE) {
      continue;
    }

    let purchase = buyCost({ price: bar.open, shares: sharesToBuy, config });
    while (sharesToBuy >= ETF_LOT_SIZE && purchase.totalCost > cash) {
      sharesToBuy -= ETF_LOT_SIZE;
      if (sharesToBuy >= ETF_LOT_SIZE) {
        purchase = buyCost({ price: bar.open, shares: sharesToBuy, config });
      }
    }
    if (sharesToBuy < ETF_LOT_SIZE || purchase.totalCost > cash) continue;

    const signal = makeSignal({
      target,
      signalDate: pending.allocation.signalDate,
      executionDate,
      executionPrice: purchase.executionPrice,
      allocation: pending.allocation,
      config,
    });
    cash -= purchase.totalCost;
    totalTradingCost += purchase.tradingCost;
    turnoverAmount += purchase.totalCost;
    if (existing) {
      const nextShares = existing.shares + sharesToBuy;
      existing.entryPrice =
        (existing.entryPrice * existing.shares + purchase.executionPrice * sharesToBuy)
        / nextShares;
      existing.shares = nextShares;
      existing.costBasis += purchase.totalCost;
    } else {
      positions.set(target.symbol, {
        history,
        shares: sharesToBuy,
        costBasis: purchase.totalCost,
        entryDate: executionDate,
        entryPrice: purchase.executionPrice,
        signal,
      });
    }
  }

  return { cash, totalTradingCost, turnoverAmount };
}

function closeAllAtEnd(input: {
  tradeDate: string;
  positions: Map<string, StablePosition>;
  cash: number;
  trades: BacktestTrade[];
  realized: RealizedContribution[];
  config: StableV2Config;
}): { cash: number; totalTradingCost: number; turnoverAmount: number } {
  let cash = input.cash;
  let totalTradingCost = 0;
  let turnoverAmount = 0;
  for (const [symbol, position] of [...input.positions.entries()]) {
    const bar = findBarAtOrBefore(position.history, input.tradeDate);
    if (!bar) continue;
    const sale = sellProceeds({ price: bar.close, shares: position.shares, config: input.config });
    const pnl = sale.netProceeds - position.costBasis;
    input.trades.push({
      symbol,
      name: position.history.item.name,
      assetType: 'etf',
      strategy: 'etf-stable-v2',
      entryDate: position.entryDate,
      entryPrice: round(position.entryPrice, 4),
      exitDate: input.tradeDate,
      exitPrice: round(sale.executionPrice, 4),
      holdDays: Math.max(
        0,
        bar.index - (position.history.byDate.get(position.entryDate)?.index ?? bar.index),
      ),
      returnPct: position.costBasis > 0 ? round((pnl / position.costBasis) * 100) : null,
      exitReason: 'end_of_data',
      signal: position.signal,
    });
    input.realized.push({
      symbol,
      name: position.history.item.name,
      assetClass: position.history.item.assetClass,
      pnl,
    });
    cash += sale.netProceeds;
    totalTradingCost += sale.tradingCost;
    turnoverAmount += sale.netProceeds;
    input.positions.delete(symbol);
  }
  return { cash, totalTradingCost, turnoverAmount };
}

function buildSnapshot(input: {
  tradeDate: string;
  cash: number;
  positions: Map<string, StablePosition>;
  initialCapital: number;
  closedTrades: number;
}): BacktestPortfolioSnapshot {
  const positionRows = [...input.positions.values()].map((position) => {
    const marketValue = markPosition(position, input.tradeDate);
    return { position, marketValue };
  });
  const invested = positionRows.reduce((sum, row) => sum + row.marketValue, 0);
  const total = input.cash + invested;
  return {
    tradeDate: input.tradeDate,
    cash: round(input.cash),
    investedMarketValue: round(invested),
    totalValue: round(total),
    returnPct: round(((total - input.initialCapital) / input.initialCapital) * 100),
    closedTrades: input.closedTrades,
    positions: positionRows.map(({ position, marketValue }) => ({
      symbol: position.history.item.symbol,
      name: position.history.item.name,
      assetType: 'etf',
      entryDate: position.entryDate,
      entryPrice: round(position.entryPrice, 4),
      shares: position.shares,
      costAmount: round(position.costBasis),
      marketValue: round(marketValue),
      weightPct: total > 0 ? round((marketValue / total) * 100) : 0,
      returnPct:
        position.costBasis > 0
          ? round(((marketValue - position.costBasis) / position.costBasis) * 100)
          : null,
      exitDate: null,
    })),
  };
}

function simulateStablePortfolio(input: {
  histories: StableV2History[];
  allDates: string[];
  config: StableV2Config;
}): SimulationResult {
  const historyBySymbol = new Map(
    input.histories.map((history) => [history.item.symbol, history]),
  );
  const positions = new Map<string, StablePosition>();
  const trades: BacktestTrade[] = [];
  const realized: RealizedContribution[] = [];
  const equityCurve: BacktestEquityPoint[] = [];
  const portfolioSnapshots: BacktestPortfolioSnapshot[] = [];
  const rebalanceLog: StableV2RebalanceLog[] = [];
  const cooldownUntil = new Map<string, number>();
  let pending: PendingAllocation | null = null;
  let cash = input.config.initialCapital;
  let peakEquity = input.config.initialCapital;
  let riskControl: StableV2RiskControlState = {
    stage: 'normal',
    stageDays: 0,
    recoveryDays: 0,
    anchorPeakEquity: input.config.initialCapital,
  };
  let daysSinceSignal = Number.POSITIVE_INFINITY;
  let totalTradingCost = 0;
  let turnoverAmount = 0;
  let investedPctSum = 0;
  let riskPctSum = 0;

  for (let dateIndex = 0; dateIndex < input.allDates.length; dateIndex += 1) {
    const tradeDate = input.allDates[dateIndex]!;
    if (pending?.executionDate === tradeDate) {
      const execution = executeTargetAllocation({
        pending,
        positions,
        cash,
        trades,
        realized,
        config: input.config,
        historyBySymbol,
      });
      cash = execution.cash;
      totalTradingCost += execution.totalTradingCost;
      turnoverAmount += execution.turnoverAmount;
      pending = null;
    }

    let equity = portfolioValue(cash, positions, tradeDate);
    peakEquity = Math.max(peakEquity, equity);
    const currentDrawdown = peakEquity > 0 ? ((equity - peakEquity) / peakEquity) * 100 : 0;
    const marketCandidates = input.histories
      .map((history) => scoreCandidate(history, tradeDate, input.config))
      .filter((candidate): candidate is StableV2Candidate => candidate != null);
    const marketRegime = resolveRegime(marketCandidates);
    const nextRiskControl = advanceStableV2RiskControl({
      state: riskControl,
      equity,
      recoveryEligible: marketRegime === 'bull' || marketRegime === 'neutral',
      config: input.config,
    });
    const currentStage = nextRiskControl.stage;
    const stageChanged = nextRiskControl.changed;
    riskControl = {
      stage: nextRiskControl.stage,
      stageDays: nextRiskControl.stageDays,
      recoveryDays: nextRiskControl.recoveryDays,
      anchorPeakEquity: nextRiskControl.anchorPeakEquity,
    };
    let stopTriggered = false;
    for (const position of positions.values()) {
      if (!isStableRiskAsset(position.history.item.assetClass)) continue;
      const marketValue = markPosition(position, tradeDate);
      const returnPct = position.costBasis > 0
        ? ((marketValue - position.costBasis) / position.costBasis) * 100
        : 0;
      if (returnPct <= input.config.positionStopLossPct) {
        cooldownUntil.set(
          position.history.item.symbol,
          dateIndex + input.config.stopCooldownDays,
        );
        stopTriggered = true;
      }
    }

    daysSinceSignal += 1;
    const shouldSignal =
      dateIndex < input.allDates.length - 1
      && pending == null
      && (daysSinceSignal >= input.config.rebalanceDays || stageChanged || stopTriggered);
    if (shouldSignal) {
      const excluded = new Set<string>();
      for (const [symbol, untilIndex] of cooldownUntil) {
        if (dateIndex < untilIndex) excluded.add(symbol);
      }
      const allocation = buildStableV2Allocation({
        histories: input.histories,
        signalDate: tradeDate,
        drawdownPct: currentDrawdown,
        controlDrawdownPct: nextRiskControl.controlDrawdownPct,
        drawdownStageOverride: currentStage,
        excludedSymbols: excluded,
        config: input.config,
      });
      const executionDate = input.allDates[dateIndex + 1] ?? null;
      if (executionDate && allocation.targets.length > 0) {
        pending = { allocation, executionDate };
        rebalanceLog.push({
          signalDate: tradeDate,
          executionDate,
          regime: allocation.regime,
          riskAllocationPct: round(allocation.riskAllocation * 100),
          cashReservePct: round(
            Math.max(
              0,
              1 - allocation.targets.reduce(
                (sum, target) => sum + target.targetWeight,
                0,
              ),
            ) * 100,
          ),
          drawdownPct: round(currentDrawdown),
          controlDrawdownPct: round(nextRiskControl.controlDrawdownPct),
          drawdownStage: allocation.drawdownStage,
          estimatedPortfolioVolPct:
            allocation.estimatedPortfolioVolPct == null
              ? null
              : round(allocation.estimatedPortfolioVolPct),
          targets: allocation.targets.map((target) => ({
            symbol: target.symbol,
            weightPct: round(target.targetWeight * 100),
            reason: target.reason,
          })),
        });
        daysSinceSignal = 0;
      }
    }
    equity = portfolioValue(cash, positions, tradeDate);
    const invested = [...positions.values()].reduce(
      (sum, position) => sum + markPosition(position, tradeDate),
      0,
    );
    const riskValue = [...positions.values()]
      .filter((position) => isStableRiskAsset(position.history.item.assetClass))
      .reduce((sum, position) => sum + markPosition(position, tradeDate), 0);
    investedPctSum += equity > 0 ? invested / equity : 0;
    riskPctSum += equity > 0 ? riskValue / equity : 0;
    equityCurve.push({
      tradeDate,
      equity: round(equity, 4),
      returnPct: round(((equity - input.config.initialCapital) / input.config.initialCapital) * 100),
      closedTrades: trades.length,
    });
    portfolioSnapshots.push(buildSnapshot({
      tradeDate,
      cash,
      positions,
      initialCapital: input.config.initialCapital,
      closedTrades: trades.length,
    }));
  }

  const lastDate = input.allDates.at(-1);
  if (lastDate && positions.size > 0) {
    const closing = closeAllAtEnd({
      tradeDate: lastDate,
      positions,
      cash,
      trades,
      realized,
      config: input.config,
    });
    cash = closing.cash;
    totalTradingCost += closing.totalTradingCost;
    turnoverAmount += closing.turnoverAmount;
    const finalPoint = equityCurve.at(-1);
    if (finalPoint) {
      finalPoint.equity = round(cash, 4);
      finalPoint.returnPct = round(
        ((cash - input.config.initialCapital) / input.config.initialCapital) * 100,
      );
      finalPoint.closedTrades = trades.length;
    }
    const finalSnapshot = portfolioSnapshots.at(-1);
    if (finalSnapshot) {
      finalSnapshot.cash = round(cash);
      finalSnapshot.investedMarketValue = 0;
      finalSnapshot.totalValue = round(cash);
      finalSnapshot.returnPct = round(
        ((cash - input.config.initialCapital) / input.config.initialCapital) * 100,
      );
      finalSnapshot.closedTrades = trades.length;
      finalSnapshot.positions = [];
    }
  }
  return {
    trades,
    equityCurve,
    portfolioSnapshots,
    rebalanceLog,
    realized,
    totalTradingCost,
    turnoverAmount,
    averageInvestedPct:
      input.allDates.length > 0 ? (investedPctSum / input.allDates.length) * 100 : 0,
    averageRiskAssetPct:
      input.allDates.length > 0 ? (riskPctSum / input.allDates.length) * 100 : 0,
  };
}

function buildBenchmarkCurve(
  history: StableV2History | undefined,
  allDates: string[],
  initialCapital: number,
): BacktestEquityPoint[] {
  if (!history || allDates.length === 0) return [];
  const first = findBarAtOrBefore(history, allDates[0]!)?.close;
  if (!first || first <= 0) return [];
  return allDates
    .map((tradeDate) => {
      const close = findBarAtOrBefore(history, tradeDate)?.close;
      if (!close) return null;
      const equity = initialCapital * (close / first);
      return {
        tradeDate,
        equity: round(equity, 4),
        returnPct: round((close / first - 1) * 100),
        closedTrades: 0,
      };
    })
    .filter((point): point is BacktestEquityPoint => point != null);
}

function dailyEquityReturns(curve: BacktestEquityPoint[]): number[] {
  const returns: number[] = [];
  for (let index = 1; index < curve.length; index += 1) {
    const previous = curve[index - 1]!.equity;
    const current = curve[index]!.equity;
    if (previous > 0) returns.push(current / previous - 1);
  }
  return returns;
}

function annualizedReturnPct(curve: BacktestEquityPoint[]): number | null {
  const first = curve[0];
  const last = curve.at(-1);
  if (!first || !last || first.equity <= 0 || last.equity <= 0) return null;
  const toTime = (value: string) => {
    const key = value.replace(/-/g, '');
    return Date.UTC(
      Number(key.slice(0, 4)),
      Number(key.slice(4, 6)) - 1,
      Number(key.slice(6, 8)),
    );
  };
  const elapsedMs = toTime(last.tradeDate) - toTime(first.tradeDate);
  const years = elapsedMs / (365.25 * 24 * 60 * 60 * 1000);
  if (years <= 0) return null;
  return (Math.pow(last.equity / first.equity, 1 / years) - 1) * 100;
}

function buildAnnualReturns(curve: BacktestEquityPoint[]): StableV2AnnualReturn[] {
  const yearEnds = new Map<string, BacktestEquityPoint>();
  for (const point of curve) yearEnds.set(point.tradeDate.slice(0, 4), point);
  const years = [...yearEnds.keys()].sort();
  const result: StableV2AnnualReturn[] = [];
  for (let index = 0; index < years.length; index += 1) {
    const year = years[index]!;
    const end = yearEnds.get(year)!;
    const startEquity = index === 0
      ? curve[0]?.equity
      : yearEnds.get(years[index - 1]!)?.equity;
    if (!startEquity || startEquity <= 0) continue;
    result.push({ year, returnPct: round((end.equity / startEquity - 1) * 100) });
  }
  return result;
}

function maxDrawdownForSlice(points: BacktestEquityPoint[]): number {
  return calcMaxDrawdownPct(points) ?? 0;
}

function buildRolling12m(curve: BacktestEquityPoint[]): StableV2RollingWindow[] {
  const windows: StableV2RollingWindow[] = [];
  const lookback = 252;
  for (let index = lookback; index < curve.length; index += 21) {
    const slice = curve.slice(index - lookback, index + 1);
    const first = slice[0];
    const last = slice.at(-1);
    if (!first || !last || first.equity <= 0) continue;
    windows.push({
      startDate: first.tradeDate,
      endDate: last.tradeDate,
      returnPct: round((last.equity / first.equity - 1) * 100),
      maxDrawdownPct: maxDrawdownForSlice(slice),
    });
  }
  return windows;
}

function buildStableMetrics(input: {
  simulation: SimulationResult;
  config: StableV2Config;
  annualReturns: StableV2AnnualReturn[];
  rolling12m: StableV2RollingWindow[];
}): StableV2Metrics {
  const curve = input.simulation.equityCurve;
  const dailyReturns = dailyEquityReturns(curve);
  const averageDaily = mean(dailyReturns);
  const dailyVol = sampleStdDev(dailyReturns);
  const downside = dailyReturns.filter((value) => value < 0);
  const downsideVol = sampleStdDev(downside);
  const cagr = annualizedReturnPct(curve);
  const maxDrawdown = calcMaxDrawdownPct(curve);
  const lastReturn = curve.at(-1)?.returnPct ?? 0;
  const positiveYears = input.annualReturns.filter((item) => item.returnPct > 0).length;
  const positiveRolling = input.rolling12m.filter((item) => item.returnPct > 0).length;
  return {
    totalReturnPct: round(lastReturn),
    annualizedReturnPct: cagr == null ? null : round(cagr),
    annualizedVolPct: dailyVol == null ? null : round(dailyVol * Math.sqrt(252) * 100),
    sharpeRatio:
      averageDaily == null || dailyVol == null || dailyVol <= 0
        ? null
        : round((averageDaily / dailyVol) * Math.sqrt(252), 3),
    sortinoRatio:
      averageDaily == null || downsideVol == null || downsideVol <= 0
        ? null
        : round((averageDaily / downsideVol) * Math.sqrt(252), 3),
    maxDrawdownPct: maxDrawdown,
    calmarRatio:
      cagr == null || maxDrawdown == null || maxDrawdown >= 0
        ? null
        : round(cagr / Math.abs(maxDrawdown), 3),
    positiveYearPct:
      input.annualReturns.length > 0
        ? round((positiveYears / input.annualReturns.length) * 100)
        : null,
    rolling12mPositivePct:
      input.rolling12m.length > 0
        ? round((positiveRolling / input.rolling12m.length) * 100)
        : null,
    turnoverPct: round(
      (input.simulation.turnoverAmount / input.config.initialCapital) * 100,
    ),
    totalTradingCost: round(input.simulation.totalTradingCost),
    tradingCostPct: round(
      (input.simulation.totalTradingCost / input.config.initialCapital) * 100,
    ),
    averageInvestedPct: round(input.simulation.averageInvestedPct),
    averageRiskAssetPct: round(input.simulation.averageRiskAssetPct),
  };
}

function buildAttribution(realized: RealizedContribution[]): StableV2Attribution {
  const symbols = new Map<string, StableV2Attribution['bySymbol'][number]>();
  const classes = new Map<StableEtfAssetClass, StableV2Attribution['byAssetClass'][number]>();
  for (const item of realized) {
    const symbol = symbols.get(item.symbol) ?? {
      symbol: item.symbol,
      name: item.name,
      assetClass: item.assetClass,
      realizedPnl: 0,
      tradeCount: 0,
    };
    symbol.realizedPnl += item.pnl;
    symbol.tradeCount += 1;
    symbols.set(item.symbol, symbol);

    const assetClass = classes.get(item.assetClass) ?? {
      assetClass: item.assetClass,
      realizedPnl: 0,
      tradeCount: 0,
    };
    assetClass.realizedPnl += item.pnl;
    assetClass.tradeCount += 1;
    classes.set(item.assetClass, assetClass);
  }
  return {
    bySymbol: [...symbols.values()]
      .map((item) => ({ ...item, realizedPnl: round(item.realizedPnl) }))
      .sort((a, b) => b.realizedPnl - a.realizedPnl),
    byAssetClass: [...classes.values()]
      .map((item) => ({ ...item, realizedPnl: round(item.realizedPnl) }))
      .sort((a, b) => b.realizedPnl - a.realizedPnl),
  };
}

function buildSymbolSummaries(trades: BacktestTrade[]): BacktestSymbolSummary[] {
  const grouped = new Map<string, BacktestTrade[]>();
  for (const trade of trades) {
    const rows = grouped.get(trade.symbol) ?? [];
    rows.push(trade);
    grouped.set(trade.symbol, rows);
  }
  return [...grouped.entries()]
    .map(([symbol, rows]) => ({
      symbol,
      name: rows[0]?.name ?? symbol,
      assetType: 'etf' as const,
      ...summarizeTrades(rows),
    }))
    .sort((a, b) => (b.avgReturnPct ?? -Infinity) - (a.avgReturnPct ?? -Infinity));
}

function buildReview(metrics: StableV2Metrics): StableV2Review {
  const passedChecks: string[] = [];
  const failedChecks: string[] = [];
  const check = (passed: boolean, success: string, failure: string) => {
    (passed ? passedChecks : failedChecks).push(passed ? success : failure);
  };
  check(
    (metrics.annualizedReturnPct ?? -Infinity) >= 8,
    '长期净年化达到 8% 基准门槛。',
    '长期净年化尚未达到 8% 基准门槛。',
  );
  check(
    Math.abs(metrics.maxDrawdownPct ?? -100) <= 15,
    '最大回撤控制在 15% 以内。',
    '最大回撤超过 15% 风险上限。',
  );
  check(
    (metrics.rolling12mPositivePct ?? 0) >= 70,
    '滚动 12 个月正收益比例达到 70%。',
    '滚动 12 个月正收益比例不足 70%。',
  );
  check(
    (metrics.calmarRatio ?? 0) >= 0.8,
    'Calmar 比率达到 0.8。',
    'Calmar 比率不足 0.8。',
  );
  const status: StableV2Review['status'] = failedChecks.length === 0
    ? 'eligible_for_paper'
    : failedChecks.length <= 2
      ? 'observe'
      : 'reject';
  const lessons = [
    metrics.averageRiskAssetPct < 40
      ? '风险资产平均仓位偏低；稳定性增强，但强趋势行情可能明显跑输权益基准。'
      : '风险资产平均仓位足以参与趋势行情，仍需持续检查回撤阶段的降仓速度。',
    metrics.tradingCostPct > 3
      ? '累计交易成本较高，应优先降低换手，而不是继续增加信号频率。'
      : '交易成本处于可控区间，但实盘仍要记录盘口价差和跨境 ETF 溢价。',
    '历史结果包含存续标的选择偏差；任何新增或替换 ETF 都必须重新跑全区间和样本外验证。',
  ];
  return {
    status,
    summary:
      status === 'eligible_for_paper'
        ? '历史门槛全部通过，可以进入模拟盘观察；仍不代表未来收益保证。'
        : status === 'observe'
          ? '部分历史门槛通过，仅适合模拟盘和小步观察，暂不提高真实资金权重。'
          : '核心收益风险门槛未通过，不应进入真实资金执行。',
    passedChecks,
    failedChecks,
    lessons,
    nextActions: [
      '使用双倍交易成本再次回测，确认收益不依赖过低成本假设。',
      '持续记录至少 6 个月或 50 次模拟成交，比较信号价、实际成交价和错失成交。',
      '每周复盘收益来源、最大亏损标的、风险状态切换和回测—模拟盘偏差。',
      '参数调整必须先写 changeset，并通过固定场景、滚动窗口和样本外验证。',
    ],
  };
}

async function loadStableHistories(days: number): Promise<{
  histories: StableV2History[];
  symbols: BacktestRunResult['symbols'];
  usedLocalCsv: boolean;
}> {
  let usedLocalCsv = false;
  const loaded = await Promise.all(
    ETF_STABLE_V2_UNIVERSE.map(async (item) => {
      try {
        const quoteDays = hasLocalEtfDailyCsv(item.symbol)
          ? LOCAL_ETF_LOAD_ALL_DAYS
          : days;
        if (quoteDays === LOCAL_ETF_LOAD_ALL_DAYS) usedLocalCsv = true;
        const data = await getDailyQuote(item.symbol, quoteDays);
        const bars: StableV2Bar[] = data.quotes
          .filter((bar): bar is typeof bar & { close: number } => bar.close != null && bar.close > 0)
          .map((bar) => ({
            tradeDate: bar.tradeDate,
            open: bar.open != null && bar.open > 0 ? bar.open : bar.close,
            high: bar.high != null && bar.high > 0 ? bar.high : bar.close,
            low: bar.low != null && bar.low > 0 ? bar.low : bar.close,
            close: bar.close,
          }));
        return {
          history: createStableV2History(item, bars),
          symbol: { symbol: item.symbol, name: item.name, assetType: 'etf' as const },
        };
      } catch (error) {
        return {
          history: null,
          symbol: {
            symbol: item.symbol,
            name: item.name,
            assetType: 'etf' as const,
            error: error instanceof Error ? error.message : String(error),
          },
        };
      }
    }),
  );
  return {
    histories: loaded
      .map((item) => item.history)
      .filter((history): history is StableV2History => history != null),
    symbols: loaded.map((item) => item.symbol),
    usedLocalCsv,
  };
}

export async function runEtfStableV2Backtest(
  input: RunEtfStableV2BacktestInput = {},
): Promise<EtfStableV2BacktestResult> {
  const config = resolveConfig(input);
  const dateRange = resolveBacktestDateRange({
    startDate: input.startDate,
    endDate: input.endDate,
    fallbackCalendarDays: input.days ?? 365 * 5,
  });
  const loadDays = computeKlineDaysForRange(
    dateRange,
    Math.max(config.trendMaDays, ...config.momentumWindows) + 20,
  );
  const loaded = input.histories
    ? {
        histories: input.histories,
        symbols: input.histories.map((history) => ({
          symbol: history.item.symbol,
          name: history.item.name,
          assetType: 'etf' as const,
        })),
        usedLocalCsv: false,
      }
    : await loadStableHistories(loadDays);
  const benchmarkHistory = loaded.histories.find(
    (history) => history.item.symbol === ETF_STABLE_V2_BENCHMARK_SYMBOL,
  );
  const calendarDates = benchmarkHistory?.bars.map((bar) => bar.tradeDate)
    ?? [...new Set(loaded.histories.flatMap((history) => history.bars.map((bar) => bar.tradeDate)))];
  const allDates = calendarDates
    .filter((date) => isTradeDateInRange(date, dateRange))
    .sort();
  const simulation = simulateStablePortfolio({
    histories: loaded.histories,
    allDates,
    config,
  });
  const annualReturns = buildAnnualReturns(simulation.equityCurve);
  const rolling12m = buildRolling12m(simulation.equityCurve);
  const stableMetrics = buildStableMetrics({ simulation, config, annualReturns, rolling12m });
  const tradeMetrics = summarizeTrades(simulation.trades);
  const benchmarkCurve = buildBenchmarkCurve(
    benchmarkHistory,
    allDates,
    config.initialCapital,
  );
  const result: EtfStableV2BacktestResult = {
    strategy: 'etf-stable-v2',
    generatedAt: new Date().toISOString(),
    requestedDays: input.days ?? Math.max(0, allDates.length),
    startDate: allDates[0] ?? dateRange.startDate,
    endDate: allDates.at(-1) ?? dateRange.endDate,
    holdDays: [config.rebalanceDays],
    symbols: loaded.symbols,
    trades: simulation.trades,
    metrics: {
      ...tradeMetrics,
      maxDrawdownPct: stableMetrics.maxDrawdownPct,
    },
    groups: [],
    equityCurve: simulation.equityCurve,
    portfolioSnapshots: simulation.portfolioSnapshots,
    benchmark: {
      symbol: ETF_STABLE_V2_BENCHMARK_SYMBOL,
      name: '沪深300ETF',
      curve: benchmarkCurve,
      finalReturnPct: benchmarkCurve.at(-1)?.returnPct ?? null,
    },
    symbolSummaries: buildSymbolSummaries(simulation.trades),
    currentDecisions: [],
    config: {
      strategyVersion: 'stable-v2.0',
      signalExecution: 'next_open',
      rebalanceDays: config.rebalanceDays,
      momentumDays: config.momentumWindows[0],
      momentumWindows: [...config.momentumWindows],
      trendMaDays: config.trendMaDays,
      volTargetPct: config.targetPortfolioVolPct,
      targetPortfolioVolPct: config.targetPortfolioVolPct,
      maxTacticalWeightPct: config.maxTacticalWeightPct * 100,
      benchmarkCoreWeightPct: config.benchmarkCoreWeightPct * 100,
      drawdownGuardPct: [
        config.drawdownSoftPct,
        config.drawdownDefensivePct,
        config.drawdownHardPct,
      ],
      hardMinimumDays: config.hardMinimumDays,
      recoveryConfirmDays: config.recoveryConfirmDays,
      recoveryStepDays: config.recoveryStepDays,
      commissionRate: config.commissionRate,
      slippageRate: config.slippageRate,
      minimumCommission: config.minimumCommission,
      rebalanceDriftPct: config.rebalanceDriftPct,
      initialCapital: config.initialCapital,
      stopLossPct: config.positionStopLossPct,
      stopCooldownDays: config.stopCooldownDays,
      maxConcurrentPositions: config.maxPositions,
      netRebalance: true,
    },
    notes: [
      'Stable V2 使用 20/60/120 日多周期动量和波动率调整评分。',
      '所有信号在 T 日收盘后生成，统一按 T+1 开盘价并计入滑点、佣金和最低佣金执行。',
      '风险资产按市场广度分为牛市/中性/弱市/熊市四档，并叠加 -6%/-9%/-12% 回撤分级。',
      `硬风控至少维持 ${config.hardMinimumDays} 个交易日；市场恢复至牛市/中性并连续确认 ${config.recoveryConfirmDays} 日后，按每 ${config.recoveryStepDays} 日一级的节奏从硬风控逐级恢复。绩效回撤仍按真实历史峰值统计，风险控制另用独立锚点避免现金仓永久锁死。`,
      `同一风险集群最多一只，战术主题总权重不超过 20%；牛市中沪深300核心目标权重为 ${config.benchmarkCoreWeightPct * 100}%，中性市场减半，其余配置海外、行业、黄金、国债或货币 ETF。`,
      loaded.usedLocalCsv
        ? '行情优先使用本地前复权 ETF 日线 CSV。'
        : '本次由调用方注入行情或使用远端日线。',
      '投资范围只包含当前存续 ETF，仍存在存续标的选择偏差；历史结果不构成未来收益保证。',
    ],
    stableMetrics,
    annualReturns,
    rolling12m,
    attribution: buildAttribution(simulation.realized),
    review: buildReview(stableMetrics),
    rebalanceLog: simulation.rebalanceLog,
  };
  return result;
}

export async function buildEtfStableV2LivePlan(input?: {
  executionDate?: string;
  portfolioDrawdownPct?: number;
  excludedSymbols?: Set<string>;
  rotationContext?: {
    matchedThemesBySymbol?: Record<string, string[]>;
    themeBoostBySymbol?: Record<string, number>;
    newsBySymbol?: Record<string, { label?: string }>;
  } | null;
}): Promise<EtfStableV2LivePlan> {
  const executionDate = normalizeTradeDateKey(
    input?.executionDate ?? formatTradeDateKey(todayDateKey()),
  );
  const config = { ...ETF_STABLE_V2_DEFAULT_CONFIG };
  const loaded = await loadStableHistories(360);
  const benchmark = loaded.histories.find(
    (history) => history.item.symbol === ETF_STABLE_V2_BENCHMARK_SYMBOL,
  );
  const signalDate = benchmark?.bars
    .map((bar) => bar.tradeDate)
    .filter((date) => date < executionDate)
    .at(-1)
    ?? loaded.histories
      .flatMap((history) => history.bars.map((bar) => bar.tradeDate))
      .filter((date) => date < executionDate)
      .sort()
      .at(-1);
  if (!signalDate) {
    throw new Error(`缺少 ${executionDate} 之前的完整 ETF 收盘数据，不能生成 T+1 计划`);
  }
  const allocation = buildStableV2Allocation({
    histories: loaded.histories,
    signalDate,
    drawdownPct: input?.portfolioDrawdownPct ?? 0,
    excludedSymbols: input?.excludedSymbols,
    config,
  });
  const rotation = input?.rotationContext ?? null;
  return {
    strategy: 'etf-stable-v2',
    signalDate,
    executionDate,
    tradeDate: signalDate,
    topN: allocation.targets.length,
    rebalanceDays: config.rebalanceDays,
    regimeExposureScale: 1,
    weakRegime: allocation.regime === 'weak' || allocation.regime === 'bear',
    bearRegime: allocation.regime === 'bear',
    regime: allocation.regime,
    riskAllocationPct: round(allocation.riskAllocation * 100),
    cashReservePct: round(
      Math.max(
        0,
        1 - allocation.targets.reduce((sum, target) => sum + target.targetWeight, 0),
      ) * 100,
    ),
    drawdownPct: round(allocation.drawdownPct),
    drawdownStage: allocation.drawdownStage,
    estimatedPortfolioVolPct:
      allocation.estimatedPortfolioVolPct == null
        ? null
        : round(allocation.estimatedPortfolioVolPct),
    hotThemes: rotation?.matchedThemesBySymbol
      ? [...new Set(Object.values(rotation.matchedThemesBySymbol).flat())]
      : undefined,
    rotationSummary: '新闻与主题仅作复盘标注，不参与 Stable V2 历史不可复现的选股评分。',
    targets: allocation.targets.map((target) => ({
      symbol: target.symbol,
      name: target.name,
      isBenchmarkFill: target.assetClass === 'cash' || target.assetClass === 'bond',
      targetWeightPct: round(target.targetWeight * 100, 4),
      assetClass: target.assetClass,
      reason: target.reason,
      matchedThemes: rotation?.matchedThemesBySymbol?.[target.symbol],
      themeBoost: rotation?.themeBoostBySymbol?.[target.symbol],
      newsLabel: rotation?.newsBySymbol?.[target.symbol]?.label,
    })),
  };
}

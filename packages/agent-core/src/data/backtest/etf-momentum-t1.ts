import { ETF_POOL_19 } from '../etf/pool.js';
import {
  calcEtfBuyCost,
  calcEtfSellProceeds,
  ETF_COMMISSION_RATE,
  ETF_LOT_SIZE,
  ETF_SLIPPAGE_RATE,
} from '../etf/trading-cost.js';
import { getDailyQuote } from '../market/services.js';
import {
  hasLocalEtfDailyCsv,
  LOCAL_ETF_LOAD_ALL_DAYS,
} from '../market/local-csv/etf-daily.js';
import { buildTradeGroups, summarizeTrades } from './engine.js';
import {
  computeKlineDaysForRange,
  formatTradeDateKey,
  isTradeDateInRange,
  normalizeTradeDateKey,
  resolveBacktestDateRange,
} from './date-range.js';
import type {
  BacktestEquityPoint,
  BacktestPortfolioSnapshot,
  BacktestRunResult,
  BacktestSignal,
  BacktestTrade,
} from './types.js';
import {
  advanceStableV2RiskControl,
  ETF_STABLE_V2_DEFAULT_CONFIG,
  type StableV2RiskControlState,
} from './etf-stable-v2.js';

export type RunEtfMomentumT1BacktestInput = {
  days?: number;
  startDate?: string;
  endDate?: string;
  topN?: number;
  momentumDays?: number;
  rebalanceDays?: number;
  trendMaDays?: number;
  bearRegimeMaxExposure?: number;
  weakRegimeMaxExposure?: number | null;
  bullBenchmarkSlotMomentumPct?: number;
  bullBenchmarkSlotCount?: number;
  minimumBenchmarkSlotCount?: number;
  cashFallbackInWeakRegime?: boolean;
  initialCapital?: number;
  maxPerTheme?: number | null;
  tPlusEnabled?: boolean;
  tPlusBuyDipPct?: number;
  tPlusMinProfitPct?: number;
  tPlusBudgetPct?: number;
  tPlusMaxTradesPerDay?: number;
  drawdownGuardEnabled?: boolean;
  maxExposure?: number;
  targetVolPct?: number;
  minExposure?: number;
  maxAssetVolPct?: number;
  riskAdjustedMomentum?: boolean;
  stopLossPct?: number;
  stopCooldownDays?: number;
};

type Bar = {
  tradeDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

type History = {
  symbol: string;
  name: string;
  bars: Bar[];
  byDate: Map<string, Bar & { index: number }>;
};

type Target = {
  history: History;
  targetWeight: number;
  score: number;
  isBenchmarkFill: boolean;
};

export type EtfMomentumT1LivePlan = {
  strategy: 'etf-momentum-t1-risk-adjusted';
  signalDate: string;
  executionDate: string;
  tradeDate: string;
  topN: number;
  rebalanceDays: number;
  weakRegime: boolean;
  bearRegime: boolean;
  targets: Array<{
    symbol: string;
    name: string;
    targetWeightPct: number;
    isBenchmarkFill: boolean;
    assetClass: 'growth' | 'cash';
    reason: string;
  }>;
};

type PendingPlan = {
  signalDate: string;
  executionDate: string;
  targets: Target[];
};

type Position = {
  history: History;
  shares: number;
  costBasis: number;
  entryDate: string;
  entryPrice: number;
  signal: BacktestSignal;
};

const BENCHMARK_SYMBOL = '510300';
const CASH_ETF_SYMBOL = '511880';
const DEFAULT_CAPITAL = 100_000;
const DEFAULT_TOP_N = 4;
const DEFAULT_MOMENTUM_DAYS = 20;
const DEFAULT_REBALANCE_DAYS = 10;
const DEFAULT_TREND_MA_DAYS = 20;
const DEFAULT_WEAK_EXPOSURE = 0.7;
const DEFAULT_BEAR_EXPOSURE = 0.25;
const DEFAULT_BULL_BENCHMARK_MOMENTUM = 8;
const DEFAULT_STOP_LOSS_PCT = -12;
const DEFAULT_STOP_COOLDOWN_DAYS = 10;
const MINIMUM_COMMISSION = 5;

const THEME_BY_SYMBOL: Record<string, string> = {
  '512880': 'brokerage',
  '512760': 'semiconductor',
  '512010': 'healthcare',
  '512660': 'defense',
  '512800': 'banking',
  '515790': 'solar',
  '159530': 'robotics',
  '159995': 'semiconductor',
  '515980': 'ai',
  '159781': 'sci-tech-startup',
  '516160': 'new-energy',
  '159808': 'growth',
  '159920': 'dividend',
  '159941': 'nasdaq',
  '513100': 'nasdaq',
  '513050': 'china-internet',
  '513500': 'sp500',
  '513520': 'nikkei',
  '510300': 'csi300',
  '512480': 'semiconductor',
};

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function positiveInt(value: number | undefined, fallback: number, min: number, max: number) {
  return value != null && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.floor(value)))
    : fallback;
}

function finite(value: number | undefined, fallback: number, min: number, max: number) {
  return value != null && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function buyCost(price: number, shares: number) {
  const base = calcEtfBuyCost({
    price,
    shares,
    commissionRate: ETF_COMMISSION_RATE,
    slippageRate: ETF_SLIPPAGE_RATE,
  });
  const commission = Math.max(MINIMUM_COMMISSION, base.commission);
  return {
    ...base,
    commission,
    tradingCost: commission + price * shares * ETF_SLIPPAGE_RATE,
    totalCost: base.grossAmount + commission,
  };
}

function sellProceeds(price: number, shares: number) {
  const base = calcEtfSellProceeds({
    price,
    shares,
    commissionRate: ETF_COMMISSION_RATE,
    slippageRate: ETF_SLIPPAGE_RATE,
  });
  const commission = Math.max(MINIMUM_COMMISSION, base.commission);
  return {
    ...base,
    commission,
    tradingCost: commission + price * shares * ETF_SLIPPAGE_RATE,
    netProceeds: Math.max(0, base.grossAmount - commission),
  };
}

function movingAverage(history: History, index: number, days: number): number | null {
  if (index < days - 1) return null;
  const values = history.bars.slice(index - days + 1, index + 1).map((bar) => bar.close);
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function momentumPct(history: History, index: number, days: number): number | null {
  const current = history.bars[index]?.close;
  const past = history.bars[index - days]?.close;
  return current && past ? ((current - past) / past) * 100 : null;
}

function annualizedVolPct(history: History, index: number, days = 20): number | null {
  if (index < days) return null;
  const returns: number[] = [];
  for (let cursor = index - days + 1; cursor <= index; cursor += 1) {
    const current = history.bars[cursor]?.close;
    const previous = history.bars[cursor - 1]?.close;
    if (!current || !previous || previous <= 0) continue;
    returns.push(current / previous - 1);
  }
  if (returns.length < Math.max(10, Math.floor(days * 0.8))) return null;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0)
    / Math.max(1, returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

function findBarAtOrBefore(history: History, tradeDate: string): (Bar & { index: number }) | null {
  const exact = history.byDate.get(tradeDate);
  if (exact) return exact;
  let found: (Bar & { index: number }) | null = null;
  for (let index = history.bars.length - 1; index >= 0; index -= 1) {
    const bar = history.bars[index]!;
    if (bar.tradeDate <= tradeDate) {
      found = { ...bar, index };
      break;
    }
  }
  return found;
}

function positionValue(position: Position, tradeDate: string, field: 'open' | 'close' = 'close') {
  const bar = findBarAtOrBefore(position.history, tradeDate);
  return bar ? position.shares * bar[field] : position.costBasis;
}

function benchmarkState(history: History | undefined, tradeDate: string, momentumDays: number) {
  const bar = history?.byDate.get(tradeDate);
  if (!history || !bar) return { weak: true, bear: true, bullSlot: false };
  const ma20 = movingAverage(history, bar.index, 20);
  const momentum = momentumPct(history, bar.index, momentumDays);
  const above = ma20 != null && bar.close >= ma20;
  return {
    weak: !above || (momentum ?? -Infinity) < 0,
    bear: !above && (momentum ?? -Infinity) < 0,
    bullSlot: above && (momentum ?? -Infinity) >= 8,
  };
}

function selectTargets(input: {
  histories: History[];
  benchmark: History | undefined;
  tradeDate: string;
  topN: number;
  momentumDays: number;
  trendMaDays: number;
  weakExposure: number;
  bearExposure: number;
  bullBenchmarkMomentum: number;
  bullBenchmarkSlots: number;
  minimumBenchmarkSlots: number;
  cashFallbackInWeakRegime: boolean;
  maxPerTheme: number | null;
  excluded: Set<string>;
  maxExposureCap: number;
  maxAssetVolPct: number;
  riskAdjustedMomentum: boolean;
  cashHistory: History | undefined;
}): Target[] {
  const benchmarkBar = input.benchmark?.byDate.get(input.tradeDate);
  const benchmarkMa = benchmarkBar && input.benchmark
    ? movingAverage(input.benchmark, benchmarkBar.index, 20)
    : null;
  const benchmarkMomentum = benchmarkBar && input.benchmark
    ? momentumPct(input.benchmark, benchmarkBar.index, input.momentumDays)
    : null;
  const benchmarkAbove = benchmarkBar != null && benchmarkMa != null
    && benchmarkBar.close >= benchmarkMa;
  const weak = !benchmarkAbove || (benchmarkMomentum ?? -Infinity) < 0;
  const bear = !benchmarkAbove && (benchmarkMomentum ?? -Infinity) < 0;
  const exposure = Math.min(
    input.maxExposureCap,
    bear ? input.bearExposure : weak ? input.weakExposure : 1,
  );
  const effectiveTrendDays = benchmarkAbove ? Math.min(10, input.trendMaDays) : input.trendMaDays;
  const bullReserve = benchmarkAbove
    && (benchmarkMomentum ?? -Infinity) >= input.bullBenchmarkMomentum
    ? Math.min(input.bullBenchmarkSlots, input.topN)
    : 0;
  const reserveBenchmark = Math.min(
    input.topN,
    Math.max(benchmarkAbove ? input.minimumBenchmarkSlots : 0, bullReserve),
  );

  const ranked = input.histories
    .filter((history) => history.symbol !== BENCHMARK_SYMBOL)
    .filter((history) => history.symbol !== CASH_ETF_SYMBOL)
    .filter((history) => !input.excluded.has(history.symbol))
    .map((history) => {
      const bar = history.byDate.get(input.tradeDate);
      if (!bar) return null;
      const ma = movingAverage(history, bar.index, effectiveTrendDays);
      const momentum = momentumPct(history, bar.index, input.momentumDays);
      if (ma == null || momentum == null || bar.close < ma) return null;
      const volatilityPct = annualizedVolPct(history, bar.index);
      if (volatilityPct != null && volatilityPct > input.maxAssetVolPct) return null;
      const score = input.riskAdjustedMomentum
        ? momentum / Math.max(10, volatilityPct ?? input.maxAssetVolPct)
        : momentum;
      return { history, score };
    })
    .filter((item): item is { history: History; score: number } => item != null)
    .sort((a, b) => b.score - a.score);

  const selected: Array<{ history: History; score: number; isBenchmarkFill: boolean }> = [];
  const themeCounts = new Map<string, number>();
  const sectorSlots = Math.max(0, input.topN - reserveBenchmark);
  for (const item of ranked) {
    if (selected.length >= sectorSlots) break;
    const theme = THEME_BY_SYMBOL[item.history.symbol] ?? item.history.symbol;
    const count = themeCounts.get(theme) ?? 0;
    if (input.maxPerTheme != null && count >= input.maxPerTheme) continue;
    selected.push({ ...item, isBenchmarkFill: false });
    themeCounts.set(theme, count + 1);
  }

  if (input.benchmark && !input.excluded.has(BENCHMARK_SYMBOL)) {
    for (let index = 0; index < reserveBenchmark; index += 1) {
      selected.push({
        history: input.benchmark,
        score: benchmarkMomentum ?? 0,
        isBenchmarkFill: true,
      });
    }
    if (!(input.cashFallbackInWeakRegime && weak)) {
      while (selected.length < input.topN) {
        selected.push({
          history: input.benchmark,
          score: benchmarkMomentum ?? 0,
          isBenchmarkFill: true,
        });
      }
    }
  }

  const counts = new Map<string, number>();
  for (const item of selected) {
    counts.set(item.history.symbol, (counts.get(item.history.symbol) ?? 0) + 1);
  }
  const targets = [...counts.entries()].map(([symbol, slots]) => {
    const item = selected.find((candidate) => candidate.history.symbol === symbol)!;
    return {
      history: item.history,
      targetWeight: exposure * slots / input.topN,
      score: item.score,
      isBenchmarkFill: item.isBenchmarkFill,
    };
  });
  const investedWeight = targets.reduce((sum, target) => sum + target.targetWeight, 0);
  if (input.cashHistory && investedWeight < 0.999) {
    targets.push({
      history: input.cashHistory,
      targetWeight: Math.max(0, 1 - investedWeight),
      score: 0,
      isBenchmarkFill: false,
    });
  }
  return targets;
}

function makeSignal(input: {
  target: Target;
  signalDate: string;
  executionDate: string;
  entryPrice: number;
  rebalanceDays: number;
  momentumDays: number;
}): BacktestSignal {
  return {
    symbol: input.target.history.symbol,
    name: input.target.history.name,
    assetType: 'etf',
    strategy: 'etf-momentum-rotation',
    tradeDate: input.signalDate,
    entryPrice: round(input.entryPrice, 4),
    score: round(input.target.score, 4),
    metadata: {
      executionDate: input.executionDate,
      signalExecution: 'next_open',
      targetWeightPct: round(input.target.targetWeight * 100),
      rebalanceDays: input.rebalanceDays,
      momentumDays: input.momentumDays,
      isBenchmarkFill: input.target.isBenchmarkFill,
    },
  };
}

async function loadMomentumT1Histories(days: number): Promise<{
  histories: History[];
  symbols: BacktestRunResult['symbols'];
  usedLocalCsv: boolean;
}> {
  const histories: History[] = [];
  const symbols: BacktestRunResult['symbols'] = [];
  let usedLocalCsv = false;
  const pool = [
    ...ETF_POOL_19,
    { symbol: CASH_ETF_SYMBOL, exchangeCode: 'sh511880' as const, name: '银华日利ETF' },
  ];
  for (const item of pool) {
    try {
      const quoteDays = hasLocalEtfDailyCsv(item.symbol) ? LOCAL_ETF_LOAD_ALL_DAYS : days;
      if (quoteDays === LOCAL_ETF_LOAD_ALL_DAYS) usedLocalCsv = true;
      const data = await getDailyQuote(item.symbol, quoteDays);
      const bars = data.quotes
        .filter((bar): bar is typeof bar & { close: number } => bar.close != null && bar.close > 0)
        .map((bar) => ({
          tradeDate: normalizeTradeDateKey(bar.tradeDate),
          open: bar.open != null && bar.open > 0 ? bar.open : bar.close,
          high: bar.high != null && bar.high > 0 ? bar.high : bar.close,
          low: bar.low != null && bar.low > 0 ? bar.low : bar.close,
          close: bar.close,
        }))
        .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
      histories.push({
        symbol: item.symbol,
        name: item.name,
        bars,
        byDate: new Map(bars.map((bar, index) => [bar.tradeDate, { ...bar, index }])),
      });
      symbols.push({ symbol: item.symbol, name: item.name, assetType: 'etf' });
    } catch (error) {
      symbols.push({
        symbol: item.symbol,
        name: item.name,
        assetType: 'etf',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { histories, symbols, usedLocalCsv };
}

export async function buildEtfMomentumT1LivePlan(input: {
  executionDate: string;
  excludedSymbols?: Set<string>;
}): Promise<EtfMomentumT1LivePlan> {
  const executionDate = normalizeTradeDateKey(input.executionDate);
  const loaded = await loadMomentumT1Histories(360);
  const benchmark = loaded.histories.find((history) => history.symbol === BENCHMARK_SYMBOL);
  const cashHistory = loaded.histories.find((history) => history.symbol === CASH_ETF_SYMBOL);
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
    throw new Error(`缺少 ${executionDate} 之前的 ETF 收盘数据，不能生成 V3 增长袖套计划`);
  }
  const regime = benchmarkState(benchmark, signalDate, DEFAULT_MOMENTUM_DAYS);
  const targets = selectTargets({
    histories: loaded.histories,
    benchmark,
    tradeDate: signalDate,
    topN: DEFAULT_TOP_N,
    momentumDays: DEFAULT_MOMENTUM_DAYS,
    trendMaDays: DEFAULT_TREND_MA_DAYS,
    weakExposure: DEFAULT_WEAK_EXPOSURE,
    bearExposure: DEFAULT_BEAR_EXPOSURE,
    bullBenchmarkMomentum: DEFAULT_BULL_BENCHMARK_MOMENTUM,
    bullBenchmarkSlots: 1,
    minimumBenchmarkSlots: 0,
    cashFallbackInWeakRegime: true,
    maxPerTheme: 2,
    excluded: input.excludedSymbols ?? new Set<string>(),
    maxExposureCap: 1,
    maxAssetVolPct: 40,
    riskAdjustedMomentum: true,
    cashHistory,
  });
  return {
    strategy: 'etf-momentum-t1-risk-adjusted',
    signalDate,
    executionDate,
    tradeDate: signalDate,
    topN: DEFAULT_TOP_N,
    rebalanceDays: DEFAULT_REBALANCE_DAYS,
    weakRegime: regime.weak,
    bearRegime: regime.bear,
    targets: targets.map((target) => ({
      symbol: target.history.symbol,
      name: target.history.name,
      targetWeightPct: round(target.targetWeight * 100, 4),
      isBenchmarkFill: target.isBenchmarkFill,
      assetClass: target.history.symbol === CASH_ETF_SYMBOL ? 'cash' : 'growth',
      reason: target.history.symbol === CASH_ETF_SYMBOL
        ? '增长袖套未分配风险预算或弱市缺位进入货币 ETF。'
        : `20日风险调整动量评分 ${round(target.score, 4)}，单ETF年化波动率不高于40%。`,
    })),
  };
}

export async function runEtfMomentumT1Backtest(
  input: RunEtfMomentumT1BacktestInput = {},
): Promise<BacktestRunResult> {
  const topN = positiveInt(input.topN, DEFAULT_TOP_N, 1, 10);
  const momentumDays = positiveInt(input.momentumDays, DEFAULT_MOMENTUM_DAYS, 5, 120);
  const rebalanceDays = positiveInt(input.rebalanceDays, DEFAULT_REBALANCE_DAYS, 1, 60);
  const trendMaDays = positiveInt(input.trendMaDays, DEFAULT_TREND_MA_DAYS, 5, 120);
  const weakExposure = input.weakRegimeMaxExposure === null
    ? 1
    : finite(input.weakRegimeMaxExposure, DEFAULT_WEAK_EXPOSURE, 0, 1);
  const bearExposure = finite(input.bearRegimeMaxExposure, DEFAULT_BEAR_EXPOSURE, 0, 1);
  const bullBenchmarkMomentum = finite(
    input.bullBenchmarkSlotMomentumPct,
    DEFAULT_BULL_BENCHMARK_MOMENTUM,
    0,
    100,
  );
  const bullBenchmarkSlots = positiveInt(input.bullBenchmarkSlotCount, 1, 0, topN);
  const minimumBenchmarkSlots = positiveInt(
    input.minimumBenchmarkSlotCount,
    0,
    0,
    topN,
  );
  const initialCapital = finite(input.initialCapital, DEFAULT_CAPITAL, 1_000, 1e10);
  const maxPerTheme = input.maxPerTheme === null
    ? null
    : positiveInt(input.maxPerTheme, 2, 1, topN);
  const tPlusEnabled = input.tPlusEnabled === true;
  const tPlusBuyDipPct = finite(input.tPlusBuyDipPct, 1.5, 0.1, 10);
  const tPlusMinProfitPct = finite(input.tPlusMinProfitPct, 0.6, 0.1, 10);
  const tPlusBudgetPct = finite(input.tPlusBudgetPct, 0.2, 0.01, 1);
  const tPlusMaxTradesPerDay = positiveInt(input.tPlusMaxTradesPerDay, 2, 1, 10);
  const drawdownGuardEnabled = input.drawdownGuardEnabled === true;
  const maxExposure = finite(input.maxExposure, 1, 0.1, 1);
  const targetVolPct = finite(input.targetVolPct, 0, 0, 100);
  const minExposure = finite(input.minExposure, 0.25, 0.05, 1);
  const maxAssetVolPct = finite(input.maxAssetVolPct, 100, 10, 200);
  const riskAdjustedMomentum = input.riskAdjustedMomentum === true;
  const stopLossPct = finite(input.stopLossPct, DEFAULT_STOP_LOSS_PCT, -50, -1);
  const stopCooldownDays = positiveInt(
    input.stopCooldownDays,
    DEFAULT_STOP_COOLDOWN_DAYS,
    1,
    120,
  );
  const dateRange = resolveBacktestDateRange({
    startDate: input.startDate,
    endDate: input.endDate,
    fallbackCalendarDays: input.days ?? 365,
  });
  const loadDays = computeKlineDaysForRange(
    dateRange,
    Math.max(momentumDays, trendMaDays, 20) + 20,
  );
  const loaded = await loadMomentumT1Histories(loadDays);
  const { histories, symbols, usedLocalCsv } = loaded;

  const benchmark = histories.find((history) => history.symbol === BENCHMARK_SYMBOL);
  const cashHistory = histories.find((history) => history.symbol === CASH_ETF_SYMBOL);
  const allDates = (benchmark?.bars.map((bar) => bar.tradeDate)
    ?? [...new Set(histories.flatMap((history) => history.bars.map((bar) => bar.tradeDate)))])
    .filter((date) => isTradeDateInRange(date, dateRange))
    .sort();
  const positions = new Map<string, Position>();
  const cooldownUntil = new Map<string, number>();
  const trades: BacktestTrade[] = [];
  const equityCurve: BacktestEquityPoint[] = [];
  const portfolioSnapshots: BacktestPortfolioSnapshot[] = [];
  let cash = initialCapital;
  let pendingPlan: PendingPlan | null = null;
  let pendingExits = new Map<string, BacktestTrade['exitReason']>();
  let daysSinceSignal = Number.POSITIVE_INFINITY;
  let tPlusTradeCount = 0;
  let tPlusTotalProfit = 0;
  let totalTradingCost = 0;
  let riskControl: StableV2RiskControlState = {
    stage: 'normal',
    stageDays: 0,
    recoveryDays: 0,
    anchorPeakEquity: initialCapital,
  };

  const totalValue = (tradeDate: string, field: 'open' | 'close' = 'close') =>
    cash + [...positions.values()].reduce(
      (sum, position) => sum + positionValue(position, tradeDate, field),
      0,
    );

  const recordSale = (
    position: Position,
    shares: number,
    tradeDate: string,
    rawPrice: number,
    exitReason: BacktestTrade['exitReason'],
  ) => {
    const ratio = shares / position.shares;
    const soldBasis = position.costBasis * ratio;
    const sale = sellProceeds(rawPrice, shares);
    totalTradingCost += sale.tradingCost;
    const pnl = sale.netProceeds - soldBasis;
    trades.push({
      symbol: position.history.symbol,
      name: position.history.name,
      assetType: 'etf',
      strategy: 'etf-momentum-rotation',
      entryDate: position.entryDate,
      entryPrice: round(position.entryPrice, 4),
      exitDate: tradeDate,
      exitPrice: round(sale.executionPrice, 4),
      holdDays: Math.max(
        0,
        (position.history.byDate.get(tradeDate)?.index ?? 0)
          - (position.history.byDate.get(position.entryDate)?.index ?? 0),
      ),
      returnPct: soldBasis > 0 ? round((pnl / soldBasis) * 100) : null,
      exitReason,
      signal: position.signal,
    });
    cash += sale.netProceeds;
    if (shares >= position.shares) {
      positions.delete(position.history.symbol);
    } else {
      position.shares -= shares;
      position.costBasis -= soldBasis;
    }
  };

  for (let dateIndex = 0; dateIndex < allDates.length; dateIndex += 1) {
    const tradeDate = allDates[dateIndex]!;

    for (const [symbol, reason] of pendingExits) {
      const position = positions.get(symbol);
      const bar = position?.history.byDate.get(tradeDate);
      if (position && bar) recordSale(position, position.shares, tradeDate, bar.open, reason);
    }
    pendingExits = new Map();

    // The plan is assigned at the end of a prior loop iteration. TypeScript 6 does not
    // widen loop-carried assignments here, so keep an explicit snapshot for execution.
    const planForToday = pendingPlan as PendingPlan | null;
    if (planForToday?.executionDate === tradeDate) {
      const equityAtOpen = totalValue(tradeDate, 'open');
      const targetBySymbol = new Map(planForToday.targets.map((target) => [target.history.symbol, target]));
      const desiredShares = new Map<string, number>();
      for (const target of planForToday.targets) {
        const bar = target.history.byDate.get(tradeDate);
        if (!bar) continue;
        desiredShares.set(
          target.history.symbol,
          Math.floor((equityAtOpen * target.targetWeight) / bar.open / ETF_LOT_SIZE) * ETF_LOT_SIZE,
        );
      }
      for (const position of [...positions.values()]) {
        const desired = desiredShares.get(position.history.symbol) ?? 0;
        const excess = Math.max(0, position.shares - desired);
        const bar = position.history.byDate.get(tradeDate);
        if (bar && excess >= ETF_LOT_SIZE) {
          recordSale(position, excess, tradeDate, bar.open, 'fixed_hold');
        }
      }
      for (const [symbol, desired] of desiredShares) {
        const target = targetBySymbol.get(symbol)!;
        const existing = positions.get(symbol);
        const shares = desired - (existing?.shares ?? 0);
        const bar = target.history.byDate.get(tradeDate);
        if (!bar || shares < ETF_LOT_SIZE) continue;
        let affordableShares = shares;
        let purchase = buyCost(bar.open, affordableShares);
        while (affordableShares >= ETF_LOT_SIZE && purchase.totalCost > cash) {
          affordableShares -= ETF_LOT_SIZE;
          if (affordableShares >= ETF_LOT_SIZE) {
            purchase = buyCost(bar.open, affordableShares);
          }
        }
        if (affordableShares < ETF_LOT_SIZE || purchase.totalCost > cash) continue;
        const signal = makeSignal({
          target,
          signalDate: planForToday.signalDate,
          executionDate: tradeDate,
          entryPrice: purchase.executionPrice,
          rebalanceDays,
          momentumDays,
        });
        cash -= purchase.totalCost;
        totalTradingCost += purchase.tradingCost;
        if (existing) {
          const nextShares = existing.shares + affordableShares;
          existing.entryPrice =
            (existing.entryPrice * existing.shares + purchase.executionPrice * affordableShares)
            / nextShares;
          existing.shares = nextShares;
          existing.costBasis += purchase.totalCost;
        } else {
          positions.set(symbol, {
            history: target.history,
            shares: affordableShares,
            costBasis: purchase.totalCost,
            entryDate: tradeDate,
            entryPrice: purchase.executionPrice,
            signal,
          });
        }
      }
      pendingPlan = null;
    }

    let tPlusToday = 0;
    for (const position of positions.values()) {
      const bar = position.history.byDate.get(tradeDate);
      const previous = bar ? position.history.bars[bar.index - 1] : null;
      if (!bar || !previous) continue;
      const positionReturnPct = position.costBasis > 0
        ? ((positionValue(position, tradeDate) - position.costBasis) / position.costBasis) * 100
        : 0;
      if (
        position.history.symbol !== BENCHMARK_SYMBOL
        && position.history.symbol !== CASH_ETF_SYMBOL
        && positionReturnPct <= stopLossPct
      ) {
        pendingExits.set(position.history.symbol, 'stop_loss');
        cooldownUntil.set(position.history.symbol, dateIndex + stopCooldownDays);
        continue;
      }
      if (position.history.symbol === CASH_ETF_SYMBOL) continue;
      if (!tPlusEnabled || tPlusToday >= tPlusMaxTradesPerDay) continue;
      const triggerPrice = previous.close * (1 - tPlusBuyDipPct / 100);
      if (bar.low > triggerPrice || bar.close < triggerPrice * (1 + tPlusMinProfitPct / 100)) {
        continue;
      }
      const budget = Math.min(cash, positionValue(position, tradeDate) * tPlusBudgetPct);
      const maxShares = Math.floor(Math.min(position.shares, budget / triggerPrice) / ETF_LOT_SIZE)
        * ETF_LOT_SIZE;
      if (maxShares < ETF_LOT_SIZE) continue;
      const buy = buyCost(triggerPrice, maxShares);
      const sell = sellProceeds(bar.close, maxShares);
      const profit = sell.netProceeds - buy.totalCost;
      if (buy.totalCost <= cash && profit > 0) {
        cash += profit;
        totalTradingCost += buy.tradingCost + sell.tradingCost;
        tPlusTotalProfit += profit;
        tPlusTradeCount += 1;
        tPlusToday += 1;
      }
    }

    const equityBeforeSignal = totalValue(tradeDate);
    const currentBenchmarkState = benchmarkState(benchmark, tradeDate, momentumDays);
    const nextRiskControl = drawdownGuardEnabled
      ? advanceStableV2RiskControl({
          state: riskControl,
          equity: equityBeforeSignal,
          recoveryEligible: !currentBenchmarkState.weak,
          config: { ...ETF_STABLE_V2_DEFAULT_CONFIG, initialCapital },
        })
      : {
          ...riskControl,
          controlDrawdownPct: 0,
          changed: false,
        };
    riskControl = {
      stage: nextRiskControl.stage,
      stageDays: nextRiskControl.stageDays,
      recoveryDays: nextRiskControl.recoveryDays,
      anchorPeakEquity: nextRiskControl.anchorPeakEquity,
    };
    const drawdownExposureCap = !drawdownGuardEnabled
      ? 1
      : riskControl.stage === 'hard'
        ? 0
        : riskControl.stage === 'defensive'
          ? 0.25
          : riskControl.stage === 'soft'
            ? 0.5
            : 1;
    const benchmarkBar = benchmark?.byDate.get(tradeDate);
    const benchmarkVolPct = benchmark && benchmarkBar
      ? annualizedVolPct(benchmark, benchmarkBar.index)
      : null;
    const volatilityExposureCap = targetVolPct > 0 && benchmarkVolPct && benchmarkVolPct > 0
      ? Math.min(1, Math.max(minExposure, targetVolPct / benchmarkVolPct))
      : 1;
    const maxExposureCap = Math.min(
      maxExposure,
      drawdownExposureCap,
      volatilityExposureCap,
    );

    daysSinceSignal += 1;
    if (
      dateIndex < allDates.length - 1
      && pendingPlan == null
      && (daysSinceSignal >= rebalanceDays || nextRiskControl.changed)
    ) {
      const excluded = new Set<string>();
      for (const [symbol, untilIndex] of cooldownUntil) {
        if (dateIndex < untilIndex) excluded.add(symbol);
      }
      for (const symbol of pendingExits.keys()) excluded.add(symbol);
      const targets = selectTargets({
        histories,
        benchmark,
        tradeDate,
        topN,
        momentumDays,
        trendMaDays,
        weakExposure,
        bearExposure,
        bullBenchmarkMomentum,
        bullBenchmarkSlots,
        minimumBenchmarkSlots,
        cashFallbackInWeakRegime: input.cashFallbackInWeakRegime === true,
        maxPerTheme,
        excluded,
        maxExposureCap,
        maxAssetVolPct,
        riskAdjustedMomentum,
        cashHistory,
      });
      pendingPlan = {
        signalDate: tradeDate,
        executionDate: allDates[dateIndex + 1]!,
        targets,
      };
      daysSinceSignal = 0;
    }

    const investedMarketValue = [...positions.values()].reduce(
      (sum, position) => sum + positionValue(position, tradeDate),
      0,
    );
    const equity = cash + investedMarketValue;
    equityCurve.push({
      tradeDate,
      equity: round(equity, 4),
      returnPct: round(((equity - initialCapital) / initialCapital) * 100),
      closedTrades: trades.length,
    });
    portfolioSnapshots.push({
      tradeDate,
      cash: round(cash),
      investedMarketValue: round(investedMarketValue),
      totalValue: round(equity),
      returnPct: round(((equity - initialCapital) / initialCapital) * 100),
      closedTrades: trades.length,
      positions: [...positions.values()].map((position) => {
        const marketValue = positionValue(position, tradeDate);
        return {
          symbol: position.history.symbol,
          name: position.history.name,
          assetType: 'etf',
          entryDate: position.entryDate,
          entryPrice: round(position.entryPrice, 4),
          shares: position.shares,
          costAmount: round(position.costBasis),
          marketValue: round(marketValue),
          weightPct: equity > 0 ? round((marketValue / equity) * 100) : 0,
          returnPct: position.costBasis > 0
            ? round(((marketValue - position.costBasis) / position.costBasis) * 100)
            : null,
          exitDate: null,
        };
      }),
    });
  }

  const finalDate = allDates.at(-1);
  if (finalDate) {
    for (const position of [...positions.values()]) {
      const bar = findBarAtOrBefore(position.history, finalDate);
      if (bar) recordSale(position, position.shares, finalDate, bar.close, 'end_of_data');
    }
    const finalPoint = equityCurve.at(-1);
    if (finalPoint) {
      finalPoint.equity = round(cash, 4);
      finalPoint.returnPct = round(((cash - initialCapital) / initialCapital) * 100);
      finalPoint.closedTrades = trades.length;
    }
    const finalSnapshot = portfolioSnapshots.at(-1);
    if (finalSnapshot) {
      finalSnapshot.cash = round(cash);
      finalSnapshot.investedMarketValue = 0;
      finalSnapshot.totalValue = round(cash);
      finalSnapshot.returnPct = round(((cash - initialCapital) / initialCapital) * 100);
      finalSnapshot.closedTrades = trades.length;
      finalSnapshot.positions = [];
    }
  }

  const benchmarkBars = benchmark?.bars.filter((bar) =>
    isTradeDateInRange(bar.tradeDate, dateRange),
  ) ?? [];
  const benchmarkStart = benchmarkBars[0]?.close;
  const benchmarkCurve = benchmarkStart
    ? benchmarkBars.map((bar) => ({
        tradeDate: bar.tradeDate,
        equity: round((bar.close / benchmarkStart) * 100, 4),
        returnPct: round(((bar.close / benchmarkStart) - 1) * 100),
        closedTrades: 0,
      }))
    : [];
  const sortedTrades = trades.sort((a, b) =>
    a.entryDate.localeCompare(b.entryDate) || a.symbol.localeCompare(b.symbol),
  );

  return {
    strategy: 'etf-momentum-rotation',
    generatedAt: new Date().toISOString(),
    requestedDays: input.days ?? allDates.length,
    startDate: allDates[0] ?? formatTradeDateKey(dateRange.startDate),
    endDate: allDates.at(-1) ?? formatTradeDateKey(dateRange.endDate),
    holdDays: [rebalanceDays],
    symbols,
    trades: sortedTrades,
    metrics: summarizeTrades(sortedTrades),
    groups: buildTradeGroups(sortedTrades, [
      { key: 'all', label: '全部轮动', predicate: () => true },
      { key: 'positive', label: '盈利轮动', predicate: (trade) => (trade.returnPct ?? 0) > 0 },
      { key: 'negative', label: '亏损轮动', predicate: (trade) => (trade.returnPct ?? 0) < 0 },
    ]),
    equityCurve,
    portfolioSnapshots,
    benchmark: benchmarkCurve.length > 0
      ? {
          symbol: BENCHMARK_SYMBOL,
          name: '沪深300ETF',
          curve: benchmarkCurve,
          finalReturnPct: benchmarkCurve.at(-1)?.returnPct ?? null,
        }
      : undefined,
    config: {
      topN,
      momentumDays,
      rebalanceDays,
      trendMaDays,
      commissionRate: ETF_COMMISSION_RATE,
      slippageRate: ETF_SLIPPAGE_RATE,
      minimumCommission: MINIMUM_COMMISSION,
      totalTradingCost: round(totalTradingCost),
      tradingCostPct: round((totalTradingCost / initialCapital) * 100),
      bearRegimeMaxExposure: bearExposure,
      weakRegimeMaxExposure: weakExposure,
      bullBenchmarkSlotMomentumPct: bullBenchmarkMomentum,
      bullBenchmarkSlotCount: bullBenchmarkSlots,
      benchmarkCoreWeightPct: minimumBenchmarkSlots / topN,
      cashFallbackInWeakRegime: input.cashFallbackInWeakRegime === true,
      tPlusEnabled,
      tPlusBuyDipPct,
      tPlusMinProfitPct,
      tPlusBudgetPct,
      tPlusMaxTradesPerDay,
      tPlusTradeCount,
      tPlusTotalProfitPct: round((tPlusTotalProfit / initialCapital) * 100),
      netRebalance: true,
      stopLossPct,
      stopCooldownDays,
      maxPerTheme,
      initialCapital,
      signalExecution: 'next_open',
      maxVolExposure: maxExposure,
      minVolExposure: targetVolPct > 0 ? minExposure : undefined,
      targetPortfolioVolPct: targetVolPct > 0 ? targetVolPct : undefined,
      maxAssetVolPct,
      riskAdjustedMomentum,
      drawdownGuardPct: drawdownGuardEnabled
        ? [
            ETF_STABLE_V2_DEFAULT_CONFIG.drawdownSoftPct,
            ETF_STABLE_V2_DEFAULT_CONFIG.drawdownDefensivePct,
            ETF_STABLE_V2_DEFAULT_CONFIG.drawdownHardPct,
          ]
        : undefined,
    },
    notes: [
      `T 日收盘计算 ${momentumDays} 日动量和趋势，统一在 T+1 开盘执行净调仓。`,
      `每 ${rebalanceDays} 个交易日检查一次，Top ${topN} 等权；弱市仓位上限 ${weakExposure * 100}%，熊市仓位上限 ${bearExposure * 100}%。`,
      `组合固定风险预算上限为 ${maxExposure * 100}%，其余资金保留现金。`,
      targetVolPct > 0
        ? `按沪深300ETF近20日实现波动率做目标波动率缩放：目标 ${targetVolPct.toFixed(1)}%，最低风险仓位 ${Math.round(minExposure * 100)}%。`
        : '未启用目标波动率缩放。',
      riskAdjustedMomentum
        ? `启用单ETF波动率过滤与风险调整动量，近20日年化波动率上限 ${maxAssetVolPct.toFixed(1)}%。`
        : '使用原始动量排序。',
      `买卖均计入佣金 ${(ETF_COMMISSION_RATE * 100).toFixed(2)}%、滑点 ${(ETF_SLIPPAGE_RATE * 100).toFixed(2)}% 和最低佣金 ${MINIMUM_COMMISSION} 元。`,
      drawdownGuardEnabled
        ? '启用可恢复组合风控：-6%/-9%/-12% 分级降仓；硬风控满足最短观察期和市场恢复确认后逐级重新承担风险。'
        : '未启用组合回撤分级。',
      tPlusEnabled
        ? `正T为日线 OHLC 代理：前一日持仓盘中触发回撤 ${tPlusBuyDipPct}% 且收盘反弹 ${tPlusMinProfitPct}% 才计入，不能替代分钟级成交验证。`
        : '未启用正T叠加。',
      usedLocalCsv ? '历史行情优先使用本地 ETF 前复权 CSV。' : '历史行情使用远端日线。',
    ],
  };
}

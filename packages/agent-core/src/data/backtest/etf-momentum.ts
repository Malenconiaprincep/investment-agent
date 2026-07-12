import { ETF_POOL_19 } from '../etf/pool.js';
import {
  calcEtfBuyCost,
  calcEtfBuyLotsByBudget,
  calcEtfSellProceeds,
  ETF_COMMISSION_RATE,
  ETF_LOT_SIZE,
  ETF_SLIPPAGE_RATE,
} from '../etf/trading-cost.js';
import { getDailyQuote } from '../market/services.js';
import type { EtfRotationContext } from '../paper/etf-rotation-news.js';
import {
  hasLocalEtfDailyCsv,
  LOCAL_ETF_LOAD_ALL_DAYS,
} from '../market/local-csv/etf-daily.js';
import {
  buildTradeGroups,
  calcReturnPct,
  summarizeTrades,
} from './engine.js';
import {
  computeKlineDaysForRange,
  formatTradeDateKey,
  isTradeDateInRange,
  normalizeTradeDateKey,
  resolveBacktestDateRange,
  todayDateKey,
} from './date-range.js';
import type {
  BacktestCurrentDecision,
  BacktestEquityPoint,
  BacktestPortfolioSnapshot,
  BacktestRunResult,
  BacktestSignal,
  BacktestSymbolSummary,
  BacktestTrade,
} from './types.js';

export type RunEtfMomentumBacktestInput = {
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
  exitOnTrendBreak?: boolean;
  initialCapital?: number;
  maxPerTheme?: number | null;
  tPlusEnabled?: boolean;
  tPlusBuyDipPct?: number;
  tPlusMinProfitPct?: number;
  tPlusBudgetPct?: number;
  tPlusMaxTradesPerDay?: number;
  netRebalance?: boolean;
  signalExecution?: 'same_close' | 'next_open';
  drawdownGuardEnabled?: boolean;
  maxExposure?: number;
  targetVolPct?: number;
  minExposure?: number;
  maxAssetVolPct?: number;
  riskAdjustedMomentum?: boolean;
  stopLossPct?: number;
  stopCooldownDays?: number;
};

type MomentumBar = {
  tradeDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

type EtfHistory = {
  symbol: string;
  name: string;
  bars: MomentumBar[];
  byDate: Map<string, MomentumBar & { index: number }>;
};

type MomentumPick = {
  history: EtfHistory;
  score: number;
  momentumPct: number;
  trendMa: number;
};

const DEFAULT_DAYS = 365;
const DEFAULT_TOP_N = 4;
const DEFAULT_MOMENTUM_DAYS = 20;
const DEFAULT_REBALANCE_DAYS = 10;
const DEFAULT_TREND_MA_DAYS = 20;
const BENCHMARK_SYMBOL = '510300';
const MARKET_REGIME_MA_DAYS = 20;
const BULL_RELAXED_TREND_MA_DAYS = 10;
const POSITION_STOP_LOSS_PCT = -12;
const COMMISSION_RATE = ETF_COMMISSION_RATE;
const SLIPPAGE_RATE = ETF_SLIPPAGE_RATE;
const VOL_LOOKBACK_DAYS = 20;
const TARGET_ANNUAL_VOL_PCT = 15;
const MIN_VOL_EXPOSURE = 0.7;
const MAX_VOL_EXPOSURE = 1.0;
const STOP_COOLDOWN_DAYS = 10;
const WEAK_REGIME_MAX_EXPOSURE = 0.7;
const BEAR_REGIME_MAX_EXPOSURE = 0.25;
const BULL_BENCHMARK_SLOT_MOMENTUM_PCT = 8;
const BULL_BENCHMARK_SLOT_COUNT = 1;
const DEFAULT_MAX_PER_THEME = 2;
const DEFAULT_T_PLUS_BUY_DIP_PCT = 1.5;
const DEFAULT_T_PLUS_MIN_PROFIT_PCT = 0.6;
const DEFAULT_T_PLUS_BUDGET_PCT = 0.2;
const DEFAULT_T_PLUS_MAX_TRADES_PER_DAY = 2;

const ETF_THEME_BY_SYMBOL: Record<string, string> = {
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

type SimPosition = {
  symbol: string;
  name: string;
  history: EtfHistory;
  entryDate: string;
  entryIndex: number;
  entryPrice: number;
  shares: number;
  grossBasis: number;
  isBenchmarkFill: boolean;
  pick?: MomentumPick;
  effectiveTrendMaDays: number;
  plannedExitIndex: number;
};

type TPlusStats = {
  tradeCount: number;
  totalProfit: number;
};

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clampPositiveInt(
  value: number | undefined,
  fallback: number,
  min = 1,
  max = 120,
): number {
  if (value != null && Number.isFinite(value)) {
    return Math.min(max, Math.max(min, Math.floor(value)));
  }
  return fallback;
}

function toHistory(
  symbol: string,
  name: string,
  quotes: Array<{
    tradeDate: string;
    open?: number | null;
    high?: number | null;
    low?: number | null;
    close: number | null;
  }>,
): EtfHistory {
  const bars = quotes
    .filter(
      (bar): bar is {
        tradeDate: string;
        open?: number | null;
        high?: number | null;
        low?: number | null;
        close: number;
      } => {
      return bar.close != null && bar.close > 0;
      },
    )
    .map((bar) => ({
      tradeDate: normalizeTradeDateKey(bar.tradeDate),
      open: bar.open != null && bar.open > 0 ? bar.open : bar.close,
      high: bar.high != null && bar.high > 0 ? bar.high : bar.close,
      low: bar.low != null && bar.low > 0 ? bar.low : bar.close,
      close: bar.close,
    }))
    .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));

  return {
    symbol,
    name,
    bars,
    byDate: new Map(
      bars.map((bar, index) => [bar.tradeDate, { ...bar, index }]),
    ),
  };
}

function scoreMomentumPick(input: {
  history: EtfHistory;
  tradeDate: string;
  momentumDays: number;
  trendMaDays: number;
}): MomentumPick | null {
  const current = input.history.byDate.get(input.tradeDate);
  if (!current) return null;

  const lookback = Math.max(input.momentumDays, input.trendMaDays);
  if (current.index < lookback) return null;

  const past = input.history.bars[current.index - input.momentumDays];
  if (!past?.close) return null;

  const trendSlice = input.history.bars
    .slice(current.index - input.trendMaDays + 1, current.index + 1)
    .map((bar) => bar.close);
  const trendMa = avg(trendSlice);
  if (trendMa == null || current.close < trendMa) return null;

  const momentumPct = ((current.close - past.close) / past.close) * 100;
  return {
    history: input.history,
    score: momentumPct,
    momentumPct: round(momentumPct),
    trendMa: round(trendMa, 4),
  };
}

function resolveEffectiveTrendMaDays(input: {
  benchmarkHistory: EtfHistory | undefined;
  tradeDate: string;
  trendMaDays: number;
}): number {
  const benchmark = input.benchmarkHistory?.byDate.get(input.tradeDate);
  if (!benchmark || benchmark.index < MARKET_REGIME_MA_DAYS) {
    return input.trendMaDays;
  }

  const regimeSlice = input.benchmarkHistory!.bars
    .slice(benchmark.index - MARKET_REGIME_MA_DAYS + 1, benchmark.index + 1)
    .map((bar) => bar.close);
  const regimeMa = avg(regimeSlice);
  if (regimeMa != null && benchmark.close >= regimeMa) {
    return Math.min(input.trendMaDays, BULL_RELAXED_TREND_MA_DAYS);
  }

  return input.trendMaDays;
}

function stdDev(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = avg(values)!;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function computeAnnualizedVolPct(
  history: EtfHistory | undefined,
  endIndex: number,
  lookback = VOL_LOOKBACK_DAYS,
): number | null {
  if (!history || endIndex < lookback) return null;

  const returns: number[] = [];
  for (let index = endIndex - lookback + 1; index <= endIndex; index += 1) {
    const prev = history.bars[index - 1]?.close;
    const current = history.bars[index]?.close;
    if (!prev || !current || prev <= 0) continue;
    returns.push((current - prev) / prev);
  }

  const dailyVol = stdDev(returns);
  if (dailyVol == null) return null;
  return dailyVol * Math.sqrt(252) * 100;
}

function resolveVolTargetExposure(
  annualizedVolPct: number | null,
  targetPct = TARGET_ANNUAL_VOL_PCT,
  minExposure = MIN_VOL_EXPOSURE,
  maxExposure = MAX_VOL_EXPOSURE,
): number {
  if (annualizedVolPct == null || annualizedVolPct <= targetPct) return maxExposure;
  const scale = targetPct / annualizedVolPct;
  return Math.max(minExposure, Math.min(maxExposure, scale));
}

function isBearRegime(input: {
  benchmarkHistory: EtfHistory | undefined;
  tradeDate: string;
  momentumDays: number;
}): boolean {
  const benchmark = input.benchmarkHistory?.byDate.get(input.tradeDate);
  if (!benchmark || benchmark.index < Math.max(MARKET_REGIME_MA_DAYS, input.momentumDays)) {
    return false;
  }

  const regimeSlice = input.benchmarkHistory!.bars
    .slice(benchmark.index - MARKET_REGIME_MA_DAYS + 1, benchmark.index + 1)
    .map((bar) => bar.close);
  const regimeMa = avg(regimeSlice);
  const past = input.benchmarkHistory!.bars[benchmark.index - input.momentumDays];
  if (regimeMa == null || !past?.close) return false;

  return benchmark.close < regimeMa && benchmark.close < past.close;
}

function isWeakRegime(input: {
  benchmarkHistory: EtfHistory | undefined;
  tradeDate: string;
  momentumDays: number;
}): boolean {
  const benchmark = input.benchmarkHistory?.byDate.get(input.tradeDate);
  if (!benchmark || benchmark.index < Math.max(MARKET_REGIME_MA_DAYS, input.momentumDays)) {
    return false;
  }

  const regimeSlice = input.benchmarkHistory!.bars
    .slice(benchmark.index - MARKET_REGIME_MA_DAYS + 1, benchmark.index + 1)
    .map((bar) => bar.close);
  const regimeMa = avg(regimeSlice);
  const past = input.benchmarkHistory!.bars[benchmark.index - input.momentumDays];
  if (regimeMa == null || !past?.close) return false;

  return benchmark.close < regimeMa || benchmark.close < past.close;
}

function isBullBenchmarkSlotEnabled(input: {
  benchmarkHistory: EtfHistory | undefined;
  tradeDate: string;
  momentumDays: number;
  thresholdPct: number | undefined;
}): boolean {
  if (input.thresholdPct == null || input.thresholdPct <= 0) return false;

  const benchmark = input.benchmarkHistory?.byDate.get(input.tradeDate);
  if (!benchmark || benchmark.index < Math.max(MARKET_REGIME_MA_DAYS, input.momentumDays)) {
    return false;
  }

  const regimeSlice = input.benchmarkHistory!.bars
    .slice(benchmark.index - MARKET_REGIME_MA_DAYS + 1, benchmark.index + 1)
    .map((bar) => bar.close);
  const regimeMa = avg(regimeSlice);
  const past = input.benchmarkHistory!.bars[benchmark.index - input.momentumDays];
  if (regimeMa == null || !past?.close || benchmark.close < regimeMa) return false;

  const momentumPct = ((benchmark.close - past.close) / past.close) * 100;
  return momentumPct >= input.thresholdPct;
}

function buildStopCooldownExclusions(
  cooldownUntil: Map<string, number>,
  dateIndex: number,
): Set<string> {
  const excluded = new Set<string>();
  for (const [symbol, untilIndex] of cooldownUntil) {
    if (dateIndex < untilIndex) excluded.add(symbol);
  }
  return excluded;
}

function resolveEtfTheme(symbol: string): string {
  return ETF_THEME_BY_SYMBOL[symbol] ?? symbol;
}

function filterPicksByTheme(
  picks: MomentumPick[],
  maxPerTheme: number | null | undefined,
): MomentumPick[] {
  if (maxPerTheme == null || maxPerTheme <= 0) return picks;

  const counts = new Map<string, number>();
  const filtered: MomentumPick[] = [];
  for (const pick of picks) {
    const theme = resolveEtfTheme(pick.history.symbol);
    const count = counts.get(theme) ?? 0;
    if (count >= maxPerTheme) continue;
    counts.set(theme, count + 1);
    filtered.push(pick);
  }
  return filtered;
}

function buyShares(input: {
  cash: number;
  price: number;
  commissionRate: number;
  slippageRate: number;
  initialCapital: number;
}): { shares: number; spent: number } | null {
  if (input.cash <= 0 || input.price <= 0 || input.initialCapital <= 0) return null;
  const actualBudget = input.cash * input.initialCapital;
  const bought = calcEtfBuyLotsByBudget({
    budget: actualBudget,
    price: input.price,
    lotSize: ETF_LOT_SIZE,
    commissionRate: input.commissionRate,
    slippageRate: input.slippageRate,
  });
  if (!bought) return null;

  return {
    shares: bought.shares / input.initialCapital,
    spent: bought.totalCost / input.initialCapital,
  };
}

function sellProceeds(input: {
  shares: number;
  price: number;
  commissionRate: number;
  slippageRate: number;
}): number {
  if (input.shares <= 0 || input.price <= 0) return 0;
  return calcEtfSellProceeds(input).netProceeds;
}

function findBarAtOrBefore(
  history: EtfHistory,
  tradeDate: string,
): (MomentumBar & { index: number }) | undefined {
  const exact = history.byDate.get(tradeDate);
  if (exact) return exact;

  let left = 0;
  let right = history.bars.length - 1;
  let matchIndex = -1;
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const bar = history.bars[mid];
    if (bar.tradeDate <= tradeDate) {
      matchIndex = mid;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }
  const bar = matchIndex >= 0 ? history.bars[matchIndex] : undefined;
  return bar ? { ...bar, index: matchIndex } : undefined;
}

function markPositionValue(position: SimPosition, tradeDate: string): number {
  const bar = findBarAtOrBefore(position.history, tradeDate);
  if (!bar || position.entryPrice <= 0) return position.grossBasis;
  return position.shares * bar.close;
}

function isPositionTrendBroken(
  position: SimPosition,
  bar: MomentumBar & { index: number },
): boolean {
  const maDays = Math.max(1, position.effectiveTrendMaDays);
  if (bar.index <= position.entryIndex || bar.index < maDays - 1) return false;
  const trendSlice = position.history.bars
    .slice(bar.index - maDays + 1, bar.index + 1)
    .map((item) => item.close);
  const trendMa = avg(trendSlice);
  return trendMa != null && bar.close < trendMa;
}

function applyTPlusTrade(input: {
  position: SimPosition;
  bar: MomentumBar & { index: number };
  cash: number;
  buyDipPct: number;
  minProfitPct: number;
  budgetPct: number;
  commissionRate: number;
  slippageRate: number;
  initialCapital: number;
}): {
  cash: number;
  profit: number;
  traded: boolean;
  trade?: NonNullable<BacktestPortfolioSnapshot['tPlusTrades']>[number];
} {
  if (input.position.isBenchmarkFill || input.cash <= 0 || input.bar.index <= 0) {
    return { cash: input.cash, profit: 0, traded: false };
  }

  const prevClose = input.position.history.bars[input.bar.index - 1]?.close;
  if (!prevClose || prevClose <= 0) return { cash: input.cash, profit: 0, traded: false };

  const buyPrice = prevClose * (1 - input.buyDipPct / 100);
  if (input.bar.low > buyPrice) return { cash: input.cash, profit: 0, traded: false };

  const minSellPrice = buyPrice * (1 + input.minProfitPct / 100);
  if (input.bar.close < minSellPrice) return { cash: input.cash, profit: 0, traded: false };

  const positionValue = input.position.shares * input.bar.close;
  const budget = Math.min(input.cash, positionValue * input.budgetPct);
  const bought = buyShares({
    cash: budget,
    price: buyPrice,
    commissionRate: input.commissionRate,
    slippageRate: input.slippageRate,
    initialCapital: input.initialCapital,
  });
  if (!bought) return { cash: input.cash, profit: 0, traded: false };

  const proceeds = sellProceeds({
    shares: bought.shares,
    price: input.bar.close,
    commissionRate: input.commissionRate,
    slippageRate: input.slippageRate,
  });
  const profit = proceeds - bought.spent;
  if (profit <= 0) return { cash: input.cash, profit: 0, traded: false };

  return {
    cash: input.cash + profit,
    profit,
    traded: true,
    trade: {
      symbol: input.position.symbol,
      name: input.position.name,
      buyPrice: round(buyPrice, 4),
      sellPrice: round(input.bar.close, 4),
      shares: round(bought.shares * input.initialCapital, 2),
      spent: round(bought.spent * input.initialCapital, 2),
      proceeds: round(proceeds * input.initialCapital, 2),
      profit: round(profit * input.initialCapital, 2),
      profitPct: bought.spent > 0 ? round((profit / bought.spent) * 100) : null,
    },
  };
}

function resolveTargetSlots(input: {
  histories: EtfHistory[];
  benchmarkHistory: EtfHistory | undefined;
  tradeDate: string;
  topN: number;
  momentumDays: number;
  trendMaDays: number;
  reserveBenchmarkSlotCount?: number;
  excludedSymbols?: Set<string>;
  allowBenchmarkFallback?: boolean;
  rotationContext?: EtfRotationContext | null;
  maxPerTheme?: number | null;
}): Array<{
  history: EtfHistory;
  pick?: MomentumPick;
  isBenchmarkFill: boolean;
  effectiveTrendMaDays: number;
}> {
  const effectiveTrendMaDays = resolveEffectiveTrendMaDays({
    benchmarkHistory: input.benchmarkHistory,
    tradeDate: input.tradeDate,
    trendMaDays: input.trendMaDays,
  });
  const rotation = input.rotationContext;
  const boostedScore = (pick: MomentumPick) =>
    pick.score + (rotation?.themeBoostBySymbol[pick.history.symbol] ?? 0);

  const rankedPicks = input.histories
    .filter((history) => history.symbol !== BENCHMARK_SYMBOL)
    .map((history) =>
      scoreMomentumPick({
        history,
        tradeDate: input.tradeDate,
        momentumDays: input.momentumDays,
        trendMaDays: effectiveTrendMaDays,
      }),
    )
    .filter((pick): pick is MomentumPick => pick != null)
    .filter(
      (pick) =>
        !rotation?.newsBlockedSymbols.has(pick.history.symbol),
    )
    .sort((a, b) => boostedScore(b) - boostedScore(a));
  const picks = filterPicksByTheme(rankedPicks, input.maxPerTheme)
    .slice(0, input.topN);
  const excludedSymbols = input.excludedSymbols ?? new Set<string>();

  const slots: Array<{
    history: EtfHistory;
    pick?: MomentumPick;
    isBenchmarkFill: boolean;
    effectiveTrendMaDays: number;
  }> = [];
  const sectorSlotCount =
    input.reserveBenchmarkSlotCount && input.benchmarkHistory
      ? Math.max(0, input.topN - input.reserveBenchmarkSlotCount)
      : input.topN;

  if (input.reserveBenchmarkSlotCount && input.benchmarkHistory) {
    for (let slot = 0; slot < input.reserveBenchmarkSlotCount; slot += 1) {
      slots.push({
        history: input.benchmarkHistory,
        isBenchmarkFill: true,
        effectiveTrendMaDays,
      });
    }
  }

  for (let slot = 0; slot < sectorSlotCount; slot += 1) {
    const pick = picks[slot];
    if (pick && !excludedSymbols.has(pick.history.symbol)) {
      slots.push({
        history: pick.history,
        pick,
        isBenchmarkFill: false,
        effectiveTrendMaDays,
      });
      continue;
    }
    if (input.benchmarkHistory && input.allowBenchmarkFallback !== false) {
      slots.push({
        history: input.benchmarkHistory,
        isBenchmarkFill: true,
        effectiveTrendMaDays,
      });
    }
  }

  return slots;
}

function closeSimPosition(input: {
  position: SimPosition;
  exitDate: string;
  exitPrice: number;
  exitReason: BacktestTrade['exitReason'];
  topN: number;
  momentumDays: number;
  rebalanceDays: number;
  commissionRate: number;
  slippageRate: number;
}): BacktestTrade {
  const proceeds = sellProceeds({
    shares: input.position.shares,
    price: input.exitPrice,
    commissionRate: input.commissionRate,
    slippageRate: input.slippageRate,
  });
  const returnPct =
    input.position.grossBasis > 0
      ? round(((proceeds - input.position.grossBasis) / input.position.grossBasis) * 100)
      : null;
  const exitIndex =
    findBarAtOrBefore(input.position.history, input.exitDate)?.index
    ?? input.position.entryIndex;

  const signal: BacktestSignal = input.position.pick
    ? {
        symbol: input.position.symbol,
        name: input.position.name,
        assetType: 'etf',
        strategy: 'etf-momentum-rotation',
        tradeDate: input.position.entryDate,
        entryPrice: input.position.entryPrice,
        score: input.position.pick.score,
        metadata: {
          momentumPct: input.position.pick.momentumPct,
          trendMa: input.position.pick.trendMa,
          topN: input.topN,
          momentumDays: input.momentumDays,
          rebalanceDays: input.rebalanceDays,
          trendMaDays: input.position.effectiveTrendMaDays,
          stopLossPct: POSITION_STOP_LOSS_PCT,
          benchmarkFallback: false,
        },
      }
    : {
        symbol: input.position.symbol,
        name: input.position.name,
        assetType: 'etf',
        strategy: 'etf-momentum-rotation',
        tradeDate: input.position.entryDate,
        entryPrice: input.position.entryPrice,
        score: 0,
        metadata: {
          benchmarkFallback: true,
          topN: input.topN,
          momentumDays: input.momentumDays,
          rebalanceDays: input.rebalanceDays,
          trendMaDays: input.position.effectiveTrendMaDays,
          stopLossPct: POSITION_STOP_LOSS_PCT,
        },
      };

  return {
    symbol: input.position.symbol,
    name: input.position.name,
    assetType: 'etf',
    strategy: 'etf-momentum-rotation',
    entryDate: input.position.entryDate,
    entryPrice: input.position.entryPrice,
    exitDate: input.exitDate,
    exitPrice: input.exitPrice,
    holdDays: Math.max(0, exitIndex - input.position.entryIndex),
    returnPct,
    exitReason:
      input.exitReason === 'fixed_hold' && input.position.isBenchmarkFill
        ? 'benchmark_fill'
        : input.exitReason,
    signal,
  };
}

function simulateDailyPortfolio(input: {
  allDates: string[];
  histories: EtfHistory[];
  benchmarkHistory: EtfHistory | undefined;
  topN: number;
  momentumDays: number;
  rebalanceDays: number;
  trendMaDays: number;
  commissionRate: number;
  slippageRate: number;
  volTargetPct: number;
  minVolExposure: number;
  maxVolExposure: number;
  stopCooldownDays: number;
  bearRegimeMaxExposure: number;
  weakRegimeMaxExposure?: number;
  bullBenchmarkSlotMomentumPct?: number;
  bullBenchmarkSlotCount: number;
  cashFallbackInWeakRegime: boolean;
  exitOnTrendBreak: boolean;
  initialCapital: number;
  maxPerTheme?: number | null;
  tPlusEnabled: boolean;
  tPlusBuyDipPct: number;
  tPlusMinProfitPct: number;
  tPlusBudgetPct: number;
  tPlusMaxTradesPerDay: number;
  netRebalance: boolean;
}): {
  trades: BacktestTrade[];
  equityPoints: Array<{ tradeDate: string; equity: number; closedTrades: number }>;
  portfolioSnapshots: BacktestPortfolioSnapshot[];
  tPlusStats: TPlusStats;
} {
  const trades: BacktestTrade[] = [];
  const equityPoints: Array<{ tradeDate: string; equity: number; closedTrades: number }> = [];
  const portfolioSnapshots: BacktestPortfolioSnapshot[] = [];
  const tPlusStats: TPlusStats = { tradeCount: 0, totalProfit: 0 };
  let currentTPlusTrades: NonNullable<BacktestPortfolioSnapshot['tPlusTrades']> = [];
  let cash = 1;
  let positions: SimPosition[] = [];
  let closedTrades = 0;
  let daysSinceRebalance = Number.POSITIVE_INFINITY;
  const cooldownUntil = new Map<string, number>();

  const closeAllPositions = (tradeDate: string, exitReason: BacktestTrade['exitReason']) => {
    for (const position of positions) {
      const bar = findBarAtOrBefore(position.history, tradeDate);
      if (!bar) continue;
      trades.push(
        closeSimPosition({
          position,
          exitDate: tradeDate,
          exitPrice: bar.close,
          exitReason,
          topN: input.topN,
          momentumDays: input.momentumDays,
          rebalanceDays: input.rebalanceDays,
          commissionRate: input.commissionRate,
          slippageRate: input.slippageRate,
        }),
      );
      cash += sellProceeds({
        shares: position.shares,
        price: bar.close,
        commissionRate: input.commissionRate,
        slippageRate: input.slippageRate,
      });
      closedTrades += 1;
    }
    positions = [];
  };

  const markPortfolioEquity = (tradeDate: string): number => {
    let invested = 0;
    for (const position of positions) {
      invested += markPositionValue(position, tradeDate);
    }
    return cash + invested;
  };

  const markPortfolioSnapshot = (tradeDate: string) => {
    const positionValues = positions.map((position) => {
      const marketValue = markPositionValue(position, tradeDate);
      return { position, marketValue };
    });
    const invested = positionValues.reduce(
      (sum, item) => sum + item.marketValue,
      0,
    );
    const totalEquity = cash + invested;
    const aggregatedPositions = new Map<string, BacktestPortfolioSnapshot['positions'][number]>();
    for (const { position, marketValue } of positionValues) {
      const key = `${position.symbol}-${position.entryDate}-${position.entryPrice}`;
      const existing = aggregatedPositions.get(key);
      const shares = position.shares * input.initialCapital;
      const costAmount = position.grossBasis * input.initialCapital;
      const scaledMarketValue = marketValue * input.initialCapital;
      const returnPct =
        position.grossBasis > 0
          ? round(((marketValue - position.grossBasis) / position.grossBasis) * 100)
          : null;
      if (existing) {
        existing.shares = round(existing.shares + shares, 2);
        existing.costAmount = round(existing.costAmount + costAmount, 2);
        existing.marketValue = round(existing.marketValue + scaledMarketValue, 2);
        existing.weightPct = totalEquity > 0
          ? round((existing.marketValue / (totalEquity * input.initialCapital)) * 100)
          : 0;
        existing.returnPct =
          existing.costAmount > 0
            ? round(((existing.marketValue - existing.costAmount) / existing.costAmount) * 100)
            : returnPct;
        continue;
      }
      aggregatedPositions.set(key, {
        symbol: position.symbol,
        name: position.name,
        assetType: 'etf',
        entryDate: position.entryDate,
        entryPrice: position.entryPrice,
        shares: round(shares, 2),
        costAmount: round(costAmount, 2),
        marketValue: round(scaledMarketValue, 2),
        weightPct: totalEquity > 0 ? round((marketValue / totalEquity) * 100) : 0,
        returnPct,
        exitDate: null,
      });
    }

    portfolioSnapshots.push({
      tradeDate,
      cash: round(cash * input.initialCapital, 2),
      investedMarketValue: round(invested * input.initialCapital, 2),
      totalValue: round(totalEquity * input.initialCapital, 2),
      returnPct: round((totalEquity - 1) * 100),
      closedTrades,
      ...(currentTPlusTrades.length > 0 ? { tPlusTrades: currentTPlusTrades } : {}),
      positions: [...aggregatedPositions.values()],
    });
  };

  const sellPositionShares = (
    position: SimPosition,
    tradeDate: string,
    price: number,
    sharesToSell: number,
    exitReason: BacktestTrade['exitReason'],
  ): SimPosition | null => {
    const shares = Math.min(position.shares, sharesToSell);
    if (shares <= 0 || position.shares <= 0) return position;
    const ratio = Math.min(1, shares / position.shares);
    const soldBasis = position.grossBasis * ratio;
    const soldPosition: SimPosition = {
      ...position,
      shares,
      grossBasis: soldBasis,
    };
    trades.push(
      closeSimPosition({
        position: soldPosition,
        exitDate: tradeDate,
        exitPrice: price,
        exitReason,
        topN: input.topN,
        momentumDays: input.momentumDays,
        rebalanceDays: input.rebalanceDays,
        commissionRate: input.commissionRate,
        slippageRate: input.slippageRate,
      }),
    );
    cash += sellProceeds({
      shares,
      price,
      commissionRate: input.commissionRate,
      slippageRate: input.slippageRate,
    });
    closedTrades += 1;

    const remainingShares = position.shares - shares;
    if (remainingShares * input.initialCapital < ETF_LOT_SIZE / 2) return null;
    return {
      ...position,
      shares: remainingShares,
      grossBasis: Math.max(0, position.grossBasis - soldBasis),
    };
  };

  for (let dateIndex = 0; dateIndex < input.allDates.length; dateIndex += 1) {
    const tradeDate = input.allDates[dateIndex];
    daysSinceRebalance += 1;

    const benchmarkBarForSchedule = input.benchmarkHistory?.byDate.get(tradeDate);
    const scheduleVol = benchmarkBarForSchedule
      ? computeAnnualizedVolPct(input.benchmarkHistory, benchmarkBarForSchedule.index)
      : null;
    const dailyWeakRegime = input.exitOnTrendBreak
      ? isWeakRegime({
          benchmarkHistory: input.benchmarkHistory,
          tradeDate,
          momentumDays: input.momentumDays,
        })
      : false;
    const requiredRebalanceDays = input.rebalanceDays;
    const isRebalanceDay = daysSinceRebalance >= requiredRebalanceDays;

    const remainingPositions: SimPosition[] = [];
    let tPlusTradesToday = 0;
    currentTPlusTrades = [];
    for (const position of positions) {
      const bar = position.history.byDate.get(tradeDate);
      if (!bar) {
        remainingPositions.push(position);
        continue;
      }

      const returnPct = calcReturnPct(position.entryPrice, bar.close);
      const hitStop =
        returnPct != null
        && returnPct <= POSITION_STOP_LOSS_PCT
        && bar.index > position.entryIndex;

      if (hitStop) {
        trades.push(
          closeSimPosition({
            position,
            exitDate: tradeDate,
            exitPrice: bar.close,
            exitReason: 'stop_loss',
            topN: input.topN,
            momentumDays: input.momentumDays,
            rebalanceDays: input.rebalanceDays,
            commissionRate: input.commissionRate,
            slippageRate: input.slippageRate,
          }),
        );
        cash += sellProceeds({
          shares: position.shares,
          price: bar.close,
          commissionRate: input.commissionRate,
          slippageRate: input.slippageRate,
        });
        if (input.stopCooldownDays > 0) {
          cooldownUntil.set(
            position.symbol,
            dateIndex + input.stopCooldownDays,
          );
        }
        closedTrades += 1;
        continue;
      }

      if (dailyWeakRegime && isPositionTrendBroken(position, bar)) {
        trades.push(
          closeSimPosition({
            position,
            exitDate: tradeDate,
            exitPrice: bar.close,
            exitReason: 'ma20_break',
            topN: input.topN,
            momentumDays: input.momentumDays,
            rebalanceDays: input.rebalanceDays,
            commissionRate: input.commissionRate,
            slippageRate: input.slippageRate,
          }),
        );
        cash += sellProceeds({
          shares: position.shares,
          price: bar.close,
          commissionRate: input.commissionRate,
          slippageRate: input.slippageRate,
        });
        closedTrades += 1;
        continue;
      }

      remainingPositions.push(position);

      if (
        input.tPlusEnabled
        && tPlusTradesToday < input.tPlusMaxTradesPerDay
        && !isRebalanceDay
      ) {
        const tPlus = applyTPlusTrade({
          position,
          bar,
          cash,
          buyDipPct: input.tPlusBuyDipPct,
          minProfitPct: input.tPlusMinProfitPct,
          budgetPct: input.tPlusBudgetPct,
          commissionRate: input.commissionRate,
          slippageRate: input.slippageRate,
          initialCapital: input.initialCapital,
        });
        if (tPlus.traded) {
          cash = tPlus.cash;
          tPlusStats.tradeCount += 1;
          tPlusStats.totalProfit += tPlus.profit;
          tPlusTradesToday += 1;
          if (tPlus.trade) currentTPlusTrades.push(tPlus.trade);
        }
      }
    }
    positions = remainingPositions;

    if (isRebalanceDay) {
      daysSinceRebalance = 0;

      const benchmarkBar = benchmarkBarForSchedule;
      const annualizedVol = scheduleVol;
      const exposureScale = resolveVolTargetExposure(
        annualizedVol,
        input.volTargetPct,
        input.minVolExposure,
        input.maxVolExposure,
      );
      const weakRegime = isWeakRegime({
        benchmarkHistory: input.benchmarkHistory,
        tradeDate,
        momentumDays: input.momentumDays,
      });
      const bearRegime = isBearRegime({
        benchmarkHistory: input.benchmarkHistory,
        tradeDate,
        momentumDays: input.momentumDays,
      });
      const weakExposureScale =
        weakRegime && input.weakRegimeMaxExposure != null
          ? Math.min(exposureScale, input.weakRegimeMaxExposure)
          : exposureScale;
      const regimeExposureScale = bearRegime
        ? Math.min(weakExposureScale, input.bearRegimeMaxExposure)
        : weakExposureScale;

      const excludedSymbols = buildStopCooldownExclusions(cooldownUntil, dateIndex);
      const reserveBenchmarkSlotCount = isBullBenchmarkSlotEnabled({
        benchmarkHistory: input.benchmarkHistory,
        tradeDate,
        momentumDays: input.momentumDays,
        thresholdPct: input.bullBenchmarkSlotMomentumPct,
      })
        ? input.bullBenchmarkSlotCount
        : 0;
      const targetSlots = resolveTargetSlots({
        histories: input.histories,
        benchmarkHistory: input.benchmarkHistory,
        tradeDate,
        topN: input.topN,
        momentumDays: input.momentumDays,
        trendMaDays: input.trendMaDays,
        reserveBenchmarkSlotCount,
        excludedSymbols,
        allowBenchmarkFallback: !(input.cashFallbackInWeakRegime && weakRegime),
        maxPerTheme: input.maxPerTheme,
      });
      if (!input.netRebalance) {
        closeAllPositions(tradeDate, 'fixed_hold');
      }

      const totalEquity = input.netRebalance ? markPortfolioEquity(tradeDate) : cash;
      const deployable = totalEquity * regimeExposureScale;
      const slotBudget = deployable / input.topN;
      const plannedExitIndex = Math.min(
        dateIndex + requiredRebalanceDays,
        input.allDates.length - 1,
      );

      if (input.netRebalance) {
        const targetBySymbol = new Map<string, {
          slot: (typeof targetSlots)[number];
          entryBar: MomentumBar & { index: number };
          targetShares: number;
        }>();
        for (const slot of targetSlots) {
          const entryBar = slot.history.byDate.get(tradeDate);
          if (!entryBar || slotBudget <= 0) continue;
          const target = buyShares({
            cash: slotBudget,
            price: entryBar.close,
            commissionRate: input.commissionRate,
            slippageRate: input.slippageRate,
            initialCapital: input.initialCapital,
          });
          if (!target) continue;
          const existing = targetBySymbol.get(slot.history.symbol);
          if (existing) {
            existing.targetShares += target.shares;
          } else {
            targetBySymbol.set(slot.history.symbol, {
              slot,
              entryBar,
              targetShares: target.shares,
            });
          }
        }

        const currentSharesBySymbol = new Map<string, number>();
        for (const position of positions) {
          const current = currentSharesBySymbol.get(position.symbol) ?? 0;
          currentSharesBySymbol.set(position.symbol, current + position.shares);
        }
        const excessSharesBySymbol = new Map<string, number>();
        for (const [symbol, currentShares] of currentSharesBySymbol) {
          const targetShares = targetBySymbol.get(symbol)?.targetShares ?? 0;
          excessSharesBySymbol.set(symbol, Math.max(0, currentShares - targetShares));
        }

        const rebalancedPositions: SimPosition[] = [];
        for (const position of positions) {
          const bar = position.history.byDate.get(tradeDate);
          const target = targetBySymbol.get(position.symbol);
          if (!bar) {
            rebalancedPositions.push(position);
            continue;
          }
          const excessShares = excessSharesBySymbol.get(position.symbol) ?? 0;
          const sharesToSell = target ? Math.min(position.shares, excessShares) : position.shares;
          const remaining =
            sharesToSell > 0
              ? sellPositionShares(position, tradeDate, bar.close, sharesToSell, 'fixed_hold')
              : position;
          if (sharesToSell > 0) {
            excessSharesBySymbol.set(position.symbol, Math.max(0, excessShares - sharesToSell));
          }
          if (!remaining) continue;
          if (target) {
            remaining.pick = target.slot.pick;
            remaining.isBenchmarkFill = target.slot.isBenchmarkFill;
            remaining.effectiveTrendMaDays = target.slot.effectiveTrendMaDays;
            remaining.plannedExitIndex = plannedExitIndex;
          }
          rebalancedPositions.push(remaining);
        }
        positions = rebalancedPositions;

        const afterSellSharesBySymbol = new Map<string, number>();
        for (const position of positions) {
          const current = afterSellSharesBySymbol.get(position.symbol) ?? 0;
          afterSellSharesBySymbol.set(position.symbol, current + position.shares);
        }
        const minLotShares = ETF_LOT_SIZE / input.initialCapital;
        for (const target of targetBySymbol.values()) {
          const currentShares = afterSellSharesBySymbol.get(target.slot.history.symbol) ?? 0;
          const rawDeltaShares = target.targetShares - currentShares;
          const actualDeltaShares =
            Math.floor((rawDeltaShares * input.initialCapital) / ETF_LOT_SIZE)
            * ETF_LOT_SIZE;
          const deltaShares = actualDeltaShares / input.initialCapital;
          if (deltaShares < minLotShares) continue;

          const exactCost = calcEtfBuyCost({
            shares: deltaShares,
            price: target.entryBar.close,
            commissionRate: input.commissionRate,
            slippageRate: input.slippageRate,
          }).totalCost;
          const bought =
            exactCost <= cash
              ? { shares: deltaShares, spent: exactCost }
              : buyShares({
                  cash,
                  price: target.entryBar.close,
                  commissionRate: input.commissionRate,
                  slippageRate: input.slippageRate,
                  initialCapital: input.initialCapital,
                });
          if (!bought) continue;
          cash -= bought.spent;
          positions.push({
            symbol: target.slot.history.symbol,
            name: target.slot.history.name,
            history: target.slot.history,
            entryDate: tradeDate,
            entryIndex: target.entryBar.index,
            entryPrice: target.entryBar.close,
            shares: bought.shares,
            grossBasis: bought.spent,
            isBenchmarkFill: target.slot.isBenchmarkFill,
            pick: target.slot.pick,
            effectiveTrendMaDays: target.slot.effectiveTrendMaDays,
            plannedExitIndex,
          });
        }
      }
      else {
        cash = totalEquity - slotBudget * targetSlots.length;
        for (const slot of targetSlots) {
          const entryBar = slot.history.byDate.get(tradeDate);
          if (!entryBar || slotBudget <= 0) {
            cash += slotBudget;
            continue;
          }

          const bought = buyShares({
            cash: slotBudget,
            price: entryBar.close,
            commissionRate: input.commissionRate,
            slippageRate: input.slippageRate,
            initialCapital: input.initialCapital,
          });
          if (!bought) {
            cash += slotBudget;
            continue;
          }
          cash += Math.max(0, slotBudget - bought.spent);

          positions.push({
            symbol: slot.history.symbol,
            name: slot.history.name,
            history: slot.history,
            entryDate: tradeDate,
            entryIndex: entryBar.index,
            entryPrice: entryBar.close,
            shares: bought.shares,
            grossBasis: bought.spent,
            isBenchmarkFill: slot.isBenchmarkFill,
            pick: slot.pick,
            effectiveTrendMaDays: slot.effectiveTrendMaDays,
            plannedExitIndex,
          });
        }
      }
    }

    const equity = markPortfolioEquity(tradeDate);
    equityPoints.push({ tradeDate, equity, closedTrades });
    markPortfolioSnapshot(tradeDate);
  }

  const lastDate = input.allDates.at(-1);
  if (lastDate && positions.length > 0) {
    closeAllPositions(lastDate, 'end_of_data');
  }

  return { trades, equityPoints, portfolioSnapshots, tPlusStats };
}

function buildMomentumEquityCurve(
  points: Array<{ tradeDate: string; equity: number; closedTrades: number }>,
): BacktestEquityPoint[] {
  return points.map((point) => ({
    tradeDate: point.tradeDate,
    equity: round(point.equity * 100, 4),
    returnPct: round((point.equity - 1) * 100),
    closedTrades: point.closedTrades,
  }));
}

function buildBenchmarkCurve(
  history: EtfHistory | undefined,
  dateRange: { startDate: string; endDate: string },
): BacktestEquityPoint[] {
  if (!history) return [];
  const bars = history.bars.filter((bar) =>
    isTradeDateInRange(bar.tradeDate, dateRange),
  );
  const start = bars[0]?.close;
  if (!start) return [];
  return bars.map((bar) => {
    const returnPct = ((bar.close - start) / start) * 100;
    return {
      tradeDate: bar.tradeDate,
      equity: round(100 + returnPct, 4),
      returnPct: round(returnPct),
      closedTrades: 0,
    };
  });
}

function buildSymbolSummaries(trades: BacktestTrade[]): BacktestSymbolSummary[] {
  const bySymbol = new Map<string, BacktestTrade[]>();
  for (const trade of trades) {
    const items = bySymbol.get(trade.symbol) ?? [];
    items.push(trade);
    bySymbol.set(trade.symbol, items);
  }

  return [...bySymbol.entries()]
    .map(([symbol, items]) => ({
      symbol,
      name: items[0]?.name ?? symbol,
      assetType: 'etf' as const,
      ...summarizeTrades(items),
    }))
    .sort((a, b) => (b.avgReturnPct ?? -Infinity) - (a.avgReturnPct ?? -Infinity));
}

function buildCurrentDecisions(input: {
  histories: EtfHistory[];
  benchmarkHistory: EtfHistory | undefined;
  topN: number;
  momentumDays: number;
  trendMaDays: number;
  bullBenchmarkSlotMomentumPct?: number;
  bullBenchmarkSlotCount: number;
  cashFallbackInWeakRegime?: boolean;
  maxPerTheme?: number | null;
}): BacktestCurrentDecision[] {
  const latestDate = [...new Set(input.histories.flatMap((item) => item.bars.map((bar) => bar.tradeDate)))]
    .sort()
    .at(-1);
  if (!latestDate) return [];

  const effectiveTrendMaDays = resolveEffectiveTrendMaDays({
    benchmarkHistory: input.benchmarkHistory,
    tradeDate: latestDate,
    trendMaDays: input.trendMaDays,
  });

  const reserveBenchmarkSlotCount = isBullBenchmarkSlotEnabled({
    benchmarkHistory: input.benchmarkHistory,
    tradeDate: latestDate,
    momentumDays: input.momentumDays,
    thresholdPct: input.bullBenchmarkSlotMomentumPct,
  })
    ? input.bullBenchmarkSlotCount
    : 0;
  const sectorSlotCount =
    reserveBenchmarkSlotCount > 0 && input.benchmarkHistory
      ? Math.max(0, input.topN - reserveBenchmarkSlotCount)
      : input.topN;
  const ranked = input.histories
    .filter((history) => history.symbol !== BENCHMARK_SYMBOL)
    .map((history) =>
      scoreMomentumPick({
        history,
        tradeDate: latestDate,
        momentumDays: input.momentumDays,
        trendMaDays: effectiveTrendMaDays,
      }),
    )
    .filter((pick): pick is MomentumPick => pick != null)
    .sort((a, b) => b.score - a.score);
  const rankedAfterThemeLimit = filterPicksByTheme(ranked, input.maxPerTheme);
  const selected = new Set(
    rankedAfterThemeLimit.slice(0, sectorSlotCount).map((pick) => pick.history.symbol),
  );
  const weakRegime = isWeakRegime({
    benchmarkHistory: input.benchmarkHistory,
    tradeDate: latestDate,
    momentumDays: input.momentumDays,
  });
  const allowBenchmarkFallback =
    !input.cashFallbackInWeakRegime || !weakRegime;
  if (
    input.benchmarkHistory
    && (reserveBenchmarkSlotCount > 0 || (allowBenchmarkFallback && ranked.length < input.topN))
  ) {
    selected.add(input.benchmarkHistory.symbol);
  }

  return input.histories
    .map((history) => {
      const current = history.byDate.get(latestDate);
      const pick = ranked.find((item) => item.history.symbol === history.symbol);
      const themeLimitedPick = rankedAfterThemeLimit.find(
        (item) => item.history.symbol === history.symbol,
      );
      const isSelected = selected.has(history.symbol);
      const blockedByTheme =
        pick != null && themeLimitedPick == null && !isSelected;
      return {
        symbol: history.symbol,
        name: history.name,
        assetType: 'etf' as const,
        action: isSelected ? ('buy' as const) : ('watch' as const),
        actionLabel: isSelected ? '轮动持有' : '等待轮动',
        price: current?.close ?? 0,
        changePct: pick?.momentumPct ?? 0,
        failCount: pick || isSelected ? 0 : 1,
        passedRules: pick || isSelected ? 2 : 0,
        failedRules:
          pick || isSelected
            ? []
            : [`未站上 MA${effectiveTrendMaDays} 或动量不足`],
        reason: pick
          ? blockedByTheme
            ? `${input.momentumDays}日动量 ${pick.momentumPct.toFixed(2)}%，站上 MA${effectiveTrendMaDays}，但同主题持仓已达上限。`
            : `${input.momentumDays}日动量 ${pick.momentumPct.toFixed(2)}%，站上 MA${effectiveTrendMaDays}，按排名${isSelected ? '进入前' + input.topN : '未进入前' + input.topN}。`
          : history.symbol === BENCHMARK_SYMBOL && isSelected
            ? reserveBenchmarkSlotCount > 0
              ? `沪深300站上 MA${MARKET_REGIME_MA_DAYS} 且 ${input.momentumDays} 日动量达到宽基保留槽位阈值，保留 ${reserveBenchmarkSlotCount} 个基准槽位。`
              : `动量标的不足 ${input.topN} 只，使用基准 ETF 兜底。`
          : `未满足 MA${effectiveTrendMaDays} 趋势过滤或缺少足够历史数据。`,
        dataSource: 'daily' as const,
      };
    })
    .sort((a, b) => {
      if (a.action !== b.action) return a.action === 'buy' ? -1 : 1;
      return b.changePct - a.changePct;
    });
}

export type EtfMomentumLiveTarget = {
  symbol: string;
  name: string;
  isBenchmarkFill: boolean;
  matchedThemes?: string[];
  themeBoost?: number;
  newsLabel?: string;
};

export type EtfMomentumLivePlan = {
  tradeDate: string;
  topN: number;
  rebalanceDays: number;
  regimeExposureScale: number;
  weakRegime: boolean;
  bearRegime: boolean;
  hotThemes?: string[];
  rotationSummary?: string;
  targets: EtfMomentumLiveTarget[];
};

async function loadEtfMomentumHistories(days: number): Promise<{
  histories: EtfHistory[];
  benchmarkHistory: EtfHistory | undefined;
}> {
  const histories: EtfHistory[] = [];
  for (const item of ETF_POOL_19) {
    try {
      const quoteDays = hasLocalEtfDailyCsv(item.symbol)
        ? LOCAL_ETF_LOAD_ALL_DAYS
        : days;
      const data = await getDailyQuote(item.symbol, quoteDays);
      histories.push(toHistory(item.symbol, item.name, data.quotes));
    } catch {
      // skip missing symbols
    }
  }
  return {
    histories,
    benchmarkHistory: histories.find((item) => item.symbol === BENCHMARK_SYMBOL),
  };
}

export async function buildEtfMomentumLivePlan(input?: {
  tradeDate?: string;
  excludedSymbols?: Set<string>;
  rotationContext?: EtfRotationContext | null;
  maxPerTheme?: number | null;
}): Promise<EtfMomentumLivePlan> {
  const tradeDate = normalizeTradeDateKey(input?.tradeDate ?? formatTradeDateKey(todayDateKey()));
  const topN = DEFAULT_TOP_N;
  const momentumDays = DEFAULT_MOMENTUM_DAYS;
  const trendMaDays = DEFAULT_TREND_MA_DAYS;
  const { histories, benchmarkHistory } = await loadEtfMomentumHistories(
    Math.max(120, momentumDays + trendMaDays + 45),
  );

  const benchmarkBar = benchmarkHistory?.byDate.get(tradeDate);
  const scheduleVol =
    benchmarkBar != null
      ? computeAnnualizedVolPct(benchmarkHistory, benchmarkBar.index)
      : null;
  const exposureScale = resolveVolTargetExposure(scheduleVol);
  const weakRegime = isWeakRegime({
    benchmarkHistory,
    tradeDate,
    momentumDays,
  });
  const bearRegime = isBearRegime({
    benchmarkHistory,
    tradeDate,
    momentumDays,
  });
  const weakExposureScale =
    weakRegime && WEAK_REGIME_MAX_EXPOSURE != null
      ? Math.min(exposureScale, WEAK_REGIME_MAX_EXPOSURE)
      : exposureScale;
  const regimeExposureScale = bearRegime
    ? Math.min(weakExposureScale, BEAR_REGIME_MAX_EXPOSURE)
    : weakExposureScale;
  const reserveBenchmarkSlotCount = isBullBenchmarkSlotEnabled({
    benchmarkHistory,
    tradeDate,
    momentumDays,
    thresholdPct: BULL_BENCHMARK_SLOT_MOMENTUM_PCT,
  })
    ? BULL_BENCHMARK_SLOT_COUNT
    : 0;
  const slots = resolveTargetSlots({
    histories,
    benchmarkHistory,
    tradeDate,
    topN,
    momentumDays,
    trendMaDays,
    reserveBenchmarkSlotCount,
    excludedSymbols: input?.excludedSymbols ?? new Set<string>(),
    allowBenchmarkFallback: true,
    rotationContext: input?.rotationContext ?? null,
    maxPerTheme:
      input?.maxPerTheme === null
        ? null
        : input?.maxPerTheme ?? DEFAULT_MAX_PER_THEME,
  });

  const rotation = input?.rotationContext ?? null;

  return {
    tradeDate,
    topN,
    rebalanceDays: DEFAULT_REBALANCE_DAYS,
    regimeExposureScale,
    weakRegime,
    bearRegime,
    hotThemes: rotation?.hotThemes,
    rotationSummary: rotation?.summary,
    targets: slots.map((slot) => ({
      symbol: slot.history.symbol,
      name: slot.history.name,
      isBenchmarkFill: slot.isBenchmarkFill,
      matchedThemes: rotation?.matchedThemesBySymbol[slot.history.symbol],
      themeBoost: rotation?.themeBoostBySymbol[slot.history.symbol],
      newsLabel: rotation?.newsBySymbol[slot.history.symbol]?.label,
    })),
  };
}

export async function runEtfMomentumBacktest(
  input: RunEtfMomentumBacktestInput = {},
): Promise<BacktestRunResult> {
  if (input.signalExecution === 'next_open') {
    const { runEtfMomentumT1Backtest } = await import('./etf-momentum-t1.js');
    return runEtfMomentumT1Backtest(input);
  }
  const topN = clampPositiveInt(input.topN, DEFAULT_TOP_N, 1, 10);
  const momentumDays = clampPositiveInt(
    input.momentumDays,
    DEFAULT_MOMENTUM_DAYS,
    5,
    120,
  );
  const rebalanceDays = clampPositiveInt(
    input.rebalanceDays,
    DEFAULT_REBALANCE_DAYS,
    1,
    60,
  );
  const trendMaDays = clampPositiveInt(
    input.trendMaDays,
    DEFAULT_TREND_MA_DAYS,
    5,
    120,
  );
  const bearRegimeMaxExposure =
    input.bearRegimeMaxExposure != null && Number.isFinite(input.bearRegimeMaxExposure)
      ? Math.max(0, Math.min(1, input.bearRegimeMaxExposure))
      : BEAR_REGIME_MAX_EXPOSURE;
  const weakRegimeMaxExposure =
    input.weakRegimeMaxExposure === null
      ? undefined
      : input.weakRegimeMaxExposure != null && Number.isFinite(input.weakRegimeMaxExposure)
      ? Math.max(0, Math.min(1, input.weakRegimeMaxExposure))
      : WEAK_REGIME_MAX_EXPOSURE;
  const bullBenchmarkSlotMomentumPct =
    input.bullBenchmarkSlotMomentumPct != null
    && Number.isFinite(input.bullBenchmarkSlotMomentumPct)
      ? Math.max(0, input.bullBenchmarkSlotMomentumPct)
      : BULL_BENCHMARK_SLOT_MOMENTUM_PCT;
  const bullBenchmarkSlotCount = clampPositiveInt(
    input.bullBenchmarkSlotCount,
    BULL_BENCHMARK_SLOT_COUNT,
    0,
    topN,
  );
  const cashFallbackInWeakRegime = input.cashFallbackInWeakRegime === true;
  const exitOnTrendBreak = input.exitOnTrendBreak === true;
  const tPlusEnabled = input.tPlusEnabled === true;
  const tPlusBuyDipPct =
    input.tPlusBuyDipPct != null && Number.isFinite(input.tPlusBuyDipPct)
      ? Math.max(0.1, input.tPlusBuyDipPct)
      : DEFAULT_T_PLUS_BUY_DIP_PCT;
  const tPlusMinProfitPct =
    input.tPlusMinProfitPct != null && Number.isFinite(input.tPlusMinProfitPct)
      ? Math.max(0.1, input.tPlusMinProfitPct)
      : DEFAULT_T_PLUS_MIN_PROFIT_PCT;
  const tPlusBudgetPct =
    input.tPlusBudgetPct != null && Number.isFinite(input.tPlusBudgetPct)
      ? Math.max(0.01, Math.min(1, input.tPlusBudgetPct))
      : DEFAULT_T_PLUS_BUDGET_PCT;
  const tPlusMaxTradesPerDay = clampPositiveInt(
    input.tPlusMaxTradesPerDay,
    DEFAULT_T_PLUS_MAX_TRADES_PER_DAY,
    1,
    10,
  );
  const netRebalance = input.netRebalance === true;
  const initialCapital =
    input.initialCapital != null && Number.isFinite(input.initialCapital)
      ? Math.max(1, input.initialCapital)
      : 100_000;
  const maxPerTheme =
    input.maxPerTheme === null
      ? null
      : input.maxPerTheme == null
      ? DEFAULT_MAX_PER_THEME
      : Math.max(1, Math.floor(input.maxPerTheme));

  const dateRange = resolveBacktestDateRange({
    startDate: input.startDate,
    endDate: input.endDate,
    fallbackCalendarDays: input.days ?? DEFAULT_DAYS,
  });
  const days =
    input.startDate || input.endDate
      ? computeKlineDaysForRange(dateRange, Math.max(momentumDays, trendMaDays) + 10)
      : Math.max(60, Math.floor(input.days ?? DEFAULT_DAYS));

  const histories: EtfHistory[] = [];
  const symbols: BacktestRunResult['symbols'] = [];
  let usedLocalCsv = false;

  for (const item of ETF_POOL_19) {
    try {
      const quoteDays = hasLocalEtfDailyCsv(item.symbol)
        ? LOCAL_ETF_LOAD_ALL_DAYS
        : days;
      if (quoteDays === LOCAL_ETF_LOAD_ALL_DAYS) usedLocalCsv = true;
      const data = await getDailyQuote(item.symbol, quoteDays);
      histories.push(toHistory(item.symbol, item.name, data.quotes));
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

  const benchmarkHistory = histories.find((item) => item.symbol === BENCHMARK_SYMBOL);
  const allDates = [...new Set(histories.flatMap((item) => item.bars.map((bar) => bar.tradeDate)))]
    .filter((date) => isTradeDateInRange(date, dateRange))
    .sort();

  const { trades, equityPoints, portfolioSnapshots, tPlusStats } = simulateDailyPortfolio({
    allDates,
    histories,
    benchmarkHistory,
    topN,
    momentumDays,
    rebalanceDays,
    trendMaDays,
    commissionRate: COMMISSION_RATE,
    slippageRate: SLIPPAGE_RATE,
    volTargetPct: TARGET_ANNUAL_VOL_PCT,
    minVolExposure: MIN_VOL_EXPOSURE,
    maxVolExposure: MAX_VOL_EXPOSURE,
    stopCooldownDays: STOP_COOLDOWN_DAYS,
    bearRegimeMaxExposure,
    weakRegimeMaxExposure,
    bullBenchmarkSlotMomentumPct,
    bullBenchmarkSlotCount,
    cashFallbackInWeakRegime,
    exitOnTrendBreak,
    initialCapital,
    maxPerTheme,
    tPlusEnabled,
    tPlusBuyDipPct,
    tPlusMinProfitPct,
    tPlusBudgetPct,
    tPlusMaxTradesPerDay,
    netRebalance,
  });

  const sortedTrades = trades.sort((a, b) => {
    if (a.entryDate !== b.entryDate) return a.entryDate.localeCompare(b.entryDate);
    return (b.signal.score ?? 0) - (a.signal.score ?? 0);
  });
  const benchmarkCurve = buildBenchmarkCurve(benchmarkHistory, dateRange);

  return {
    strategy: 'etf-momentum-rotation',
    generatedAt: new Date().toISOString(),
    requestedDays: days,
    startDate: formatTradeDateKey(dateRange.startDate),
    endDate: formatTradeDateKey(dateRange.endDate),
    holdDays: [rebalanceDays],
    symbols,
    trades: sortedTrades,
    metrics: summarizeTrades(sortedTrades),
    groups: buildTradeGroups(sortedTrades, [
      { key: 'all', label: '全部轮动', predicate: () => true },
      {
        key: 'positive',
        label: '盈利轮动',
        predicate: (trade) => (trade.returnPct ?? 0) > 0,
      },
      {
        key: 'negative',
        label: '亏损轮动',
        predicate: (trade) => (trade.returnPct ?? 0) < 0,
      },
    ]),
    equityCurve: buildMomentumEquityCurve(equityPoints),
    portfolioSnapshots,
    benchmark:
      benchmarkCurve.length > 0
        ? {
            symbol: '510300',
            name: '沪深300ETF',
            curve: benchmarkCurve,
            finalReturnPct: benchmarkCurve.at(-1)?.returnPct ?? null,
          }
        : undefined,
    symbolSummaries: buildSymbolSummaries(sortedTrades),
    currentDecisions: buildCurrentDecisions({
      histories,
      benchmarkHistory,
      topN,
      momentumDays,
      trendMaDays,
      bullBenchmarkSlotMomentumPct,
      bullBenchmarkSlotCount,
      cashFallbackInWeakRegime,
      maxPerTheme,
    }),
    config: {
      topN,
      momentumDays,
      rebalanceDays,
      trendMaDays,
      maxConcurrentPositions: topN,
      noSymbolOverlap: true,
      newsFilter: 'off',
      rawSignalCount: sortedTrades.length,
      commissionRate: COMMISSION_RATE,
      slippageRate: SLIPPAGE_RATE,
      volTargetPct: TARGET_ANNUAL_VOL_PCT,
      minVolExposure: MIN_VOL_EXPOSURE,
      maxVolExposure: MAX_VOL_EXPOSURE,
      bearRegimeMaxExposure,
      weakRegimeMaxExposure,
      bullBenchmarkSlotMomentumPct,
      bullBenchmarkSlotCount,
      cashFallbackInWeakRegime,
      exitOnTrendBreak,
      tPlusEnabled,
      tPlusBuyDipPct,
      tPlusMinProfitPct,
      tPlusBudgetPct,
      tPlusMaxTradesPerDay,
      tPlusTradeCount: tPlusStats.tradeCount,
      tPlusTotalProfitPct: round(tPlusStats.totalProfit * 100),
      netRebalance,
      stopLossPct: POSITION_STOP_LOSS_PCT,
      stopCooldownDays: STOP_COOLDOWN_DAYS,
      maxPerTheme,
      initialCapital,
    },
    notes: [
      `ETF 动量轮动：默认每 ${rebalanceDays} 个交易日调仓。`,
      `选择 ${momentumDays} 日涨幅最高且站上 MA${trendMaDays} 的前 ${topN} 只 ETF 等权持有。`,
      maxPerTheme != null
        ? `同主题 ETF 最多持有 ${maxPerTheme} 只；多只芯片/半导体 ETF 同时入围时，仅保留动量排名靠前者。`
        : '当前不限制同主题 ETF 数量；高度相关主题可能同时入选。',
      `沪深300 站上 MA${MARKET_REGIME_MA_DAYS} 时，单只 ETF 趋势过滤放宽至 MA${BULL_RELAXED_TREND_MA_DAYS}，减少 V 型反弹踏空。`,
      `动量标的不足 ${topN} 只时，剩余仓位用 ${BENCHMARK_SYMBOL} 基准 ETF 兜底，避免空仓错过大盘反弹。`,
      `单个持仓从入场价下跌至 ${POSITION_STOP_LOSS_PCT}% 时按日线收盘止损；止损后 ${STOP_COOLDOWN_DAYS} 个交易日内不再买回同一 ETF，冷却挡掉的槽位只用基准兜底，不后补弱势动量。`,
      exitOnTrendBreak
        ? `大盘弱市中，若持仓 ETF 收盘跌破入场时使用的趋势均线（MA${BULL_RELAXED_TREND_MA_DAYS} 或 MA${trendMaDays}），提前退出并等待下一次调仓。`
        : '持仓期内不按均线破位提前退出，仅在调仓日、止损或样本结束时平仓。',
      `组合权益按每个交易日持仓市值 + 现金滚动计算，不再仅用调仓点近似。`,
      `交易成本：单边佣金 ${(COMMISSION_RATE * 100).toFixed(2)}%、滑点 ${(SLIPPAGE_RATE * 100).toFixed(2)}%；买卖均计入。`,
      `波动率目标：以沪深300 ${VOL_LOOKBACK_DAYS} 日年化波动率为参考，目标 ${TARGET_ANNUAL_VOL_PCT}%；仅当波动率高于目标时降仓，范围 ${MIN_VOL_EXPOSURE * 100}% ~ ${MAX_VOL_EXPOSURE * 100}%。`,
      `大盘跌破 MA${MARKET_REGIME_MA_DAYS} 且 ${momentumDays} 日动量为负时，组合总仓位上限降至 ${bearRegimeMaxExposure * 100}%。`,
      weakRegimeMaxExposure != null
        ? `大盘跌破 MA${MARKET_REGIME_MA_DAYS} 或 ${momentumDays} 日动量为负时，组合总仓位上限预防性降至 ${weakRegimeMaxExposure * 100}%。`
        : '默认仅在大盘跌破 MA20 且动量为负的确认熊市中强制降仓。',
      bullBenchmarkSlotMomentumPct > 0
        ? `大盘站上 MA${MARKET_REGIME_MA_DAYS} 且 ${momentumDays} 日动量不低于 ${bullBenchmarkSlotMomentumPct}% 时，保留 ${bullBenchmarkSlotCount} 个槽位给 ${BENCHMARK_SYMBOL}，其余槽位继续做 ETF 动量轮动。`
        : '默认不强制保留宽基槽位；基准 ETF 只在动量标的不足或冷却替补时兜底。',
      cashFallbackInWeakRegime
        ? `弱市中动量标的不足或止损冷却释放的槽位不再用 ${BENCHMARK_SYMBOL} 兜底，保留现金等待下一次调仓。`
        : `动量标的不足 ${topN} 只或止损冷却释放槽位时，仍用 ${BENCHMARK_SYMBOL} 基准 ETF 兜底。`,
      tPlusEnabled
        ? `正 T 叠加：持仓 ETF 日内低点较昨收回撤至少 ${tPlusBuyDipPct}% 且收盘较买入触发价反弹至少 ${tPlusMinProfitPct}% 时，用该持仓市值最多 ${tPlusBudgetPct * 100}% 做一次日内成本优化；每日最多 ${tPlusMaxTradesPerDay} 笔，计入佣金和滑点。`
        : '默认不启用做 T 叠加；主策略只做轮动、止损和调仓。',
      netRebalance
        ? '调仓成交：同一 ETF 连续入选时只交易目标份额与当前份额的差额，续持部分不重复计算卖出/买入成本。'
        : '调仓成交：调仓日按旧口径先卖出全部持仓，再按目标组合重新买入。',
      '该策略不使用新闻过滤，避免历史新闻覆盖不足和标题情绪噪声影响回测。',
      '收益曲线为日线组合净值，基准为沪深300ETF同期买入持有收益。',
      usedLocalCsv
        ? '历史回测优先使用本地 ETF 前复权 CSV（含真实成交额）；缺失时退回腾讯前复权日 K。'
        : '历史回测使用腾讯前复权日 K。',
    ],
  };
}

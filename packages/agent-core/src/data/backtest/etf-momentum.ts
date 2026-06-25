import { ETF_POOL_19 } from '../etf/pool.js';
import { getDailyQuote } from '../market/services.js';
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
} from './date-range.js';
import type {
  BacktestCurrentDecision,
  BacktestEquityPoint,
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
};

type MomentumBar = {
  tradeDate: string;
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
const DEFAULT_TOP_N = 3;
const DEFAULT_MOMENTUM_DAYS = 20;
const DEFAULT_REBALANCE_DAYS = 10;
const DEFAULT_TREND_MA_DAYS = 20;
const BENCHMARK_SYMBOL = '510300';
const MARKET_REGIME_MA_DAYS = 20;
const BULL_RELAXED_TREND_MA_DAYS = 10;
const POSITION_STOP_LOSS_PCT = -12;
const COMMISSION_RATE = 0.0003;
const SLIPPAGE_RATE = 0.0005;
const VOL_LOOKBACK_DAYS = 20;
const TARGET_ANNUAL_VOL_PCT = 15;
const MIN_VOL_EXPOSURE = 0.7;
const MAX_VOL_EXPOSURE = 1.0;
const STOP_COOLDOWN_DAYS = 10;
const HIGH_VOL_REBALANCE_DAYS = 12;
const HIGH_VOL_REBALANCE_TRIGGER_PCT = 30;

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
  quotes: Array<{ tradeDate: string; close: number | null }>,
): EtfHistory {
  const bars = quotes
    .filter((bar): bar is { tradeDate: string; close: number } => {
      return bar.close != null && bar.close > 0;
    })
    .map((bar) => ({
      tradeDate: normalizeTradeDateKey(bar.tradeDate),
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

function resolveRebalanceDays(input: {
  annualizedVolPct: number | null;
  benchmarkHistory: EtfHistory | undefined;
  tradeDate: string;
  baseDays: number;
  highVolDays?: number;
  triggerPct?: number;
}): number {
  const highVolDays = input.highVolDays ?? HIGH_VOL_REBALANCE_DAYS;
  const triggerPct = input.triggerPct ?? HIGH_VOL_REBALANCE_TRIGGER_PCT;
  const benchmark = input.benchmarkHistory?.byDate.get(input.tradeDate);
  if (!benchmark || benchmark.index < MARKET_REGIME_MA_DAYS) {
    return input.baseDays;
  }

  const regimeSlice = input.benchmarkHistory!.bars
    .slice(benchmark.index - MARKET_REGIME_MA_DAYS + 1, benchmark.index + 1)
    .map((bar) => bar.close);
  const regimeMa = avg(regimeSlice);
  const bearRegime = regimeMa != null && benchmark.close < regimeMa;
  if (
    bearRegime
    && input.annualizedVolPct != null
    && input.annualizedVolPct >= triggerPct
  ) {
    return highVolDays;
  }

  return input.baseDays;
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

function buyShares(input: {
  cash: number;
  price: number;
  commissionRate: number;
  slippageRate: number;
}): { shares: number; spent: number } | null {
  if (input.cash <= 0 || input.price <= 0) return null;
  const adjustedPrice = input.price * (1 + input.slippageRate);
  const shares = input.cash / (adjustedPrice * (1 + input.commissionRate));
  if (!Number.isFinite(shares) || shares <= 0) return null;
  return { shares, spent: input.cash };
}

function sellProceeds(input: {
  shares: number;
  price: number;
  commissionRate: number;
  slippageRate: number;
}): number {
  if (input.shares <= 0 || input.price <= 0) return 0;
  return (
    input.shares
    * input.price
    * (1 - input.slippageRate)
    * (1 - input.commissionRate)
  );
}

function markPositionValue(position: SimPosition, tradeDate: string): number {
  const bar = position.history.byDate.get(tradeDate);
  if (!bar || position.entryPrice <= 0) return position.grossBasis;
  return position.shares * bar.close;
}

function resolveTargetSlots(input: {
  histories: EtfHistory[];
  benchmarkHistory: EtfHistory | undefined;
  tradeDate: string;
  topN: number;
  momentumDays: number;
  trendMaDays: number;
  excludedSymbols?: Set<string>;
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
  const picks = input.histories
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
    .sort((a, b) => b.score - a.score)
    .slice(0, input.topN);
  const excludedSymbols = input.excludedSymbols ?? new Set<string>();

  const slots: Array<{
    history: EtfHistory;
    pick?: MomentumPick;
    isBenchmarkFill: boolean;
    effectiveTrendMaDays: number;
  }> = [];

  for (let slot = 0; slot < input.topN; slot += 1) {
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
    if (input.benchmarkHistory) {
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
  const exitIndex = input.position.history.byDate.get(input.exitDate)?.index ?? 0;

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
  highVolRebalanceDays: number;
}): {
  trades: BacktestTrade[];
  equityPoints: Array<{ tradeDate: string; equity: number; closedTrades: number }>;
} {
  const trades: BacktestTrade[] = [];
  const equityPoints: Array<{ tradeDate: string; equity: number; closedTrades: number }> = [];
  let cash = 1;
  let positions: SimPosition[] = [];
  let closedTrades = 0;
  let daysSinceRebalance = Number.POSITIVE_INFINITY;
  const cooldownUntil = new Map<string, number>();

  const closeAllPositions = (tradeDate: string, exitReason: BacktestTrade['exitReason']) => {
    for (const position of positions) {
      const bar = position.history.byDate.get(tradeDate);
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

  for (let dateIndex = 0; dateIndex < input.allDates.length; dateIndex += 1) {
    const tradeDate = input.allDates[dateIndex];
    daysSinceRebalance += 1;

    const benchmarkBarForSchedule = input.benchmarkHistory?.byDate.get(tradeDate);
    const scheduleVol = benchmarkBarForSchedule
      ? computeAnnualizedVolPct(input.benchmarkHistory, benchmarkBarForSchedule.index)
      : null;
    const requiredRebalanceDays = resolveRebalanceDays({
      annualizedVolPct: scheduleVol,
      benchmarkHistory: input.benchmarkHistory,
      tradeDate,
      baseDays: input.rebalanceDays,
      highVolDays: input.highVolRebalanceDays,
    });
    const isRebalanceDay = daysSinceRebalance >= requiredRebalanceDays;

    const remainingPositions: SimPosition[] = [];
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

      remainingPositions.push(position);
    }
    positions = remainingPositions;

    if (isRebalanceDay) {
      closeAllPositions(tradeDate, 'fixed_hold');
      daysSinceRebalance = 0;

      const benchmarkBar = benchmarkBarForSchedule;
      const annualizedVol = scheduleVol;
      const exposureScale = resolveVolTargetExposure(
        annualizedVol,
        input.volTargetPct,
        input.minVolExposure,
        input.maxVolExposure,
      );

      const totalEquity = cash;
      const deployable = totalEquity * exposureScale;
      cash = totalEquity - deployable;
      const slotBudget = deployable / input.topN;
      const excludedSymbols = buildStopCooldownExclusions(cooldownUntil, dateIndex);
      const targetSlots = resolveTargetSlots({
        histories: input.histories,
        benchmarkHistory: input.benchmarkHistory,
        tradeDate,
        topN: input.topN,
        momentumDays: input.momentumDays,
        trendMaDays: input.trendMaDays,
        excludedSymbols,
      });
      const plannedExitIndex = Math.min(
        dateIndex + requiredRebalanceDays,
        input.allDates.length - 1,
      );

      for (const slot of targetSlots) {
        const entryBar = slot.history.byDate.get(tradeDate);
        if (!entryBar || slotBudget <= 0) continue;

        const bought = buyShares({
          cash: slotBudget,
          price: entryBar.close,
          commissionRate: input.commissionRate,
          slippageRate: input.slippageRate,
        });
        if (!bought) continue;

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

    const equity = markPortfolioEquity(tradeDate);
    equityPoints.push({ tradeDate, equity, closedTrades });
  }

  const lastDate = input.allDates.at(-1);
  if (lastDate && positions.length > 0) {
    closeAllPositions(lastDate, 'end_of_data');
  }

  return { trades, equityPoints };
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

  const ranked = input.histories
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
  const selected = new Set(ranked.slice(0, input.topN).map((pick) => pick.history.symbol));

  return input.histories
    .map((history) => {
      const current = history.byDate.get(latestDate);
      const pick = ranked.find((item) => item.history.symbol === history.symbol);
      const isSelected = selected.has(history.symbol);
      return {
        symbol: history.symbol,
        name: history.name,
        assetType: 'etf' as const,
        action: isSelected ? ('buy' as const) : ('watch' as const),
        actionLabel: isSelected ? '轮动持有' : '等待轮动',
        price: current?.close ?? 0,
        changePct: pick?.momentumPct ?? 0,
        failCount: pick ? 0 : 1,
        passedRules: pick ? 2 : 0,
        failedRules: pick ? [] : [`未站上 MA${effectiveTrendMaDays} 或动量不足`],
        reason: pick
          ? `${input.momentumDays}日动量 ${pick.momentumPct.toFixed(2)}%，站上 MA${effectiveTrendMaDays}，按排名${isSelected ? '进入前' + input.topN : '未进入前' + input.topN}。`
          : `未满足 MA${effectiveTrendMaDays} 趋势过滤或缺少足够历史数据。`,
        dataSource: 'daily' as const,
      };
    })
    .sort((a, b) => {
      if (a.action !== b.action) return a.action === 'buy' ? -1 : 1;
      return b.changePct - a.changePct;
    });
}

export async function runEtfMomentumBacktest(
  input: RunEtfMomentumBacktestInput = {},
): Promise<BacktestRunResult> {
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

  const { trades, equityPoints } = simulateDailyPortfolio({
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
    highVolRebalanceDays: HIGH_VOL_REBALANCE_DAYS,
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
    holdDays: [rebalanceDays, HIGH_VOL_REBALANCE_DAYS],
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
      stopLossPct: POSITION_STOP_LOSS_PCT,
      stopCooldownDays: STOP_COOLDOWN_DAYS,
      highVolRebalanceDays: HIGH_VOL_REBALANCE_DAYS,
      highVolRebalanceTriggerPct: HIGH_VOL_REBALANCE_TRIGGER_PCT,
    },
    notes: [
      `ETF 动量轮动：默认每 ${rebalanceDays} 个交易日调仓；当沪深300 ${VOL_LOOKBACK_DAYS} 日年化波动率不低于 ${HIGH_VOL_REBALANCE_TRIGGER_PCT}% 且大盘跌破 MA${MARKET_REGIME_MA_DAYS} 时，调仓周期延长至 ${HIGH_VOL_REBALANCE_DAYS} 日。`,
      `选择 ${momentumDays} 日涨幅最高且站上 MA${trendMaDays} 的前 ${topN} 只 ETF 等权持有。`,
      `沪深300 站上 MA${MARKET_REGIME_MA_DAYS} 时，单只 ETF 趋势过滤放宽至 MA${BULL_RELAXED_TREND_MA_DAYS}，减少 V 型反弹踏空。`,
      `动量标的不足 ${topN} 只时，剩余仓位用 ${BENCHMARK_SYMBOL} 基准 ETF 兜底，避免空仓错过大盘反弹。`,
      `单个持仓从入场价下跌至 ${POSITION_STOP_LOSS_PCT}% 时按日线收盘止损；止损后 ${STOP_COOLDOWN_DAYS} 个交易日内不再买回同一 ETF，空位用基准兜底。`,
      `组合权益按每个交易日持仓市值 + 现金滚动计算，不再仅用调仓点近似。`,
      `交易成本：单边佣金 ${(COMMISSION_RATE * 100).toFixed(2)}%、滑点 ${(SLIPPAGE_RATE * 100).toFixed(2)}%；买卖均计入。`,
      `波动率目标：以沪深300 ${VOL_LOOKBACK_DAYS} 日年化波动率为参考，目标 ${TARGET_ANNUAL_VOL_PCT}%；仅当波动率高于目标时降仓，范围 ${MIN_VOL_EXPOSURE * 100}% ~ ${MAX_VOL_EXPOSURE * 100}%。`,
      '该策略不使用新闻过滤，避免历史新闻覆盖不足和标题情绪噪声影响回测。',
      '收益曲线为日线组合净值，基准为沪深300ETF同期买入持有收益。',
      usedLocalCsv
        ? '历史回测优先使用本地 ETF 前复权 CSV（含真实成交额）；缺失时退回腾讯前复权日 K。'
        : '历史回测使用腾讯前复权日 K。',
    ],
  };
}

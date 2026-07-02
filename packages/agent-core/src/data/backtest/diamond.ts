import {
  detectDiamondSignal,
  scanDiamondSignalHistory,
  type DiamondSignalResult,
} from '../market/diamond-signal.js';
import { fetchIntradayQuotes } from '../market/free/intraday-quote.js';
import { getDailyQuote } from '../market/services.js';
import { inferAssetType, isRetailTradableStock } from '../market/asset-type.js';
import {
  hasLocalStockDailyCsv,
  hasLocalEtfDailyCsv,
  getLocalStockName,
  LOCAL_ETF_LOAD_ALL_DAYS,
  listLocalStockDailyCsvSymbols,
  LOCAL_DAILY_LOAD_ALL_DAYS,
} from '../market/local-csv/etf-daily.js';
import { sma, type OhlcvBar } from '../market/indicators.js';
import {
  analyzeMomentum,
  evaluateMomentumExit,
  MOMENTUM_TRAILING_STOP_PCT,
  type MomentumAnalysis,
} from '../paper/momentum.js';
import {
  buildTradeGroups,
  buildPricePath,
  calcMaxDrawdownPct,
  calcReturnPct,
  createFixedHoldTrade,
  findBarIndex,
  summarizeTrades,
} from './engine.js';
import {
  computeKlineDaysForRange,
  formatTradeDateKey,
  isTradeDateInRange,
  normalizeTradeDateKey,
  resolveBacktestDateRange,
  addCalendarDays,
  todayDateKey,
} from './date-range.js';
import { shiftTradeDateLabel } from '../paper/trading-calendar.js';
import {
  buildPortfolioLedger,
  filterTradesByPortfolioRules,
} from './portfolio.js';
import {
  evaluateEtfNewsSentiment,
  filterNewsForTradeDate,
  getStockNewsProfile,
  loadBacktestNewsTimeline,
  shouldBlockEtfEntryByNews,
  type BacktestNewsLoadResult,
  type EtfNewsFilterMode,
} from './etf-news.js';
import type {
  BacktestAssetType,
  BacktestEquityPoint,
  BacktestExitReason,
  BacktestRunResult,
  BacktestSignal,
  BacktestStrategy,
  BacktestTrade,
} from './types.js';

export type BacktestSymbolInput = {
  symbol: string;
  name?: string;
  assetType?: BacktestAssetType;
};

export type RunDiamondBacktestInput = {
  symbols: BacktestSymbolInput[];
  universe?: 'manual' | 'retail-stock';
  strategy?: Extract<BacktestStrategy, 'red-diamond' | 'red-diamond-momentum'>;
  days?: number;
  lookback?: number;
  holdDays?: number[];
  startDate?: string;
  endDate?: string;
  initialCapital?: number;
  maxConcurrentPositions?: number;
  noSymbolOverlap?: boolean;
  newsFilter?: EtfNewsFilterMode;
  newsLookbackDays?: number;
  stockMarketFilter?: 'off' | 'avoid_bearish' | 'require_bullish';
  minBenchmarkMomentum20Pct?: number;
  defensiveBenchmarkMomentum20Pct?: number;
  excludeRiskyStockNames?: boolean;
  minEntryPrice?: number;
  minAvgTurnoverAmount?: number;
  minDelayedEntryDriftPct?: number;
  maxDelayedEntryDriftPct?: number;
  delayedEntryDriftFilterMaxBenchmarkMomentum20Pct?: number;
  maxEntryMa20ExtensionPct?: number;
  maxEntryChecklistScore?: number;
  momentumMaxHoldDays?: number;
  weakMomentumMaxHoldDays?: number;
  weakMomentumMaxHoldBenchmarkMomentum20Pct?: number;
  weakMomentumNoEntryMinBenchmarkMomentum20Pct?: number;
  weakMomentumNoEntryMaxBenchmarkMomentum20Pct?: number;
  stopLossPct?: number;
  takeProfitPct?: number;
};

const DEFAULT_DAYS = 250;
const DEFAULT_HOLD_DAYS = [1, 3, 5, 10, 20];
const MOMENTUM_EXIT_GROUPS: Array<{
  key: string;
  label: string;
  reason: BacktestExitReason;
}> = [
  { key: 'exit-take-profit', label: '止盈保护', reason: 'take_profit' },
  { key: 'exit-stop-loss', label: '止损退出', reason: 'stop_loss' },
  { key: 'exit-ma20-break', label: '跌破 MA20', reason: 'ma20_break' },
  { key: 'exit-trailing-stop', label: '移动止盈', reason: 'trailing_stop' },
  { key: 'exit-signal-weakened', label: '信号减弱', reason: 'signal_weakened' },
  { key: 'exit-signal-lost', label: '信号消失', reason: 'signal_lost' },
  { key: 'exit-max-hold', label: '持有到期', reason: 'max_hold' },
  { key: 'exit-end-of-data', label: '跑到区间结束', reason: 'end_of_data' },
];
const SIGNAL_WARMUP_BARS = 260;
const STOCK_BACKTEST_STOP_LOSS_PCT = 0.08;
const MOMENTUM_TAKE_PROFIT_PCT = 0.2;
const MOMENTUM_MIN_SIGNAL_EXIT_HOLD_DAYS = 5;
const MOMENTUM_SIGNAL_EXIT_CONFIRM_DAYS = 3;
const MOMENTUM_MAX_HOLD_DAYS = 5;
const DEFAULT_MAX_CONCURRENT = 5;
const MAX_ENTRY_MA20_EXTENSION_PCT = 0.12;
const DEFAULT_MIN_ENTRY_PRICE = 0;
const DEFAULT_MIN_AVG_TURNOVER_AMOUNT = 0;
const DEFAULT_DEFENSIVE_BENCHMARK_MOMENTUM20_PCT = 3;
const STOCK_ENTRY_DELAY_TRADING_DAYS = 2;
const DEFAULT_MIN_DELAYED_ENTRY_DRIFT_PCT = -5;
const DEFAULT_MAX_DELAYED_ENTRY_DRIFT_PCT = 3;
const DEFAULT_DELAYED_ENTRY_DRIFT_FILTER_MAX_BENCHMARK_MOMENTUM20_PCT = 3;
const DEFAULT_WEAK_MOMENTUM_MAX_HOLD_DAYS = 4;
const DEFAULT_WEAK_MOMENTUM_MAX_HOLD_BENCHMARK_MOMENTUM20_PCT = 3;
const DEFAULT_WEAK_MOMENTUM_NO_ENTRY_MIN_BENCHMARK_MOMENTUM20_PCT = 0;
const DEFAULT_WEAK_MOMENTUM_NO_ENTRY_MAX_BENCHMARK_MOMENTUM20_PCT = 2;

type StockMarketFilterMode = NonNullable<RunDiamondBacktestInput['stockMarketFilter']>;

type MarketRegimeSnapshot = {
  close: number;
  ma20: number | null;
  ma60: number | null;
  momentum20Pct: number | null;
  momentum60Pct: number | null;
  weak: boolean;
  bearish: boolean;
  bullish: boolean;
  midBullish: boolean;
};

function normalizeHoldDays(holdDays: number[] | undefined): number[] {
  const values = holdDays?.length ? holdDays : DEFAULT_HOLD_DAYS;
  return [...new Set(values.map((value) => Math.max(0, Math.floor(value))))]
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
}

function scopeBarsToDateRange(
  bars: OhlcvBar[],
  dateRange: { startDate: string; endDate: string },
): { bars: OhlcvBar[]; signalLookback: number } {
  const endIndex = bars.findIndex(
    (bar) => bar.tradeDate.replace(/-/g, '') <= dateRange.endDate,
  );
  if (endIndex < 0) return { bars: [], signalLookback: 0 };

  const fromEnd = bars.slice(endIndex);
  const firstBeforeStart = fromEnd.findIndex(
    (bar) => bar.tradeDate.replace(/-/g, '') < dateRange.startDate,
  );
  const signalLookback = firstBeforeStart < 0 ? fromEnd.length : firstBeforeStart;
  const sliceEnd =
    firstBeforeStart < 0
      ? fromEnd.length
      : Math.min(fromEnd.length, firstBeforeStart + SIGNAL_WARMUP_BARS);

  return {
    bars: fromEnd.slice(0, sliceEnd),
    signalLookback,
  };
}

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function buildBenchmarkCurve(
  bars: Array<{ tradeDate: string; close: number | null }>,
  dateRange: { startDate: string; endDate: string },
): BacktestEquityPoint[] {
  const inRange = bars
    .filter(
      (bar): bar is { tradeDate: string; close: number } =>
        bar.close != null && bar.close > 0 && isTradeDateInRange(bar.tradeDate, dateRange),
    )
    .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  const startClose = inRange[0]?.close;
  if (!startClose || startClose <= 0) return [];

  return inRange.map((bar) => {
    const returnPct = round(((bar.close - startClose) / startClose) * 100);
    return {
      tradeDate: bar.tradeDate,
      equity: round(100 + returnPct, 4),
      returnPct,
      closedTrades: 0,
    };
  });
}

async function buildStockBenchmark(
  dateRange: { startDate: string; endDate: string },
  days: number,
): Promise<BacktestRunResult['benchmark'] | undefined> {
  const quoteDays = hasLocalEtfDailyCsv('510300')
    ? LOCAL_ETF_LOAD_ALL_DAYS
    : Math.max(days, computeKlineDaysForRange(dateRange, 10));
  const data = await getDailyQuote('510300', quoteDays);
  const curve = buildBenchmarkCurve(data.quotes, dateRange);
  if (curve.length === 0) return undefined;

  return {
    symbol: '510300',
    name: '沪深300ETF',
    curve,
    finalReturnPct: curve.at(-1)?.returnPct ?? null,
  };
}

async function buildStockMarketRegimeMap(
  dateRange: { startDate: string; endDate: string },
  days: number,
): Promise<Map<string, MarketRegimeSnapshot>> {
  const quoteDays = hasLocalEtfDailyCsv('510300')
    ? LOCAL_ETF_LOAD_ALL_DAYS
    : Math.max(days, computeKlineDaysForRange(dateRange, 40));
  const data = await getDailyQuote('510300', quoteDays);
  const bars = data.quotes
    .filter((bar) => bar.close != null && bar.close > 0)
    .sort((a, b) => normalizeTradeDateKey(b.tradeDate).localeCompare(normalizeTradeDateKey(a.tradeDate)));
  const map = new Map<string, MarketRegimeSnapshot>();

  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index];
    const close = bar.close as number;
    const window = bars.slice(index, index + 20);
    const ma20 = sma(
      window
        .map((item) => item.close)
        .filter((value): value is number => value != null && value > 0),
      20,
    );
    const ma60 = sma(
      bars
        .slice(index, index + 60)
        .map((item) => item.close)
        .filter((value): value is number => value != null && value > 0),
      60,
    );
    const prior = bars[index + 20]?.close;
    const prior60 = bars[index + 60]?.close;
    const momentum20Pct =
      prior != null && prior > 0
        ? round(((close - prior) / prior) * 100)
        : null;
    const momentum60Pct =
      prior60 != null && prior60 > 0
        ? round(((close - prior60) / prior60) * 100)
        : null;
    const belowMa20 = ma20 != null && close < ma20;
    const negativeMomentum = momentum20Pct != null && momentum20Pct < 0;
    const bearish = belowMa20 && negativeMomentum;
    const bullish = ma20 != null && close >= ma20 && momentum20Pct != null && momentum20Pct >= 0;
    const midBullish =
      ma60 != null &&
      close >= ma60 &&
      momentum60Pct != null &&
      momentum60Pct >= 0;

    map.set(normalizeTradeDateKey(bar.tradeDate), {
      close,
      ma20,
      ma60,
      momentum20Pct,
      momentum60Pct,
      weak: belowMa20 || negativeMomentum,
      bearish,
      bullish,
      midBullish,
    });
  }

  return map;
}

function evaluateStockMarketGate(input: {
  tradeDate: string;
  mode: StockMarketFilterMode;
  minBenchmarkMomentum20Pct: number;
  defensiveBenchmarkMomentum20Pct: number;
  regimes: Map<string, MarketRegimeSnapshot>;
}): { blocked: boolean; reason: string; regime?: MarketRegimeSnapshot } {
  if (input.mode === 'off') return { blocked: false, reason: '大盘过滤关闭' };

  const regime = input.regimes.get(normalizeTradeDateKey(input.tradeDate));
  if (!regime) return { blocked: false, reason: '缺少大盘状态，放行' };

  if (input.mode === 'avoid_bearish') {
    if (regime.bearish) {
      return {
        blocked: true,
        reason: `沪深300弱熊：收盘低于 MA20 且 20 日动量 ${regime.momentum20Pct ?? 0}%`,
        regime,
      };
    }
    return { blocked: false, reason: '大盘未触发弱熊过滤', regime };
  }

  const minMomentum = input.minBenchmarkMomentum20Pct;
  const momentum = regime.momentum20Pct;
  if (!regime.bullish || momentum == null || momentum < minMomentum) {
    return {
      blocked: true,
      reason: `沪深300未满足强势条件：MA20 ${regime.ma20 ?? '-'}，20 日动量 ${momentum ?? '-'}%，最低要求 ${minMomentum}%`,
      regime,
    };
  }
  const defensiveMomentum = input.defensiveBenchmarkMomentum20Pct;
  if (
    defensiveMomentum > 0 &&
    !regime.midBullish &&
    momentum < defensiveMomentum
  ) {
    return {
      blocked: true,
      reason: `沪深300中期趋势未确认，20 日动量 ${momentum}% 低于防守阈值 ${defensiveMomentum}%`,
      regime,
    };
  }
  return { blocked: false, reason: '大盘强势确认', regime };
}

function toSignal(
  diamond: DiamondSignalResult,
  input: BacktestSymbolInput,
  strategy: BacktestStrategy,
  metadata?: Record<string, unknown>,
): BacktestSignal {
  return {
    symbol: diamond.symbol,
    name: diamond.name || input.name || diamond.symbol,
    assetType: input.assetType ?? inferAssetType(diamond.symbol),
    strategy,
    tradeDate: diamond.tradeDate,
    entryPrice: diamond.close,
    score: diamond.score,
    metadata: {
      strength: diamond.strength,
      reasons: diamond.reasons,
      volumeRatio: diamond.volumeRatio,
      macdGoldenCross: diamond.macdGoldenCross,
      breakout: diamond.breakout,
      ...metadata,
    },
  };
}

async function enrichTradeNames(
  trades: BacktestTrade[],
  options: { refreshExisting?: boolean } = {},
): Promise<BacktestTrade[]> {
  const missingNameSymbols = [
    ...new Set(
      trades
        .filter(
          (trade) =>
            options.refreshExisting || !trade.name || trade.name === trade.symbol,
        )
        .map((trade) => trade.symbol),
    ),
  ];
  if (missingNameSymbols.length === 0) return trades;

  const quotes = await fetchIntradayQuotes(missingNameSymbols).catch(() => new Map());

  return trades.map((trade) => {
    const apiName = quotes.get(trade.symbol)?.name?.trim();
    const localName = getLocalStockName(trade.symbol);
    const name = apiName || localName;
    if (!name || (!options.refreshExisting && name === trade.symbol)) return trade;
    if (!options.refreshExisting && trade.name && trade.name !== trade.symbol) return trade;
    return {
      ...trade,
      name,
      signal: trade.signal
        ? {
            ...trade.signal,
            name,
          }
        : trade.signal,
    };
  });
}

function ma20At(bars: OhlcvBar[]): number | null {
  const closes = bars
    .map((bar) => bar.close)
    .filter((value): value is number => value != null);
  return sma(closes, 20);
}

function ma5At(bars: OhlcvBar[]): number | null {
  const closes = bars
    .map((bar) => bar.close)
    .filter((value): value is number => value != null);
  return sma(closes, 5);
}

function isRiskyStockName(name: string | null | undefined): boolean {
  if (!name) return false;
  const normalized = name
    .normalize('NFKC')
    .trim()
    .toUpperCase()
    .replace(/[\s.*＊·]+/g, '');
  return normalized.includes('ST') || /退|风险警示/.test(normalized);
}

function tradeHasRiskyStockName(trade: BacktestTrade): boolean {
  return isRiskyStockName(trade.name) || isRiskyStockName(trade.signal.name);
}

function isWeakMomentumNoEntryBand(input: {
  momentum20Pct: number | null | undefined;
  minPct: number | undefined;
  maxPct: number | undefined;
}): boolean {
  if (
    input.momentum20Pct == null ||
    input.minPct == null ||
    input.maxPct == null ||
    input.minPct > input.maxPct
  ) {
    return false;
  }
  return input.momentum20Pct >= input.minPct && input.momentum20Pct <= input.maxPct;
}

function avgTurnoverAmountAt(
  bars: OhlcvBar[],
  entryIndex: number,
  days = 5,
): number | null {
  const values = bars
    .slice(entryIndex, entryIndex + days)
    .map((bar) => bar.amount)
    .filter((value): value is number => value != null && value > 0);
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function evaluateStockQualityGate(input: {
  name: string;
  diamond: DiamondSignalResult;
  bars: OhlcvBar[];
  excludeRiskyStockNames: boolean;
  minEntryPrice: number;
  minAvgTurnoverAmount: number;
}): {
  blocked: boolean;
  reason: string;
  avgTurnoverAmount?: number | null;
} {
  if (input.excludeRiskyStockNames && isRiskyStockName(input.name)) {
    return { blocked: true, reason: `风险名称过滤：${input.name}` };
  }

  if (input.minEntryPrice > 0 && input.diamond.close < input.minEntryPrice) {
    return {
      blocked: true,
      reason: `入场价 ${input.diamond.close} 低于 ${input.minEntryPrice}`,
    };
  }

  if (input.minAvgTurnoverAmount > 0) {
    const entryIndex = findBarIndex(input.bars, input.diamond.tradeDate);
    const avgAmount =
      entryIndex >= 0 ? avgTurnoverAmountAt(input.bars, entryIndex, 5) : null;
    if (avgAmount != null && avgAmount < input.minAvgTurnoverAmount) {
      return {
        blocked: true,
        reason: `近5日平均成交额 ${Math.round(avgAmount)} 低于 ${Math.round(input.minAvgTurnoverAmount)}`,
        avgTurnoverAmount: avgAmount,
      };
    }
    return { blocked: false, reason: '质量过滤通过', avgTurnoverAmount: avgAmount };
  }

  return { blocked: false, reason: '质量过滤通过' };
}

function resolveDelayedEntrySignal(input: {
  sourceDiamond: DiamondSignalResult;
  bars: OhlcvBar[];
  delayTradingDays: number;
}): {
  entryTradeDate: string;
  entryClose: number;
  sourceTradeDate: string;
  sourceClose: number;
  delayTradingDays: number;
} | null {
  const sourceIndex = findBarIndex(input.bars, input.sourceDiamond.tradeDate);
  if (sourceIndex < 0) return null;

  const delayTradingDays = Math.max(0, Math.floor(input.delayTradingDays));
  const entryIndex = sourceIndex - delayTradingDays;
  if (entryIndex < 0) return null;

  const entryBar = input.bars[entryIndex];
  if (!entryBar?.close || entryBar.close <= 0) return null;

  return {
    entryTradeDate: entryBar.tradeDate,
    entryClose: entryBar.close,
    sourceTradeDate: input.sourceDiamond.tradeDate,
    sourceClose: input.sourceDiamond.close,
    delayTradingDays,
  };
}

function calcDelayedEntryDriftPct(input: {
  sourceClose: number;
  entryClose: number;
}): number | null {
  if (input.sourceClose <= 0 || input.entryClose <= 0) return null;
  return round(((input.entryClose - input.sourceClose) / input.sourceClose) * 100);
}

function mapMomentumExitReason(reason: string): BacktestExitReason {
  if (reason.includes('硬止损')) return 'stop_loss';
  if (reason.includes('止盈保护')) return 'take_profit';
  if (reason.includes('跌破 MA20')) return 'ma20_break';
  if (reason.includes('移动止盈')) return 'trailing_stop';
  if (reason.includes('持有上限')) return 'max_hold';
  if (reason.includes('仅余蓝钻')) return 'signal_weakened';
  return 'signal_lost';
}

function evaluateBacktestMomentumExit(input: {
  avgCost: number;
  close: number;
  ma5: number | null;
  ma20: number | null;
  highWaterMark: number | null;
  diamondStrength: 'red' | 'blue' | null;
  holdDays: number;
  weakSignalDays: number;
  stopLossPct: number;
  takeProfitPct: number;
  maxHoldDays: number;
}): { reason: string } | null {
  if (input.avgCost > 0) {
    const lossPct = (input.close - input.avgCost) / input.avgCost;
    if (lossPct <= -input.stopLossPct) {
      return { reason: `硬止损（${(lossPct * 100).toFixed(1)}%）` };
    }

    const gainPct = (input.close - input.avgCost) / input.avgCost;
    if (gainPct >= input.takeProfitPct) {
      return { reason: `止盈保护（${(gainPct * 100).toFixed(1)}%）` };
    }
  }

  if (input.holdDays < input.maxHoldDays) return null;

  const baseExit = evaluateMomentumExit({
    avgCost: input.avgCost,
    close: input.close,
    ma20: input.ma20,
    highWaterMark: input.highWaterMark,
    diamondStrength: input.diamondStrength,
  });
  if (!baseExit) return null;

  const isSignalExit =
    baseExit.reason.includes('动量信号消失') ||
    baseExit.reason.includes('仅余蓝钻');
  if (!isSignalExit) return baseExit;

  if (
    input.holdDays >= MOMENTUM_MIN_SIGNAL_EXIT_HOLD_DAYS &&
    input.weakSignalDays >= MOMENTUM_SIGNAL_EXIT_CONFIRM_DAYS &&
    input.ma5 != null &&
    input.close < input.ma5
  ) {
    return baseExit;
  }

  return null;
}

function createMomentumExitTrade(
  signal: BacktestSignal,
  bars: OhlcvBar[],
  options: {
    stopLossPct: number;
    takeProfitPct: number;
    maxHoldDays: number;
  },
): BacktestTrade | null {
  const entryIndex = findBarIndex(bars, signal.tradeDate);
  if (entryIndex < 0) return null;

  let highWaterMark = signal.entryPrice;
  let weakSignalDays = 0;
  for (let index = entryIndex - 1; index >= 0; index -= 1) {
    const bar = bars[index];
    if (!bar?.close) continue;

    const holdDays = entryIndex - index;
    highWaterMark = Math.max(highWaterMark, bar.close);
    const slice = bars.slice(index);
    const currentDiamond = detectDiamondSignal(
      signal.symbol,
      signal.name,
      slice,
    );
    weakSignalDays =
      currentDiamond?.strength === 'red' ? 0 : weakSignalDays + 1;

    const exit = evaluateBacktestMomentumExit({
      avgCost: signal.entryPrice,
      close: bar.close,
      ma5: ma5At(slice),
      ma20: ma20At(slice),
      highWaterMark,
      diamondStrength: currentDiamond?.strength ?? null,
      holdDays,
      weakSignalDays,
      stopLossPct: options.stopLossPct,
      takeProfitPct: options.takeProfitPct,
      maxHoldDays: options.maxHoldDays,
    });

    const maxHoldExit =
      holdDays >= options.maxHoldDays
        ? { reason: `达到持有上限（${options.maxHoldDays} 日）` }
        : null;
    const effectiveExit = exit ?? maxHoldExit;
    if (!effectiveExit) continue;

    return {
      symbol: signal.symbol,
      name: signal.name,
      assetType: signal.assetType,
      strategy: signal.strategy,
      entryDate: signal.tradeDate,
      entryPrice: signal.entryPrice,
      exitDate: bar.tradeDate,
      exitPrice: bar.close,
      holdDays,
      returnPct: calcReturnPct(signal.entryPrice, bar.close),
      exitReason: mapMomentumExitReason(effectiveExit.reason),
      signal: {
        ...signal,
        metadata: {
          ...signal.metadata,
          exitMemo: effectiveExit.reason,
          pricePath: buildPricePath(bars, signal.tradeDate, bar.tradeDate),
        },
      },
    };
  }

  const latest = bars[0];
  if (!latest?.close) return null;

  return {
    symbol: signal.symbol,
    name: signal.name,
    assetType: signal.assetType,
    strategy: signal.strategy,
    entryDate: signal.tradeDate,
    entryPrice: signal.entryPrice,
    exitDate: latest.tradeDate,
    exitPrice: latest.close,
    holdDays: Math.max(0, entryIndex),
    returnPct: calcReturnPct(signal.entryPrice, latest.close),
    exitReason: 'end_of_data',
    signal: {
      ...signal,
      metadata: {
        ...signal.metadata,
        pricePath: buildPricePath(bars, signal.tradeDate, latest.tradeDate),
      },
    },
  };
}

function evaluateMomentumBuy(
  symbol: BacktestSymbolInput,
  diamond: DiamondSignalResult,
  bars: OhlcvBar[],
  tradeDate = diamond.tradeDate,
  maxMa20ExtensionPct = MAX_ENTRY_MA20_EXTENSION_PCT,
): {
  passed: boolean;
  analysis: MomentumAnalysis | null;
  ma20ExtensionPct: number | null;
} {
  const entryIndex = findBarIndex(bars, tradeDate);
  if (entryIndex < 0) {
    return { passed: false, analysis: null, ma20ExtensionPct: null };
  }

  const analysis = analyzeMomentum(
    symbol.symbol,
    symbol.name ?? diamond.name,
    bars.slice(entryIndex),
    diamond,
  );
  let ma20ExtensionPct: number | null = null;
  if (analysis?.ma20 != null && analysis.ma20 > 0) {
    ma20ExtensionPct = (analysis.close - analysis.ma20) / analysis.ma20;
    if (ma20ExtensionPct > maxMa20ExtensionPct) {
      return { passed: false, analysis, ma20ExtensionPct };
    }
  }
  return {
    passed: analysis?.action === 'buy',
    analysis,
    ma20ExtensionPct,
  };
}

export async function runDiamondBacktest(
  input: RunDiamondBacktestInput,
): Promise<BacktestRunResult> {
  const strategy = input.strategy ?? 'red-diamond';
  const dateRange = resolveBacktestDateRange({
    startDate: input.startDate,
    endDate: input.endDate,
    fallbackCalendarDays: input.days,
  });
  const days =
    input.startDate || input.endDate
      ? computeKlineDaysForRange(dateRange, 80)
      : Math.max(60, Math.floor(input.days ?? DEFAULT_DAYS));
  const lookback = Math.max(1, Math.floor(input.lookback ?? days));
  const holdDays = strategy === 'red-diamond'
    ? normalizeHoldDays(input.holdDays)
    : [];
  const trades: BacktestTrade[] = [];
  const symbols: BacktestRunResult['symbols'] = [];
  const universe = input.universe ?? 'manual';
  const universeSymbols: BacktestSymbolInput[] =
    universe === 'retail-stock'
      ? listLocalStockDailyCsvSymbols()
          .filter(isRetailTradableStock)
          .map((symbol) => ({ symbol, name: getLocalStockName(symbol) ?? symbol }))
      : input.symbols;
  const benchmark = await buildStockBenchmark(dateRange, days).catch(() => undefined);
  const fullHistoryThreshold = addCalendarDays(todayDateKey(), -900);
  const needsFullLocalHistory = dateRange.endDate < fullHistoryThreshold;
  const initialCapital =
    input.initialCapital != null && Number.isFinite(input.initialCapital)
      ? Math.max(1, input.initialCapital)
      : 100_000;
  const maxConcurrentPositions = Math.max(
    1,
    Math.floor(input.maxConcurrentPositions ?? DEFAULT_MAX_CONCURRENT),
  );
  const noSymbolOverlap = input.noSymbolOverlap !== false;
  const newsFilter: EtfNewsFilterMode = input.newsFilter ?? 'off';
  const newsLookbackDays = Math.max(
    1,
    Math.floor(input.newsLookbackDays ?? 3),
  );
  const stockMarketFilter: StockMarketFilterMode =
    input.stockMarketFilter ??
    (strategy === 'red-diamond-momentum' ? 'require_bullish' : 'off');
  const minBenchmarkMomentum20Pct =
    input.minBenchmarkMomentum20Pct != null &&
    Number.isFinite(input.minBenchmarkMomentum20Pct)
      ? Math.max(0, input.minBenchmarkMomentum20Pct)
      : 0;
  const defensiveBenchmarkMomentum20Pct =
    input.defensiveBenchmarkMomentum20Pct != null &&
    Number.isFinite(input.defensiveBenchmarkMomentum20Pct)
      ? Math.max(0, input.defensiveBenchmarkMomentum20Pct)
      : strategy === 'red-diamond-momentum' &&
          stockMarketFilter === 'require_bullish'
        ? DEFAULT_DEFENSIVE_BENCHMARK_MOMENTUM20_PCT
        : 0;
  const stopLossPct =
    input.stopLossPct != null && Number.isFinite(input.stopLossPct)
      ? Math.min(0.5, Math.max(0.01, input.stopLossPct))
      : STOCK_BACKTEST_STOP_LOSS_PCT;
  const takeProfitPct =
    input.takeProfitPct != null && Number.isFinite(input.takeProfitPct)
      ? Math.min(1, Math.max(0.01, input.takeProfitPct))
      : MOMENTUM_TAKE_PROFIT_PCT;
  const excludeRiskyStockNames =
    input.excludeRiskyStockNames ?? strategy === 'red-diamond-momentum';
  const minEntryPrice =
    input.minEntryPrice != null && Number.isFinite(input.minEntryPrice)
      ? Math.max(0, input.minEntryPrice)
      : strategy === 'red-diamond-momentum'
        ? DEFAULT_MIN_ENTRY_PRICE
        : 0;
  const minAvgTurnoverAmount =
    input.minAvgTurnoverAmount != null && Number.isFinite(input.minAvgTurnoverAmount)
      ? Math.max(0, input.minAvgTurnoverAmount)
      : strategy === 'red-diamond-momentum'
        ? DEFAULT_MIN_AVG_TURNOVER_AMOUNT
        : 0;
  const minDelayedEntryDriftPct =
    input.minDelayedEntryDriftPct != null && Number.isFinite(input.minDelayedEntryDriftPct)
      ? input.minDelayedEntryDriftPct
      : strategy === 'red-diamond-momentum'
        ? DEFAULT_MIN_DELAYED_ENTRY_DRIFT_PCT
        : undefined;
  const maxDelayedEntryDriftPct =
    input.maxDelayedEntryDriftPct != null && Number.isFinite(input.maxDelayedEntryDriftPct)
      ? input.maxDelayedEntryDriftPct
      : strategy === 'red-diamond-momentum'
        ? DEFAULT_MAX_DELAYED_ENTRY_DRIFT_PCT
        : undefined;
  const delayedEntryDriftFilterMaxBenchmarkMomentum20Pct =
    input.delayedEntryDriftFilterMaxBenchmarkMomentum20Pct != null &&
    Number.isFinite(input.delayedEntryDriftFilterMaxBenchmarkMomentum20Pct)
      ? input.delayedEntryDriftFilterMaxBenchmarkMomentum20Pct
      : strategy === 'red-diamond-momentum'
        ? DEFAULT_DELAYED_ENTRY_DRIFT_FILTER_MAX_BENCHMARK_MOMENTUM20_PCT
        : undefined;
  const maxEntryMa20ExtensionPct =
    input.maxEntryMa20ExtensionPct != null && Number.isFinite(input.maxEntryMa20ExtensionPct)
      ? Math.max(0, input.maxEntryMa20ExtensionPct)
      : MAX_ENTRY_MA20_EXTENSION_PCT;
  const maxEntryChecklistScore =
    input.maxEntryChecklistScore != null && Number.isFinite(input.maxEntryChecklistScore)
      ? Math.max(0, Math.floor(input.maxEntryChecklistScore))
      : undefined;
  const momentumMaxHoldDays =
    input.momentumMaxHoldDays != null && Number.isFinite(input.momentumMaxHoldDays)
      ? Math.max(1, Math.floor(input.momentumMaxHoldDays))
      : MOMENTUM_MAX_HOLD_DAYS;
  const weakMomentumMaxHoldDays =
    input.weakMomentumMaxHoldDays != null && Number.isFinite(input.weakMomentumMaxHoldDays)
      ? Math.max(1, Math.floor(input.weakMomentumMaxHoldDays))
      : strategy === 'red-diamond-momentum'
        ? DEFAULT_WEAK_MOMENTUM_MAX_HOLD_DAYS
        : undefined;
  const weakMomentumMaxHoldBenchmarkMomentum20Pct =
    input.weakMomentumMaxHoldBenchmarkMomentum20Pct != null &&
    Number.isFinite(input.weakMomentumMaxHoldBenchmarkMomentum20Pct)
      ? input.weakMomentumMaxHoldBenchmarkMomentum20Pct
      : strategy === 'red-diamond-momentum'
        ? DEFAULT_WEAK_MOMENTUM_MAX_HOLD_BENCHMARK_MOMENTUM20_PCT
        : undefined;
  const weakMomentumNoEntryMinBenchmarkMomentum20Pct =
    input.weakMomentumNoEntryMinBenchmarkMomentum20Pct != null &&
    Number.isFinite(input.weakMomentumNoEntryMinBenchmarkMomentum20Pct)
      ? input.weakMomentumNoEntryMinBenchmarkMomentum20Pct
      : strategy === 'red-diamond-momentum'
        ? DEFAULT_WEAK_MOMENTUM_NO_ENTRY_MIN_BENCHMARK_MOMENTUM20_PCT
        : undefined;
  const weakMomentumNoEntryMaxBenchmarkMomentum20Pct =
    input.weakMomentumNoEntryMaxBenchmarkMomentum20Pct != null &&
    Number.isFinite(input.weakMomentumNoEntryMaxBenchmarkMomentum20Pct)
      ? input.weakMomentumNoEntryMaxBenchmarkMomentum20Pct
      : strategy === 'red-diamond-momentum'
        ? DEFAULT_WEAK_MOMENTUM_NO_ENTRY_MAX_BENCHMARK_MOMENTUM20_PCT
        : undefined;
  const newsTimeline: BacktestNewsLoadResult =
    newsFilter === 'off'
      ? { news: [], sources: [] as string[] }
      : await loadBacktestNewsTimeline({
          startDate: dateRange.startDate,
          endDate: dateRange.endDate,
        }).catch(() => ({
          news: [],
          sources: [] as string[],
          warning: '新闻加载失败，已跳过',
        }));
  const marketRegimes =
    stockMarketFilter === 'off'
      ? new Map<string, MarketRegimeSnapshot>()
      : await buildStockMarketRegimeMap(dateRange, days).catch(() => new Map());
  let rawSignalCount = 0;
  let newsBlockedCount = 0;
  let marketBlockedCount = 0;
  let qualityBlockedCount = 0;
  let delayedEntrySkippedCount = 0;
  let delayedEntryDriftBlockedCount = 0;
  let entryMa20ExtensionBlockedCount = 0;
  let entryChecklistBlockedCount = 0;
  let weakMomentumNoEntryBlockedCount = 0;
  let enrichedRiskNameBlockedCount = 0;

  for (const symbol of universeSymbols) {
    const code = symbol.symbol.trim();
    const displayName = symbol.name ?? getLocalStockName(code) ?? code;
    if (!/^\d{6}$/.test(code)) {
      symbols.push({
        symbol: code,
        name: displayName,
        assetType: symbol.assetType ?? 'stock',
        error: '证券代码必须为 6 位数字',
      });
      continue;
    }

    if (universe === 'manual' && !isRetailTradableStock(code)) {
      symbols.push({
        symbol: code,
        name: displayName,
        assetType: 'stock',
        error: '已排除科创板或非普通 A 股股票',
      });
      continue;
    }

    try {
      const useLocalStockCsv = hasLocalStockDailyCsv(code);
      const useFullLocalHistory =
        useLocalStockCsv && (universe === 'manual' || needsFullLocalHistory);
      const quoteDays = useFullLocalHistory ? LOCAL_DAILY_LOAD_ALL_DAYS : days;
      const data = await getDailyQuote(code, quoteDays);
      const name = displayName;
      const rawBars = data.quotes.filter((bar) => bar.close != null && bar.close > 0);
      const scoped = scopeBarsToDateRange(rawBars, dateRange);
      const bars = scoped.bars;
      const symbolLookback = input.lookback
        ? Math.min(bars.length, lookback)
        : Math.min(bars.length, scoped.signalLookback);
      if (bars.length === 0 || symbolLookback <= 0) {
        continue;
      }
      const signals = scanDiamondSignalHistory(code, name, bars, symbolLookback)
        .filter((signal) => signal.strength === 'red')
        .filter((signal) => isTradeDateInRange(signal.tradeDate, dateRange))
        .reverse();

      if (universe === 'manual') {
        symbols.push({
          symbol: code,
          name,
          assetType: symbol.assetType ?? inferAssetType(code),
        });
      }

      for (const diamond of signals) {
        rawSignalCount += 1;

        if (strategy === 'red-diamond-momentum') {
          const delayedEntry = resolveDelayedEntrySignal({
            sourceDiamond: diamond,
            bars,
            delayTradingDays: STOCK_ENTRY_DELAY_TRADING_DAYS,
          });
          if (!delayedEntry) {
            delayedEntrySkippedCount += 1;
            continue;
          }

          const entryDiamond = {
            ...diamond,
            tradeDate: delayedEntry.entryTradeDate,
            close: delayedEntry.entryClose,
          };
          const momentumBuy = evaluateMomentumBuy(
            { ...symbol, symbol: code, name },
            diamond,
            bars,
            delayedEntry.entryTradeDate,
            maxEntryMa20ExtensionPct,
          );
          if (!momentumBuy.passed) {
            if (
              momentumBuy.ma20ExtensionPct != null &&
              momentumBuy.ma20ExtensionPct > maxEntryMa20ExtensionPct
            ) {
              entryMa20ExtensionBlockedCount += 1;
            }
            continue;
          }
          const delayedEntryDriftPct = calcDelayedEntryDriftPct({
            sourceClose: delayedEntry.sourceClose,
            entryClose: delayedEntry.entryClose,
          });
          if (
            maxEntryChecklistScore != null &&
            (momentumBuy.analysis?.checklistScore ?? 0) > maxEntryChecklistScore
          ) {
            entryChecklistBlockedCount += 1;
            continue;
          }

          const qualityGate = evaluateStockQualityGate({
            name,
            diamond: entryDiamond,
            bars,
            excludeRiskyStockNames,
            minEntryPrice,
            minAvgTurnoverAmount,
          });
          if (qualityGate.blocked) {
            qualityBlockedCount += 1;
            continue;
          }

          const marketGate = evaluateStockMarketGate({
            tradeDate: entryDiamond.tradeDate,
            mode: stockMarketFilter,
            minBenchmarkMomentum20Pct,
            defensiveBenchmarkMomentum20Pct,
            regimes: marketRegimes,
          });
          if (marketGate.blocked) {
            marketBlockedCount += 1;
            continue;
          }
          const effectiveMaxHoldDays =
            weakMomentumMaxHoldDays != null &&
            weakMomentumMaxHoldBenchmarkMomentum20Pct != null &&
            marketGate.regime?.momentum20Pct != null &&
            marketGate.regime.momentum20Pct <=
              weakMomentumMaxHoldBenchmarkMomentum20Pct
              ? weakMomentumMaxHoldDays
              : momentumMaxHoldDays;
          const applyDelayedEntryDriftFilter =
            minDelayedEntryDriftPct != null || maxDelayedEntryDriftPct != null
              ? delayedEntryDriftFilterMaxBenchmarkMomentum20Pct == null ||
                marketGate.regime?.momentum20Pct == null ||
                marketGate.regime.momentum20Pct <=
                  delayedEntryDriftFilterMaxBenchmarkMomentum20Pct
              : false;
          if (
            applyDelayedEntryDriftFilter &&
            delayedEntryDriftPct != null &&
            minDelayedEntryDriftPct != null &&
            delayedEntryDriftPct < minDelayedEntryDriftPct
          ) {
            delayedEntryDriftBlockedCount += 1;
            continue;
          }
          if (
            applyDelayedEntryDriftFilter &&
            delayedEntryDriftPct != null &&
            maxDelayedEntryDriftPct != null &&
            delayedEntryDriftPct > maxDelayedEntryDriftPct
          ) {
            delayedEntryDriftBlockedCount += 1;
            continue;
          }

          const newsProfile = getStockNewsProfile(code, name);
          const entryNews = filterNewsForTradeDate({
            news: newsTimeline.news,
            tradeDate: entryDiamond.tradeDate,
            lookbackDays: newsLookbackDays,
          });
          const newsSentiment = evaluateEtfNewsSentiment({
            profile: newsProfile,
            news: entryNews,
          });
          const newsGate = shouldBlockEtfEntryByNews(newsSentiment, newsFilter);
          if (newsGate.blocked) {
            newsBlockedCount += 1;
            continue;
          }

          const signal = toSignal(
            entryDiamond,
            { ...symbol, symbol: code, name },
            strategy,
            {
              sourceSignalDate: delayedEntry.sourceTradeDate,
              sourceSignalPrice: delayedEntry.sourceClose,
              entryDelayTradingDays: delayedEntry.delayTradingDays,
              delayedEntryDriftPct,
              entryChecklistScore: momentumBuy.analysis?.checklistScore,
              entryVolumeRatio: momentumBuy.analysis?.volumeRatio,
              entryMa20ExtensionPct:
                momentumBuy.ma20ExtensionPct == null
                  ? null
                  : round(momentumBuy.ma20ExtensionPct * 100),
              effectiveMaxHoldDays,
              newsLabel: newsSentiment.label,
              newsNet: newsSentiment.net,
              newsBullish: newsSentiment.bullish,
              newsBearish: newsSentiment.bearish,
              newsHeadlines: newsSentiment.headlines,
              newsGateReason: newsGate.reason,
              marketFilter: stockMarketFilter,
              marketGateReason: marketGate.reason,
              benchmarkClose: marketGate.regime?.close,
              benchmarkMa20: marketGate.regime?.ma20,
              benchmarkMa60: marketGate.regime?.ma60,
              benchmarkMomentum20Pct: marketGate.regime?.momentum20Pct,
              benchmarkMomentum60Pct: marketGate.regime?.momentum60Pct,
              benchmarkMidBullish: marketGate.regime?.midBullish,
              qualityGateReason: qualityGate.reason,
              avgTurnoverAmount5d: qualityGate.avgTurnoverAmount,
            },
          );
          const trade = createMomentumExitTrade(signal, bars, {
            stopLossPct,
            takeProfitPct,
            maxHoldDays: effectiveMaxHoldDays,
          });
          if (trade) trades.push(trade);
          continue;
        }

        for (const holdDay of holdDays) {
          const signal = toSignal(
            diamond,
            { ...symbol, symbol: code, name },
            strategy,
            { fixedHoldDays: holdDay },
          );
          const trade = createFixedHoldTrade(signal, bars, holdDay);
          if (trade) trades.push(trade);
        }
      }
    } catch (error) {
      symbols.push({
        symbol: code,
        name: displayName,
        assetType: symbol.assetType ?? inferAssetType(code),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const sortedTrades = trades.sort((a, b) => {
    if (a.entryDate !== b.entryDate) return a.entryDate.localeCompare(b.entryDate);
    if (a.symbol !== b.symbol) return a.symbol.localeCompare(b.symbol);
    return a.holdDays - b.holdDays;
  });
  const namedPrePortfolioTrades =
    strategy === 'red-diamond-momentum'
      ? await enrichTradeNames(sortedTrades, { refreshExisting: true })
      : sortedTrades;
  const portfolioTrades =
    strategy === 'red-diamond-momentum'
      ? filterTradesByPortfolioRules(namedPrePortfolioTrades, {
          maxConcurrent: maxConcurrentPositions,
          noSymbolOverlap,
          reserveRejectedSlots: true,
          rejectTrade: (trade) => {
            if (excludeRiskyStockNames && tradeHasRiskyStockName(trade)) {
              enrichedRiskNameBlockedCount += 1;
              return true;
            }
            if (
              isWeakMomentumNoEntryBand({
                momentum20Pct:
                  typeof trade.signal.metadata?.benchmarkMomentum20Pct === 'number'
                    ? trade.signal.metadata.benchmarkMomentum20Pct
                    : null,
                minPct: weakMomentumNoEntryMinBenchmarkMomentum20Pct,
                maxPct: weakMomentumNoEntryMaxBenchmarkMomentum20Pct,
              })
            ) {
              weakMomentumNoEntryBlockedCount += 1;
              return true;
            }
            return false;
          },
        })
      : namedPrePortfolioTrades;
  const portfolioSkippedCount = Math.max(
    0,
    namedPrePortfolioTrades.length -
      portfolioTrades.length -
      enrichedRiskNameBlockedCount -
      weakMomentumNoEntryBlockedCount,
  );
  const namedTrades =
    strategy === 'red-diamond-momentum'
      ? portfolioTrades
      : await enrichTradeNames(portfolioTrades);
  const portfolioLedger = buildPortfolioLedger(namedTrades, {
    slots: maxConcurrentPositions,
    initialCapital,
  });

  return {
    strategy,
    generatedAt: new Date().toISOString(),
    requestedDays: days,
    startDate: formatTradeDateKey(dateRange.startDate),
    endDate: formatTradeDateKey(dateRange.endDate),
    holdDays,
    symbols,
    trades: namedTrades,
    metrics: {
      ...summarizeTrades(namedTrades),
      maxDrawdownPct: calcMaxDrawdownPct(portfolioLedger.equityCurve),
    },
    groups: buildTradeGroups(namedTrades, [
      { key: 'all', label: '全部交易', predicate: () => true },
      { key: 'stock', label: '股票', predicate: (trade) => trade.assetType === 'stock' },
      ...(strategy === 'red-diamond-momentum'
        ? MOMENTUM_EXIT_GROUPS.map((group) => ({
            key: group.key,
            label: group.label,
            predicate: (trade: BacktestTrade) => trade.exitReason === group.reason,
          }))
        : []),
      ...(strategy === 'red-diamond'
        ? holdDays.map((daysValue) => ({
            key: `hold-${daysValue}`,
            label: `持有 ${daysValue} 个交易日`,
            predicate: (trade: BacktestTrade) =>
              trade.signal.metadata?.fixedHoldDays === daysValue,
          }))
        : []),
    ]),
    config: {
      maxConcurrentPositions,
      noSymbolOverlap,
      stockUniverse: universe,
      stockUniverseCount: universeSymbols.length,
      initialCapital,
      newsFilter,
      newsLookbackDays,
      stockMarketFilter,
      minBenchmarkMomentum20Pct,
      defensiveBenchmarkMomentum20Pct,
      rawSignalCount,
      newsBlockedCount,
      marketBlockedCount,
      qualityBlockedCount,
      excludeRiskyStockNames,
      minEntryPrice,
      minAvgTurnoverAmount,
      portfolioSkippedCount,
      stopLossPct,
      takeProfitPct,
      stockEntryDelayTradingDays:
        strategy === 'red-diamond-momentum'
          ? STOCK_ENTRY_DELAY_TRADING_DAYS
          : undefined,
      delayedEntrySkippedCount:
        strategy === 'red-diamond-momentum'
          ? delayedEntrySkippedCount
          : undefined,
      minDelayedEntryDriftPct,
      maxDelayedEntryDriftPct,
      delayedEntryDriftFilterMaxBenchmarkMomentum20Pct,
      delayedEntryDriftBlockedCount:
        strategy === 'red-diamond-momentum'
          ? delayedEntryDriftBlockedCount
          : undefined,
      maxEntryMa20ExtensionPct,
      entryMa20ExtensionBlockedCount:
        strategy === 'red-diamond-momentum'
          ? entryMa20ExtensionBlockedCount
          : undefined,
      maxEntryChecklistScore,
      entryChecklistBlockedCount:
        strategy === 'red-diamond-momentum'
          ? entryChecklistBlockedCount
          : undefined,
      weakMomentumNoEntryMinBenchmarkMomentum20Pct,
      weakMomentumNoEntryMaxBenchmarkMomentum20Pct,
      weakMomentumNoEntryBlockedCount:
        strategy === 'red-diamond-momentum'
          ? weakMomentumNoEntryBlockedCount
          : undefined,
      enrichedRiskNameBlockedCount:
        strategy === 'red-diamond-momentum'
          ? enrichedRiskNameBlockedCount
          : undefined,
      momentumMaxHoldDays:
        strategy === 'red-diamond-momentum'
          ? momentumMaxHoldDays
          : undefined,
      weakMomentumMaxHoldDays,
      weakMomentumMaxHoldBenchmarkMomentum20Pct,
    },
    equityCurve: portfolioLedger.equityCurve,
    portfolioSnapshots: portfolioLedger.snapshots,
    benchmark,
    notes:
      strategy === 'red-diamond-momentum'
        ? [
            universe === 'retail-stock'
              ? '股票池为本地全市场 A 股 CSV，已排除 688/689 科创板代码。'
              : '股票池为手动输入代码列表，688/689 科创板会被排除。',
            `回测区间 ${formatTradeDateKey(dateRange.startDate)} 至 ${formatTradeDateKey(dateRange.endDate)}；仅统计区间内触发的红钻信号。`,
            `股票策略：红钻信号先进入候选池，至少延迟 ${STOCK_ENTRY_DELAY_TRADING_DAYS} 个交易日后才允许入场；入场日按真实收盘价重新跑动量 checklist，并过滤距离 MA20 超过 ${Math.round(maxEntryMa20ExtensionPct * 100)}% 的追高信号。`,
            minDelayedEntryDriftPct != null || maxDelayedEntryDriftPct != null
              ? `T+2 涨跌幅过滤：信号日至入场日涨跌幅需满足 ${minDelayedEntryDriftPct ?? '-∞'}% 至 ${maxDelayedEntryDriftPct ?? '+∞'}%。`
              : undefined,
            maxEntryChecklistScore != null
              ? `T+2 过热过滤：入场 checklist 通过项不高于 ${maxEntryChecklistScore}。`
              : undefined,
            weakMomentumMaxHoldDays != null &&
            weakMomentumMaxHoldBenchmarkMomentum20Pct != null
              ? `退出策略：默认最多持有 ${momentumMaxHoldDays} 个交易日；当沪深300 20 日动量不高于 ${weakMomentumMaxHoldBenchmarkMomentum20Pct}% 时，最多持有 ${weakMomentumMaxHoldDays} 个交易日。期间按 -${Math.round(stopLossPct * 100)}% 硬止损和 +${Math.round(takeProfitPct * 100)}% 止盈保护提前出场，到期再检查 MA20/信号弱化。`
              : `退出策略：从真实入场日开始最多持有 ${momentumMaxHoldDays} 个交易日，期间按 -${Math.round(stopLossPct * 100)}% 硬止损和 +${Math.round(takeProfitPct * 100)}% 止盈保护提前出场，到期再检查 MA20/信号弱化。`,
            weakMomentumNoEntryMinBenchmarkMomentum20Pct != null &&
            weakMomentumNoEntryMaxBenchmarkMomentum20Pct != null &&
            weakMomentumNoEntryMinBenchmarkMomentum20Pct <=
              weakMomentumNoEntryMaxBenchmarkMomentum20Pct
              ? `弱动量降频：沪深300 20 日动量位于 ${weakMomentumNoEntryMinBenchmarkMomentum20Pct}% 至 ${weakMomentumNoEntryMaxBenchmarkMomentum20Pct}% 时暂停新开股票仓。`
              : undefined,
            `质量过滤：${excludeRiskyStockNames ? '排除 ST/退市/风险警示名称，并在行情名称补全后进入组合前复查' : '不排除风险名称'}；${minEntryPrice > 0 ? `最低入场价 ${minEntryPrice} 元` : '不启用最低价格硬过滤'}，${minAvgTurnoverAmount > 0 ? `近 5 日平均成交额不低于 ${Math.round(minAvgTurnoverAmount / 10_000)} 万元` : '不启用成交额硬过滤'}。`,
            stockMarketFilter === 'off'
              ? '大盘状态过滤已关闭；可用 --market-filter=require_bullish 仅在沪深300强势时新开股票仓。'
              : stockMarketFilter === 'require_bullish'
                ? '大盘状态过滤默认开启：仅当沪深300站上 MA20 且 20 日动量不为负时允许新开股票仓。'
                : '大盘状态过滤：沪深300跌破 MA20 且 20 日动量为负时暂停新开股票仓。',
            stockMarketFilter === 'require_bullish' && minBenchmarkMomentum20Pct > 0
              ? `强势确认阈值：沪深300 20 日动量需不低于 ${minBenchmarkMomentum20Pct}%。`
              : undefined,
            stockMarketFilter === 'require_bullish' &&
            defensiveBenchmarkMomentum20Pct > 0
              ? `自适应防守阈值：沪深300未满足 MA60 中期强势时，20 日动量需不低于 ${defensiveBenchmarkMomentum20Pct}%。`
              : undefined,
            `组合约束：最多同时持有 ${maxConcurrentPositions} 只${noSymbolOverlap ? '，同一股票不重复开仓' : ''}；原始红钻信号 ${rawSignalCount} 个，T+2 未形成可交易入场 ${delayedEntrySkippedCount} 个，T+2 涨跌幅过滤 ${delayedEntryDriftBlockedCount} 个，T+2 过热过滤 ${entryChecklistBlockedCount} 个，MA20 乖离过滤 ${entryMa20ExtensionBlockedCount} 个，质量过滤 ${qualityBlockedCount} 个，弱动量暂停新仓 ${weakMomentumNoEntryBlockedCount} 个，补全名称后风险过滤 ${enrichedRiskNameBlockedCount} 笔，大盘过滤 ${marketBlockedCount} 个，新闻拦截 ${newsBlockedCount} 个，组合过滤 ${portfolioSkippedCount} 笔，最终交易 ${namedTrades.length} 笔。`,
            newsFilter === 'off'
              ? '股票新闻过滤默认关闭；可用 --news-filter=avoid_bearish 回测买入前近端新闻利空拦截，或 --news-filter=require_bullish 要求相关新闻净分为正。'
              : newsFilter === 'require_bullish'
                ? `股票新闻过滤：买入前 ${newsLookbackDays} 日内需有相关利好（净分 > 0）。`
                : `股票新闻过滤：买入前 ${newsLookbackDays} 日内拦截明显利空新闻。`,
            newsFilter !== 'off' && newsTimeline.sources.length > 0
              ? `新闻来源：${newsTimeline.sources.join('、')}。`
              : undefined,
            newsFilter !== 'off' && newsTimeline.sources.length === 0
              ? '未拉到足够新闻数据，长区间历史新闻回测需配置 BACKTEST_NEWS_HISTORICAL=1；未命中新闻时不会假装拦截。'
              : undefined,
            newsFilter !== 'off' ? newsTimeline.warning : undefined,
            benchmark
              ? `大盘基准使用 ${benchmark.name}（${benchmark.symbol}）同期买入持有收益。`
              : '大盘基准暂未生成，已尝试读取沪深300ETF日线。',
            'A 股本地前复权历史早期可能出现负价格，回测已剔除非正收盘价 K 线。',
          ].filter((note): note is string => Boolean(note))
        : [
            universe === 'retail-stock'
              ? '股票池为本地全市场 A 股 CSV，已排除 688/689 科创板代码。'
              : '股票池为手动输入代码列表，688/689 科创板会被排除。',
            `回测区间 ${formatTradeDateKey(dateRange.startDate)} 至 ${formatTradeDateKey(dateRange.endDate)}；仅统计区间内触发的红钻信号。`,
            '固定观察期以红钻触发日收盘价作为基准，并在目标交易日收盘价统计收益；这是信号有效性统计，不代表实盘交易策略。',
            'A 股本地前复权历史早期可能出现负价格，回测已剔除非正收盘价 K 线。',
          ],
  };
}

export const STOCK_STRATEGY_PAPER_CONFIG = {
  stockMarketFilter: 'require_bullish' as const,
  minBenchmarkMomentum20Pct: 0,
  defensiveBenchmarkMomentum20Pct: DEFAULT_DEFENSIVE_BENCHMARK_MOMENTUM20_PCT,
  excludeRiskyStockNames: true,
  minEntryPrice: 3,
  minAvgTurnoverAmount: 30_000_000,
  minDelayedEntryDriftPct: DEFAULT_MIN_DELAYED_ENTRY_DRIFT_PCT,
  maxDelayedEntryDriftPct: DEFAULT_MAX_DELAYED_ENTRY_DRIFT_PCT,
  delayedEntryDriftFilterMaxBenchmarkMomentum20Pct:
    DEFAULT_DELAYED_ENTRY_DRIFT_FILTER_MAX_BENCHMARK_MOMENTUM20_PCT,
  maxEntryMa20ExtensionPct: MAX_ENTRY_MA20_EXTENSION_PCT,
  newsLookbackDays: 3,
  entryDelayTradingDays: STOCK_ENTRY_DELAY_TRADING_DAYS,
  weakMomentumNoEntryMinBenchmarkMomentum20Pct:
    DEFAULT_WEAK_MOMENTUM_NO_ENTRY_MIN_BENCHMARK_MOMENTUM20_PCT,
  weakMomentumNoEntryMaxBenchmarkMomentum20Pct:
    DEFAULT_WEAK_MOMENTUM_NO_ENTRY_MAX_BENCHMARK_MOMENTUM20_PCT,
};

export type StockStrategyScanMode = 'entry_close' | 'preopen';

export type StockStrategyEntryCandidate = {
  symbol: string;
  name: string;
  entryPrice: number;
  entryTradeDate: string;
  sourceSignalDate: string;
  memo: string;
};

function matchesEntryTradeDate(actual: string, expected: string): boolean {
  return normalizeTradeDateKey(actual) === normalizeTradeDateKey(expected);
}

function evaluateStockStrategyEntryGates(input: {
  code: string;
  name: string;
  bars: OhlcvBar[];
  diamond: DiamondSignalResult;
  delayedEntry: NonNullable<ReturnType<typeof resolveDelayedEntrySignal>>;
  entryDiamond: DiamondSignalResult;
  marketRegimes: Map<string, MarketRegimeSnapshot>;
  newsTimeline: BacktestNewsLoadResult;
  newsFilter: EtfNewsFilterMode;
  newsLookbackDays: number;
  newsTradeDate?: string;
  config: typeof STOCK_STRATEGY_PAPER_CONFIG;
}): { passed: boolean; reason: string; entryPrice: number; memo: string } {
  const momentumBuy = evaluateMomentumBuy(
    { symbol: input.code, name: input.name },
    input.diamond,
    input.bars,
    input.delayedEntry.entryTradeDate,
    input.config.maxEntryMa20ExtensionPct,
  );
  if (!momentumBuy.passed) {
    return {
      passed: false,
      reason: momentumBuy.ma20ExtensionPct != null ? 'MA20 乖离或动量未达标' : '动量 checklist 未达标',
      entryPrice: input.delayedEntry.entryClose,
      memo: '',
    };
  }

  const delayedEntryDriftPct = calcDelayedEntryDriftPct({
    sourceClose: input.delayedEntry.sourceClose,
    entryClose: input.delayedEntry.entryClose,
  });

  const qualityGate = evaluateStockQualityGate({
    name: input.name,
    diamond: input.entryDiamond,
    bars: input.bars,
    excludeRiskyStockNames: input.config.excludeRiskyStockNames,
    minEntryPrice: input.config.minEntryPrice,
    minAvgTurnoverAmount: input.config.minAvgTurnoverAmount,
  });
  if (qualityGate.blocked) {
    return { passed: false, reason: qualityGate.reason, entryPrice: input.delayedEntry.entryClose, memo: '' };
  }

  const marketGate = evaluateStockMarketGate({
    tradeDate: input.entryDiamond.tradeDate,
    mode: input.config.stockMarketFilter,
    minBenchmarkMomentum20Pct: input.config.minBenchmarkMomentum20Pct,
    defensiveBenchmarkMomentum20Pct: input.config.defensiveBenchmarkMomentum20Pct,
    regimes: input.marketRegimes,
  });
  if (marketGate.blocked) {
    return { passed: false, reason: marketGate.reason, entryPrice: input.delayedEntry.entryClose, memo: '' };
  }

  const applyDelayedEntryDriftFilter =
    input.config.minDelayedEntryDriftPct != null || input.config.maxDelayedEntryDriftPct != null
      ? input.config.delayedEntryDriftFilterMaxBenchmarkMomentum20Pct == null ||
        marketGate.regime?.momentum20Pct == null ||
        marketGate.regime.momentum20Pct <=
          input.config.delayedEntryDriftFilterMaxBenchmarkMomentum20Pct
      : false;
  if (
    applyDelayedEntryDriftFilter &&
    delayedEntryDriftPct != null &&
    input.config.minDelayedEntryDriftPct != null &&
    delayedEntryDriftPct < input.config.minDelayedEntryDriftPct
  ) {
    return {
      passed: false,
      reason: `T+2 涨跌幅 ${delayedEntryDriftPct}% 低于 ${input.config.minDelayedEntryDriftPct}%`,
      entryPrice: input.delayedEntry.entryClose,
      memo: '',
    };
  }
  if (
    applyDelayedEntryDriftFilter &&
    delayedEntryDriftPct != null &&
    input.config.maxDelayedEntryDriftPct != null &&
    delayedEntryDriftPct > input.config.maxDelayedEntryDriftPct
  ) {
    return {
      passed: false,
      reason: `T+2 涨跌幅 ${delayedEntryDriftPct}% 高于 ${input.config.maxDelayedEntryDriftPct}%`,
      entryPrice: input.delayedEntry.entryClose,
      memo: '',
    };
  }

  if (
    isWeakMomentumNoEntryBand({
      momentum20Pct: marketGate.regime?.momentum20Pct,
      minPct: input.config.weakMomentumNoEntryMinBenchmarkMomentum20Pct,
      maxPct: input.config.weakMomentumNoEntryMaxBenchmarkMomentum20Pct,
    })
  ) {
    return {
      passed: false,
      reason: '弱动量区间暂停新开仓',
      entryPrice: input.delayedEntry.entryClose,
      memo: '',
    };
  }

  const newsProfile = getStockNewsProfile(input.code, input.name);
  const entryNews = filterNewsForTradeDate({
    news: input.newsTimeline.news,
    tradeDate: input.newsTradeDate ?? input.entryDiamond.tradeDate,
    lookbackDays: input.newsLookbackDays,
  });
  const newsSentiment = evaluateEtfNewsSentiment({
    profile: newsProfile,
    news: entryNews,
  });
  const newsGate = shouldBlockEtfEntryByNews(newsSentiment, input.newsFilter);
  if (newsGate.blocked) {
    return {
      passed: false,
      reason: newsGate.reason,
      entryPrice: input.delayedEntry.entryClose,
      memo: '',
    };
  }

  const checklist = momentumBuy.analysis?.checklistScore ?? 0;
  const memo = [
    `红钻 ${input.delayedEntry.sourceTradeDate} → T+2 入场 ${input.entryDiamond.tradeDate}`,
    `checklist ${checklist}`,
    momentumBuy.analysis?.entryMemo ?? '',
    qualityGate.reason,
    marketGate.reason,
    delayedEntryDriftPct != null ? `T+2 漂移 ${delayedEntryDriftPct}%` : null,
    input.newsFilter !== 'off' ? `新闻：${newsSentiment.label}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    passed: true,
    reason: '回测策略入场通过',
    entryPrice: input.delayedEntry.entryClose,
    memo,
  };
}

export async function scanStockStrategyEntriesForDate(input: {
  entryTradeDate: string;
  mode: StockStrategyScanMode;
  newsFilter?: EtfNewsFilterMode;
  onProgress?: (done: number, total: number) => void;
}): Promise<{
  candidates: StockStrategyEntryCandidate[];
  scanned: number;
  rawSignals: number;
}> {
  const config = STOCK_STRATEGY_PAPER_CONFIG;
  const newsFilter = input.newsFilter ?? 'off';
  const newsLookbackDays = config.newsLookbackDays;
  const entryKey = normalizeTradeDateKey(input.entryTradeDate);
  const dateRange = {
    startDate: addCalendarDays(entryKey, -120),
    endDate: entryKey,
  };
  const marketRegimes = await buildStockMarketRegimeMap(dateRange, LOCAL_DAILY_LOAD_ALL_DAYS).catch(
    () => new Map<string, MarketRegimeSnapshot>(),
  );
  const newsTimeline: BacktestNewsLoadResult =
    newsFilter === 'off'
      ? { news: [], sources: [] as string[] }
      : await loadBacktestNewsTimeline({
          startDate: dateRange.startDate,
          endDate: dateRange.endDate,
        }).catch(() => ({
          news: [],
          sources: [] as string[],
          warning: '新闻加载失败，已跳过',
        }));

  const universeSymbols = listLocalStockDailyCsvSymbols()
    .filter(isRetailTradableStock)
    .map((symbol) => ({ symbol, name: getLocalStockName(symbol) ?? symbol }));

  const candidates: StockStrategyEntryCandidate[] = [];
  let rawSignals = 0;
  let done = 0;

  for (const symbol of universeSymbols) {
    done += 1;
    input.onProgress?.(done, universeSymbols.length);
    const code = symbol.symbol.trim();
    const name = symbol.name ?? code;
    if (!/^\d{6}$/.test(code)) continue;

    try {
      const data = await getDailyQuote(code, LOCAL_DAILY_LOAD_ALL_DAYS);
      const bars = data.quotes.filter((bar) => bar.close != null && bar.close > 0);
      if (bars.length === 0) continue;

      const lookback = Math.min(bars.length, 120);
      const signals = scanDiamondSignalHistory(code, name, bars, lookback)
        .filter((signal) => signal.strength === 'red')
        .reverse();

      for (const diamond of signals) {
        rawSignals += 1;

        if (input.mode === 'preopen') {
          const signalDate = shiftTradeDateLabel(
            input.entryTradeDate,
            -config.entryDelayTradingDays,
          );
          if (!matchesEntryTradeDate(diamond.tradeDate, signalDate)) continue;

          const latestBar = bars[0];
          if (!latestBar?.close) continue;
          const preopenEntry = {
            entryTradeDate: latestBar.tradeDate,
            entryClose: latestBar.close,
            sourceTradeDate: diamond.tradeDate,
            sourceClose: diamond.close,
            delayTradingDays: config.entryDelayTradingDays,
          };
          const entryDiamond = {
            ...diamond,
            tradeDate: preopenEntry.entryTradeDate,
            close: preopenEntry.entryClose,
          };
          const gate = evaluateStockStrategyEntryGates({
            code,
            name,
            bars,
            diamond,
            delayedEntry: preopenEntry,
            entryDiamond,
            marketRegimes,
            newsTimeline,
            newsFilter,
            newsLookbackDays,
            newsTradeDate: input.entryTradeDate,
            config,
          });
          if (!gate.passed) continue;
          candidates.push({
            symbol: code,
            name,
            entryPrice: preopenEntry.entryClose,
            entryTradeDate: input.entryTradeDate,
            sourceSignalDate: diamond.tradeDate,
            memo: `${gate.memo} · 盘前确认`,
          });
          break;
        }

        const delayedEntry = resolveDelayedEntrySignal({
          sourceDiamond: diamond,
          bars,
          delayTradingDays: config.entryDelayTradingDays,
        });
        if (!delayedEntry || !matchesEntryTradeDate(delayedEntry.entryTradeDate, input.entryTradeDate)) {
          continue;
        }
        const entryDiamond = {
          ...diamond,
          tradeDate: delayedEntry.entryTradeDate,
          close: delayedEntry.entryClose,
        };
        const gate = evaluateStockStrategyEntryGates({
          code,
          name,
          bars,
          diamond,
          delayedEntry,
          entryDiamond,
          marketRegimes,
          newsTimeline,
          newsFilter,
          newsLookbackDays,
          config,
        });
        if (!gate.passed) continue;
        candidates.push({
          symbol: code,
          name,
          entryPrice: gate.entryPrice,
          entryTradeDate: delayedEntry.entryTradeDate,
          sourceSignalDate: delayedEntry.sourceTradeDate,
          memo: gate.memo,
        });
        break;
      }
    } catch {
      // skip symbol
    }
  }

  candidates.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return { candidates, scanned: universeSymbols.length, rawSignals };
}

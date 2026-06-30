import {
  detectDiamondSignal,
  scanDiamondSignalHistory,
  type DiamondSignalResult,
} from '../market/diamond-signal.js';
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
} from '../paper/momentum.js';
import {
  buildTradeGroups,
  calcReturnPct,
  createFixedHoldTrade,
  findBarIndex,
  summarizeTrades,
} from './engine.js';
import {
  computeKlineDaysForRange,
  formatTradeDateKey,
  isTradeDateInRange,
  resolveBacktestDateRange,
  addCalendarDays,
  todayDateKey,
} from './date-range.js';
import { buildPortfolioLedger } from './portfolio.js';
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
const STOCK_BACKTEST_STOP_LOSS_PCT = 0.2;
const MOMENTUM_TAKE_PROFIT_PCT = 0.5;
const MOMENTUM_MIN_SIGNAL_EXIT_HOLD_DAYS = 5;
const MOMENTUM_SIGNAL_EXIT_CONFIRM_DAYS = 3;
const MOMENTUM_MAX_HOLD_DAYS = 5;

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
}): { reason: string } | null {
  if (input.avgCost > 0) {
    const lossPct = (input.close - input.avgCost) / input.avgCost;
    if (lossPct <= -STOCK_BACKTEST_STOP_LOSS_PCT) {
      return { reason: `硬止损（${(lossPct * 100).toFixed(1)}%）` };
    }

    const gainPct = (input.close - input.avgCost) / input.avgCost;
    if (gainPct >= MOMENTUM_TAKE_PROFIT_PCT) {
      return { reason: `止盈保护（${(gainPct * 100).toFixed(1)}%）` };
    }
  }

  if (input.holdDays < MOMENTUM_MAX_HOLD_DAYS) return null;

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
    });

    const maxHoldExit =
      holdDays >= MOMENTUM_MAX_HOLD_DAYS
        ? { reason: `达到持有上限（${MOMENTUM_MAX_HOLD_DAYS} 日）` }
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
    signal,
  };
}

function passesMomentumBuy(
  symbol: BacktestSymbolInput,
  diamond: DiamondSignalResult,
  bars: OhlcvBar[],
): boolean {
  const entryIndex = findBarIndex(bars, diamond.tradeDate);
  if (entryIndex < 0) return false;

  const analysis = analyzeMomentum(
    symbol.symbol,
    symbol.name ?? diamond.name,
    bars.slice(entryIndex),
    diamond,
  );
  return analysis?.action === 'buy';
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
        if (
          strategy === 'red-diamond-momentum' &&
          !passesMomentumBuy({ ...symbol, symbol: code, name }, diamond, bars)
        ) {
          continue;
        }

        if (strategy === 'red-diamond-momentum') {
          const signal = toSignal(diamond, { ...symbol, symbol: code, name }, strategy);
          const trade = createMomentumExitTrade(signal, bars);
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
  const portfolioLedger = buildPortfolioLedger(sortedTrades, {
    slots: 5,
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
    trades: sortedTrades,
    metrics: summarizeTrades(sortedTrades),
    groups: buildTradeGroups(sortedTrades, [
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
      maxConcurrentPositions: 5,
      noSymbolOverlap: true,
      stockUniverse: universe,
      stockUniverseCount: universeSymbols.length,
      initialCapital,
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
            `股票策略：红钻 + 动量 checklist 入场；最多持有 ${MOMENTUM_MAX_HOLD_DAYS} 个交易日，期间按 -${Math.round(STOCK_BACKTEST_STOP_LOSS_PCT * 100)}% 硬止损和 +${Math.round(MOMENTUM_TAKE_PROFIT_PCT * 100)}% 止盈保护提前出场，到期再检查 MA20/信号弱化；组合权益曲线按 5 个等权槽位滚动。`,
            benchmark
              ? `大盘基准使用 ${benchmark.name}（${benchmark.symbol}）同期买入持有收益。`
              : '大盘基准暂未生成，已尝试读取沪深300ETF日线。',
            'A 股本地前复权历史早期可能出现负价格，回测已剔除非正收盘价 K 线。',
          ]
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

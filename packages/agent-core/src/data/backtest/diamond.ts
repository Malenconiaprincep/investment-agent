import {
  detectDiamondSignal,
  scanDiamondSignalHistory,
  type DiamondSignalResult,
} from '../market/diamond-signal.js';
import { getDailyQuote } from '../market/services.js';
import { inferAssetType, isRetailTradableStock } from '../market/asset-type.js';
import {
  hasLocalStockDailyCsv,
  listLocalStockDailyCsvSymbols,
  LOCAL_DAILY_LOAD_ALL_DAYS,
} from '../market/local-csv/etf-daily.js';
import { sma, type OhlcvBar } from '../market/indicators.js';
import {
  analyzeMomentum,
  evaluateMomentumExit,
  MOMENTUM_STOP_LOSS_PCT,
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
} from './date-range.js';
import { buildPortfolioEquityCurve } from './portfolio.js';
import type {
  BacktestAssetType,
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
};

const DEFAULT_DAYS = 250;
const DEFAULT_HOLD_DAYS = [1, 3, 5, 10, 20];
const MOMENTUM_EXIT_GROUPS: Array<{
  key: string;
  label: string;
  reason: BacktestExitReason;
}> = [
  { key: 'exit-stop-loss', label: '止损退出', reason: 'stop_loss' },
  { key: 'exit-ma20-break', label: '跌破 MA20', reason: 'ma20_break' },
  { key: 'exit-trailing-stop', label: '移动止盈', reason: 'trailing_stop' },
  { key: 'exit-signal-weakened', label: '信号减弱', reason: 'signal_weakened' },
  { key: 'exit-signal-lost', label: '信号消失', reason: 'signal_lost' },
  { key: 'exit-end-of-data', label: '跑到区间结束', reason: 'end_of_data' },
];

function normalizeHoldDays(holdDays: number[] | undefined): number[] {
  const values = holdDays?.length ? holdDays : DEFAULT_HOLD_DAYS;
  return [...new Set(values.map((value) => Math.max(0, Math.floor(value))))]
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
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

function mapMomentumExitReason(reason: string): BacktestExitReason {
  if (reason.includes('硬止损')) return 'stop_loss';
  if (reason.includes('跌破 MA20')) return 'ma20_break';
  if (reason.includes('移动止盈')) return 'trailing_stop';
  if (reason.includes('仅余蓝钻')) return 'signal_weakened';
  return 'signal_lost';
}

function createMomentumExitTrade(
  signal: BacktestSignal,
  bars: OhlcvBar[],
): BacktestTrade | null {
  const entryIndex = findBarIndex(bars, signal.tradeDate);
  if (entryIndex < 0) return null;

  let highWaterMark = signal.entryPrice;
  for (let index = entryIndex - 1; index >= 0; index -= 1) {
    const bar = bars[index];
    if (!bar?.close) continue;

    highWaterMark = Math.max(highWaterMark, bar.close);
    const slice = bars.slice(index);
    const currentDiamond = detectDiamondSignal(
      signal.symbol,
      signal.name,
      slice,
    );
    const exit = evaluateMomentumExit({
      avgCost: signal.entryPrice,
      close: bar.close,
      ma20: ma20At(slice),
      highWaterMark,
      diamondStrength: currentDiamond?.strength ?? null,
    });

    if (!exit) continue;

    return {
      symbol: signal.symbol,
      name: signal.name,
      assetType: signal.assetType,
      strategy: signal.strategy,
      entryDate: signal.tradeDate,
      entryPrice: signal.entryPrice,
      exitDate: bar.tradeDate,
      exitPrice: bar.close,
      holdDays: entryIndex - index,
      returnPct: calcReturnPct(signal.entryPrice, bar.close),
      exitReason: mapMomentumExitReason(exit.reason),
      signal: {
        ...signal,
        metadata: {
          ...signal.metadata,
          exitMemo: exit.reason,
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
          .map((symbol) => ({ symbol }))
      : input.symbols;

  for (const symbol of universeSymbols) {
    const code = symbol.symbol.trim();
    if (!/^\d{6}$/.test(code)) {
      symbols.push({
        symbol: code,
        name: symbol.name ?? code,
        assetType: symbol.assetType ?? 'stock',
        error: '证券代码必须为 6 位数字',
      });
      continue;
    }

    if (universe === 'manual' && !isRetailTradableStock(code)) {
      symbols.push({
        symbol: code,
        name: symbol.name ?? code,
        assetType: 'stock',
        error: '已排除科创板或非普通 A 股股票',
      });
      continue;
    }

    try {
      const useLocalStockCsv = hasLocalStockDailyCsv(code);
      const useFullLocalHistory = useLocalStockCsv && universe === 'manual';
      const quoteDays = useFullLocalHistory ? LOCAL_DAILY_LOAD_ALL_DAYS : days;
      const data = await getDailyQuote(code, quoteDays);
      const name = symbol.name ?? code;
      const bars = data.quotes.filter((bar) => bar.close != null && bar.close > 0);
      const symbolLookback = input.lookback
        ? Math.min(bars.length, lookback)
        : useFullLocalHistory
          ? bars.length
          : Math.min(bars.length, lookback);
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
        name: symbol.name ?? code,
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
    },
    equityCurve: buildPortfolioEquityCurve(sortedTrades, 5),
    notes:
      strategy === 'red-diamond-momentum'
        ? [
            universe === 'retail-stock'
              ? '股票池为本地全市场 A 股 CSV，已排除 688/689 科创板代码。'
              : '股票池为手动输入代码列表，688/689 科创板会被排除。',
            `回测区间 ${formatTradeDateKey(dateRange.startDate)} 至 ${formatTradeDateKey(dateRange.endDate)}；仅统计区间内触发的红钻信号。`,
            `股票策略：红钻 + 动量 checklist 入场；持有天数不预设，出场按 -${Math.round(MOMENTUM_STOP_LOSS_PCT * 100)}% 硬止损、跌破 MA20、从持仓高点回撤 ${Math.round(MOMENTUM_TRAILING_STOP_PCT * 100)}% 移动止盈、红/蓝钻信号减弱或消失动态决定；组合权益曲线按 5 个等权槽位滚动。`,
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

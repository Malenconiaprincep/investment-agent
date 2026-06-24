import {
  detectDiamondSignal,
  scanDiamondSignalHistory,
  type DiamondSignalResult,
} from '../market/diamond-signal.js';
import { getDailyQuote } from '../market/services.js';
import { inferAssetType } from '../market/asset-type.js';
import { sma, type OhlcvBar } from '../market/indicators.js';
import {
  analyzeMomentum,
  evaluateMomentumExit,
} from '../paper/momentum.js';
import {
  buildTradeGroups,
  calcReturnPct,
  createFixedHoldTrade,
  findBarIndex,
  summarizeTrades,
} from './engine.js';
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
  strategy?: Extract<BacktestStrategy, 'red-diamond' | 'red-diamond-momentum'>;
  days?: number;
  lookback?: number;
  holdDays?: number[];
};

const DEFAULT_DAYS = 250;
const DEFAULT_HOLD_DAYS = [1, 3, 5, 10, 20];

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
  const days = Math.max(60, Math.floor(input.days ?? DEFAULT_DAYS));
  const lookback = Math.min(days, Math.max(1, Math.floor(input.lookback ?? days)));
  const holdDays = strategy === 'red-diamond'
    ? normalizeHoldDays(input.holdDays)
    : [];
  const trades: BacktestTrade[] = [];
  const symbols: BacktestRunResult['symbols'] = [];

  for (const symbol of input.symbols) {
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

    try {
      const data = await getDailyQuote(code, days);
      const name = symbol.name ?? code;
      const bars = data.quotes.filter((bar) => bar.close != null);
      const signals = scanDiamondSignalHistory(code, name, bars, lookback)
        .filter((signal) => signal.strength === 'red')
        .reverse();

      symbols.push({
        symbol: code,
        name,
        assetType: symbol.assetType ?? inferAssetType(code),
      });

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
    holdDays,
    symbols,
    trades: sortedTrades,
    metrics: summarizeTrades(sortedTrades),
    groups: buildTradeGroups(sortedTrades, [
      { key: 'all', label: '全部交易', predicate: () => true },
      { key: 'stock', label: '股票', predicate: (trade) => trade.assetType === 'stock' },
      { key: 'etf', label: 'ETF', predicate: (trade) => trade.assetType === 'etf' },
      ...(strategy === 'red-diamond'
        ? holdDays.map((daysValue) => ({
            key: `hold-${daysValue}`,
            label: `持有 ${daysValue} 个交易日`,
            predicate: (trade: BacktestTrade) =>
              trade.signal.metadata?.fixedHoldDays === daysValue,
          }))
        : []),
    ]),
    notes:
      strategy === 'red-diamond-momentum'
        ? ['动量策略使用当前模拟盘 evaluateMomentumExit 规则，信号消失会触发退出。']
        : ['固定持有期以红钻触发日收盘价买入，并在目标交易日收盘价卖出。'],
  };
}

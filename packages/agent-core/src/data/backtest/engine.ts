import type { OhlcvBar } from '../market/indicators.js';
import type {
  BacktestGroup,
  BacktestMetrics,
  BacktestSignal,
  BacktestTrade,
} from './types.js';

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

export function barsWithClose(bars: OhlcvBar[]): OhlcvBar[] {
  return bars.filter((bar) => bar.close != null);
}

export function findBarIndex(
  bars: OhlcvBar[],
  tradeDate: string,
): number {
  const target = tradeDate.replace(/-/g, '');
  return bars.findIndex((bar) => bar.tradeDate.replace(/-/g, '') === target);
}

export function calcReturnPct(
  entryPrice: number | null,
  exitPrice: number | null,
): number | null {
  if (entryPrice == null || exitPrice == null || entryPrice <= 0) return null;
  return round(((exitPrice - entryPrice) / entryPrice) * 100);
}

export function createFixedHoldTrade(
  signal: BacktestSignal,
  bars: OhlcvBar[],
  holdDays: number,
): BacktestTrade | null {
  const filtered = barsWithClose(bars);
  const entryIndex = findBarIndex(filtered, signal.tradeDate);
  if (entryIndex < 0) return null;

  const normalizedHoldDays = Math.max(0, Math.floor(holdDays));
  const exitIndex =
    normalizedHoldDays === 0
      ? 0
      : Math.max(0, entryIndex - normalizedHoldDays);
  const exit = filtered[exitIndex] ?? filtered[entryIndex];
  if (!exit?.close) return null;

  const actualHoldDays = Math.max(0, entryIndex - exitIndex);
  const reachedTargetHold = actualHoldDays >= normalizedHoldDays;
  const returnPct =
    reachedTargetHold || normalizedHoldDays === 0
      ? calcReturnPct(signal.entryPrice, exit.close)
      : null;

  return {
    symbol: signal.symbol,
    name: signal.name,
    assetType: signal.assetType,
    strategy: signal.strategy,
    entryDate: signal.tradeDate,
    entryPrice: signal.entryPrice,
    exitDate: exit.tradeDate,
    exitPrice: exit.close,
    holdDays: actualHoldDays,
    returnPct,
    exitReason: reachedTargetHold ? 'fixed_hold' : 'end_of_data',
    signal,
  };
}

export function summarizeTrades(trades: BacktestTrade[]): BacktestMetrics {
  const validTrades = trades.filter((trade) => trade.returnPct != null);
  const returns = validTrades.map((trade) => trade.returnPct as number);
  const sortedReturns = [...returns].sort((a, b) => a - b);
  const wins = returns.filter((value) => value > 0);
  const losses = returns.filter((value) => value < 0);
  const holdDays = validTrades.map((trade) => trade.holdDays);

  const avg = (values: number[]): number | null => {
    if (values.length === 0) return null;
    return round(values.reduce((sum, value) => sum + value, 0) / values.length);
  };

  const median =
    sortedReturns.length === 0
      ? null
      : sortedReturns.length % 2 === 1
        ? sortedReturns[Math.floor(sortedReturns.length / 2)]
        : round(
            (
              sortedReturns[sortedReturns.length / 2 - 1] +
              sortedReturns[sortedReturns.length / 2]
            ) / 2,
          );

  const avgWin = avg(wins);
  const avgLoss = avg(losses.map(Math.abs));

  return {
    tradeCount: trades.length,
    validTradeCount: validTrades.length,
    winRatePct:
      validTrades.length > 0 ? round((wins.length / validTrades.length) * 100) : null,
    avgReturnPct: avg(returns),
    medianReturnPct: median,
    bestReturnPct: returns.length > 0 ? round(Math.max(...returns)) : null,
    worstReturnPct: returns.length > 0 ? round(Math.min(...returns)) : null,
    avgHoldDays: avg(holdDays),
    profitLossRatio:
      avgWin != null && avgLoss != null && avgLoss > 0
        ? round(avgWin / avgLoss)
        : null,
  };
}

export function buildTradeGroups(
  trades: BacktestTrade[],
  groups: Array<{
    key: string;
    label: string;
    predicate: (trade: BacktestTrade) => boolean;
  }>,
): BacktestGroup[] {
  return groups.map((group) => ({
    key: group.key,
    label: group.label,
    ...summarizeTrades(trades.filter(group.predicate)),
  }));
}

import { normalizeTradeDateKey } from './date-range.js';
import {
  calcEtfBuyLotsByBudget,
  calcEtfSellProceeds,
  type EtfTradingCostRates,
} from '../etf/trading-cost.js';
import type {
  BacktestEquityPoint,
  BacktestPortfolioSnapshot,
  BacktestTrade,
} from './types.js';

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

const A_SHARE_LOT_SIZE = 100;

function lotSizeForAsset(assetType: BacktestTrade['assetType']): number {
  return assetType === 'stock' || assetType === 'etf' ? A_SHARE_LOT_SIZE : 1;
}

function calcPositionSize(input: {
  assetType: BacktestTrade['assetType'];
  budget: number;
  price: number;
  costRates?: EtfTradingCostRates;
}): { shares: number; costAmount: number } | null {
  if (input.budget <= 0 || input.price <= 0) return null;

  const lotSize = lotSizeForAsset(input.assetType);
  if (input.assetType === 'etf' && input.costRates) {
    const lots = calcEtfBuyLotsByBudget({
      budget: input.budget,
      price: input.price,
      lotSize,
      ...input.costRates,
    });
    return lots
      ? {
          shares: lots.shares,
          costAmount: lots.totalCost,
        }
      : null;
  }

  const lots = Math.floor(input.budget / (input.price * lotSize));
  const shares = lots * lotSize;
  if (!Number.isFinite(shares) || shares <= 0) return null;

  return {
    shares,
    costAmount: shares * input.price,
  };
}

function readTradePricePath(trade: BacktestTrade): Map<string, number> {
  const raw = trade.signal.metadata?.pricePath;
  if (!Array.isArray(raw)) return new Map();

  const prices = new Map<string, number>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { tradeDate?: unknown; close?: unknown };
    const tradeDate =
      typeof row.tradeDate === 'string'
        ? normalizeTradeDateKey(row.tradeDate)
        : null;
    const close = Number(row.close);
    if (!tradeDate || !Number.isFinite(close) || close <= 0) continue;
    prices.set(tradeDate, close);
  }
  return prices;
}

export type PortfolioFilterOptions = {
  maxConcurrent: number;
  noSymbolOverlap: boolean;
  rejectTrade?: (trade: BacktestTrade) => boolean;
  reserveRejectedSlots?: boolean;
};

export type PortfolioLedger = {
  equityCurve: BacktestEquityPoint[];
  snapshots: BacktestPortfolioSnapshot[];
};

export function filterTradesByPortfolioRules(
  trades: BacktestTrade[],
  options: PortfolioFilterOptions,
): BacktestTrade[] {
  const maxConcurrent = Math.max(1, Math.floor(options.maxConcurrent));
  const sorted = [...trades].sort((a, b) => {
    if (a.entryDate !== b.entryDate) {
      return normalizeTradeDateKey(a.entryDate).localeCompare(
        normalizeTradeDateKey(b.entryDate),
      );
    }
    if (a.symbol !== b.symbol) return a.symbol.localeCompare(b.symbol);
    return a.holdDays - b.holdDays;
  });

  const accepted: BacktestTrade[] = [];
  const open: Array<{ symbol: string; exitDate: string }> = [];

  for (const trade of sorted) {
    if (!trade.exitDate) continue;
    const entryKey = normalizeTradeDateKey(trade.entryDate);
    const stillOpen = open.filter(
      (position) =>
        normalizeTradeDateKey(position.exitDate) > entryKey,
    );
    open.length = 0;
    open.push(...stillOpen);

    if (
      options.noSymbolOverlap &&
      open.some((position) => position.symbol === trade.symbol)
    ) {
      continue;
    }
    if (open.length >= maxConcurrent) continue;

    if (options.rejectTrade?.(trade)) {
      if (options.reserveRejectedSlots) {
        open.push({ symbol: trade.symbol, exitDate: trade.exitDate });
      }
      continue;
    }

    accepted.push(trade);
    open.push({ symbol: trade.symbol, exitDate: trade.exitDate });
  }

  return accepted;
}

export function buildPortfolioEquityCurve(
  trades: BacktestTrade[],
  slots = 5,
): BacktestEquityPoint[] {
  return buildPortfolioLedger(trades, {
    slots,
    initialCapital: 100,
  }).equityCurve;
}

export function buildPortfolioLedger(
  trades: BacktestTrade[],
  options: {
    slots?: number;
    initialCapital?: number;
    etfTradingCosts?: EtfTradingCostRates;
  } = {},
): PortfolioLedger {
  const valid = trades.filter(
    (trade) => trade.exitDate && trade.returnPct != null && trade.entryPrice > 0,
  );
  if (valid.length === 0) return { equityCurve: [], snapshots: [] };

  const slotCount = Math.max(1, Math.floor(options.slots ?? 5));
  const initialCapital =
    options.initialCapital != null && Number.isFinite(options.initialCapital)
      ? Math.max(1, options.initialCapital)
      : 100;
  const dates = [
    ...new Set(
      valid.flatMap((trade) => [
        normalizeTradeDateKey(trade.entryDate),
        normalizeTradeDateKey(trade.exitDate as string),
        ...readTradePricePath(trade).keys(),
      ]),
    ),
  ].sort();
  const entriesByDate = new Map<string, BacktestTrade[]>();
  const exitsByDate = new Map<string, BacktestTrade[]>();
  for (const trade of valid) {
    const entryDate = normalizeTradeDateKey(trade.entryDate);
    const exitDate = normalizeTradeDateKey(trade.exitDate as string);
    entriesByDate.set(entryDate, [...(entriesByDate.get(entryDate) ?? []), trade]);
    exitsByDate.set(exitDate, [...(exitsByDate.get(exitDate) ?? []), trade]);
  }

  let cash = initialCapital;
  const active = new Map<string, {
    trade: BacktestTrade;
    costAmount: number;
    shares: number;
    marketValue: number;
    lastPrice: number;
    priceByDate: Map<string, number>;
  }>();
  const points: BacktestEquityPoint[] = [];
  const snapshots: BacktestPortfolioSnapshot[] = [];
  let closedTrades = 0;

  const markPoint = (tradeDate: string) => {
    const positions = [...active.values()]
      .sort((a, b) => {
        if (a.trade.entryDate !== b.trade.entryDate) {
          return a.trade.entryDate.localeCompare(b.trade.entryDate);
        }
        return a.trade.symbol.localeCompare(b.trade.symbol);
      });
    let investedMarketValue = 0;
    for (const position of positions) {
      const markPrice = position.priceByDate.get(tradeDate) ?? position.lastPrice;
      position.lastPrice = markPrice;
      position.marketValue = position.shares * markPrice;
      investedMarketValue += position.marketValue;
    }
    const totalValue = cash + investedMarketValue;
    const returnPct = ((totalValue - initialCapital) / initialCapital) * 100;
    const roundedTotalValue = round(totalValue, 2);
    const roundedInvestedMarketValue = round(investedMarketValue, 2);
    const roundedCash = round(cash, 2);

    snapshots.push({
      tradeDate,
      cash: roundedCash,
      investedMarketValue: roundedInvestedMarketValue,
      totalValue: roundedTotalValue,
      returnPct: round(returnPct),
      closedTrades,
      positions: positions.map((position) => {
        const tradeReturnPct =
          position.costAmount > 0
            ? round(((position.marketValue - position.costAmount) / position.costAmount) * 100)
            : null;
        return {
          symbol: position.trade.symbol,
          name: position.trade.name,
          assetType: position.trade.assetType,
          entryDate: position.trade.entryDate,
          entryPrice: position.trade.entryPrice,
          shares: round(position.shares, 2),
          costAmount: round(position.costAmount, 2),
          marketValue: round(position.marketValue, 2),
          weightPct:
            roundedTotalValue > 0
              ? round((position.marketValue / roundedTotalValue) * 100)
              : 0,
          returnPct: tradeReturnPct,
          exitDate: position.trade.exitDate,
        };
      }),
    });

    const equity = (totalValue / initialCapital) * 100;
    points.push({
      tradeDate,
      equity: round(equity, 4),
      returnPct: round(equity - 100),
      closedTrades,
    });
  };

  const closePosition = (trade: BacktestTrade): boolean => {
    const key = `${trade.symbol}-${trade.entryDate}`;
    const position = active.get(key);
    if (!position) return false;
    const proceeds =
      trade.assetType === 'etf' && options.etfTradingCosts && trade.exitPrice != null
        ? calcEtfSellProceeds({
            shares: position.shares,
            price: trade.exitPrice,
            ...options.etfTradingCosts,
          }).netProceeds
        : position.costAmount * (1 + (trade.returnPct as number) / 100);
    cash += proceeds;
    active.delete(key);
    closedTrades += 1;
    return true;
  };

  for (const date of dates) {
    for (const trade of exitsByDate.get(date) ?? []) {
      closePosition(trade);
    }

    const entries = entriesByDate.get(date) ?? [];
    for (let index = 0; index < entries.length; index += 1) {
      const trade = entries[index];
      if (active.size >= slotCount) continue;
      const remainingEntries = entries.length - index;
      const remainingSlots = Math.max(1, slotCount - active.size);
      const slotsToFill = Math.min(remainingEntries, remainingSlots);
      const targetBudget = cash / slotsToFill;
      const positionSize = calcPositionSize({
        assetType: trade.assetType,
        budget: targetBudget,
        price: trade.entryPrice,
        costRates: options.etfTradingCosts,
      });
      if (!positionSize) continue;
      cash -= positionSize.costAmount;
      active.set(`${trade.symbol}-${trade.entryDate}`, {
        trade,
        costAmount: positionSize.costAmount,
        shares: positionSize.shares,
        marketValue: positionSize.costAmount,
        lastPrice: trade.entryPrice,
        priceByDate: readTradePricePath(trade),
      });
      if (normalizeTradeDateKey(trade.exitDate as string) === date) {
        closePosition(trade);
      }
    }

    markPoint(date);
  }

  const dedupedPoints = new Map<string, BacktestEquityPoint>();
  for (const point of points) {
    dedupedPoints.set(point.tradeDate, point);
  }
  const dedupedSnapshots = new Map<string, BacktestPortfolioSnapshot>();
  for (const snapshot of snapshots) {
    dedupedSnapshots.set(snapshot.tradeDate, snapshot);
  }

  return {
    equityCurve: [...dedupedPoints.values()].sort((a, b) =>
      a.tradeDate.localeCompare(b.tradeDate),
    ),
    snapshots: [...dedupedSnapshots.values()].sort((a, b) =>
      a.tradeDate.localeCompare(b.tradeDate),
    ),
  };
}

export function buildPortfolioSnapshots(
  trades: BacktestTrade[],
  slots = 5,
  initialCapital = 100_000,
): BacktestPortfolioSnapshot[] {
  return buildPortfolioLedger(trades, { slots, initialCapital }).snapshots;
}

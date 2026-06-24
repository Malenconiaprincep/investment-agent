import { normalizeTradeDateKey } from './date-range.js';
import type { BacktestEquityPoint, BacktestTrade } from './types.js';

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

export type PortfolioFilterOptions = {
  maxConcurrent: number;
  noSymbolOverlap: boolean;
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

    accepted.push(trade);
    open.push({ symbol: trade.symbol, exitDate: trade.exitDate });
  }

  return accepted;
}

export function buildPortfolioEquityCurve(
  trades: BacktestTrade[],
  slots = 5,
): BacktestEquityPoint[] {
  const valid = trades.filter(
    (trade) => trade.exitDate && trade.returnPct != null,
  );
  if (valid.length === 0) return [];

  const slotCount = Math.max(1, Math.floor(slots));
  const slotWeight = 1 / slotCount;
  const events = valid
    .flatMap((trade) => [
      {
        date: normalizeTradeDateKey(trade.entryDate),
        kind: 'entry' as const,
        trade,
      },
      {
        date: normalizeTradeDateKey(trade.exitDate as string),
        kind: 'exit' as const,
        trade,
      },
    ])
    .sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      if (a.kind === b.kind) return 0;
      return a.kind === 'exit' ? -1 : 1;
    });

  let cash = 100;
  const active = new Map<string, { trade: BacktestTrade; allocation: number }>();
  const points: BacktestEquityPoint[] = [];
  let closedTrades = 0;

  const markPoint = (tradeDate: string) => {
    let invested = 0;
    for (const position of active.values()) {
      invested += position.allocation;
    }
    const equity = cash + invested;
    points.push({
      tradeDate,
      equity: round(equity, 4),
      returnPct: round(equity - 100),
      closedTrades,
    });
  };

  for (const event of events) {
    if (event.kind === 'entry') {
      if (active.size >= slotCount) continue;
      const allocation = cash * slotWeight;
      if (allocation <= 0) continue;
      cash -= allocation;
      active.set(`${event.trade.symbol}-${event.trade.entryDate}`, {
        trade: event.trade,
        allocation,
      });
      markPoint(event.date);
      continue;
    }

    const key = `${event.trade.symbol}-${event.trade.entryDate}`;
    const position = active.get(key);
    if (!position) continue;
    const proceeds =
      position.allocation * (1 + (event.trade.returnPct as number) / 100);
    cash += proceeds;
    active.delete(key);
    closedTrades += 1;
    markPoint(event.date);
  }

  const deduped = new Map<string, BacktestEquityPoint>();
  for (const point of points) {
    deduped.set(point.tradeDate, point);
  }
  return [...deduped.values()].sort((a, b) =>
    a.tradeDate.localeCompare(b.tradeDate),
  );
}

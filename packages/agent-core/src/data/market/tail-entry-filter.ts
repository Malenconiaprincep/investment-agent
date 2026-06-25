import { getLikelyUpLimitPct, isLikelyLimitUp } from './price-limit.js';
import { isRetailTradableStock } from './asset-type.js';
import type { TailEntryStockPick } from './tail-entry-outlook.js';

export function isTailEntryLimitUp(stock: {
  symbol: string;
  name: string;
  pctChg: number;
}): boolean {
  return isLikelyLimitUp({
    symbol: stock.symbol,
    name: stock.name,
    pctChg: stock.pctChg,
  });
}

/** 尾盘仍可介入：有强度、未涨停、未贴近涨停价 */
export function isTailEntryBuyable(stock: {
  symbol: string;
  name: string;
  pctChg: number;
}): boolean {
  if (isTailEntryLimitUp(stock)) return false;
  const limitPct = getLikelyUpLimitPct(stock.symbol, stock.name);
  if (stock.pctChg < 1.5) return false;
  // 距涨停不足约 1.2 个百分点，尾盘很难买到
  if (stock.pctChg >= limitPct - 1.2) return false;
  return true;
}

export function enrichTailEntryStockPick(
  pick: TailEntryStockPick,
): TailEntryStockPick {
  if (isTailEntryLimitUp(pick)) {
    return {
      ...pick,
      tier: 'speculative',
      tierLabel: '已涨停',
      logic: '今日已涨停，尾盘只能排板，普通买入很难成交',
      riskNote: '已涨停，不建议作为尾盘介入参考',
    };
  }

  const limitPct = getLikelyUpLimitPct(pick.symbol, pick.name);
  const nearLimit = pick.pctChg >= limitPct - 2.5;

  return {
    ...pick,
    tier: pick.netInflowWan >= 30000 ? 'first' : 'second',
    tierLabel: pick.netInflowWan >= 30000 ? '中军' : '弹性',
    logic: nearLimit
      ? `涨幅 ${pick.pctChg.toFixed(2)}%，接近涨停，尾盘介入需控制仓位`
      : pick.netInflowWan >= 30000
        ? '资金流入居前，强势但未封板，尾盘仍可介入'
        : '板块内涨幅靠前且未涨停，适合尾盘跟踪',
    riskNote: nearLimit ? '接近涨停，注意追高风险' : undefined,
  };
}

export function splitTailEntryStocks(
  picks: TailEntryStockPick[],
  buyableLimit: number,
): { buyable: TailEntryStockPick[]; limitUp: TailEntryStockPick[] } {
  const seen = new Set<string>();
  const buyable: TailEntryStockPick[] = [];
  const limitUp: TailEntryStockPick[] = [];

  for (const raw of picks) {
    if (seen.has(raw.symbol)) continue;
    if (!isRetailTradableStock(raw.symbol)) continue;
    seen.add(raw.symbol);
    const pick = enrichTailEntryStockPick(raw);
    if (isTailEntryBuyable(pick)) {
      if (buyable.length < buyableLimit) buyable.push(pick);
    } else if (isTailEntryLimitUp(pick)) {
      limitUp.push(pick);
    }
  }

  return { buyable, limitUp };
}

export function pickBuyableTailEntryStocks(
  picks: TailEntryStockPick[],
  limit: number,
): TailEntryStockPick[] {
  return splitTailEntryStocks(picks, limit).buyable;
}

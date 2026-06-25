import {
  ETF_MOMENTUM_TOP_N,
  ETF_PAPER_PROBE_DEPLOY_PCT,
} from './bucket.js';
import { roundToLot } from './trading-calendar.js';

export function countEtfTargetSlots(
  targets: Array<{ symbol: string }>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const target of targets) {
    counts.set(target.symbol, (counts.get(target.symbol) ?? 0) + 1);
  }
  return counts;
}

export function calcEtfTargetBudget(input: {
  totalEquity: number;
  deployableScale: number;
  slotCount: number;
  isProbeEntry: boolean;
}): number {
  const deployable = input.totalEquity * input.deployableScale;
  const fullBudget = (deployable / ETF_MOMENTUM_TOP_N) * input.slotCount;
  if (input.isProbeEntry) {
    return deployable * ETF_PAPER_PROBE_DEPLOY_PCT;
  }
  return fullBudget;
}

export function calcEtfBuySharesFromBudget(budget: number, price: number): number {
  if (budget <= 0 || price <= 0) return 0;
  return roundToLot(Math.floor(budget / price));
}

export function calcEtfPaperBuyShares(input: {
  totalEquity: number;
  deployableScale: number;
  price: number;
  slotCount: number;
  isProbeEntry: boolean;
  currentMarketValue?: number;
}): number {
  const targetBudget = calcEtfTargetBudget(input);
  const currentMv = input.currentMarketValue ?? 0;
  const buyBudget = Math.max(0, targetBudget - currentMv);
  return calcEtfBuySharesFromBudget(buyBudget, input.price);
}

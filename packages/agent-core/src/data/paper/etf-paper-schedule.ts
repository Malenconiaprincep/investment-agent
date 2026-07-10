import { ETF_MOMENTUM_REBALANCE_DAYS } from './bucket.js';
import { shiftTradeDateLabel } from './trading-calendar.js';

export function resolveNextEtfRebalanceDate(input: {
  lastRebalanceDate: string | null | undefined;
  tradeDate: string;
  rebalanceDays?: number;
}): string {
  if (!input.lastRebalanceDate) return input.tradeDate;
  const target = shiftTradeDateLabel(
    input.lastRebalanceDate,
    input.rebalanceDays ?? ETF_MOMENTUM_REBALANCE_DAYS,
  );
  return target < input.tradeDate ? input.tradeDate : target;
}

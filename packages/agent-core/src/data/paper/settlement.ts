import { isEtfSymbol } from '../market/asset-type.js';

export type PaperSettlementRule = 't0' | 't1';

/** A 股 ETF 场内 T+0；股票 T+1 */
export function getPaperSettlementRule(symbol: string): PaperSettlementRule {
  return isEtfSymbol(symbol) ? 't0' : 't1';
}

export function usesT1Settlement(symbol: string): boolean {
  return getPaperSettlementRule(symbol) === 't1';
}

export function settlementRuleLabel(symbol: string): string {
  return usesT1Settlement(symbol) ? 'T+1' : 'T+0';
}

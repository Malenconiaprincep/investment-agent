import { describe, expect, it } from 'vitest';
import {
  getPaperSettlementRule,
  settlementRuleLabel,
  usesT1Settlement,
} from './settlement.js';

describe('paper settlement rules', () => {
  it('treats A-share ETFs as T+0', () => {
    expect(getPaperSettlementRule('510300')).toBe('t0');
    expect(getPaperSettlementRule('159915')).toBe('t0');
    expect(usesT1Settlement('510300')).toBe(false);
    expect(settlementRuleLabel('510300')).toBe('T+0');
  });

  it('treats stocks as T+1', () => {
    expect(getPaperSettlementRule('600519')).toBe('t1');
    expect(getPaperSettlementRule('300014')).toBe('t1');
    expect(usesT1Settlement('300014')).toBe(true);
    expect(settlementRuleLabel('300014')).toBe('T+1');
  });
});

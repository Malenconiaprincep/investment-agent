import { describe, expect, it } from 'vitest';
import {
  calcEtfPaperBuyShares,
  calcEtfTargetBudget,
  countEtfTargetSlots,
} from './etf-paper-sizing.js';

describe('etf paper sizing', () => {
  it('counts duplicate momentum slots per symbol', () => {
    const counts = countEtfTargetSlots([
      { symbol: '510300' },
      { symbol: '510300' },
      { symbol: '510300' },
      { symbol: '159915' },
    ]);
    expect(counts.get('510300')).toBe(3);
    expect(counts.get('159915')).toBe(1);
  });

  it('uses 25% probe budget on first entry instead of full slot stack', () => {
    const probeBudget = calcEtfTargetBudget({
      totalEquity: 50_000,
      deployableScale: 1,
      slotCount: 4,
      isProbeEntry: true,
    });
    const fullBudget = calcEtfTargetBudget({
      totalEquity: 50_000,
      deployableScale: 1,
      slotCount: 4,
      isProbeEntry: false,
    });

    expect(probeBudget).toBe(12_500);
    expect(fullBudget).toBe(50_000);

    const probeShares = calcEtfPaperBuyShares({
      totalEquity: 50_000,
      deployableScale: 1,
      price: 5,
      slotCount: 4,
      isProbeEntry: true,
    });
    expect(probeShares).toBe(2500);
  });

  it('tops up toward full allocation on rebalance when already holding', () => {
    const shares = calcEtfPaperBuyShares({
      totalEquity: 50_000,
      deployableScale: 1,
      price: 5,
      slotCount: 4,
      isProbeEntry: false,
      currentMarketValue: 12_000,
    });
    expect(shares).toBe(7600);
  });
});

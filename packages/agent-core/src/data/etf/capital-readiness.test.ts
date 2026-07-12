import { describe, expect, it } from 'vitest';
import {
  ETF_CAPITAL_ACCEPTANCE,
  rebuildDualSleeveShadowLedger,
  type ShadowExecutionEvidence,
  type ShadowPlanRecord,
} from './capital-readiness.js';

describe('长青 V3 资金准入', () => {
  it('验收门槛不能被短期回测结果放宽', () => {
    expect(ETF_CAPITAL_ACCEPTANCE.minShadowExecutionDays).toBe(20);
    expect(ETF_CAPITAL_ACCEPTANCE.minPaperTradingDays).toBe(60);
    expect(ETF_CAPITAL_ACCEPTANCE.minWeeklyReviews).toBe(8);
    expect(ETF_CAPITAL_ACCEPTANCE.initialCapitalTranchePct).toBe(10);
  });

  it('增长和防守袖套独立记账并计入T+1成本', () => {
    const basePlan = {
      strategy: 'etf-evergreen-v3',
      signalDate: '20260101',
      generatedAt: '2026-01-01T08:00:00.000Z',
      cashReservePct: 0,
      targets: [{ symbol: '510300', name: '沪深300ETF', targetWeightPct: 60 }],
      sleeves: {
        growth: {
          rebalanceDays: 10,
          stopLossPct: -20,
          stopCooldownDays: 20,
          targets: [{
            symbol: '510300',
            name: '沪深300ETF',
            targetWeightPct: 100,
            assetClass: 'growth',
          }],
        },
        defensive: {
          rebalanceDays: 20,
          stopLossPct: -20,
          stopCooldownDays: 10,
          targets: [],
        },
      },
      recordedAt: '2026-01-01T08:00:00.000Z',
    };
    const plans: ShadowPlanRecord[] = [
      { ...basePlan, executionDate: '20260102' },
      { ...basePlan, signalDate: '20260102', executionDate: '20260105' },
    ];
    const evidence = (executionDate: string, signalDate: string, close: number): ShadowExecutionEvidence => ({
      executionDate,
      signalDate,
      generatedAt: '2026-01-06T08:00:00.000Z',
      targetCount: 1,
      pricedTargetCount: 1,
      priceCoveragePct: 100,
      weightedAverageAbsGapPct: 0,
      valid: true,
      prices: [{
        symbol: '510300',
        name: '沪深300ETF',
        targetWeightPct: 60,
        signalClose: 100,
        executionOpen: 100,
        executionClose: close,
        gapPct: 0,
      }],
    });
    const ledger = rebuildDualSleeveShadowLedger(plans, [
      evidence('20260102', '20260101', 110),
      evidence('20260105', '20260102', 90),
    ]);

    expect(ledger.tradingDays).toBe(2);
    expect(ledger.orderCount).toBe(1);
    expect(ledger.rebalanceCount).toBe(2);
    expect(ledger.firstTradeDate).toBe('20260102');
    expect(ledger.sleeves.growth?.positionCount).toBe(1);
    expect(ledger.sleeves.defensive?.positionCount).toBe(0);
    expect(ledger.equityCurve[0]?.totalValue).toBeLessThan(105_000);
    expect(ledger.maxDrawdownPct).toBeLessThan(0);
  });
});

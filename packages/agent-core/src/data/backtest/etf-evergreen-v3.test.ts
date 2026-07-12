import { describe, expect, it } from 'vitest';
import {
  buildEtfEvergreenV3LivePlan,
  runEtfEvergreenV3Backtest,
} from './etf-evergreen-v3.js';

describe('长青 V3 双袖套回测', () => {
  it('按60/40组合增长和防守袖套，并保持T+1执行', async () => {
    const result = await runEtfEvergreenV3Backtest({
      startDate: '2025-07-10',
      endDate: '2026-07-10',
      growthWeightPct: 0.6,
    });

    expect(result.strategy).toBe('etf-evergreen-v3');
    expect(result.config?.signalExecution).toBe('next_open');
    expect(result.config?.growthSleeveWeightPct).toBe(0.6);
    expect(result.config?.defensiveSleeveWeightPct).toBeCloseTo(0.4);
    expect(result.equityCurve?.length).toBeGreaterThan(200);
    expect(result.evergreenMetrics.maxDrawdownPct).toBeLessThanOrEqual(0);
    expect(result.evergreenMetrics.totalTradingCost).toBeGreaterThan(0);
    expect(result.evergreenMetrics.tradingCostPct).toBeGreaterThan(0);
    expect(
      result.portfolioSnapshots?.every((snapshot) =>
        snapshot.positions.every((position) => position.shares % 100 === 0),
      ),
    ).toBe(true);
    expect(result.notes.some((note) => note.includes('511880'))).toBe(true);
    expect(result.notes.some((note) => note.includes('不缩放成交份额'))).toBe(true);
  });

  it('生成与回测同配置的实时影子目标', async () => {
    const plan = await buildEtfEvergreenV3LivePlan({
      executionDate: '2026-07-11',
    });
    const totalTargetPct = plan.targets.reduce(
      (sum, target) => sum + target.targetWeightPct,
      0,
    );

    expect(plan.strategy).toBe('etf-evergreen-v3');
    expect(plan.signalDate).toBe('20260710');
    expect(plan.executionDate).toBe('20260711');
    expect(plan.targets.length).toBeGreaterThan(0);
    expect(totalTargetPct).toBeGreaterThan(75);
    expect(totalTargetPct).toBeLessThanOrEqual(100.01);
    expect(totalTargetPct + plan.cashReservePct).toBeCloseTo(100, 2);
    expect(plan.targets.some((target) => target.symbol === '511880')).toBe(true);
    expect(plan.targets.some((target) => target.reason.includes('增长袖套'))).toBe(true);
    expect(plan.targets.some((target) => target.reason.includes('防守袖套'))).toBe(true);
  });
});

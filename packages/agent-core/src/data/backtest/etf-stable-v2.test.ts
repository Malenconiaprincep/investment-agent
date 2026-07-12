import { describe, expect, it } from 'vitest';
import { ETF_STABLE_V2_UNIVERSE } from '../etf/stable-universe.js';
import {
  advanceStableV2RiskControl,
  buildStableV2Allocation,
  createStableV2History,
  runEtfStableV2Backtest,
  type StableV2Bar,
} from './etf-stable-v2.js';

function dates(count: number): string[] {
  const output: string[] = [];
  const date = new Date(Date.UTC(2020, 0, 1));
  while (output.length < count) {
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) output.push(date.toISOString().slice(0, 10).replace(/-/g, ''));
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return output;
}

function history(symbol: string, dailyReturn: number, nextOpenMultiplier = 1) {
  const item = ETF_STABLE_V2_UNIVERSE.find((entry) => entry.symbol === symbol)!;
  const tradeDates = dates(180);
  let close = 100;
  const bars: StableV2Bar[] = tradeDates.map((tradeDate, index) => {
    close *= 1 + dailyReturn;
    const open = index === 151 ? close * nextOpenMultiplier : close;
    return { tradeDate, open, high: Math.max(open, close), low: Math.min(open, close), close };
  });
  return createStableV2History(item, bars);
}

function universe() {
  return [
    history('510300', 0.0015),
    history('513500', 0.0012),
    history('513100', 0.0018),
    history('512480', 0.0022),
    history('518880', 0.0005),
    history('511010', 0.0002),
    history('511880', 0.00005),
  ];
}

describe('ETF Stable V2 allocation', () => {
  it('caps tactical weight and avoids duplicate risk clusters', () => {
    const histories = universe();
    const signalDate = histories[0]!.bars[150]!.tradeDate;
    const allocation = buildStableV2Allocation({ histories, signalDate });
    const tacticalWeight = allocation.targets
      .filter((target) => target.assetClass === 'equity_tactical')
      .reduce((sum, target) => sum + target.targetWeight, 0);
    const usTargets = allocation.targets.filter((target) => target.riskCluster === 'us_equity');

    expect(tacticalWeight).toBeLessThanOrEqual(0.2 + 1e-8);
    expect(usTargets.length).toBeLessThanOrEqual(1);
    expect(allocation.targets.reduce((sum, target) => sum + target.targetWeight, 0)).toBeCloseTo(1, 6);
  });

  it('keeps a benchmark core allocation in a confirmed bull regime', () => {
    const histories = universe();
    const allocation = buildStableV2Allocation({
      histories,
      signalDate: histories[0]!.bars[150]!.tradeDate,
    });
    const benchmark = allocation.targets.find((target) => target.symbol === '510300');

    expect(allocation.regime).toBe('bull');
    expect(benchmark?.targetWeight).toBeGreaterThanOrEqual(0.49);
  });

  it('switches to the cash ETF at the hard drawdown guard', () => {
    const histories = universe();
    const allocation = buildStableV2Allocation({
      histories,
      signalDate: histories[0]!.bars[150]!.tradeDate,
      drawdownPct: -13,
    });
    expect(allocation.drawdownStage).toBe('hard');
    expect(allocation.targets).toHaveLength(1);
    expect(allocation.targets[0]?.symbol).toBe('511880');
    expect(allocation.targets[0]?.targetWeight).toBeCloseTo(1, 6);
  });

  it('exits hard risk-off after a minimum hold and confirmed market recovery', () => {
    const recovered = advanceStableV2RiskControl({
      state: {
        stage: 'hard',
        stageDays: 19,
        recoveryDays: 4,
        anchorPeakEquity: 100_000,
      },
      equity: 88_000,
      recoveryEligible: true,
    });

    expect(recovered.stage).toBe('defensive');
    expect(recovered.changed).toBe(true);
    expect(recovered.anchorPeakEquity).toBe(88_000);
    expect(recovered.controlDrawdownPct).toBe(0);
  });

  it('does not exit hard risk-off while the market recovery is unconfirmed', () => {
    const guarded = advanceStableV2RiskControl({
      state: {
        stage: 'hard',
        stageDays: 60,
        recoveryDays: 0,
        anchorPeakEquity: 100_000,
      },
      equity: 88_000,
      recoveryEligible: false,
    });

    expect(guarded.stage).toBe('hard');
    expect(guarded.changed).toBe(false);
    expect(guarded.anchorPeakEquity).toBe(100_000);
  });

  it('generates the signal at T close and executes at T+1 open', async () => {
    const histories = universe();
    const startDate = histories[0]!.bars[150]!.tradeDate;
    const endDate = histories[0]!.bars[160]!.tradeDate;
    const result = await runEtfStableV2Backtest({
      histories,
      startDate,
      endDate,
      rebalanceDays: 20,
    });
    const firstExecution = result.rebalanceLog[0];
    const firstTrade = result.trades.find((trade) => trade.signal.metadata?.signalExecution === 'next_open');

    expect(firstExecution?.signalDate).toBe(startDate);
    expect(firstExecution?.executionDate).toBe(histories[0]!.bars[151]!.tradeDate);
    expect(firstTrade?.entryDate).toBe(firstExecution?.executionDate);
    expect(firstTrade?.signal.tradeDate).toBe(firstExecution?.signalDate);
    for (const trade of result.trades) {
      expect(trade.signal.metadata?.executionDate).toBe(trade.entryDate);
      expect(trade.signal.tradeDate < trade.entryDate).toBe(true);
    }
  });
});

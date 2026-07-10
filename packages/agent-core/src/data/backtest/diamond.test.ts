import { describe, expect, it } from 'vitest';

import {
  computeDiamondV2SelectionScore,
  resolveStockBacktestEntryExecution,
} from './diamond.js';
import type { OhlcvBar } from '../market/indicators.js';

const bars: OhlcvBar[] = [
  { tradeDate: '20260107', open: 10.8, high: 11, low: 10.6, close: 10.9, vol: 100 },
  { tradeDate: '20260106', open: 10.1, high: 10.7, low: 10, close: 10.6, vol: 100 },
  { tradeDate: '20260105', open: 9.8, high: 10.2, low: 9.7, close: 10, vol: 100 },
];

describe('stock backtest entry execution', () => {
  it('uses the next trading day open after close-based confirmation', () => {
    expect(
      resolveStockBacktestEntryExecution({
        bars,
        confirmationTradeDate: '20260105',
        mode: 'next_open',
      }),
    ).toEqual({ tradeDate: '20260106', price: 10.1 });
  });

  it('keeps the legacy confirmation close mode explicit', () => {
    expect(
      resolveStockBacktestEntryExecution({
        bars,
        confirmationTradeDate: '20260105',
        mode: 'confirmation_close',
      }),
    ).toEqual({ tradeDate: '20260105', price: 10 });
  });
});

describe('diamond v2 selection score', () => {
  it('ranks stronger, liquid and less extended candidates higher', () => {
    const strong = computeDiamondV2SelectionScore({
      signalScore: 87,
      signalVolumeRatio: 2,
      entryVolumeRatio: 1.8,
      entryMa20ExtensionPct: 5,
      benchmarkMomentum20Pct: 4,
      delayedEntryDriftPct: 1,
      avgTurnoverAmount5d: 120_000_000,
    });
    const weak = computeDiamondV2SelectionScore({
      signalScore: 74,
      signalVolumeRatio: 1.8,
      entryVolumeRatio: 1.2,
      entryMa20ExtensionPct: 10,
      benchmarkMomentum20Pct: 0,
      delayedEntryDriftPct: -4,
      avgTurnoverAmount5d: 30_000_000,
    });

    expect(strong).toBeGreaterThan(weak);
  });
});

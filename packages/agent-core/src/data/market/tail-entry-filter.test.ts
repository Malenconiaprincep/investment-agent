import { describe, expect, it } from 'vitest';
import {
  isTailEntryBuyable,
  isTailEntryLimitUp,
  pickBuyableTailEntryStocks,
  splitTailEntryStocks,
} from './tail-entry-filter.js';
import type { TailEntryStockPick } from './tail-entry-outlook.js';

function pick(input: Partial<TailEntryStockPick> & Pick<TailEntryStockPick, 'symbol' | 'name' | 'pctChg'>): TailEntryStockPick {
  return {
    netInflowWan: 5000,
    tier: 'second',
    tierLabel: '弹性',
    logic: 'test',
    ...input,
  };
}

describe('tail-entry-filter', () => {
  it('detects 20cm limit-up on STAR board', () => {
    expect(isTailEntryLimitUp({ symbol: '688525', name: '佰维存储', pctChg: 20 })).toBe(true);
    expect(isTailEntryBuyable({ symbol: '688525', name: '佰维存储', pctChg: 20 })).toBe(false);
  });

  it('keeps strong but not limit-up stocks buyable', () => {
    expect(isTailEntryBuyable({ symbol: '300408', name: '三环集团', pctChg: 10.84 })).toBe(true);
  });

  it('excludes near-limit 10cm stocks', () => {
    expect(isTailEntryBuyable({ symbol: '600000', name: '测试', pctChg: 9.2 })).toBe(false);
    expect(isTailEntryBuyable({ symbol: '600000', name: '测试', pctChg: 7.5 })).toBe(true);
  });

  it('prefers buyable leaders over limit-up when sorting board list', () => {
    const merged = [
      pick({ symbol: '300223', name: '北京君正', pctChg: 20 }),
      pick({ symbol: '300408', name: '三环集团', pctChg: 10.84 }),
      pick({ symbol: '688521', name: '芯原股份', pctChg: 12.67 }),
    ];
    const { buyable, limitUp } = splitTailEntryStocks(merged, 2);
    expect(buyable.map((s) => s.symbol)).toEqual(['300408']);
    expect(limitUp.map((s) => s.symbol)).toEqual(['300223']);
    expect(pickBuyableTailEntryStocks(merged, 2).map((s) => s.symbol)).toEqual([
      '300408',
    ]);
  });

  it('excludes star market 688 symbols', () => {
    const merged = [
      pick({ symbol: '688525', name: '佰维存储', pctChg: 14 }),
      pick({ symbol: '600000', name: '浦发银行', pctChg: 5 }),
    ];
    expect(pickBuyableTailEntryStocks(merged, 2).map((s) => s.symbol)).toEqual([
      '600000',
    ]);
  });
});

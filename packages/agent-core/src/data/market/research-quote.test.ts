import { describe, expect, it } from 'vitest';
import {
  formatResearchQuoteBlock,
  type ResearchMarketSnapshot,
} from './research-quote.js';

function makeSnapshot(
  partial: Partial<ResearchMarketSnapshot> = {},
): ResearchMarketSnapshot {
  return {
    tsCode: '300759.SZ',
    symbol: '300759',
    asOf: '2026-06-25T06:30:00.000Z',
    tradeDate: '2026-06-25',
    currentPrice: 152.5,
    currentPctChg: 7.13,
    priceSource: 'intraday',
    live: {
      symbol: '300759',
      name: '康龙化成',
      price: 152.5,
      pctChg: 7.13,
      change: 10.15,
      open: 142.0,
      high: 153.0,
      low: 141.5,
      prevClose: 142.35,
      volume: 1_200_000,
      amount: 180_000_000,
    },
    daily: {
      tsCode: '300759.SZ',
      quotes: [],
      latestClose: 142.35,
      latestPctChg: 0,
      dataSource: 'tencent',
      asOf: '2026-06-25T06:30:00.000Z',
      cached: false,
      disclaimer: '',
    },
    dataSource: 'eastmoney-intraday',
    cached: false,
    ...partial,
  };
}

describe('formatResearchQuoteBlock', () => {
  it('includes live price and query time', () => {
    const text = formatResearchQuoteBlock(makeSnapshot());
    expect(text).toContain('此刻现价');
    expect(text).toContain('152.50');
    expect(text).toContain('+7.13');
    expect(text).toContain('东方财富实时行情');
  });

  it('falls back to daily close when live missing', () => {
    const text = formatResearchQuoteBlock(
      makeSnapshot({
        live: null,
        priceSource: 'daily-close',
        currentPrice: 142.35,
        currentPctChg: -1.2,
      }),
    );
    expect(text).toContain('142.35');
    expect(text).toContain('日 K 最新收盘');
  });
});

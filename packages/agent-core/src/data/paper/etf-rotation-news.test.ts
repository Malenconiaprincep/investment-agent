import { describe, expect, it } from 'vitest';
import type { HotNewsItem } from '../market/hot-market-discovery.js';
import {
  buildEtfRotationContext,
  matchEtfThemes,
  themeMatchesEtfKeyword,
} from './etf-rotation-news.js';

describe('etf rotation news', () => {
  it('matches hot themes to ETF keywords', () => {
    expect(themeMatchesEtfKeyword('人工智能', '人工智能')).toBe(true);
    expect(matchEtfThemes('515980', '人工智能ETF', ['人工智能', '银行']).sort()).toEqual([
      '人工智能',
    ]);
  });

  it('boosts theme-matched ETFs and blocks bearish news entries', () => {
    const news: HotNewsItem[] = [
      {
        title: '人工智能板块走强，算力龙头获资金流入',
        datetime: '2026-06-26 10:00',
        source: 'test',
      },
      {
        title: '光伏行业利空：组件价格持续下跌，龙头预减',
        datetime: '2026-06-26 09:30',
        source: 'test',
      },
    ];

    const context = buildEtfRotationContext({
      tradeDate: '2026-06-26',
      news,
      newsFilter: 'avoid_bearish',
      lookbackDays: 3,
      themeLimit: 5,
    });

    expect(context.themeBoostBySymbol['515980']).toBe(3);
    expect(context.newsBlockedSymbols.has('515790')).toBe(true);
    expect(context.newsBlockedSymbols.has('510300')).toBe(false);
    expect(context.summary).toContain('主线');
  });
});

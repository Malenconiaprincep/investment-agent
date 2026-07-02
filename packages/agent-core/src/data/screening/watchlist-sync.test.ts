import { describe, expect, it } from 'vitest';
import type { ScreeningSessionRecord } from './store.js';
import {
  gradeScreeningCandidate,
  selectScreeningWatchlistCandidates,
} from './watchlist-sync.js';

function candidate(
  symbol: string,
  name: string,
  total: number,
  assetType: 'stock' | 'etf' = 'stock',
  outlook: NonNullable<
    ScreeningSessionRecord['candidates'][number]['factorScore']
  >['outlook'] = 'neutral',
  diamond?: 'red' | 'blue',
): ScreeningSessionRecord['candidates'][number] {
  return {
    symbol,
    name,
    thesis: `${name} thesis`,
    dataSource: 'test',
    assetType,
    diamond: diamond
      ? {
          strength: diamond,
          score: diamond === 'red' ? 88 : 72,
          tradeDate: '2026-07-01',
          close: 10,
          reasons: [],
        }
      : null,
    factorScore: {
      total,
      themeScore: total,
      longTermScore: total,
      trendReturnScore: total,
      stabilityScore: total,
      outlook,
      outlookLabel:
        outlook === 'mainline-trend'
          ? '主线趋势'
          : outlook === 'long-watch'
            ? '趋势观察'
            : '中性观望',
      matchedTheme: null,
      ret20dPct: null,
      ret60dPct: null,
      ret120dPct: null,
    },
  };
}

function session(
  candidates: ScreeningSessionRecord['candidates'],
): ScreeningSessionRecord {
  return {
    id: 'screen-1',
    query: 'test',
    sectors: [],
    candidates,
    rotationSummary: '',
    hotNews: [],
    hotThemes: [],
    mode: 'auto',
    passed: true,
    elapsedMs: 1,
    createdAt: '2026-07-01T09:25:00.000Z',
    tailEntryOutlook: null,
    tailEntryRun: null,
  };
}

describe('screening watchlist sync', () => {
  it('grades strong and warming screening candidates', () => {
    expect(gradeScreeningCandidate(candidate('000001', 'A', 66))).toBe('A');
    expect(gradeScreeningCandidate(candidate('000002', 'B', 48, 'stock', 'long-watch'))).toBe('B');
    expect(gradeScreeningCandidate(candidate('000003', 'C', 40))).toBe('C');
    expect(gradeScreeningCandidate(candidate('000004', 'D', 30, 'stock', 'neutral', 'red'))).toBe('A');
  });

  it('selects separate stock and ETF buckets', () => {
    const picked = selectScreeningWatchlistCandidates(
      session([
        candidate('000001', '平安银行', 62),
        candidate('000002', '万科A', 56),
        candidate('000003', '国瓷材料', 49),
        candidate('000004', '低分股票', 20),
        candidate('510300', '沪深300ETF', 70, 'etf'),
        candidate('159915', '创业板ETF', 52, 'etf'),
        candidate('BAD', '坏代码', 99),
      ]),
      { stockLimit: 2, etfLimit: 1 },
    );

    expect(picked.map((item) => item.symbol)).toEqual(['510300', '000001', '000002']);
    expect(picked.filter((item) => item.assetType === 'stock')).toHaveLength(2);
    expect(picked.filter((item) => item.assetType === 'etf')).toHaveLength(1);
  });

  it('skips board and index rows from screening results', () => {
    const board = candidate('886110', '2026中报预增', 99);
    board.thesis = '指数代码: 886110.TI；指数简称: 2026中报预增；最新价: 1234';

    const sector = candidate('885808', '养鸡', 98);
    sector.thesis = '板块名称: 养鸡；最新涨跌幅: 6.11%；指数代码: 885808.TI';

    const picked = selectScreeningWatchlistCandidates(
      session([
        board,
        sector,
        candidate('000001', '平安银行', 62),
      ]),
      { stockLimit: 3, etfLimit: 0 },
    );

    expect(picked.map((item) => item.symbol)).toEqual(['000001']);
  });
});

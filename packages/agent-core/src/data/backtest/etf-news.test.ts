import { describe, expect, it } from 'vitest';
import {
  evaluateEtfNewsSentiment,
  getEtfNewsProfile,
  getStockNewsProfile,
  scoreNewsTitleForEtf,
  shouldBlockEtfEntryByNews,
} from './etf-news.js';

describe('etf news sentiment', () => {
  it('scores bullish semiconductor headline', () => {
    const profile = getEtfNewsProfile('512480', '国泰CES半导体ETF');
    const scored = scoreNewsTitleForEtf(
      '半导体板块政策利好，龙头订单增长',
      profile,
    );
    expect(scored.relevant).toBe(true);
    expect(scored.bullish).toBeGreaterThan(0);
  });

  it('blocks bearish entries in avoid_bearish mode', () => {
    const profile = getEtfNewsProfile('512880', '证券ETF');
    const sentiment = evaluateEtfNewsSentiment({
      profile,
      news: [
        {
          title: '券商板块利空，证券股集体下跌',
          datetime: '2026-06-24T10:00:00+08:00',
          url: null,
        },
      ],
    });
    expect(sentiment.label).toBe('利空');
    expect(
      shouldBlockEtfEntryByNews(sentiment, 'avoid_bearish').blocked,
    ).toBe(true);
  });

  it('requires positive net in require_bullish mode', () => {
    const profile = getEtfNewsProfile('515980', '人工智能ETF');
    const sentiment = evaluateEtfNewsSentiment({
      profile,
      news: [
        {
          title: '人工智能板块震荡整理',
          datetime: '2026-06-24T10:00:00+08:00',
          url: null,
        },
      ],
    });
    expect(
      shouldBlockEtfEntryByNews(sentiment, 'require_bullish').blocked,
    ).toBe(true);
  });

  it('scores stock headlines by company short name', () => {
    const profile = getStockNewsProfile('600519', '贵州茅台股份有限公司');
    const scored = scoreNewsTitleForEtf(
      '贵州茅台遭遇利空，白酒板块走弱',
      profile,
    );
    expect(scored.relevant).toBe(true);
    expect(scored.bearish).toBeGreaterThan(0);
  });
});

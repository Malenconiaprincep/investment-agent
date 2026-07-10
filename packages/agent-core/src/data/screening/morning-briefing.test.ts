import { describe, expect, it } from 'vitest';
import type { DataQualityHarnessReport } from '../../eval/data-quality-harness.js';
import type { EtfMorningRadarResult } from '../etf/morning-radar.js';
import type { HotNewsItem } from '../market/hot-market-discovery.js';
import type { PreopenScreeningDoneEvent } from './preopen-screening.js';
import {
  buildMorningBriefingLines,
  buildMorningBriefingScreeningQuery,
  deriveMorningStance,
  evaluateMorningBriefingQuality,
  type MorningBriefingContext,
  type MorningBriefingMarketItem,
} from './morning-briefing.js';

function dataQualityReport(): DataQualityHarnessReport {
  return {
    name: 'data-quality',
    ranAt: '2026-07-09T00:30:00.000Z',
    expectedDataDate: '2026-07-08',
    passed: true,
    score: 98.1,
    summary: { pass: 12, warn: 1, fail: 0 },
    freshness: {
      tradeDate: '2026-07-09',
      isTradingDay: true,
      expectedDataDate: '2026-07-08',
      benchmarkLatestDate: '20260708',
      stockSampleLatestDate: '20260708',
      latestDataDate: '20260708',
      isFresh: true,
      reminder: null,
    },
    checks: [
      {
        id: 'freshness.expected-date',
        label: '本地行情新鲜度',
        status: 'pass',
        detail: '本地行情已覆盖期望日期',
      },
    ],
  };
}

function markets(): MorningBriefingMarketItem[] {
  return [
    {
      id: 'sp500',
      name: '标普500',
      symbol: '^GSPC',
      region: 'US',
      role: 'risk',
      price: 5600,
      open: 5660,
      changePct: -1.1,
      asOf: '2026-07-08T20:00:00.000Z',
      source: 'fixture',
    },
    {
      id: 'nasdaq',
      name: '纳斯达克',
      symbol: '^IXIC',
      region: 'US',
      role: 'risk',
      price: 18300,
      open: 18580,
      changePct: -1.4,
      asOf: '2026-07-08T20:00:00.000Z',
      source: 'fixture',
    },
    {
      id: 'gold',
      name: 'COMEX黄金',
      symbol: 'GC=F',
      region: 'COMMODITY',
      role: 'defensive',
      price: 2450,
      open: 2420,
      changePct: 1.5,
      asOf: '2026-07-08T20:00:00.000Z',
      source: 'fixture',
    },
    {
      id: 'nikkei',
      name: '日经225',
      symbol: '^N225',
      region: 'JP',
      role: 'risk',
      price: 40500,
      open: 40200,
      changePct: -0.2,
      asOf: '2026-07-09T00:30:00.000Z',
      source: 'fixture',
    },
  ];
}

function proxyMarkets(): MorningBriefingMarketItem[] {
  return [
    {
      id: 'proxy-hs300',
      name: '沪深300ETF',
      symbol: '510300',
      region: 'CN',
      role: 'local-risk',
      price: 4.2,
      changePct: 0.2,
      asOf: '20260708',
      source: 'local-etf',
      proxy: true,
    },
  ];
}

function internationalNews(): HotNewsItem[] {
  return [
    {
      title: '美股三大指数收跌，纳指跌幅居前，市场等待美联储通胀数据',
      datetime: '2026-07-09T07:10:00+08:00',
      url: null,
    },
    {
      title: '中东风险扰动油价，避险情绪推升黄金',
      datetime: '2026-07-09T07:20:00+08:00',
      url: null,
    },
  ];
}

function domesticNews(): HotNewsItem[] {
  return [
    {
      title: 'A股机器人板块活跃，多家公司披露订单增长',
      datetime: '2026-07-09T07:30:00+08:00',
      url: null,
    },
    {
      title: '央行开展公开市场操作，流动性保持合理充裕',
      datetime: '2026-07-09T07:40:00+08:00',
      url: null,
    },
  ];
}

function etfRadar(): EtfMorningRadarResult {
  return {
    tradeDate: '2026-07-09',
    stage: 'open',
    stageLabel: '早盘异动观察',
    summary: '早盘异动观察：发现 1 只 ETF 异动，均等待尾盘确认',
    candidates: [
      {
        symbol: '512880',
        exchangeCode: 'sh512880',
        name: '证券ETF',
        price: 1.02,
        changePct: 2.3,
        volumeRatio: 1.2,
        dailyTurnover: 180_000_000,
        ma5: 1,
        ma20: 0.98,
        ma30: 0.97,
        failCount: 1,
        status: 'surge_watch',
        actionLabel: '异动观察',
        reasons: ['涨幅 +2.30%', '量比 1.20'],
        note: '等待尾盘确认',
      },
    ],
    errors: [],
    poolSize: 20,
    generatedAt: '2026-07-09T01:35:00.000Z',
    elapsedMs: 1200,
  };
}

function screeningDone(): PreopenScreeningDoneEvent {
  return {
    type: 'done',
    query: '早报判断防守，外盘与新闻偏谨慎，围绕机器人筛选股票或ETF',
    sectors: [{ name: '机器人', reason: '新闻催化', dataSource: 'iwencai' }],
    candidates: [
      {
        symbol: '159530',
        name: '机器人ETF',
        thesis: '主题有催化，使用 ETF 降低个股波动',
        dataSource: 'iwencai',
        assetType: 'etf',
        diamond: null,
        factorScore: {
          total: 76,
          themeScore: 80,
          longTermScore: 72,
          trendReturnScore: 75,
          stabilityScore: 78,
          outlook: 'mainline-trend',
          outlookLabel: '主线趋势',
          matchedTheme: '机器人',
          ret20dPct: 6.1,
          ret60dPct: 12.2,
          ret120dPct: 18.5,
        },
      },
    ],
    diamondPicks: [],
    rotationSummary: '测试',
    hotNews: [],
    hotThemes: ['机器人'],
    mode: 'manual',
    passed: true,
    missingSections: [],
    missingKeywords: [],
    screenedAt: '2026-07-09T00:36:00.000Z',
    elapsedMs: 1000,
    sessionId: 'screen-morning-1',
    watchlistSync: {
      screeningId: 'screen-morning-1',
      added: [],
      skipped: [],
      ranAt: '2026-07-09T00:36:00.000Z',
    },
    fetchErrors: [],
    tailEntryOutlook: null,
    tailEntryRun: null,
  };
}

function context(): MorningBriefingContext {
  const dataQuality = dataQualityReport();
  const stance = deriveMorningStance({
    dataQuality,
    markets: markets(),
    internationalNews: internationalNews(),
    domesticNews: domesticNews(),
    themes: ['机器人', '黄金'],
    etfRadar: etfRadar(),
  });
  return {
    tradeDate: '2026-07-09',
    generatedAt: '2026-07-09T00:30:00.000Z',
    dataQuality,
    markets: markets(),
    proxyMarkets: proxyMarkets(),
    marketErrors: [],
    internationalNews: internationalNews(),
    domesticNews: domesticNews(),
    themes: ['机器人', '黄金'],
    newsSources: ['fixture'],
    newsErrors: [],
    stance,
    etfRadar: etfRadar(),
  };
}

describe('morning briefing', () => {
  it('derives defense stance from weak global markets and risk-off news', () => {
    const stance = context().stance;

    expect(stance.mode).toBe('defense');
    expect(stance.label).toBe('防守');
    expect(stance.reasons.join('\n')).toContain('风险因子承压');
  });

  it('builds a stance-aware screening query', () => {
    const query = buildMorningBriefingScreeningQuery(context());

    expect(query).toContain('早报判断防守');
    expect(query).toContain('机器人');
    expect(query).toContain('黄金');
    expect(query).toContain('低波动');
  });

  it('formats a Feishu-ready report with markets, news, stance and candidates', () => {
    const lines = buildMorningBriefingLines({
      context: context(),
      screening: screeningDone(),
      now: new Date('2026-07-09T00:30:00.000Z'),
    });
    const text = lines.join('\n');

    expect(text).toContain('今日基调：防守');
    expect(text).toContain('外盘与资产');
    expect(text).toContain('标普500(^GSPC) 开盘');
    expect(text).toContain('国际新闻');
    expect(text).toContain('筛选口径');
    expect(text).toContain('机器人ETF(159530)');
    expect(text).not.toContain('沪深300ETF(510300)');
    expect(lines.every((line) => line.length <= 120)).toBe(true);
  });

  it('evaluates briefing quality including Feishu readability', () => {
    const report = evaluateMorningBriefingQuality({
      context: context(),
      screening: screeningDone(),
    });

    expect(report.passed).toBe(true);
    expect(report.score).toBeGreaterThanOrEqual(90);
    expect(report.checks.map((check) => check.id)).toContain('international-news');
  });
});

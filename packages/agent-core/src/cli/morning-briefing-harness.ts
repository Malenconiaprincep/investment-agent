import type { DataQualityHarnessReport } from '../eval/data-quality-harness.js';
import type { HotNewsItem } from '../data/market/hot-market-discovery.js';
import type { PreopenScreeningDoneEvent } from '../data/screening/preopen-screening.js';
import {
  buildMorningBriefingLines,
  buildMorningBriefingScreeningQuery,
  deriveMorningStance,
  evaluateMorningBriefingQuality,
  type MorningBriefingContext,
  type MorningBriefingMarketItem,
} from '../data/screening/morning-briefing.js';

type HarnessCheck = {
  name: string;
  ok: boolean;
  detail?: string;
};

function assertCheck(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

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

function context(overrides?: Partial<MorningBriefingContext>): MorningBriefingContext {
  const dataQuality = dataQualityReport();
  const baseMarkets = markets();
  const baseInternationalNews = internationalNews();
  const baseDomesticNews = domesticNews();
  const themes = ['机器人', '黄金'];
  const stance = deriveMorningStance({
    dataQuality,
    markets: baseMarkets,
    internationalNews: baseInternationalNews,
    domesticNews: baseDomesticNews,
    themes,
    etfRadar: null,
  });

  return {
    tradeDate: '2026-07-09',
    generatedAt: '2026-07-09T00:30:00.000Z',
    dataQuality,
    markets: baseMarkets,
    proxyMarkets: proxyMarkets(),
    marketErrors: [],
    internationalNews: baseInternationalNews,
    domesticNews: baseDomesticNews,
    themes,
    newsSources: ['fixture'],
    newsErrors: [],
    stance,
    etfRadar: null,
    ...overrides,
  };
}

function screeningDone(): PreopenScreeningDoneEvent {
  return {
    type: 'done',
    query: buildMorningBriefingScreeningQuery(context()),
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
    rotationSummary: 'fixture',
    hotNews: [],
    hotThemes: ['机器人'],
    mode: 'manual',
    passed: true,
    missingSections: [],
    missingKeywords: [],
    screenedAt: '2026-07-09T00:36:00.000Z',
    elapsedMs: 1000,
    sessionId: 'screen-morning-fixture',
    watchlistSync: {
      screeningId: 'screen-morning-fixture',
      added: [],
      skipped: [],
      ranAt: '2026-07-09T00:36:00.000Z',
    },
    fetchErrors: [],
    tailEntryOutlook: null,
    tailEntryRun: null,
  };
}

async function main() {
  const checks: HarnessCheck[] = [];
  const reportContext = context();
  const screening = screeningDone();
  const lines = buildMorningBriefingLines({
    context: reportContext,
    screening,
    now: new Date('2026-07-09T00:30:00.000Z'),
  });
  const text = lines.join('\n');

  assertCheck(reportContext.stance.mode === 'defense', 'fixture should produce defense stance');
  checks.push({
    name: 'stance-defense',
    ok: true,
    detail: `${reportContext.stance.label}(${reportContext.stance.score})`,
  });

  const query = buildMorningBriefingScreeningQuery(reportContext);
  assertCheck(query.includes('早报判断防守'), 'screening query should carry briefing stance');
  assertCheck(query.includes('机器人'), 'screening query should carry briefing themes');
  checks.push({ name: 'query-uses-briefing', ok: true });

  for (const section of ['今日基调', '外盘与资产', '国际新闻', '筛选口径', '股票/ETF候选']) {
    assertCheck(text.includes(section), `Feishu report should include section: ${section}`);
  }
  assertCheck(text.includes('标普500(^GSPC) 开盘'), 'global section should use real index open data');
  assertCheck(!text.includes('沪深300ETF(510300)'), 'global section should not show ETF proxies when real indices exist');
  assertCheck(lines.every((line) => line.length <= 120), 'Feishu lines should fit readable length');
  checks.push({ name: 'feishu-report-shape', ok: true });

  const quality = evaluateMorningBriefingQuality({
    context: reportContext,
    screening,
    lines,
  });
  assertCheck(quality.passed, 'quality report should pass complete fixture');
  assertCheck(quality.score >= 90, 'quality score should be at least 90 for complete fixture');
  checks.push({ name: 'quality-complete-fixture', ok: true, detail: String(quality.score) });

  const emptyContext = context({
    markets: [],
    proxyMarkets: [],
    internationalNews: [],
    domesticNews: [],
    themes: [],
    stance: deriveMorningStance({
      dataQuality: dataQualityReport(),
      markets: [],
      internationalNews: [],
      domesticNews: [],
      themes: [],
      etfRadar: null,
    }),
  });
  const emptyQuality = evaluateMorningBriefingQuality({
    context: emptyContext,
  });
  assertCheck(!emptyQuality.passed, 'quality report should fail when markets/news are missing');
  checks.push({
    name: 'quality-detects-missing-context',
    ok: true,
    detail: String(emptyQuality.score),
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        checks,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

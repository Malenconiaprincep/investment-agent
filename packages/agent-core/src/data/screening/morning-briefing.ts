import { safeFetch } from '../../lib/safe-fetch.js';
import type { DataQualityHarnessReport } from '../../eval/data-quality-harness.js';
import type { EtfMorningRadarResult } from '../etf/morning-radar.js';
import { runEtfMorningRadar } from '../etf/morning-radar.js';
import type { HotNewsItem } from '../market/hot-market-discovery.js';
import {
  extractThemesFromNews,
  fetchHotNews as fetchMarketHotNews,
  pickNewsForThemes,
  rankHotNews,
} from '../market/hot-market-discovery.js';
import { getDailyQuote } from '../market/services.js';
import { formatTradeDate, getBeijingNow } from '../paper/trading-calendar.js';
import type { PreopenScreeningDoneEvent } from './preopen-screening.js';

export type MorningBriefingRiskMode = 'attack' | 'balanced' | 'defense';

export type MorningBriefingMarketRole =
  | 'risk'
  | 'local-risk'
  | 'defensive'
  | 'currency'
  | 'commodity';

export type MorningBriefingMarketItem = {
  id: string;
  name: string;
  symbol: string;
  region: string;
  role: MorningBriefingMarketRole;
  price: number | null;
  open?: number | null;
  changePct: number | null;
  asOf: string | null;
  source: 'yahoo-index' | 'yahoo-asset' | 'local-etf' | 'fixture';
  sessionLabel?: string;
  proxy?: boolean;
};

export type MorningBriefingStance = {
  mode: MorningBriefingRiskMode;
  label: string;
  score: number;
  exposureHint: string;
  actionBias: string;
  reasons: string[];
};

export type MorningBriefingContext = {
  tradeDate: string;
  generatedAt: string;
  dataQuality: DataQualityHarnessReport;
  /** 真实外盘指数/商品/汇率，不包含 ETF 代理 */
  markets: MorningBriefingMarketItem[];
  /** ETF 代理只做降级参考，不参与外盘展示默认列表和攻防评分 */
  proxyMarkets: MorningBriefingMarketItem[];
  marketErrors: string[];
  internationalNews: HotNewsItem[];
  domesticNews: HotNewsItem[];
  themes: string[];
  newsSources: string[];
  newsErrors: string[];
  stance: MorningBriefingStance;
  etfRadar: EtfMorningRadarResult | null;
};

export type MorningBriefingQualityCheckStatus = 'pass' | 'warn' | 'fail';

export type MorningBriefingQualityCheck = {
  id: string;
  label: string;
  status: MorningBriefingQualityCheckStatus;
  detail: string;
};

export type MorningBriefingQualityReport = {
  name: 'morning-briefing';
  ranAt: string;
  passed: boolean;
  score: number;
  summary: {
    pass: number;
    warn: number;
    fail: number;
  };
  checks: MorningBriefingQualityCheck[];
};

export type MorningBriefingDeps = {
  fetchGlobalMarkets?: () => Promise<MorningBriefingMarketItem[]>;
  fetchProxyMarkets?: () => Promise<MorningBriefingMarketItem[]>;
  fetchNews?: () => Promise<{ items: HotNewsItem[]; sourcesUsed: string[] }>;
  runEtfRadar?: () => Promise<EtfMorningRadarResult | null>;
};

type YahooChartResponse = {
  chart?: {
    result?: Array<{
      meta?: {
        regularMarketPrice?: number;
        regularMarketOpen?: number;
        chartPreviousClose?: number;
        previousClose?: number;
        regularMarketTime?: number;
        marketState?: string;
      };
    }>;
  };
};

const GLOBAL_MARKETS: Array<
  Omit<MorningBriefingMarketItem, 'price' | 'changePct' | 'asOf' | 'source'>
> = [
  { id: 'sp500', name: '标普500', symbol: '^GSPC', region: 'US', role: 'risk' },
  { id: 'nasdaq', name: '纳斯达克', symbol: '^IXIC', region: 'US', role: 'risk' },
  { id: 'dow', name: '道琼斯', symbol: '^DJI', region: 'US', role: 'risk' },
  { id: 'hsi', name: '恒生指数', symbol: '^HSI', region: 'HK', role: 'risk' },
  { id: 'nikkei', name: '日经225', symbol: '^N225', region: 'JP', role: 'risk' },
  { id: 'gold', name: 'COMEX黄金', symbol: 'GC=F', region: 'COMMODITY', role: 'defensive' },
  { id: 'oil', name: 'WTI原油', symbol: 'CL=F', region: 'COMMODITY', role: 'commodity' },
  { id: 'usd-cnh', name: '美元/离岸人民币', symbol: 'CNH=X', region: 'FX', role: 'currency' },
];

const GLOBAL_PROXY_ETFS: Array<
  Omit<MorningBriefingMarketItem, 'price' | 'changePct' | 'asOf' | 'source'> & {
    sourceName: string;
  }
> = [
  {
    id: 'proxy-nasdaq',
    name: '纳指科技ETF',
    symbol: '513100',
    region: 'CN-QDII',
    role: 'risk',
    sourceName: '纳指代理',
  },
  {
    id: 'proxy-sp500',
    name: '标普500ETF',
    symbol: '513500',
    region: 'CN-QDII',
    role: 'risk',
    sourceName: '标普代理',
  },
  {
    id: 'proxy-nikkei',
    name: '日经ETF',
    symbol: '513520',
    region: 'CN-QDII',
    role: 'risk',
    sourceName: '日经代理',
  },
  {
    id: 'proxy-china-internet',
    name: '中概互联ETF',
    symbol: '513050',
    region: 'CN-QDII',
    role: 'risk',
    sourceName: '中概代理',
  },
  {
    id: 'proxy-hs300',
    name: '沪深300ETF',
    symbol: '510300',
    region: 'CN',
    role: 'local-risk',
    sourceName: 'A股代理',
  },
];

const INTERNATIONAL_NEWS_PATTERNS = [
  /美股|道指|纳指|标普|英伟达|苹果|特斯拉|美联储|美元|美债|非农|CPI|PCE/i,
  /港股|恒生|中概|日经|日本|韩国|欧洲|欧股|德国|英国|法国/,
  /原油|黄金|铜价|大宗商品|中东|俄乌|地缘|关税|制裁/,
];

const DOMESTIC_NEWS_PATTERNS = [
  /A股|沪深|创业板|科创|涨停|板块|概念|主力|国务院|央行|证监会/,
  /半导体|AI|人工智能|机器人|医药|新能源|银行|地产|消费|军工|稀土/,
];

const POSITIVE_NEWS_PATTERNS = [
  /上涨|收涨|反弹|新高|突破|走强|风险偏好|降息|宽松|刺激|回暖|增持|回购/,
];

const NEGATIVE_NEWS_PATTERNS = [
  /下跌|收跌|重挫|跳水|暴跌|避险|冲突|制裁|关税|衰退|加息|收益率上行|美元走强|油价大涨|风险事件/,
];

function beijingTimeLabel(date = new Date()): string {
  return date.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
}

function compact(value: string | undefined, maxLength: number): string {
  const text = value?.trim() ?? '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function formatPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function qualityCheck(
  id: string,
  label: string,
  status: MorningBriefingQualityCheckStatus,
  detail: string,
): MorningBriefingQualityCheck {
  return { id, label, status, detail };
}

function isInternationalNews(item: HotNewsItem): boolean {
  return INTERNATIONAL_NEWS_PATTERNS.some((pattern) => pattern.test(item.title));
}

function isDomesticNews(item: HotNewsItem): boolean {
  return DOMESTIC_NEWS_PATTERNS.some((pattern) => pattern.test(item.title));
}

function scoreNewsItem(item: HotNewsItem): number {
  const title = item.title;
  let score = 0;
  if (POSITIVE_NEWS_PATTERNS.some((pattern) => pattern.test(title))) score += 1;
  if (NEGATIVE_NEWS_PATTERNS.some((pattern) => pattern.test(title))) score -= 1;
  return score;
}

function marketRiskScore(item: MorningBriefingMarketItem): number {
  const changePct = item.changePct;
  if (changePct == null || !Number.isFinite(changePct)) return 0;

  if (item.role === 'currency') {
    if (changePct >= 0.4) return -1;
    if (changePct <= -0.4) return 1;
    return 0;
  }

  if (item.role === 'defensive') {
    if (changePct >= 1.2) return -1;
    if (changePct <= -1.2) return 1;
    return 0;
  }

  if (item.role === 'commodity') {
    if (changePct >= 2) return -1;
    if (changePct <= -2) return 1;
    return 0;
  }

  if (changePct >= 1) return 2;
  if (changePct >= 0.35) return 1;
  if (changePct <= -1) return -2;
  if (changePct <= -0.35) return -1;
  return 0;
}

export function deriveMorningStance(input: {
  dataQuality: DataQualityHarnessReport;
  markets: MorningBriefingMarketItem[];
  internationalNews: HotNewsItem[];
  domesticNews: HotNewsItem[];
  themes: string[];
  etfRadar?: EtfMorningRadarResult | null;
}): MorningBriefingStance {
  const marketScore = input.markets.reduce((sum, item) => sum + marketRiskScore(item), 0);
  const newsScore = [...input.internationalNews.slice(0, 6), ...input.domesticNews.slice(0, 6)]
    .reduce((sum, item) => sum + scoreNewsItem(item), 0);
  const etfScore =
    input.etfRadar && input.etfRadar.candidates.length >= 3
      ? 1
      : input.etfRadar && input.etfRadar.errors.length >= 5
        ? -1
        : 0;
  const dataScore = input.dataQuality.passed
    ? input.dataQuality.summary.warn >= 2
      ? -1
      : 0
    : -3;
  const score = Math.max(-6, Math.min(6, marketScore + newsScore + etfScore + dataScore));
  const reasons: string[] = [];

  const positiveMarkets = input.markets
    .filter((item) => marketRiskScore(item) > 0)
    .slice(0, 2)
    .map((item) => `${item.name}${formatPct(item.changePct)}`);
  const negativeMarkets = input.markets
    .filter((item) => marketRiskScore(item) < 0)
    .slice(0, 2)
    .map((item) => `${item.name}${formatPct(item.changePct)}`);

  if (positiveMarkets.length > 0) {
    reasons.push(`风险资产偏强：${positiveMarkets.join('、')}`);
  }
  if (negativeMarkets.length > 0) {
    reasons.push(`风险因子承压：${negativeMarkets.join('、')}`);
  }
  if (!input.dataQuality.passed) {
    reasons.push(`本地数据质量未通过：${input.dataQuality.summary.fail} fail`);
  } else if (input.dataQuality.summary.warn > 0) {
    reasons.push(`数据有 ${input.dataQuality.summary.warn} 条预警，降低仓位置信心`);
  }

  const themeHint = input.themes.slice(0, 3).join('、');
  if (themeHint) reasons.push(`新闻主线：${themeHint}`);
  if (input.etfRadar && input.etfRadar.candidates.length > 0) {
    reasons.push(`ETF 早盘雷达发现 ${input.etfRadar.candidates.length} 只异动`);
  }

  if (reasons.length === 0) {
    reasons.push('外盘与新闻没有形成明确方向，先按均衡观察处理');
  }

  if (score >= 3) {
    return {
      mode: 'attack',
      label: '进攻',
      score,
      exposureHint: '候选池可偏主题进攻，但保留尾盘确认',
      actionBias: '优先强主线、资金承接好的股票和高流动性主题 ETF',
      reasons,
    };
  }

  if (score <= -2) {
    return {
      mode: 'defense',
      label: '防守',
      score,
      exposureHint: '控制开仓，优先观察和低波动资产',
      actionBias: '优先宽基、红利、银行、医药、黄金类 ETF，个股只留高质量候选',
      reasons,
    };
  }

  return {
    mode: 'balanced',
    label: '均衡',
    score,
    exposureHint: '轻仓试错，等待开盘后强弱验证',
    actionBias: '主题股票与 ETF 同步观察，避免追高单一方向',
    reasons,
  };
}

async function fetchYahooMarketItem(
  def: (typeof GLOBAL_MARKETS)[number],
): Promise<MorningBriefingMarketItem> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(def.symbol)}?range=5d&interval=1d`;
  const response = await safeFetch(
    url,
    {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    },
    {
      allowedHosts: ['query1.finance.yahoo.com'],
      retries: 1,
      timeoutMs: 8_000,
    },
  );
  const json = (await response.json()) as YahooChartResponse;
  const meta = json.chart?.result?.[0]?.meta;
  const price = meta?.regularMarketPrice ?? null;
  const open = meta?.regularMarketOpen ?? null;
  const prev = meta?.chartPreviousClose ?? meta?.previousClose ?? null;
  const changePct =
    price != null && prev != null && prev > 0
      ? Number((((price - prev) / prev) * 100).toFixed(2))
      : null;
  const asOf = meta?.regularMarketTime
    ? new Date(meta.regularMarketTime * 1000).toISOString()
    : null;

  return {
    ...def,
    price,
    open,
    changePct,
    asOf,
    source:
      def.role === 'commodity' || def.role === 'currency' || def.role === 'defensive'
        ? 'yahoo-asset'
        : 'yahoo-index',
    sessionLabel: meta?.marketState ?? undefined,
  };
}

export async function fetchYahooGlobalMarkets(): Promise<MorningBriefingMarketItem[]> {
  const settled = await Promise.allSettled(
    GLOBAL_MARKETS.map((item) => fetchYahooMarketItem(item)),
  );
  return fulfilledValues(settled);
}

export async function fetchGlobalProxyEtfs(): Promise<MorningBriefingMarketItem[]> {
  const settled = await Promise.allSettled(
    GLOBAL_PROXY_ETFS.map(async (item) => {
      const quote = await getDailyQuote(item.symbol, 5);
      return {
        id: item.id,
        name: item.name,
        symbol: item.symbol,
        region: item.region,
        role: item.role,
        price: quote.latestClose,
        changePct: quote.latestPctChg,
        asOf: quote.quotes[0]?.tradeDate ?? null,
        source: 'local-etf' as const,
        proxy: true,
      };
    }),
  );

  return fulfilledValues<MorningBriefingMarketItem>(settled);
}

function classifyNews(news: HotNewsItem[]): {
  internationalNews: HotNewsItem[];
  domesticNews: HotNewsItem[];
} {
  const ranked = rankHotNews(news);
  const internationalNews = ranked.filter(isInternationalNews).slice(0, 8);
  const domesticNews = ranked.filter(isDomesticNews).slice(0, 10);

  return {
    internationalNews:
      internationalNews.length > 0 ? internationalNews : ranked.slice(0, 3),
    domesticNews: domesticNews.length > 0 ? domesticNews : ranked.slice(0, 6),
  };
}

export async function buildMorningBriefingContext(input: {
  dataQuality: DataQualityHarnessReport;
  lookbackDays?: number;
  now?: Date;
  includeEtfRadar?: boolean;
  deps?: MorningBriefingDeps;
}): Promise<MorningBriefingContext> {
  const now = input.now ?? getBeijingNow();
  const generatedAt = new Date().toISOString();
  const marketErrors: string[] = [];
  const newsErrors: string[] = [];

  const [directMarkets, proxyMarkets, newsResult, etfRadar] = await Promise.all([
    (input.deps?.fetchGlobalMarkets ?? fetchYahooGlobalMarkets)().catch((error) => {
      marketErrors.push(`global: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }),
    (input.deps?.fetchProxyMarkets ?? fetchGlobalProxyEtfs)().catch((error) => {
      marketErrors.push(`proxy-etf: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }),
    (input.deps?.fetchNews ??
      (() => fetchMarketHotNews(30, { lookbackDays: input.lookbackDays ?? 3 })))().catch(
      (error) => {
        newsErrors.push(error instanceof Error ? error.message : String(error));
        return { items: [], sourcesUsed: [] };
      },
    ),
    input.includeEtfRadar === true
      ? (input.deps?.runEtfRadar ?? (() => runEtfMorningRadar({ stage: 'open' })))().catch(
          (error) => {
            marketErrors.push(`etf-radar: ${error instanceof Error ? error.message : String(error)}`);
            return null;
          },
        )
      : Promise.resolve(null),
  ]);

  const markets = directMarkets
    .filter((item) => !item.proxy && item.changePct != null)
    .slice(0, 10);
  const { internationalNews, domesticNews } = classifyNews(newsResult.items);
  const themes = extractThemesFromNews(
    pickNewsForThemes(newsResult.items, undefined, 2),
    4,
  );
  const stance = deriveMorningStance({
    dataQuality: input.dataQuality,
    markets,
    internationalNews,
    domesticNews,
    themes,
    etfRadar,
  });

  return {
    tradeDate: formatTradeDate(now),
    generatedAt,
    dataQuality: input.dataQuality,
    markets,
    proxyMarkets,
    marketErrors,
    internationalNews,
    domesticNews,
    themes,
    newsSources: newsResult.sourcesUsed,
    newsErrors,
    stance,
    etfRadar,
  };
}

export function buildMorningBriefingScreeningQuery(
  context: MorningBriefingContext,
): string {
  const themes =
    context.themes.length > 0 ? context.themes.slice(0, 3).join('、') : '市场主线';
  const marketBias = context.stance.label;

  if (context.stance.mode === 'defense') {
    return `早报判断${marketBias}，外盘与新闻偏谨慎，围绕${themes}筛选股票或ETF；优先宽基、红利、银行、医药、黄金、低波动方向，排除ST，避免高位追涨`;
  }

  if (context.stance.mode === 'attack') {
    return `早报判断${marketBias}，外盘风险偏好较强，围绕${themes}筛选股票或ETF；优先主线趋势、资金承接、成交活跃、高流动性ETF，排除ST`;
  }

  return `早报判断${marketBias}，围绕${themes}筛选股票或ETF；股票和ETF同步观察，优先趋势稳、流动性好、回撤可控，排除ST`;
}

function marketLine(item: MorningBriefingMarketItem): string {
  const openPart = item.open != null && Number.isFinite(item.open)
    ? `开盘 ${item.open.toFixed(2)} · `
    : '';
  const pricePart = item.price != null && Number.isFinite(item.price)
    ? `最新 ${item.price.toFixed(2)} `
    : '';
  const sourceLabel =
    item.source === 'local-etf'
      ? '代理参考'
      : item.source === 'yahoo-asset' ||
          item.role === 'commodity' ||
          item.role === 'currency' ||
          item.role === 'defensive'
        ? '资产'
        : '指数';
  return `· ${item.name}(${item.symbol}) ${openPart}${pricePart}${formatPct(item.changePct)} · ${item.region}/${sourceLabel}`;
}

function newsLine(item: HotNewsItem): string {
  return `· ${compact(item.title, 76)}`;
}

function fulfilledValues<T>(settled: PromiseSettledResult<T>[]): T[] {
  const values: T[] = [];
  for (const item of settled) {
    if (item.status === 'fulfilled') values.push(item.value);
  }
  return values;
}

function candidateLine(
  candidate: PreopenScreeningDoneEvent['candidates'][number],
  index: number,
): string {
  const assetType = candidate.assetType === 'etf' ? 'ETF' : '股票';
  const score = candidate.factorScore ? `因子${candidate.factorScore.total}` : '因子-';
  return `${index + 1}. ${candidate.name}(${candidate.symbol}) · ${assetType} · ${score} · ${compact(candidate.thesis, 36)}`;
}

export function buildMorningBriefingLines(input: {
  context: MorningBriefingContext;
  screening?: PreopenScreeningDoneEvent;
  now?: Date;
}): string[] {
  const { context, screening } = input;
  const lines: string[] = [
    `时间：${beijingTimeLabel(input.now)}`,
    `交易日：${context.tradeDate}`,
    `今日基调：${context.stance.label}（${context.stance.score}） · ${context.stance.exposureHint}`,
    `行动：${context.stance.actionBias}`,
    `数据质量：${context.dataQuality.score} 分 · ${context.dataQuality.summary.pass} pass / ${context.dataQuality.summary.warn} warn / ${context.dataQuality.summary.fail} fail`,
  ];

  lines.push('', '判断依据：');
  lines.push(...context.stance.reasons.slice(0, 4).map((item) => `· ${compact(item, 88)}`));

  lines.push('', '外盘与资产：');
  if (context.markets.length === 0) {
    lines.push('· 暂无可用真实外盘指数，按国际新闻降级判断；不使用 ETF 代理替代外盘。');
  } else {
    lines.push(...context.markets.slice(0, 6).map(marketLine));
  }

  if (context.markets.length === 0 && context.proxyMarkets.length > 0) {
    lines.push('', '代理参考（不参与外盘判断）：');
    lines.push(...context.proxyMarkets.slice(0, 4).map(marketLine));
  }

  lines.push('', '国际新闻：');
  if (context.internationalNews.length === 0) {
    lines.push('· 暂无明确国际新闻，开盘后以盘面验证为主。');
  } else {
    lines.push(...context.internationalNews.slice(0, 4).map(newsLine));
  }

  lines.push('', '国内主线：');
  if (context.themes.length > 0) {
    lines.push(`· 主题：${context.themes.slice(0, 5).join('、')}`);
  }
  lines.push(...context.domesticNews.slice(0, 3).map(newsLine));

  if (context.etfRadar) {
    const radar = context.etfRadar;
    lines.push('', `ETF 雷达：${radar.summary}`);
    for (const item of radar.candidates.slice(0, 3)) {
      lines.push(
        `· ${item.name}(${item.symbol}) ${formatPct(item.changePct)} · ${item.actionLabel}`,
      );
    }
  }

  if (screening) {
    lines.push(
      '',
      `筛选口径：${compact(screening.query, 96)}`,
      `股票/ETF候选：${screening.candidates.length} 只 · 钻石 ${screening.diamondPicks.length} 只 · 入跟踪池 ${screening.watchlistSync?.added.length ?? 0} 只`,
    );
    if (screening.candidates.length === 0) {
      lines.push('今日没有形成候选池。');
    } else {
      lines.push(...screening.candidates.slice(0, 8).map(candidateLine));
    }
    if (screening.sectors.length > 0) {
      lines.push(`板块：${screening.sectors.slice(0, 5).map((sector) => sector.name).join('、')}`);
    }
  }

  const warnings = [
    ...context.marketErrors.slice(0, 2),
    ...context.newsErrors.slice(0, 2),
    ...(screening?.fetchErrors ?? []).slice(0, 2),
  ];
  if (warnings.length > 0) {
    lines.push('', '待核实：', ...warnings.map((item) => `· ${compact(item, 88)}`));
  }

  lines.push('', '口径：早报用于研究和观察，不构成投资建议；盘中以成交额、承接和尾盘确认复核。');
  return lines.map((line) => compact(line, 118));
}

function countSummary(checks: MorningBriefingQualityCheck[]) {
  return checks.reduce(
    (summary, check) => ({
      ...summary,
      [check.status]: summary[check.status] + 1,
    }),
    { pass: 0, warn: 0, fail: 0 },
  );
}

function computeScore(summary: { pass: number; warn: number; fail: number }): number {
  const total = summary.pass + summary.warn + summary.fail;
  if (total === 0) return 0;
  return Number((((summary.pass * 100 + summary.warn * 65) / total)).toFixed(1));
}

export function evaluateMorningBriefingQuality(input: {
  context: MorningBriefingContext;
  screening?: PreopenScreeningDoneEvent;
  lines?: string[];
}): MorningBriefingQualityReport {
  const { context, screening } = input;
  const lines = input.lines ?? buildMorningBriefingLines(input);
  const checks: MorningBriefingQualityCheck[] = [];

  checks.push(
    qualityCheck(
      'data-quality',
      '本地数据质量',
      context.dataQuality.passed ? 'pass' : 'fail',
      context.dataQuality.passed
        ? `数据质量 ${context.dataQuality.score} 分。`
        : `数据质量未通过：${context.dataQuality.summary.fail} fail。`,
    ),
  );

  checks.push(
    qualityCheck(
      'global-markets',
      '外盘与资产覆盖',
      context.markets.length >= 4 ? 'pass' : context.markets.length > 0 ? 'warn' : 'fail',
      context.markets.length > 0
        ? `覆盖 ${context.markets.length} 个真实外盘/资产指标。`
        : '没有真实外盘指数或资产数据，不能用 ETF 代理替代。',
    ),
  );

  checks.push(
    qualityCheck(
      'international-news',
      '国际新闻覆盖',
      context.internationalNews.length >= 2
        ? 'pass'
        : context.internationalNews.length > 0
          ? 'warn'
          : 'fail',
      context.internationalNews.length > 0
        ? `覆盖 ${context.internationalNews.length} 条国际新闻。`
        : '没有国际新闻，早报缺少外部变量。',
    ),
  );

  checks.push(
    qualityCheck(
      'stance',
      '攻防判断',
      context.stance.reasons.length >= 2 ? 'pass' : 'warn',
      `${context.stance.label}，依据 ${context.stance.reasons.length} 条。`,
    ),
  );

  checks.push(
    qualityCheck(
      'candidate-link',
      '晨报驱动候选池',
      screening
        ? screening.candidates.length > 0
          ? 'pass'
          : 'warn'
        : 'warn',
      screening
        ? `候选 ${screening.candidates.length} 只，查询：${compact(screening.query, 72)}`
        : '当前只验证晨报结构，未传入选股结果。',
    ),
  );

  const longLines = lines.filter((line) => line.length > 120);
  checks.push(
    qualityCheck(
      'feishu-line-length',
      '飞书可读性',
      longLines.length === 0 ? 'pass' : 'warn',
      longLines.length === 0
        ? '所有行均控制在 120 字以内。'
        : `${longLines.length} 行超过 120 字，可能影响飞书阅读。`,
    ),
  );

  const summary = countSummary(checks);
  return {
    name: 'morning-briefing',
    ranAt: new Date().toISOString(),
    passed: summary.fail === 0,
    score: computeScore(summary),
    summary,
    checks,
  };
}

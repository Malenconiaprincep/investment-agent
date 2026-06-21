import { callIwencaiTool, isIwencaiMcpConfigured } from '../../mastra/mcp/iwencai.js';
import { extractNewsEntries } from './format-report-news.js';
import {
  fetchEastMoneyColumnNews,
  fetchEastMoneyFastNews,
  fetchSinaFinanceRollNews,
} from './free/market-news-feed.js';
import { enrichHotNews, type NewsMentionedSymbol } from './news-enrichment.js';

export type HotNewsItem = {
  title: string;
  datetime: string;
  url: string | null;
};

export type HotNewsFetchOptions = {
  lookbackDays?: number;
  /** YYYY-MM-DD；设置后为历史回放模式 */
  asOfDate?: string;
};

export type AutoScreenContext = {
  /** 展示用主题说明 */
  query: string;
  sectorQuery: string;
  stockQuery: string;
  /** 多路问财个股 query，避免单 query 总是同一批结果 */
  stockQueries: string[];
  hotNews: HotNewsItem[];
  hotThemes: string[];
  newsSymbols: NewsMentionedSymbol[];
  mode: 'auto' | 'manual';
  lookbackDays: number;
  asOfDate?: string;
};

const DEFAULT_LOOKBACK_DAYS = 14;

const NOISE_TITLE_PATTERNS = [
  /首页/,
  /_财经_/,
  /_市场_/,
  /_新浪网$/,
  /新浪财经_新浪网/,
  /cnfol\.com\/?$/,
  /cls\.cn$/,
  /rss/i,
  /app\.d\.html/,
  /zaker\/articles/,
  /召开董事会会议$/,
  /金投网/,
  /优惠来了/,
  /火爆原因/,
  /健康养生新闻/,
  /护理保健/,
  /美容护肤/,
];

const HOT_KEYWORD_PATTERN =
  /MLCC|半导体|AI|人工智能|涨停|板块|概念|资金|关税|国补|稀土|算力|机器人|医药|新能源|铜|金|银行|地产/i;

export function isNoiseNewsTitle(title: string): boolean {
  const trimmed = title.trim();
  if (trimmed.length < 10) return true;
  if (NOISE_TITLE_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return true;
  }
  const separators = (trimmed.match(/[_|/]/g) ?? []).length;
  if (separators >= 2 && trimmed.length < 40) return true;
  return false;
}

function scoreNewsTitle(title: string): number {
  if (isNoiseNewsTitle(title)) return -1;
  let score = 0;
  if (HOT_KEYWORD_PATTERN.test(title)) score += 10;
  if (/A股|沪深|涨停|板块|概念|主力|国补|央行|国务院/.test(title)) score += 8;
  if (/港股|港元|美股|增持\d/.test(title)) score -= 6;
  if (title.length >= 12 && title.length <= 60) score += 2;
  return score;
}

/** 按热度关键词排序后再提取主题 */
export function rankHotNews(news: HotNewsItem[]): HotNewsItem[] {
  return [...news].sort((a, b) => {
    const timeDiff = parseNewsTime(b.datetime) - parseNewsTime(a.datetime);
    if (timeDiff !== 0) return timeDiff;
    return scoreNewsTitle(b.title) - scoreNewsTitle(a.title);
  });
}

export function parseNewsTime(value: string): number {
  if (!value) return 0;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : 0;
}

/** 实时选股：主题提取优先用近几天新闻，避免 14 天窗口里老标题反复主导 */
export function pickNewsForThemes(
  news: HotNewsItem[],
  asOfDate?: string,
  recentDays = 3,
): HotNewsItem[] {
  if (asOfDate) {
    const onDay = news.filter((item) => {
      const ts = parseNewsTime(item.datetime);
      if (!ts) return false;
      const day = new Date(ts).toLocaleDateString('en-CA', {
        timeZone: 'Asia/Shanghai',
      });
      return day === asOfDate;
    });
    return onDay.length > 0 ? onDay : news;
  }

  const cutoffTs = Date.now() - recentDays * 24 * 60 * 60 * 1000;
  const recent = news.filter((item) => {
    const ts = parseNewsTime(item.datetime);
    return ts > 0 && ts >= cutoffTs;
  });
  return recent.length >= 3 ? recent : news.slice(0, 12);
}

function buildStockQueries(input: {
  themes: string[];
  excludeHint: string;
  isReplay: boolean;
  asOfDate?: string;
  newsSymbols: NewsMentionedSymbol[];
}): string[] {
  const queries: string[] = [];

  for (const theme of input.themes.slice(0, 3)) {
    queries.push(
      `${theme}主线龙头，60日涨幅靠前，站上MA60${input.excludeHint}`,
    );
    queries.push(
      `${theme}概念，板块强度靠前，MA20大于MA60${input.excludeHint}`,
    );
    queries.push(
      `${theme}相关，120日趋势向上，中期趋势${input.excludeHint}`,
    );
  }

  if (queries.length === 0) {
    queries.push(`A股主线，60日涨幅前30，MA60上方${input.excludeHint}`);
    queries.push(`A股，板块强度靠前，120日涨幅靠前${input.excludeHint}`);
    queries.push(`A股，中期趋势向上，均线多头${input.excludeHint}`);
  }

  if (input.newsSymbols.length > 0) {
    const codeHint = input.newsSymbols
      .slice(0, 6)
      .map((item) => item.symbol)
      .join('、');
    queries.push(`${codeHint}${input.excludeHint}，60日线趋势向上`);
  }

  return [...new Set(queries)];
}

function normalizeHotNewsKey(title: string): string {
  return title
    .replace(/【[^】]+】/g, '')
    .replace(/\s+/g, '')
    .slice(0, 48);
}

/** 多源新闻合并去重，优先较新的条目 */
export function mergeHotNewsSources(lists: HotNewsItem[][]): HotNewsItem[] {
  const seen = new Set<string>();
  const merged: HotNewsItem[] = [];

  for (const item of lists.flat()) {
    if (isNoiseNewsTitle(item.title)) continue;
    const key = normalizeHotNewsKey(item.title);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }

  return rankHotNews(merged);
}

export function resolveNewsWindow(options?: HotNewsFetchOptions): {
  asOf: Date;
  cutoff: Date;
  lookbackDays: number;
} {
  const lookbackDays = options?.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const asOf = options?.asOfDate
    ? new Date(`${options.asOfDate}T23:59:59+08:00`)
    : new Date();
  const cutoff = new Date(asOf);
  cutoff.setDate(cutoff.getDate() - lookbackDays);
  cutoff.setHours(0, 0, 0, 0);
  return { asOf, cutoff, lookbackDays };
}

/** 保留 lookback 窗口内、且不晚于 asOf 的新闻 */
export function filterHotNewsByWindow(
  news: HotNewsItem[],
  cutoff: Date,
  asOf: Date,
): HotNewsItem[] {
  const cutoffTs = cutoff.getTime();
  const asOfTs = asOf.getTime();

  return news.filter((item) => {
    const ts = parseNewsTime(item.datetime);
    if (!ts) return true;
    return ts >= cutoffTs && ts <= asOfTs;
  });
}

export function formatAsOfDateLabel(asOfDate: string): string {
  const [year, month, day] = asOfDate.split('-').map(Number);
  return `${year}年${month}月${day}日`;
}

function formatShortDate(date: Date): string {
  return date.toLocaleDateString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
  });
}

/** 从问财 news_search 结果提取新闻标题（复用研报资讯解析） */
export function parseHotNewsFromIwencai(data: unknown, limit = 15): HotNewsItem[] {
  const entries = extractNewsEntries(data);
  const items: HotNewsItem[] = [];

  for (const entry of entries) {
    if (!entry.title || isNoiseNewsTitle(entry.title)) continue;
    items.push({
      title: entry.title,
      datetime: entry.datetime,
      url: entry.url,
    });
    if (items.length >= limit) break;
  }

  return items;
}

/** 从新闻标题提取可用于问财 query 的主题词 */
export function extractThemesFromNews(
  news: HotNewsItem[],
  limit = 3,
): string[] {
  const themes: string[] = [];
  const seen = new Set<string>();
  const ranked = rankHotNews(news);

  for (const item of ranked) {
    if (isNoiseNewsTitle(item.title)) continue;

    const cleaned = item.title
      .replace(/【[^】]+】/g, '')
      .replace(/^[|\s_-]+|[|\s_-]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (cleaned.length < 6) continue;

    const keywordTheme =
      (/MLCC/i.test(cleaned) && 'MLCC概念') ||
      (/半导体/.test(cleaned) && '半导体') ||
      (/AI硬件|人工智能/.test(cleaned) && 'AI应用') ||
      (/国补/.test(cleaned) && '消费补贴') ||
      (/稀土/.test(cleaned) && '稀土永磁') ||
      null;

    const topic =
      keywordTheme ??
      cleaned.match(/行业\d+[：:]([^，,——附]+)/)?.[1]?.trim().slice(0, 16) ??
      cleaned.split(/[：:|｜—-]/)[0]?.trim().slice(0, 20) ??
      cleaned.slice(0, 20);
    if (topic.length < 4 || seen.has(topic)) continue;

    seen.add(topic);
    themes.push(topic);
    if (themes.length >= limit) break;
  }

  return themes;
}

export async function fetchIwencaiHotNews(
  limit = 15,
  options?: HotNewsFetchOptions,
): Promise<{
  raw: unknown;
  items: HotNewsItem[];
}> {
  if (!isIwencaiMcpConfigured()) {
    throw new Error('问财未配置：请在 .env 设置 IWENCAI_API_KEY');
  }

  const { asOf, cutoff, lookbackDays } = resolveNewsWindow(options);
  const startLabel = formatShortDate(cutoff);
  const endLabel = options?.asOfDate
    ? formatAsOfDateLabel(options.asOfDate)
    : formatShortDate(asOf);

  const query = options?.asOfDate
    ? `A股 ${startLabel}到${endLabel} 热点 板块 涨停 资金`
    : `A股 近${lookbackDays}日 热点 板块 涨停 资金`;

  const raw = await callIwencaiTool('news_search', {
    query,
    timeout: 60,
  });

  const parsed = filterHotNewsByWindow(
    rankHotNews(parseHotNewsFromIwencai(raw, limit * 3)),
    cutoff,
    asOf,
  );

  return {
    raw,
    items: parsed.slice(0, limit),
  };
}

/**
 * 热点新闻：问财 + 东方财富 7×24/资讯 + 新浪滚动，合并去重。
 * 默认保留近 14 天窗口内新闻；历史回放可指定 asOfDate。
 */
export async function fetchHotNews(
  limit = 15,
  options?: HotNewsFetchOptions,
): Promise<{
  items: HotNewsItem[];
  sourcesUsed: string[];
}> {
  const { asOf, cutoff, lookbackDays } = resolveNewsWindow(options);
  const fetchLimit = Math.min(Math.max(limit * 3, lookbackDays * 6), 120);
  const lists: HotNewsItem[][] = [];
  const sourcesUsed: string[] = [];

  const liveResults = await Promise.allSettled([
    fetchEastMoneyFastNews(fetchLimit),
    fetchEastMoneyColumnNews(fetchLimit),
    fetchSinaFinanceRollNews(fetchLimit),
  ]);

  const liveLabels = ['eastmoney-724', 'eastmoney-news', 'sina-roll'] as const;
  liveResults.forEach((result, index) => {
    if (result.status === 'fulfilled' && result.value.length > 0) {
      lists.push(result.value);
      sourcesUsed.push(liveLabels[index]);
      return;
    }
    if (result.status === 'rejected') {
      const message =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
      console.warn(`[hot-news] ${liveLabels[index]} failed: ${message}`);
    }
  });

  if (isIwencaiMcpConfigured()) {
    try {
      const { items } = await fetchIwencaiHotNews(limit * 2, options);
      if (items.length > 0) {
        lists.push(items);
        sourcesUsed.push('iwencai');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[hot-news] iwencai failed: ${message}`);
    }
  }

  const items = filterHotNewsByWindow(
    mergeHotNewsSources(lists),
    cutoff,
    asOf,
  ).slice(0, limit);

  if (items.length === 0) {
    throw new Error('热点新闻获取失败，请稍后重试');
  }

  return { items, sourcesUsed };
}

function buildMarketQueries(input: {
  themeHint: string | null;
  excludeHint: string;
  isReplay: boolean;
  asOfDate?: string;
}) {
  const screenDateHint = input.isReplay && input.asOfDate
    ? formatAsOfDateLabel(input.asOfDate)
    : '今日';

  if (input.themeHint) {
    return {
      sectorQuery: input.isReplay
        ? `${input.themeHint}主线板块，60日涨幅靠前${input.excludeHint}`
        : `${input.themeHint}概念板块，板块强度靠前，60日涨幅靠前${input.excludeHint}`,
      stockQuery: input.isReplay
        ? `${input.themeHint}主线龙头，MA60上方${input.excludeHint}`
        : `${input.themeHint}主线龙头，60日涨幅靠前，MA20大于MA60${input.excludeHint}`,
    };
  }

  return {
    sectorQuery: input.isReplay
      ? `${screenDateHint}A股主线板块，60日涨幅排名前10${input.excludeHint}`
      : `A股主线板块，板块强度靠前，60日涨幅排名前10${input.excludeHint}`,
    stockQuery: input.isReplay
      ? `${screenDateHint}A股主线，MA60上方，60日涨幅前20${input.excludeHint}`
      : `A股主线龙头，120日趋势向上，MA60上方${input.excludeHint}`,
  };
}

/**
 * 自动发现热点：热门新闻 + 预设板块轮动问句，无需用户输入主题。
 * 若提供 userQuery 则作为补充约束（CLI 可选）。
 */
export async function discoverAutoScreenContext(options?: {
  userQuery?: string;
  excludeSt?: boolean;
  lookbackDays?: number;
  asOfDate?: string;
}): Promise<AutoScreenContext> {
  if (!isIwencaiMcpConfigured()) {
    throw new Error('问财未配置：请在 .env 设置 IWENCAI_API_KEY');
  }

  const lookbackDays = options?.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const asOfDate = options?.asOfDate?.trim();
  const isReplay = Boolean(asOfDate);
  const excludeHint = options?.excludeSt !== false ? '，排除ST' : '';
  const userQuery = options?.userQuery?.trim();

  const { items: hotNews } = await fetchHotNews(20, {
    lookbackDays,
    asOfDate,
  });
  const themeNews = pickNewsForThemes(hotNews, asOfDate);
  const enrichment = await enrichHotNews(themeNews, 5);
  const enrichedNews = mergeHotNewsSources([
    hotNews,
    enrichment.relatedNews,
  ]).slice(0, 20);
  const hotThemes = extractThemesFromNews(themeNews, 3);
  const newsSymbols = enrichment.mentionedSymbols;
  const { sectorQuery, stockQuery } = buildMarketQueries({
    themeHint: hotThemes.length > 0 ? hotThemes.slice(0, 2).join('、') : null,
    excludeHint,
    isReplay,
    asOfDate,
  });
  const stockQueries = buildStockQueries({
    themes: hotThemes,
    excludeHint,
    isReplay,
    asOfDate,
    newsSymbols,
  });

  const baseContext = {
    sectorQuery,
    stockQuery,
    stockQueries,
    hotNews: enrichedNews,
    hotThemes,
    newsSymbols,
    lookbackDays,
    asOfDate,
  };

  if (userQuery) {
    const themeHint =
      hotThemes.length > 0 ? hotThemes.slice(0, 2).join('、') : '市场热点';
    const replayPrefix = isReplay && asOfDate
      ? `历史回放（${formatAsOfDateLabel(asOfDate)}）· `
      : '';
    const replayDateHint = isReplay && asOfDate
      ? formatAsOfDateLabel(asOfDate)
      : null;
    return {
      ...baseContext,
      query: `${replayPrefix}${userQuery}`,
      sectorQuery: replayDateHint
        ? `${userQuery}${excludeHint}，参考${replayDateHint}前${lookbackDays}天热点：${themeHint}，${replayDateHint}当日板块涨幅排名靠前`
        : `${userQuery}${excludeHint}，参考热点：${themeHint}`,
      stockQuery: replayDateHint
        ? `${userQuery}相关A股，${replayDateHint}当日涨幅排名前20${excludeHint}`
        : `${userQuery} A股${excludeHint}`,
      stockQueries: [
        replayDateHint
          ? `${userQuery}相关A股，${replayDateHint}当日涨幅排名前20${excludeHint}`
          : `${userQuery} A股${excludeHint}`,
        ...stockQueries,
      ],
      mode: 'manual' as const,
    };
  }

  const themeHint =
    hotThemes.length > 0 ? hotThemes.slice(0, 2).join('、') : null;

  if (isReplay && asOfDate) {
    const dateLabel = formatAsOfDateLabel(asOfDate);
    return {
      ...baseContext,
      query: themeHint
        ? `历史回放（${dateLabel}）：${themeHint}`
        : `历史回放（${dateLabel}）：热点选股`,
      mode: 'auto' as const,
    };
  }

  return {
    ...baseContext,
    query: themeHint
      ? `主线趋势：${themeHint}`
      : '主线趋势：热点+趋势性收益',
    mode: 'auto' as const,
  };
}

import { callIwencaiTool, isIwencaiMcpConfigured } from '../../mastra/mcp/iwencai.js';
import { extractNewsEntries } from './format-report-news.js';
import {
  fetchEastMoneyColumnNews,
  fetchEastMoneyFastNews,
  fetchSinaFinanceRollNews,
} from './free/market-news-feed.js';

export type HotNewsItem = {
  title: string;
  datetime: string;
  url: string | null;
};

export type AutoScreenContext = {
  /** 展示用主题说明 */
  query: string;
  sectorQuery: string;
  stockQuery: string;
  hotNews: HotNewsItem[];
  hotThemes: string[];
  mode: 'auto' | 'manual';
};

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
  // 导航型标题：分隔符过多、缺少实质内容
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

function parseNewsTime(value: string): number {
  if (!value) return 0;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : 0;
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

export async function fetchIwencaiHotNews(limit = 15): Promise<{
  raw: unknown;
  items: HotNewsItem[];
}> {
  if (!isIwencaiMcpConfigured()) {
    throw new Error('问财未配置：请在 .env 设置 IWENCAI_API_KEY');
  }

  const today = new Date().toLocaleDateString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
  });

  const raw = await callIwencaiTool('news_search', {
    query: `A股 ${today} 热点 板块 涨停 资金`,
    timeout: 60,
  });

  return {
    raw,
    items: rankHotNews(parseHotNewsFromIwencai(raw, limit * 2)).slice(
      0,
      limit,
    ),
  };
}

/**
 * 热点新闻：问财 + 东方财富 7×24/资讯 + 新浪滚动，合并去重。
 * 实时源失败时不阻断问财；全部失败才抛错。
 */
export async function fetchHotNews(limit = 15): Promise<{
  items: HotNewsItem[];
  sourcesUsed: string[];
}> {
  const lists: HotNewsItem[][] = [];
  const sourcesUsed: string[] = [];

  const liveResults = await Promise.allSettled([
    fetchEastMoneyFastNews(limit * 2),
    fetchEastMoneyColumnNews(limit * 2),
    fetchSinaFinanceRollNews(limit * 2),
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
      const { items } = await fetchIwencaiHotNews(limit * 2);
      if (items.length > 0) {
        lists.push(items);
        sourcesUsed.push('iwencai');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[hot-news] iwencai failed: ${message}`);
    }
  }

  const items = mergeHotNewsSources(lists).slice(0, limit);
  if (items.length === 0) {
    throw new Error('热点新闻获取失败，请稍后重试');
  }

  return { items, sourcesUsed };
}

/**
 * 自动发现热点：热门新闻 + 预设板块轮动问句，无需用户输入主题。
 * 若提供 userQuery 则作为补充约束（CLI 可选）。
 */
export async function discoverAutoScreenContext(options?: {
  userQuery?: string;
  excludeSt?: boolean;
}): Promise<AutoScreenContext> {
  if (!isIwencaiMcpConfigured()) {
    throw new Error('问财未配置：请在 .env 设置 IWENCAI_API_KEY');
  }

  const excludeHint = options?.excludeSt !== false ? '，排除ST' : '';
  const userQuery = options?.userQuery?.trim();

  const { items: hotNews } = await fetchHotNews(15);
  const hotThemes = extractThemesFromNews(hotNews, 3);

  if (userQuery) {
    const themeHint =
      hotThemes.length > 0 ? hotThemes.slice(0, 2).join('、') : '市场热点';
    return {
      query: userQuery,
      sectorQuery: `${userQuery}${excludeHint}，参考热点：${themeHint}`,
      stockQuery: `${userQuery} A股${excludeHint}`,
      hotNews,
      hotThemes,
      mode: 'manual',
    };
  }

  const themeHint =
    hotThemes.length > 0 ? hotThemes.slice(0, 2).join('、') : null;

  const sectorQuery = themeHint
    ? `${themeHint}概念板块，今日涨幅或主力净流入靠前${excludeHint}`
    : `今日A股概念板块涨幅排名前10${excludeHint}`;

  const stockQuery = themeHint
    ? `${themeHint}相关A股，主力净流入${excludeHint}`
    : `今日A股主力净流入排名前20${excludeHint}`;

  return {
    query: themeHint ? `热点自动选股：${themeHint}` : '热点自动选股：今日强势板块',
    sectorQuery,
    stockQuery,
    hotNews,
    hotThemes,
    mode: 'auto',
  };
}

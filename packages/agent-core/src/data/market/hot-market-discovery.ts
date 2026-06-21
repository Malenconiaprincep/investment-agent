import { callIwencaiTool, isIwencaiMcpConfigured } from '../../mastra/mcp/iwencai.js';
import { extractNewsEntries } from './format-report-news.js';

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
  if (title.length >= 12 && title.length <= 60) score += 2;
  return score;
}

/** 按热度关键词排序后再提取主题 */
export function rankHotNews(news: HotNewsItem[]): HotNewsItem[] {
  return [...news].sort(
    (a, b) => scoreNewsTitle(b.title) - scoreNewsTitle(a.title),
  );
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

  const raw = await callIwencaiTool('news_search', {
    query: 'A股 今日 热点 板块 涨停 资金',
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

  const { items: hotNews } = await fetchIwencaiHotNews(15);
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

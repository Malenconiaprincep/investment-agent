import { callIwencaiTool, isIwencaiMcpConfigured } from '../../mastra/mcp/iwencai.js';

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

function walkValues(node: unknown, out: unknown[]): void {
  if (node == null) return;
  if (Array.isArray(node)) {
    for (const item of node) walkValues(item, out);
    return;
  }
  if (typeof node === 'object') {
    out.push(node);
    for (const value of Object.values(node as Record<string, unknown>)) {
      walkValues(value, out);
    }
  }
}

function normalizeUrl(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  const trimmed = url.trim();
  if (trimmed.startsWith('http')) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  return null;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/** 从问财 news_search / comprehensive search 结果提取新闻标题 */
export function parseHotNewsFromIwencai(data: unknown, limit = 15): HotNewsItem[] {
  const items: HotNewsItem[] = [];
  const seen = new Set<string>();
  const flat: unknown[] = [];
  walkValues(data, flat);

  for (const node of flat) {
    if (!node || typeof node !== 'object') continue;
    const obj = node as Record<string, unknown>;
    const title =
      pickString(obj, [
        'title',
        'news_title',
        'content_title',
        'headline',
        'doc_title',
        'name',
      ]) ?? null;

    if (!title || title.length < 6 || seen.has(title)) continue;
    if (/^[0-9.%+-]+$/.test(title)) continue;

    seen.add(title);
    const datetime =
      pickString(obj, [
        'datetime',
        'time',
        'publish_time',
        'pub_time',
        'date',
      ]) ?? '';
    const url = normalizeUrl(
      pickString(obj, ['url', 'link', 'pc_url', 'news_url', 'jump_url']),
    );

    items.push({ title, datetime, url });
    if (items.length >= limit) break;
  }

  if (items.length === 0) {
    for (const node of flat) {
      if (typeof node !== 'string' || node.length < 10 || node.length > 120) {
        continue;
      }
      if (seen.has(node)) continue;
      seen.add(node);
      items.push({ title: node, datetime: '', url: null });
      if (items.length >= limit) break;
    }
  }

  return items;
}

/** 从新闻标题提取简短主题词（用于拼接问财 query） */
export function extractThemesFromNews(
  news: HotNewsItem[],
  limit = 5,
): string[] {
  const themes: string[] = [];
  const seen = new Set<string>();

  for (const item of news) {
    const title = item.title
      .replace(/【[^】]+】/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (title.length < 4) continue;

    const snippet = title.slice(0, 24);
    if (seen.has(snippet)) continue;
    seen.add(snippet);
    themes.push(snippet);
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
    query: 'A股今日热点 财经要闻 板块异动',
    timeout: 60,
  });

  return {
    raw,
    items: parseHotNewsFromIwencai(raw, limit),
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
  const hotThemes = extractThemesFromNews(hotNews, 5);
  const themeHint =
    hotThemes.length > 0
      ? hotThemes.slice(0, 3).join('、')
      : 'A股今日市场热点';

  if (userQuery) {
    return {
      query: userQuery,
      sectorQuery: `${userQuery}${excludeHint}，参考热点：${themeHint}`,
      stockQuery: `${userQuery} A股${excludeHint}`,
      hotNews,
      hotThemes,
      mode: 'manual',
    };
  }

  const sectorQuery = `今日A股涨幅靠前或资金净流入的概念板块，热点：${themeHint}${excludeHint}`;
  const stockQuery = `${themeHint} 相关A股，所属热门板块，近期有新闻催化${excludeHint}`;

  return {
    query: `热点自动选股：${themeHint}`,
    sectorQuery,
    stockQuery,
    hotNews,
    hotThemes,
    mode: 'auto',
  };
}

import {
  callIwencaiCoreTool,
  isIwencaiMcpConfigured,
} from '../../mastra/mcp/iwencai.js';
import { toTsCode } from './symbols.js';
import { IWENCAI_DISCLAIMER } from './types.js';

export type IwencaiFallbackKey = 'quote' | 'financial' | 'announcements' | 'news';

type IwencaiWrappedResult = {
  tsCode: string;
  query: string;
  tool: string;
  data: unknown;
  dataSource: 'iwencai';
  fetchMethod: 'iwencai';
  asOf: string;
  cached: false;
  disclaimer: string;
  localFallbackReason: string;
};

function wrapIwencaiResult(
  tsCode: string,
  tool: string,
  query: string,
  data: unknown,
  reason: string,
): IwencaiWrappedResult {
  return {
    tsCode,
    query,
    tool,
    data,
    dataSource: 'iwencai',
    fetchMethod: 'iwencai',
    asOf: new Date().toISOString(),
    cached: false,
    disclaimer: IWENCAI_DISCLAIMER,
    localFallbackReason: reason,
  };
}

function hasFetchError(fetchErrors: string[], key: IwencaiFallbackKey): boolean {
  return fetchErrors.some((entry) => entry.startsWith(`${key}:`));
}

function isEmptyNews(data: unknown): boolean {
  if (!data || typeof data !== 'object') return true;
  const news = data as { count?: number; items?: unknown[] };
  return (news.count ?? news.items?.length ?? 0) === 0;
}

function isEmptyAnnouncements(data: unknown): boolean {
  if (!data || typeof data !== 'object') return true;
  const announcements = data as { count?: number; announcements?: unknown[] };
  return (
    (announcements.count ?? announcements.announcements?.length ?? 0) === 0
  );
}

function isEmptyFinancial(data: unknown): boolean {
  if (!data || typeof data !== 'object') return true;
  const financial = data as {
    roe?: number | null;
    revenue?: number | null;
    netProfit?: number | null;
  };
  return (
    financial.roe == null &&
    financial.revenue == null &&
    financial.netProfit == null
  );
}

function isEmptyQuote(data: unknown): boolean {
  if (!data || typeof data !== 'object') return true;
  const quote = data as { quotes?: unknown[]; latestClose?: number | null };
  return (quote.quotes?.length ?? 0) === 0 && quote.latestClose == null;
}

async function tryIwencaiFallback(
  key: IwencaiFallbackKey,
  reason: string,
  run: () => Promise<IwencaiWrappedResult>,
): Promise<{ key: IwencaiFallbackKey; value: IwencaiWrappedResult } | null> {
  try {
    return { key, value: await run() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[iwencai-fallback] ${key} 失败 (${reason}): ${message}`);
    return null;
  }
}

export async function enrichMarketDataWithIwencai(input: {
  symbol: string;
  name: string;
  quote: unknown;
  financial: unknown;
  announcements: unknown;
  news: unknown;
  fetchErrors: string[];
}): Promise<{
  quote: unknown;
  financial: unknown;
  announcements: unknown;
  news: unknown;
  iwencaiFallbacks: IwencaiFallbackKey[];
}> {
  if (!isIwencaiMcpConfigured()) {
    return { ...input, iwencaiFallbacks: [] };
  }

  const tsCode = toTsCode(input.symbol);
  const label = `${input.name} ${input.symbol}`;
  const tasks: Array<
    Promise<{ key: IwencaiFallbackKey; value: IwencaiWrappedResult } | null>
  > = [];

  if (hasFetchError(input.fetchErrors, 'quote') || isEmptyQuote(input.quote)) {
    tasks.push(
      tryIwencaiFallback('quote', '本地行情缺失', async () =>
        wrapIwencaiResult(
          tsCode,
          'hithink_market_query',
          `${label} 最新价 涨跌幅 成交量`,
          await callIwencaiCoreTool('hithink_market_query', {
            query: `${label} 最新价 涨跌幅 成交量`,
            limit: '5',
          }),
          '本地行情缺失或为空',
        ),
      ),
    );
  }

  if (
    hasFetchError(input.fetchErrors, 'financial') ||
    isEmptyFinancial(input.financial)
  ) {
    tasks.push(
      tryIwencaiFallback('financial', '本地财务缺失', async () =>
        wrapIwencaiResult(
          tsCode,
          'hithink_finance_query',
          `${label} ROE 营业收入 净利润 负债率 PE`,
          await callIwencaiCoreTool('hithink_finance_query', {
            query: `${label} ROE 营业收入 净利润 负债率 PE`,
            limit: '5',
          }),
          '本地财务缺失或为空',
        ),
      ),
    );
  }

  if (
    hasFetchError(input.fetchErrors, 'announcements') ||
    isEmptyAnnouncements(input.announcements)
  ) {
    tasks.push(
      tryIwencaiFallback('announcements', '本地公告缺失', async () =>
        wrapIwencaiResult(
          tsCode,
          'announcement_search',
          `${label} 最新公告`,
          await callIwencaiCoreTool('announcement_search', {
            query: `${label} 最新公告`,
          }),
          '本地公告缺失或为空',
        ),
      ),
    );
  }

  if (hasFetchError(input.fetchErrors, 'news') || isEmptyNews(input.news)) {
    tasks.push(
      tryIwencaiFallback('news', '本地新闻缺失', async () =>
        wrapIwencaiResult(
          tsCode,
          'news_search',
          `${label} 最新资讯`,
          await callIwencaiCoreTool('news_search', {
            query: `${label} 最新资讯`,
          }),
          '本地新闻缺失或为空',
        ),
      ),
    );
  }

  if (tasks.length === 0) {
    return { ...input, iwencaiFallbacks: [] };
  }

  const results = await Promise.all(tasks);
  const next = {
    quote: input.quote,
    financial: input.financial,
    announcements: input.announcements,
    news: input.news,
  };
  const iwencaiFallbacks: IwencaiFallbackKey[] = [];

  for (const result of results) {
    if (!result) continue;
    next[result.key] = result.value;
    iwencaiFallbacks.push(result.key);
  }

  if (iwencaiFallbacks.length > 0) {
    console.info(
      `[iwencai-fallback] 已补充: ${iwencaiFallbacks.join(', ')} (${label})`,
    );
  }

  return { ...next, iwencaiFallbacks };
}

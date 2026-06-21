import { callIwencaiTool, isIwencaiMcpConfigured } from '../../mastra/mcp/iwencai.js';
import { extractNewsEntries } from './format-report-news.js';
import type { HotNewsItem } from './hot-market-discovery.js';

export type NewsMentionedSymbol = {
  symbol: string;
  name: string;
  source: string;
};

export type HotNewsEnrichment = {
  mentionedSymbols: NewsMentionedSymbol[];
  relatedNews: HotNewsItem[];
};

const A_SHARE_CODE = /\b([036]\d{5})\b/g;

/** 从文本中提取 A 股代码 */
export function extractSymbolsFromText(
  text: string,
  source: string,
): NewsMentionedSymbol[] {
  const found: NewsMentionedSymbol[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(A_SHARE_CODE)) {
    const symbol = match[1];
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    found.push({ symbol, name: symbol, source });
  }

  return found;
}

/** 对 Top 新闻做轻量补全：标题抽代码 + 问财 news_search 扩相关资讯 */
export async function enrichHotNews(
  news: HotNewsItem[],
  limit = 5,
): Promise<HotNewsEnrichment> {
  const mentionedSymbols = new Map<string, NewsMentionedSymbol>();
  const relatedNews: HotNewsItem[] = [];
  const relatedSeen = new Set<string>();

  for (const item of news.slice(0, limit)) {
    for (const entry of extractSymbolsFromText(item.title, item.title)) {
      mentionedSymbols.set(entry.symbol, entry);
    }

    if (!isIwencaiMcpConfigured()) continue;

    const query = item.title.replace(/【[^】]+】/g, '').trim().slice(0, 48);
    if (query.length < 8) continue;

    try {
      const raw = await callIwencaiTool('news_search', {
        query,
        timeout: 30,
      });
      const entries = extractNewsEntries(raw);
      for (const entry of entries.slice(0, 5)) {
        if (entry.title) {
          for (const sym of extractSymbolsFromText(entry.title, item.title)) {
            mentionedSymbols.set(sym.symbol, sym);
          }
          const key = entry.title.slice(0, 48);
          if (!relatedSeen.has(key)) {
            relatedSeen.add(key);
            relatedNews.push({
              title: entry.title,
              datetime: entry.datetime,
              url: entry.url,
            });
          }
        }
      }
    } catch {
      // 单条新闻补全失败不阻断
    }
  }

  return {
    mentionedSymbols: [...mentionedSymbols.values()],
    relatedNews,
  };
}

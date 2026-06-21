import type { HotNewsItem } from '../hot-market-discovery.js';
import { freeFetchJson } from './http.js';

type EmColumnResponse = {
  code?: string;
  data?: {
    list?: Array<{
      title?: string;
      showTime?: string;
      url?: string;
      uniqueUrl?: string;
    }>;
  };
};

type EmFastNewsResponse = {
  code?: string;
  data?: {
    fastNewsList?: Array<{
      title?: string;
      showTime?: string;
      code?: string;
    }>;
  };
};

type SinaRollResponse = {
  result?: {
    data?: Array<{
      title?: string;
      ctime?: string;
      url?: string;
    }>;
  };
};

function traceId(): string {
  return String(Date.now());
}

function toItem(
  title: string,
  datetime: string,
  url: string | null,
): HotNewsItem | null {
  const trimmed = title.trim();
  if (trimmed.length < 8) return null;
  return { title: trimmed, datetime, url };
}

function mapEastMoneyUrl(url?: string, uniqueUrl?: string, code?: string): string | null {
  const direct = uniqueUrl?.trim() || url?.trim();
  if (direct?.startsWith('http')) return direct;
  if (code) return `https://finance.eastmoney.com/a/${code}.html`;
  return null;
}

/** 东方财富 7×24 快讯（kuaixun） */
export async function fetchEastMoneyFastNews(limit = 20): Promise<HotNewsItem[]> {
  const json = await freeFetchJson<EmFastNewsResponse>(
    `https://np-weblist.eastmoney.com/comm/web/getFastNewsList?client=web&biz=web_724&fastColumn=102&pageSize=${limit}&sortEnd=&req_trace=${traceId()}`,
    {
      headers: {
        Referer: 'https://kuaixun.eastmoney.com/',
      },
    },
  );

  const list = json.data?.fastNewsList ?? [];
  const items: HotNewsItem[] = [];

  for (const row of list) {
    const item = toItem(
      String(row.title ?? ''),
      String(row.showTime ?? ''),
      mapEastMoneyUrl(undefined, undefined, row.code),
    );
    if (item) items.push(item);
  }

  return items;
}

/** 东方财富财经资讯列表 */
export async function fetchEastMoneyColumnNews(limit = 20): Promise<HotNewsItem[]> {
  const json = await freeFetchJson<EmColumnResponse>(
    `https://np-listapi.eastmoney.com/comm/web/getNewsByColumns?client=web&biz=web_news_col&column=350&page_index=1&page_size=${limit}&req_trace=${traceId()}&fields=showTime,title,mediaName,url,uniqueUrl`,
    {
      headers: {
        Referer: 'https://finance.eastmoney.com/',
      },
    },
  );

  const list = json.data?.list ?? [];
  const items: HotNewsItem[] = [];

  for (const row of list) {
    const item = toItem(
      String(row.title ?? ''),
      String(row.showTime ?? ''),
      mapEastMoneyUrl(row.url, row.uniqueUrl),
    );
    if (item) items.push(item);
  }

  return items;
}

/** 新浪财经滚动资讯 */
export async function fetchSinaFinanceRollNews(limit = 20): Promise<HotNewsItem[]> {
  const json = await freeFetchJson<SinaRollResponse>(
    `https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2516&num=${limit}&page=1`,
    {
      headers: {
        Referer: 'https://finance.sina.com.cn/',
      },
    },
  );

  const list = json.result?.data ?? [];
  const items: HotNewsItem[] = [];

  for (const row of list) {
    const ts = row.ctime ? new Date(Number(row.ctime) * 1000).toISOString() : '';
    const item = toItem(String(row.title ?? ''), ts, row.url?.trim() || null);
    if (item) items.push(item);
  }

  return items;
}

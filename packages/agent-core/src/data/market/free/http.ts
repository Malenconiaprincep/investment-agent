import { safeFetch } from '../../../lib/safe-fetch.js';
import { eastmoneyMarketCode, eastmoneySecId } from '../asset-type.js';

export const FREE_ALLOWED_HOSTS = [
  'push2.eastmoney.com',
  'push2delay.eastmoney.com',
  'searchapi.eastmoney.com',
  'emweb.securities.eastmoney.com',
  'np-anotice-stock.eastmoney.com',
  'search-api-web.eastmoney.com',
  'np-listapi.eastmoney.com',
  'np-weblist.eastmoney.com',
  'web.ifzq.gtimg.cn',
  'feed.mix.sina.com.cn',
];

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  Referer: 'https://emweb.securities.eastmoney.com/',
};

export async function freeFetchJson<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await safeFetch(
    url,
    {
      ...init,
      headers: {
        ...DEFAULT_HEADERS,
        ...init?.headers,
      },
    },
    { allowedHosts: FREE_ALLOWED_HOSTS, retries: 2 },
  );

  return (await response.json()) as T;
}

export function toSecId(symbol: string): string {
  return eastmoneySecId(symbol);
}

export function toMarketCode(symbol: string): string {
  return eastmoneyMarketCode(symbol);
}

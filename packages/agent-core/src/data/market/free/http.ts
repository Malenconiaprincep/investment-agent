import { safeFetch } from '../../../lib/safe-fetch.js';

export const FREE_ALLOWED_HOSTS = [
  'push2delay.eastmoney.com',
  'emweb.securities.eastmoney.com',
  'np-anotice-stock.eastmoney.com',
  'search-api-web.eastmoney.com',
  'web.ifzq.gtimg.cn',
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
  const code = symbol.trim();
  if (code.startsWith('6')) return `1.${code}`;
  if (code.startsWith('0') || code.startsWith('3')) return `0.${code}`;
  if (code.startsWith('8') || code.startsWith('4')) return `0.${code}`;
  throw new Error(`无法识别交易所: ${symbol}`);
}

export function toMarketCode(symbol: string): string {
  const code = symbol.trim();
  if (code.startsWith('6')) return `SH${code}`;
  if (code.startsWith('0') || code.startsWith('3')) return `SZ${code}`;
  if (code.startsWith('8') || code.startsWith('4')) return `BJ${code}`;
  throw new Error(`无法识别交易所: ${symbol}`);
}

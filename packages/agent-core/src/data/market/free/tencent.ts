import { getCached, setCached } from '../cache.js';
import { safeFetch } from '../../../lib/safe-fetch.js';
import { tencentPrefix } from '../asset-type.js';

const TTL_MS = 60 * 60 * 1000;

type KlineResponse = {
  data?: Record<
    string,
    {
      qfqday?: Array<[string, string, string, string, string, string]>;
      day?: Array<[string, string, string, string, string, string]>;
    }
  >;
};

function toTencentCode(symbol: string): string {
  return `${tencentPrefix(symbol)}${symbol.trim()}`;
}

export async function fetchDailyKlines(symbol: string, days: number) {
  const cacheKey = `tx:kline:${symbol}:${days}`;
  const cached = getCached<ReturnType<typeof mapKlines>>(cacheKey);
  if (cached) return { quotes: cached, cached: true as const };

  const txCode = toTencentCode(symbol);
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${txCode},day,,,${days},qfq`;

  const response = await safeFetch(url, undefined, {
    allowedHosts: ['web.ifzq.gtimg.cn'],
  });
  const json = (await response.json()) as KlineResponse;

  const rows = json.data?.[txCode]?.qfqday ?? json.data?.[txCode]?.day ?? [];
  if (rows.length === 0) {
    throw new Error(`暂无行情数据: ${symbol}`);
  }

  const quotes = mapKlines(rows);
  setCached(cacheKey, quotes, TTL_MS);
  return { quotes, cached: false as const };
}

function mapKlines(
  rows: Array<[string, string, string, string, string, string]>,
) {
  return rows
    .map(([tradeDate, open, close, high, low, vol]) => {
      const openNum = Number(open);
      const closeNum = Number(close);

      return {
        tradeDate: tradeDate.replace(/-/g, ''),
        open: Number.isFinite(openNum) ? openNum : null,
        high: Number.isFinite(Number(high)) ? Number(high) : null,
        low: Number.isFinite(Number(low)) ? Number(low) : null,
        close: Number.isFinite(closeNum) ? closeNum : null,
        pctChg:
          Number.isFinite(openNum) && openNum > 0
            ? Number((((closeNum - openNum) / openNum) * 100).toFixed(2))
            : null,
        vol: Number.isFinite(Number(vol)) ? Number(vol) : null,
        amount: null as number | null,
      };
    })
    .reverse();
}

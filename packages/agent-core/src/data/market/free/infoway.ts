import { safeFetch } from '../../../lib/safe-fetch.js';
import { exchangeSuffix } from '../asset-type.js';

type InfowayKlineRow = {
  t?: string;
  h?: string;
  o?: string;
  l?: string;
  c?: string;
  v?: string;
  vw?: string;
  pc?: string;
  pca?: string;
};

type InfowayKlineResponse = {
  ret?: number;
  msg?: string;
  traceId?: string;
  data?: Array<{
    s?: string;
    respList?: InfowayKlineRow[];
  }>;
};

type InfowayAdjustmentFactorResponse = {
  ret?: number;
  msg?: string;
  traceId?: string;
  data?: Array<{
    trade_date?: string;
    forward_factor?: number | string;
  }>;
};

function toInfowayCode(symbol: string): string {
  return `${symbol.trim()}.${exchangeSuffix(symbol)}`;
}

function parseNumber(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const parsed = Number(value.replace('%', ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function formatTradeDateFromTimestamp(value: string | undefined): string | null {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date(timestamp * 1000))
    .replace(/-/g, '');
}

function mapRows(rows: InfowayKlineRow[], symbol: string) {
  return rows
    .map((row) => {
      const tradeDate = formatTradeDateFromTimestamp(row.t);
      if (!tradeDate) return null;
      return {
        tradeDate,
        open: parseNumber(row.o),
        high: parseNumber(row.h),
        low: parseNumber(row.l),
        close: parseNumber(row.c),
        pctChg: parseNumber(row.pc),
        vol: parseNumber(row.v),
        amount: parseNumber(row.vw),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null)
    .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
}

function applyFactor(value: number | null, factor: number): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Number((value * factor).toFixed(6));
}

async function fetchAdjustmentFactors(input: {
  code: string;
  beginDay: string;
  endDay: string;
  apiKey: string;
  timeoutMs?: number;
  retries?: number;
}): Promise<Map<string, number>> {
  const url = new URL('https://data.infoway.io/common/basic/symbols/adjustment_factors');
  url.searchParams.set('symbol', input.code);
  url.searchParams.set('market', 'CN');
  url.searchParams.set('beginDay', input.beginDay);
  url.searchParams.set('endDay', input.endDay);

  const response = await safeFetch(
    url.toString(),
    {
      headers: {
        apiKey: input.apiKey,
      },
    },
    {
      allowedHosts: ['data.infoway.io'],
      retries: input.retries,
      timeoutMs: input.timeoutMs,
    },
  );
  const json = (await response.json()) as InfowayAdjustmentFactorResponse;
  if (json.ret !== 200) {
    throw new Error(
      `Infoway factor ${json.ret ?? 'unknown'}: ${json.msg ?? 'request failed'}${
        json.traceId ? ` (${json.traceId})` : ''
      }`,
    );
  }

  const factors = new Map<string, number>();
  for (const item of json.data ?? []) {
    const tradeDate = item.trade_date?.trim();
    const factor = Number(item.forward_factor);
    if (tradeDate && Number.isFinite(factor)) factors.set(tradeDate, factor);
  }
  return factors;
}

export async function fetchInfowayDailyKlines(
  symbol: string,
  days: number,
  options?: { timeoutMs?: number; retries?: number },
) {
  const apiKey = process.env.INFOWAY_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('未配置 INFOWAY_API_KEY');
  }

  const code = toInfowayCode(symbol);
  const url = 'https://data.infoway.io/stock/v2/batch_kline';
  const response = await safeFetch(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apiKey,
      },
      body: JSON.stringify({
        klineType: 8,
        klineNum: Math.max(1, Math.min(500, Math.floor(days))),
        codes: code,
      }),
    },
    {
      allowedHosts: ['data.infoway.io'],
      retries: options?.retries,
      timeoutMs: options?.timeoutMs,
    },
  );

  const json = (await response.json()) as InfowayKlineResponse;
  if (json.ret !== 200) {
    throw new Error(
      `Infoway ${json.ret ?? 'unknown'}: ${json.msg ?? 'request failed'}${
        json.traceId ? ` (${json.traceId})` : ''
      }`,
    );
  }

  const rows =
    json.data?.find((item) => item.s === code)?.respList ??
    json.data?.[0]?.respList ??
    [];
  const quotes = mapRows(rows, symbol);
  if (quotes.length === 0) {
    throw new Error(`Infoway 暂无日线数据: ${code}`);
  }

  const beginDay = quotes[0]?.tradeDate;
  const endDay = quotes.at(-1)?.tradeDate;
  if (!beginDay || !endDay) {
    throw new Error(`Infoway 无法识别交易日: ${code}`);
  }

  const factors = await fetchAdjustmentFactors({
    code,
    beginDay,
    endDay,
    apiKey,
    retries: options?.retries,
    timeoutMs: options?.timeoutMs,
  });
  const adjustedQuotes = quotes.map((quote) => {
    const factor = factors.get(quote.tradeDate);
    if (factor == null) {
      throw new Error(`Infoway 缺少前复权因子: ${code} ${quote.tradeDate}`);
    }
    return {
      ...quote,
      open: applyFactor(quote.open, factor),
      high: applyFactor(quote.high, factor),
      low: applyFactor(quote.low, factor),
      close: applyFactor(quote.close, factor),
    };
  });

  return { quotes: adjustedQuotes, cached: false as const, provider: 'infoway' as const };
}

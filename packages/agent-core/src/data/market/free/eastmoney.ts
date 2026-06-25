import { getCached, setCached } from '../cache.js';
import { freeFetchJson, toMarketCode, toSecId } from './http.js';

const TTL_MS = {
  snapshot: 30 * 60 * 1000,
  profile: 24 * 60 * 60 * 1000,
  financial: 24 * 60 * 60 * 1000,
  announcements: 6 * 60 * 60 * 1000,
  news: 60 * 60 * 1000,
  industry: 24 * 60 * 60 * 1000,
} as const;

type SnapshotResponse = {
  data?: {
    f57?: string;
    f58?: string;
    f127?: string;
    f162?: number;
    f167?: number;
  };
};

type CompanySurveyResponse = {
  jbzl?: Array<{
    SECURITY_NAME_ABBR?: string;
    INDUSTRYCSRC1?: string;
    PROVINCE?: string;
    TRADE_MARKET?: string;
  }>;
  fxxg?: Array<{ LISTING_DATE?: string }>;
};

type FinancialResponse = {
  bgq?: Array<{
    REPORT_DATE?: string;
    NOTICE_DATE?: string;
    TOTAL_OPERATE_INCOME?: number;
    NETPROFIT?: number;
    ROE?: number;
    DEBT_ASSET_RATIO?: number;
    SALE_NPR?: number;
  }>;
};

type AnnouncementResponse = {
  data?: {
    list?: Array<{ notice_date?: string; title?: string }>;
  };
};

type NewsBulletinResponse = {
  gszx?: {
    data?: {
      items?: Array<{
        title?: string;
        showDateTime?: number;
        url?: string;
        summary?: string;
      }>;
    };
  };
};

type IndustryListResponse = {
  data?: {
    diff?: Record<string, { f12?: string; f14?: string }>;
  };
};

type IndustryPeersResponse = {
  data?: {
    diff?: Array<{
      f12?: string;
      f14?: string;
      f9?: number;
      f23?: number;
      f20?: number;
    }>;
  };
};

type StockSuggestResponse = {
  QuotationCodeTable?: {
    Data?: Array<{
      Code?: string;
      Name?: string;
      PinYin?: string;
      Classify?: string;
      SecurityTypeName?: string;
      QuoteID?: string;
    }>;
  };
};

export type StockSuggestItem = {
  symbol: string;
  name: string;
  pinyin: string | null;
  classify: string | null;
  securityTypeName: string | null;
  quoteId: string | null;
};

export async function fetchStockSuggestions(keyword: string, limit = 8) {
  const input = keyword.trim();
  if (!input) return { data: [] as StockSuggestItem[], cached: false as const };

  const cacheKey = `em:suggest:${input}:${limit}`;
  const cached = getCached<StockSuggestItem[]>(cacheKey);
  if (cached) return { data: cached, cached: true as const };

  const json = await freeFetchJson<StockSuggestResponse>(
    `https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(input)}&type=14&token=1`,
  );

  const data = (json.QuotationCodeTable?.Data ?? [])
    .map((item): StockSuggestItem | null => {
      const symbol = String(item.Code ?? '').trim();
      const name = String(item.Name ?? '').trim();
      if (!/^\d{6}$/.test(symbol) || !name) return null;
      return {
        symbol,
        name,
        pinyin: item.PinYin != null ? String(item.PinYin) : null,
        classify: item.Classify != null ? String(item.Classify) : null,
        securityTypeName:
          item.SecurityTypeName != null ? String(item.SecurityTypeName) : null,
        quoteId: item.QuoteID != null ? String(item.QuoteID) : null,
      };
    })
    .filter((item): item is StockSuggestItem => item != null)
    .slice(0, limit);

  setCached(cacheKey, data, TTL_MS.profile);
  return { data, cached: false as const };
}

export async function fetchStockSnapshot(symbol: string) {
  const cacheKey = `em:snapshot:${symbol}`;
  const cached = getCached<ReturnType<typeof mapSnapshot>>(cacheKey);
  if (cached) return { data: cached, cached: true as const };

  const secid = toSecId(symbol);
  const json = await freeFetchJson<SnapshotResponse>(
    `https://push2delay.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f57,f58,f127,f162,f167`,
  );

  if (!json.data?.f57) {
    throw new Error(`未找到股票: ${symbol}`);
  }

  const data = mapSnapshot(symbol, json.data);
  setCached(cacheKey, data, TTL_MS.snapshot);
  return { data, cached: false as const };
}

function mapSnapshot(
  symbol: string,
  raw: NonNullable<SnapshotResponse['data']>,
) {
  return {
    symbol: String(raw.f57 ?? symbol),
    name: String(raw.f58 ?? ''),
    industry: raw.f127 != null ? String(raw.f127) : null,
    pe: raw.f162 != null ? Number(raw.f162) / 100 : null,
    pb: raw.f167 != null ? Number(raw.f167) / 100 : null,
  };
}

export async function fetchCompanyProfile(symbol: string) {
  const cacheKey = `em:profile:${symbol}`;
  const cached = getCached<ReturnType<typeof mapProfile>>(cacheKey);
  if (cached) return { data: cached, cached: true as const };

  const code = toMarketCode(symbol);
  const json = await freeFetchJson<CompanySurveyResponse>(
    `https://emweb.securities.eastmoney.com/PC_HSF10/CompanySurvey/PageAjax?code=${code}`,
  );

  const data = mapProfile(json);
  setCached(cacheKey, data, TTL_MS.profile);
  return { data, cached: false as const };
}

function mapProfile(json: CompanySurveyResponse) {
  const basic = json.jbzl?.[0];
  const issue = json.fxxg?.[0];

  return {
    area: basic?.PROVINCE != null ? String(basic.PROVINCE) : null,
    industryDetail:
      basic?.INDUSTRYCSRC1 != null ? String(basic.INDUSTRYCSRC1) : null,
    market: basic?.TRADE_MARKET != null ? String(basic.TRADE_MARKET) : null,
    listDate:
      issue?.LISTING_DATE != null
        ? String(issue.LISTING_DATE).slice(0, 10).replace(/-/g, '')
        : null,
  };
}

export async function fetchLatestFinancial(symbol: string) {
  const cacheKey = `em:financial:v3:${symbol}`;
  const cached = getCached<ReturnType<typeof mapFinancial>>(cacheKey);
  if (cached) return { data: cached, cached: true as const };

  const code = toMarketCode(symbol);
  const json = await freeFetchJson<FinancialResponse>(
    `https://emweb.securities.eastmoney.com/PC_HSF10/NewFinanceAnalysis/DBFXAjaxNew?type=0&code=${code}`,
  );

  const rows = json.bgq ?? [];
  if (rows.length === 0) {
    throw new Error(`暂无财务数据: ${symbol}`);
  }

  const data = mapFinancial(rows);
  setCached(cacheKey, data, TTL_MS.financial);
  return { data, cached: false as const };
}

function yoyPct(current: number | null, prior: number | null): number | null {
  if (current == null || prior == null || prior === 0) return null;
  return Number((((current - prior) / Math.abs(prior)) * 100).toFixed(2));
}

function findPriorYearSameQuarterRow(
  rows: NonNullable<FinancialResponse['bgq']>,
  currentRow: NonNullable<FinancialResponse['bgq']>[number],
) {
  const currentDate = String(currentRow.REPORT_DATE ?? '').slice(0, 10);
  const monthDay = currentDate.slice(5);
  if (!monthDay) return null;

  const currentYear = Number(currentDate.slice(0, 4));
  if (!Number.isFinite(currentYear)) return null;

  return (
    rows.find((row) => {
      const date = String(row.REPORT_DATE ?? '').slice(0, 10);
      const year = Number(date.slice(0, 4));
      return date.slice(5) === monthDay && year === currentYear - 1;
    }) ?? null
  );
}

function mapFinancial(rows: NonNullable<FinancialResponse['bgq']>) {
  const row = rows[0];
  const priorYearRow = findPriorYearSameQuarterRow(rows, row);
  const revenue =
    row.TOTAL_OPERATE_INCOME != null
      ? Number(row.TOTAL_OPERATE_INCOME)
      : null;
  const netProfit = row.NETPROFIT != null ? Number(row.NETPROFIT) : null;
  const priorRevenue =
    priorYearRow?.TOTAL_OPERATE_INCOME != null
      ? Number(priorYearRow.TOTAL_OPERATE_INCOME)
      : null;
  const priorNetProfit =
    priorYearRow?.NETPROFIT != null ? Number(priorYearRow.NETPROFIT) : null;

  return {
    endDate:
      row.REPORT_DATE != null
        ? String(row.REPORT_DATE).slice(0, 10).replace(/-/g, '')
        : null,
    annDate:
      row.NOTICE_DATE != null
        ? String(row.NOTICE_DATE).slice(0, 10).replace(/-/g, '')
        : null,
    revenue,
    netProfit,
    roe: row.ROE != null ? Number(row.ROE) : null,
    debtRatio:
      row.DEBT_ASSET_RATIO != null ? Number(row.DEBT_ASSET_RATIO) : null,
    grossMargin: row.SALE_NPR != null ? Number(row.SALE_NPR) : null,
    revenueYoy: yoyPct(revenue, priorRevenue),
    netProfitYoy: yoyPct(netProfit, priorNetProfit),
  };
}

export async function fetchAnnouncements(symbol: string, days: number) {
  const cacheKey = `em:ann:${symbol}:${days}`;
  const cached = getCached<ReturnType<typeof mapAnnouncements>>(cacheKey);
  if (cached) return { data: cached, cached: true as const };

  const json = await freeFetchJson<AnnouncementResponse>(
    `https://np-anotice-stock.eastmoney.com/api/security/ann?sr=-1&page_size=15&page_index=1&ann_type=A&client_source=web&stock_list=${symbol}`,
  );

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const data = mapAnnouncements(json, cutoff);
  setCached(cacheKey, data, TTL_MS.announcements);
  return { data, cached: false as const };
}

function mapAnnouncements(json: AnnouncementResponse, cutoff: Date) {
  const list = json.data?.list ?? [];

  return list
    .filter((item) => {
      if (!item.notice_date) return true;
      return new Date(item.notice_date) >= cutoff;
    })
    .slice(0, 15)
    .map((item) => ({
      annDate:
        item.notice_date != null
          ? String(item.notice_date).slice(0, 10).replace(/-/g, '')
          : '',
      title: String(item.title ?? ''),
    }));
}

export async function fetchNews(symbol: string, _stockName: string, days: number) {
  const cacheKey = `em:news:${symbol}:${days}`;
  const cached = getCached<ReturnType<typeof mapNewsBulletin>>(cacheKey);
  if (cached) return { data: cached, cached: true as const };

  const code = toMarketCode(symbol);
  const json = await freeFetchJson<NewsBulletinResponse>(
    `https://emweb.securities.eastmoney.com/PC_HSF10/NewsBulletin/PageAjax?code=${code}`,
  );

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const data = mapNewsBulletin(json, cutoff);
  setCached(cacheKey, data, TTL_MS.news);
  return { data, cached: false as const };
}

function mapNewsBulletin(json: NewsBulletinResponse, cutoff: Date) {
  const list = json.gszx?.data?.items ?? [];

  return list
    .filter((item) => {
      if (!item.showDateTime) {
        return true;
      }
      return new Date(item.showDateTime) >= cutoff;
    })
    .slice(0, 10)
    .map((item) => ({
      datetime: item.showDateTime
        ? new Date(item.showDateTime).toISOString()
        : '',
      title: String(item.title ?? ''),
      source: null as string | null,
      url: item.url != null ? String(item.url) : null,
    }));
}

async function findIndustryBoard(industryName: string): Promise<string | null> {
  const cacheKey = `em:board:${industryName}`;
  const cached = getCached<string>(cacheKey);
  if (cached) return cached;

  const keyword = industryName.replace(/[ⅠⅡⅢⅣⅤ\d\s]/g, '').slice(0, 4);
  if (!keyword) return null;

  const json = await freeFetchJson<IndustryListResponse>(
    'https://push2delay.eastmoney.com/api/qt/clist/get?pn=1&pz=500&fs=m:90+t:2&fields=f12,f14',
  );

  const diff = json.data?.diff ?? {};
  const boards = Object.values(diff);

  const match =
    boards.find((item) => String(item.f14 ?? '').includes(keyword)) ??
    boards.find((item) => keyword.includes(String(item.f14 ?? '').slice(0, 2)));

  if (!match?.f12) return null;

  const boardCode = String(match.f12);
  setCached(cacheKey, boardCode, TTL_MS.industry);
  return boardCode;
}

export async function fetchIndustryPeers(
  industryName: string,
  excludeSymbol: string,
  limit: number,
) {
  const boardCode = await findIndustryBoard(industryName);
  if (!boardCode) {
    return { peers: [], cached: false as const };
  }

  const cacheKey = `em:peers:${boardCode}:${limit}`;
  const cached = getCached<ReturnType<typeof mapPeers>>(cacheKey);
  if (cached) return { peers: cached, cached: true as const };

  const json = await freeFetchJson<IndustryPeersResponse>(
    `https://push2delay.eastmoney.com/api/qt/clist/get?pn=1&pz=${limit + 5}&fs=b:${boardCode}&fields=f12,f14,f9,f23,f20`,
  );

  const peers = mapPeers(json, excludeSymbol, limit);
  setCached(cacheKey, peers, TTL_MS.industry);
  return { peers, cached: false as const };
}

function mapPeers(
  json: IndustryPeersResponse,
  excludeSymbol: string,
  limit: number,
) {
  const raw = json.data?.diff ?? [];
  const diff = Array.isArray(raw) ? raw : Object.values(raw);

  return diff
    .filter((item) => String(item.f12) !== excludeSymbol)
    .slice(0, limit)
    .map((item) => ({
      symbol: String(item.f12 ?? ''),
      name: String(item.f14 ?? ''),
      roe: null as number | null,
      debtRatio: null as number | null,
      revenueYoy: null as number | null,
      pe: item.f9 != null ? Number(item.f9) : null,
      pb: item.f23 != null ? Number(item.f23) : null,
      marketCap: item.f20 != null ? Number(item.f20) : null,
      endDate: null as string | null,
    }));
}

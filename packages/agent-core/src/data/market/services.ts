import {
  fetchAnnouncements,
  fetchCompanyProfile,
  fetchIndustryPeers,
  fetchLatestFinancial,
  fetchNews,
  fetchStockSnapshot,
} from './free/eastmoney.js';
import { fetchNewsBrowser } from './free/news-browser.js';
import { fetchDailyKlines } from './free/tencent.js';
import {
  fetchLocalEtfDailyKlines,
  hasLocalEtfDailyCsv,
  LOCAL_ETF_LOAD_ALL_DAYS,
} from './local-csv/etf-daily.js';
import { buildMeta } from './meta.js';
import { isEtfSymbol } from './asset-type.js';
import { toSymbol, toTsCode } from './symbols.js';

export async function getStockBasic(symbol: string) {
  const tsCode = toTsCode(symbol);
  const code = toSymbol(tsCode);

  if (isEtfSymbol(code)) {
    const snapshot = await fetchStockSnapshot(code);
    return {
      tsCode,
      symbol: snapshot.data.symbol,
      name: snapshot.data.name,
      industry: snapshot.data.industry ?? 'ETF',
      area: null,
      listDate: null,
      market: null,
      ...buildMeta('eastmoney', snapshot.cached),
    };
  }

  const [snapshot, profile] = await Promise.all([
    fetchStockSnapshot(code),
    fetchCompanyProfile(code),
  ]);

  return {
    tsCode,
    symbol: snapshot.data.symbol,
    name: snapshot.data.name,
    industry: snapshot.data.industry ?? profile.data.industryDetail,
    area: profile.data.area,
    listDate: profile.data.listDate,
    market: profile.data.market,
    ...buildMeta('eastmoney', snapshot.cached && profile.cached),
  };
}

export async function getDailyQuote(symbol: string, days = 5) {
  const tsCode = toTsCode(symbol);
  const code = toSymbol(tsCode);

  if (isEtfSymbol(code) && hasLocalEtfDailyCsv(code)) {
    const { quotes, cached } = fetchLocalEtfDailyKlines(code, days);
    const latest = quotes[0];
    return {
      tsCode,
      quotes,
      latestClose: latest?.close ?? null,
      latestPctChg: latest?.pctChg ?? null,
      ...buildMeta('local-csv', cached),
    };
  }

  const { quotes, cached } = await fetchDailyKlines(code, days);
  const withPct = quotes.map((quote, index) => {
    const prev = quotes[index + 1];
    const pctChg =
      prev?.close && quote.close
        ? Number((((quote.close - prev.close) / prev.close) * 100).toFixed(2))
        : quote.pctChg;
    return { ...quote, pctChg };
  });

  const latest = withPct[0];
  return {
    tsCode,
    quotes: withPct,
    latestClose: latest?.close ?? null,
    latestPctChg: latest?.pctChg ?? null,
    ...buildMeta('tencent', cached),
  };
}

export async function getFinancialReport(symbol: string) {
  const tsCode = toTsCode(symbol);
  const code = toSymbol(tsCode);

  const { data, cached } = await fetchLatestFinancial(code);
  return {
    tsCode,
    ...data,
    ...buildMeta('eastmoney', cached),
  };
}

export async function getAnnouncements(symbol: string, days = 30) {
  const tsCode = toTsCode(symbol);
  const code = toSymbol(tsCode);

  const { data, cached } = await fetchAnnouncements(code, days);
  return {
    tsCode,
    announcements: data,
    count: data.length,
    ...buildMeta('eastmoney', cached),
  };
}

export async function comparePeers(symbol: string, limit = 5) {
  const tsCode = toTsCode(symbol);
  const code = toSymbol(tsCode);

  const basic = await getStockBasic(symbol);
  const industry = basic.industry;
  if (!industry) throw new Error(`股票 ${symbol} 缺少行业信息，无法对比`);

  const { peers: industryPeers, cached } = await fetchIndustryPeers(
    industry,
    code,
    limit - 1,
  );

  const targetPeer = await buildPeerRow(symbol, basic.name, tsCode);

  const presetPeers = await fetchPresetIndustryPeers(code, industry);
  const otherPeers = mergePeerRows(
    [
      ...presetPeers,
      ...industryPeers.map((peer) => ({
        tsCode: toTsCode(peer.symbol),
        symbol: peer.symbol,
        name: peer.name,
        roe: peer.roe,
        debtRatio: peer.debtRatio,
        revenueYoy: peer.revenueYoy,
        netProfitYoy: null as number | null,
        endDate: peer.endDate,
        pe: peer.pe,
        pb: peer.pb,
        marketCap: peer.marketCap,
      })),
    ],
    code,
    Math.max(limit - 1, presetPeers.length),
  );

  return {
    target: {
      tsCode,
      symbol: basic.symbol,
      name: basic.name,
      industry,
    },
    peers: [targetPeer, ...otherPeers],
    presetPeerSymbols: presetPeers.map((p) => p.symbol),
    ...buildMeta('eastmoney', cached),
  };
}

type PeerRow = {
  tsCode: string;
  symbol: string;
  name: string;
  roe: number | null;
  debtRatio: number | null;
  revenueYoy: number | null;
  netProfitYoy?: number | null;
  endDate: string | null;
  pe: number | null;
  pb: number | null;
  marketCap: number | null;
};

const INDUSTRY_PEER_PRESETS: Array<{
  keywords: string[];
  peers: Array<{ symbol: string; name: string }>;
}> = [
  {
    keywords: ['医药', '外包', 'CRO', 'CDMO', 'CXO', '医疗研发', '生物'],
    peers: [
      { symbol: '603259', name: '药明康德' },
      { symbol: '300759', name: '康龙化成' },
      { symbol: '300347', name: '泰格医药' },
      { symbol: '002821', name: '凯莱英' },
    ],
  },
];

function mergePeerRows(rows: PeerRow[], excludeSymbol: string, limit: number) {
  const seen = new Set<string>();
  const merged: PeerRow[] = [];

  for (const row of rows) {
    if (row.symbol === excludeSymbol || seen.has(row.symbol)) continue;
    seen.add(row.symbol);
    merged.push(row);
    if (merged.length >= limit) break;
  }

  return merged;
}

async function buildPeerRow(
  symbol: string,
  name: string,
  tsCode: string,
): Promise<PeerRow> {
  const row: PeerRow = {
    tsCode,
    symbol: toSymbol(tsCode),
    name,
    roe: null,
    debtRatio: null,
    revenueYoy: null,
    netProfitYoy: null,
    endDate: null,
    pe: null,
    pb: null,
    marketCap: null,
  };

  try {
    const [financial, snapshot] = await Promise.all([
      fetchLatestFinancial(symbol),
      fetchStockSnapshot(symbol),
    ]);
    row.roe = financial.data.roe;
    row.debtRatio = financial.data.debtRatio;
    row.revenueYoy = financial.data.revenueYoy;
    row.netProfitYoy = financial.data.netProfitYoy;
    row.endDate = financial.data.endDate;
    row.pe = snapshot.data.pe;
    row.pb = snapshot.data.pb;
  } catch {
    // 单票财务缺失时仍返回基础行
  }

  return row;
}

const KNOWN_CXO_SYMBOLS = new Set([
  '002821',
  '603259',
  '300759',
  '300347',
  '300363',
  '603127',
  '688131',
  '688076',
]);

async function fetchPresetIndustryPeers(
  excludeSymbol: string,
  industry: string,
): Promise<PeerRow[]> {
  const preset =
    KNOWN_CXO_SYMBOLS.has(excludeSymbol)
      ? INDUSTRY_PEER_PRESETS[0]
      : INDUSTRY_PEER_PRESETS.find((entry) =>
          entry.keywords.some((keyword) => industry.includes(keyword)),
        );
  if (!preset) return [];

  const rows = await Promise.all(
    preset.peers
      .filter((peer) => peer.symbol !== excludeSymbol)
      .map(async (peer) => buildPeerRow(peer.symbol, peer.name, toTsCode(peer.symbol))),
  );

  return rows;
}

export async function comparePeerSymbols(
  symbols: string[],
  excludeSymbol?: string,
) {
  const unique = [...new Set(symbols.map((s) => toSymbol(toTsCode(s))))].filter(
    (symbol) => symbol !== excludeSymbol,
  );

  const peers = await Promise.all(
    unique.map(async (symbol) => {
      const tsCode = toTsCode(symbol);
      const basic = await getStockBasic(symbol).catch(() => null);
      return buildPeerRow(symbol, basic?.name ?? symbol, tsCode);
    }),
  );

  return { peers, ...buildMeta('eastmoney', false) };
}

export async function searchNews(symbol: string, days = 7) {
  const tsCode = toTsCode(symbol);
  const code = toSymbol(tsCode);

  const basic = await fetchStockSnapshot(code);

  try {
    const { data, cached } = await fetchNews(code, basic.data.name, days);
    return {
      tsCode,
      stockName: basic.data.name,
      items: data,
      count: data.length,
      fetchMethod: 'http' as const,
      ...buildMeta('eastmoney', cached && basic.cached),
    };
  } catch (httpError) {
    const { data } = await fetchNewsBrowser(code, days);
    const message =
      httpError instanceof Error ? httpError.message : String(httpError);

    return {
      tsCode,
      stockName: basic.data.name,
      items: data,
      count: data.length,
      fetchMethod: 'browser' as const,
      httpError: message,
      ...buildMeta('eastmoney', false),
    };
  }
}

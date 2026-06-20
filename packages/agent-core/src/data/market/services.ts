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
import { buildMeta } from './meta.js';
import { toSymbol, toTsCode } from './symbols.js';

export async function getStockBasic(symbol: string) {
  const tsCode = toTsCode(symbol);
  const code = toSymbol(tsCode);

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

  const targetPeer = {
    tsCode,
    symbol: basic.symbol,
    name: basic.name,
    roe: null as number | null,
    debtRatio: null as number | null,
    revenueYoy: null as number | null,
    endDate: null as string | null,
    pe: null as number | null,
    pb: null as number | null,
    marketCap: null as number | null,
  };

  try {
    const financial = await fetchLatestFinancial(code);
    targetPeer.roe = financial.data.roe;
    targetPeer.debtRatio = financial.data.debtRatio;
    targetPeer.endDate = financial.data.endDate;
  } catch {
    // 财务数据缺失时仍返回行业 peers
  }

  return {
    target: {
      tsCode,
      symbol: basic.symbol,
      name: basic.name,
      industry,
    },
    peers: [
      targetPeer,
      ...industryPeers.map((peer) => ({
        tsCode: toTsCode(peer.symbol),
        symbol: peer.symbol,
        name: peer.name,
        roe: peer.roe,
        debtRatio: peer.debtRatio,
        revenueYoy: peer.revenueYoy,
        endDate: peer.endDate,
        pe: peer.pe,
        pb: peer.pb,
        marketCap: peer.marketCap,
      })),
    ],
    ...buildMeta('eastmoney', cached),
  };
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

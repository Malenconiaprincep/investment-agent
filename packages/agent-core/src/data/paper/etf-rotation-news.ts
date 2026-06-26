import {
  evaluateEtfNewsSentiment,
  filterNewsForTradeDate,
  getEtfNewsProfile,
  loadLiveEtfNews,
  shouldBlockEtfEntryByNews,
  type EtfNewsFilterMode,
  type EtfNewsSentiment,
} from '../backtest/etf-news.js';
import { ETF_POOL_19 } from '../etf/pool.js';
import { extractThemesFromNews } from '../market/hot-market-discovery.js';

/** 命中当日主线时，给 20 日动量得分加的百分点 */
export const ETF_THEME_MOMENTUM_BOOST_PCT = 3;

export type EtfRotationContext = {
  tradeDate: string;
  hotThemes: string[];
  newsFilter: EtfNewsFilterMode;
  lookbackDays: number;
  themeBoostBySymbol: Record<string, number>;
  newsBlockedSymbols: Set<string>;
  newsBySymbol: Record<string, EtfNewsSentiment>;
  matchedThemesBySymbol: Record<string, string[]>;
  summary: string;
};

function parseNewsFilterMode(): EtfNewsFilterMode {
  const raw = process.env.ETF_PAPER_NEWS_FILTER?.trim().toLowerCase();
  if (raw === 'off' || raw === 'avoid_bearish' || raw === 'require_bullish') {
    return raw;
  }
  return 'avoid_bearish';
}

function parseLookbackDays(): number {
  const parsed = Number(process.env.ETF_PAPER_NEWS_LOOKBACK_DAYS ?? 3);
  if (!Number.isFinite(parsed) || parsed < 1) return 3;
  return Math.min(7, Math.floor(parsed));
}

export function themeMatchesEtfKeyword(theme: string, keyword: string): boolean {
  const compactTheme = theme.replace(/[，,。！？\s]/g, '').toLowerCase();
  const compactKeyword = keyword.replace(/[，,。！？\s]/g, '').toLowerCase();
  if (compactTheme.length < 2 || compactKeyword.length < 2) return false;
  return (
    compactTheme.includes(compactKeyword)
    || compactKeyword.includes(compactTheme)
    || compactTheme.slice(0, 2) === compactKeyword.slice(0, 2)
  );
}

export function matchEtfThemes(
  symbol: string,
  name: string,
  hotThemes: string[],
): string[] {
  if (hotThemes.length === 0) return [];
  const profile = getEtfNewsProfile(symbol, name);
  return hotThemes.filter((theme) =>
    profile.keywords.some((keyword) => themeMatchesEtfKeyword(theme, keyword)),
  );
}

export function buildEtfRotationContext(input: {
  tradeDate: string;
  news: Awaited<ReturnType<typeof loadLiveEtfNews>>;
  newsFilter?: EtfNewsFilterMode;
  lookbackDays?: number;
  themeLimit?: number;
}): EtfRotationContext {
  const newsFilter = input.newsFilter ?? parseNewsFilterMode();
  const lookbackDays = input.lookbackDays ?? parseLookbackDays();
  const hotThemes = extractThemesFromNews(input.news, input.themeLimit ?? 5);
  const recentNews = filterNewsForTradeDate({
    news: input.news,
    tradeDate: input.tradeDate,
    lookbackDays,
  });

  const themeBoostBySymbol: Record<string, number> = {};
  const newsBlockedSymbols = new Set<string>();
  const newsBySymbol: Record<string, EtfNewsSentiment> = {};
  const matchedThemesBySymbol: Record<string, string[]> = {};

  for (const item of ETF_POOL_19) {
    const matchedThemes = matchEtfThemes(item.symbol, item.name, hotThemes);
    if (matchedThemes.length > 0) {
      matchedThemesBySymbol[item.symbol] = matchedThemes;
      themeBoostBySymbol[item.symbol] = ETF_THEME_MOMENTUM_BOOST_PCT;
    }

    const profile = getEtfNewsProfile(item.symbol, item.name);
    const sentiment = evaluateEtfNewsSentiment({
      profile,
      news: recentNews,
    });
    newsBySymbol[item.symbol] = sentiment;

    const gate = shouldBlockEtfEntryByNews(sentiment, newsFilter);
    if (gate.blocked && item.symbol !== '510300') {
      newsBlockedSymbols.add(item.symbol);
    }
  }

  const boosted = Object.keys(themeBoostBySymbol);
  const blocked = [...newsBlockedSymbols];
  const summary = [
    hotThemes.length > 0 ? `主线：${hotThemes.join('、')}` : '主线：暂无',
    boosted.length > 0 ? `轮动加分 ${boosted.length} 只` : null,
    newsFilter === 'off'
      ? '新闻过滤关闭'
      : blocked.length > 0
        ? `新闻拦截 ${blocked.length} 只`
        : '新闻未拦截',
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    tradeDate: input.tradeDate,
    hotThemes,
    newsFilter,
    lookbackDays,
    themeBoostBySymbol,
    newsBlockedSymbols,
    newsBySymbol,
    matchedThemesBySymbol,
    summary,
  };
}

export async function loadEtfRotationContext(
  tradeDate: string,
): Promise<EtfRotationContext> {
  const news = await loadLiveEtfNews(80);
  return buildEtfRotationContext({ tradeDate, news });
}

export function formatEtfTargetRotationNote(input: {
  matchedThemes?: string[];
  newsLabel?: string;
  themeBoost?: number;
}): string {
  const parts: string[] = [];
  if (input.matchedThemes?.length) {
    parts.push(`主线${input.matchedThemes.join('、')}`);
  }
  if (input.themeBoost != null && input.themeBoost > 0) {
    parts.push(`动量+${input.themeBoost.toFixed(0)}%`);
  }
  if (input.newsLabel && input.newsLabel !== '无相关') {
    parts.push(`新闻${input.newsLabel}`);
  }
  return parts.length > 0 ? ` · ${parts.join(' · ')}` : '';
}

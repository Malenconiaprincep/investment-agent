import {
  extractThemesFromNews,
  fetchHotNews,
  isNoiseNewsTitle,
  normalizeHotNewsKey,
  pickNewsForThemes,
  rankHotNews,
  type HotNewsItem,
} from '../market/hot-market-discovery.js';
import { fetchIntradayQuotes, type IntradayQuote } from '../market/free/intraday-quote.js';
import { extractSymbolsFromText } from '../market/news-enrichment.js';
import { isLikelyLimitUp } from '../market/price-limit.js';
import { getDailyQuote, getStockBasic } from '../market/services.js';
import {
  formatTradeDate,
  getBeijingNow,
  isTradingSession,
  isWeekday,
  TRADING_HOURS_LABEL,
} from '../paper/trading-calendar.js';
import { listWatchlistItems } from '../watchlist/store.js';
import {
  filterUnseenNews,
  getMonitorRuntimeState,
  hasAlertDedupeKey,
  hasRecentAlert,
  markNewsSeen,
  listMonitorAlerts,
  saveAlertDedupeKey,
  saveMonitorAlert,
  saveMonitorPollRun,
  setMonitorRuntimeState,
  purgeExpiredMonitorData,
  type MonitorAlertSeverity,
  type MonitorAlertType,
} from './store.js';
import type {
  MonitorPaperAction,
  MonitorPaperRecommendation,
} from '../paper/monitor-bridge.js';

export type MonitorPollResult = {
  tradeDate: string;
  marketOpen: boolean;
  newsCount: number;
  newNewsCount: number;
  alertsCreated: number;
  symbolsScanned: number;
  alerts: Awaited<ReturnType<typeof saveMonitorAlert>>[];
  hotNews: HotNewsItem[];
  newNews: HotNewsItem[];
  hotThemes: string[];
  recommendations: MonitorPaperRecommendation[];
  paperActions: MonitorPaperAction[];
  elapsedMs: number;
  summary: string;
  skipped?: boolean;
};

type SymbolContext = {
  symbol: string;
  name: string;
  quote: IntradayQuote | null;
  ret20dPct: number | null;
  newsItems: HotNewsItem[];
  themes: string[];
  inWatchlist: boolean;
};

const NON_A_SHARE_PATTERN =
  /港股|韩股|美股|欧股|日本|泰国|新加坡|SpaceX|期货|汇率|债券|央行|联合国/i;

function isAShareRelevant(text: string): boolean {
  if (NON_A_SHARE_PATTERN.test(text)) return false;
  return /A股|沪深|创业板|科创板|涨停|板块|概念|[\d]{6}/.test(text) || !/股/.test(text);
}

function matchThemeInText(text: string, themes: string[]): string | null {
  const lower = text.toLowerCase();
  for (const theme of themes) {
    const keyword = theme.replace(/概念|板块/g, '').trim();
    if (keyword.length >= 2 && lower.includes(keyword.toLowerCase())) {
      return theme;
    }
  }
  return null;
}

function newsKey(item: HotNewsItem): string {
  return normalizeHotNewsKey(item.title);
}

function newsSource(item: HotNewsItem): string | null {
  if (!item.url) return null;
  try {
    return new URL(item.url).hostname;
  } catch {
    return null;
  }
}

function pushUniqueNews(target: HotNewsItem[], item: HotNewsItem) {
  if (target.some((existing) => newsKey(existing) === newsKey(item))) return;
  target.push(item);
}

function truncateText(text: string, max = 80): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function fmtPct(v: number): string {
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function buildKlineFactor(ret20dPct: number | null): string {
  if (ret20dPct == null) {
    return 'K线因子：20日涨幅暂缺，继续等待红钻+动量确认';
  }
  if (ret20dPct >= 25) {
    return `K线因子：20日涨幅 ${fmtPct(ret20dPct)}，短线偏热，避免追高`;
  }
  if (ret20dPct <= -10) {
    return `K线因子：20日涨幅 ${fmtPct(ret20dPct)}，趋势仍弱，仅跟踪不抢跑`;
  }
  return `K线因子：20日涨幅 ${fmtPct(ret20dPct)}，尚未明显透支`;
}

function buildFactorSummary(input: {
  kind: 'pre_move' | 'news_catalyst' | 'early_move' | 'watchlist_surge';
  ctx: SymbolContext;
  news?: HotNewsItem;
  theme?: string | null;
  pct?: number | null;
}): string {
  const parts: string[] = [];
  if (input.news) parts.push(`新闻因子：${truncateText(input.news.title)}`);
  if (input.theme) parts.push(`题材因子：命中 ${input.theme}`);

  if (input.pct != null) {
    if (input.kind === 'pre_move') {
      parts.push(`盘口因子：当前涨幅 ${fmtPct(input.pct)}，新闻出现但股价尚未启动`);
    } else if (input.kind === 'early_move') {
      parts.push(`盘口因子：当前涨幅 ${fmtPct(input.pct)}，处于温和启动区间`);
    } else if (input.kind === 'watchlist_surge') {
      parts.push(`盘口因子：自选标的盘中波动 ${fmtPct(input.pct)}，需要复核持仓计划`);
    } else {
      parts.push(`盘口因子：当前涨幅 ${fmtPct(input.pct)}，未触及涨停过滤线`);
    }
  } else {
    parts.push('盘口因子：暂无实时涨幅，等待盘口确认');
  }

  parts.push(buildKlineFactor(input.ctx.ret20dPct));

  if (input.kind === 'pre_move') {
    parts.push('操作结论：未涨停且未大幅追高，纳入潜伏买入候选');
  } else if (input.kind === 'early_move') {
    parts.push('操作结论：未涨停，先自动跟踪，等红钻+动量达标再买入模拟盘');
  } else if (input.kind === 'watchlist_surge') {
    parts.push('操作结论：自选池异动提醒，按原计划复核，不追涨停板');
  } else {
    parts.push('操作结论：记录催化并自动跟踪，过滤已涨停或接近涨停标的');
  }

  return parts.join('；');
}

function attachNewsByKnownNames(
  symbols: Map<string, { name: string; news: HotNewsItem[]; inWatchlist: boolean }>,
  news: HotNewsItem[],
) {
  for (const item of news) {
    const title = item.title;
    for (const meta of symbols.values()) {
      const name = meta.name.trim();
      if (name.length < 2 || /^\d{6}$/.test(name)) continue;
      if (title.includes(name)) pushUniqueNews(meta.news, item);
    }
  }
}

async function calcRet20d(symbol: string): Promise<number | null> {
  try {
    const data = await getDailyQuote(symbol, 30);
    const bars = data.quotes.filter((q) => q.close != null);
    if (bars.length <= 20) return null;
    const latest = bars[0].close!;
    const base = bars[20].close!;
    if (base === 0) return null;
    return Number((((latest - base) / base) * 100).toFixed(2));
  } catch {
    return null;
  }
}

function isUnresolvedName(name: string | undefined, symbol: string): boolean {
  if (!name) return true;
  const trimmed = name.trim();
  return trimmed === symbol || /^\d{6}$/.test(trimmed);
}

async function resolveUnresolvedSymbolNames(
  symbols: Map<string, { name: string; news: HotNewsItem[]; inWatchlist: boolean }>,
) {
  const pending = [...symbols.entries()].filter(([symbol, meta]) =>
    isUnresolvedName(meta.name, symbol),
  );
  if (pending.length === 0) return;

  await Promise.all(
    pending.map(async ([symbol]) => {
      try {
        const basic = await getStockBasic(symbol);
        const meta = symbols.get(symbol);
        if (meta && basic.name) meta.name = basic.name;
      } catch {
        // 保留原名称
      }
    }),
  );
}

async function buildSymbolContexts(input: {
  symbols: Map<string, { name: string; news: HotNewsItem[]; inWatchlist: boolean }>;
  quotes: Map<string, IntradayQuote>;
  hotThemes: string[];
}): Promise<SymbolContext[]> {
  const contexts: SymbolContext[] = [];

  for (const [symbol, meta] of input.symbols) {
    const quote = input.quotes.get(symbol) ?? null;
    const ret20dPct = await calcRet20d(symbol);
    const themes = input.hotThemes.filter(
      (theme) =>
        meta.news.some((n) => matchThemeInText(n.title, [theme])) ||
        matchThemeInText(meta.name, [theme]),
    );

    contexts.push({
      symbol,
      name: quote?.name ?? meta.name,
      quote,
      ret20dPct,
      newsItems: meta.news,
      themes,
      inWatchlist: meta.inWatchlist,
    });
  }

  return contexts;
}

async function createAlertIfNew(input: {
  alertType: MonitorAlertType;
  severity: MonitorAlertSeverity;
  symbol: string | null;
  name: string | null;
  title: string;
  summary: string;
  newsTitle?: string | null;
  newsUrl?: string | null;
  pctChg?: number | null;
  ret20dPct?: number | null;
  theme?: string | null;
  tradeDate: string;
  alerts: Awaited<ReturnType<typeof saveMonitorAlert>>[];
  dedupeKey?: string;
}) {
  if (input.dedupeKey && (await hasAlertDedupeKey(input.dedupeKey))) {
    return;
  }

  if (!input.dedupeKey) {
    const duplicate = await hasRecentAlert({
      symbol: input.symbol,
      alertType: input.alertType,
      tradeDate: input.tradeDate,
    });
    if (duplicate) return;
  }

  const saved = await saveMonitorAlert({
    alertType: input.alertType,
    severity: input.severity,
    symbol: input.symbol,
    name: input.name,
    title: input.title,
    summary: input.summary,
    newsTitle: input.newsTitle ?? null,
    newsUrl: input.newsUrl ?? null,
    pctChg: input.pctChg ?? null,
    ret20dPct: input.ret20dPct ?? null,
    theme: input.theme ?? null,
    tradeDate: input.tradeDate,
  });
  if (input.dedupeKey) {
    await saveAlertDedupeKey({
      dedupeKey: input.dedupeKey,
      alertId: saved.id,
    });
  }
  input.alerts.push(saved);
}

function collectNewsSymbols(
  news: HotNewsItem[],
): Map<string, { name: string; news: HotNewsItem[] }> {
  const map = new Map<string, { name: string; news: HotNewsItem[] }>();

  for (const item of news) {
    const fromTitle = extractSymbolsFromText(item.title, item.title);
    for (const entry of fromTitle) {
      const existing = map.get(entry.symbol);
      if (existing) {
        existing.news.push(item);
      } else {
        map.set(entry.symbol, { name: entry.name, news: [item] });
      }
    }
  }

  return map;
}

/** 实时新闻 + 行情监控：优先捕捉「有催化、尚未大涨」 */
export async function runMonitorPoll(options?: {
  force?: boolean;
}): Promise<MonitorPollResult> {
  const started = Date.now();
  const now = getBeijingNow();
  const tradeDate = formatTradeDate(now);
  const marketOpen = isTradingSession(now);
  const alerts: Awaited<ReturnType<typeof saveMonitorAlert>>[] = [];

  await purgeExpiredMonitorData().catch(() => {
    // 清理失败不阻断扫描
  });

  if (!options?.force && !isWeekday(now)) {
    const summary = '周末休市，跳过盘中监控';
    await saveMonitorPollRun({
      tradeDate,
      status: 'skipped',
      newsCount: 0,
      newNewsCount: 0,
      alertCount: 0,
      symbolsScanned: 0,
      marketOpen: false,
      elapsedMs: Date.now() - started,
      summary,
    });
    return {
      tradeDate,
      marketOpen: false,
      newsCount: 0,
      newNewsCount: 0,
      alertsCreated: 0,
      symbolsScanned: 0,
      alerts: [],
      hotNews: [],
      newNews: [],
      hotThemes: [],
      recommendations: [],
      paperActions: [],
      elapsedMs: Date.now() - started,
      summary,
    };
  }

  const { items: hotNews } = await fetchHotNews(30, { lookbackDays: 3 });
  const themeNews = pickNewsForThemes(hotNews, undefined, 2);
  const hotThemes = extractThemesFromNews(themeNews, 5);

  const newsKeys = hotNews.map((item) => ({
    key: newsKey(item),
    title: item.title,
    url: item.url,
    publishedAt: item.datetime || null,
    source: newsSource(item),
  }));
  const unseenKeys = await filterUnseenNews(newsKeys);
  const unseenSet = new Set(unseenKeys.map((item) => item.key));
  const newNews = hotNews.filter((item) =>
    unseenSet.has(newsKey(item)),
  );

  const watchlist = await listWatchlistItems();

  const { listScreeningSessions, getScreeningSession } = await import('../screening/store.js');
  const sessions = await listScreeningSessions({ limit: 1 });
  const latestScreen = sessions[0]?.id
    ? await getScreeningSession(sessions[0].id)
    : null;

  type SymbolMeta = { name: string; news: HotNewsItem[]; inWatchlist: boolean };
  const symbolMeta = new Map<string, SymbolMeta>();

  for (const [symbol, meta] of collectNewsSymbols(rankHotNews(newNews))) {
    symbolMeta.set(symbol, { ...meta, inWatchlist: false });
  }

  for (const [symbol, meta] of collectNewsSymbols(hotNews)) {
    const existing = symbolMeta.get(symbol);
    if (existing) {
      existing.news = [...new Map([...existing.news, ...meta.news].map((n) => [n.title, n])).values()];
      existing.name = meta.name || existing.name;
    } else {
      symbolMeta.set(symbol, { ...meta, inWatchlist: false });
    }
  }

  for (const item of watchlist) {
    const existing = symbolMeta.get(item.symbol);
    if (existing) {
      existing.inWatchlist = true;
      existing.name = item.name;
    } else {
      symbolMeta.set(item.symbol, {
        name: item.name,
        news: [],
        inWatchlist: true,
      });
    }
  }

  for (const candidate of latestScreen?.candidates ?? []) {
    const existing = symbolMeta.get(candidate.symbol);
    if (existing) {
      existing.name = candidate.name;
    } else {
      symbolMeta.set(candidate.symbol, {
        name: candidate.name,
        news: [],
        inWatchlist: false,
      });
    }
  }

  attachNewsByKnownNames(symbolMeta, hotNews);

  await resolveUnresolvedSymbolNames(symbolMeta);

  const quotes = marketOpen
    ? await fetchIntradayQuotes([...symbolMeta.keys()])
    : new Map<string, IntradayQuote>();

  const contexts = await buildSymbolContexts({
    symbols: symbolMeta,
    quotes,
    hotThemes,
  });

  for (const ctx of contexts) {
    const pct = ctx.quote?.pctChg ?? null;
    const limitBlocked =
      marketOpen &&
      isLikelyLimitUp({
        symbol: ctx.symbol,
        name: ctx.name,
        pctChg: pct,
        price: ctx.quote?.price,
        prevClose: ctx.quote?.prevClose,
      });
    if (limitBlocked) continue;

    for (const news of ctx.newsItems) {
      if (isNoiseNewsTitle(news.title)) continue;
      const theme = matchThemeInText(news.title, hotThemes);

      if (marketOpen && pct != null && pct >= -0.5 && pct <= 2.5) {
        const notChased = ctx.ret20dPct == null || ctx.ret20dPct < 25;
        if (notChased) {
          await createAlertIfNew({
            alertType: 'pre_move',
            severity: 'urgent',
            symbol: ctx.symbol,
            name: ctx.name,
            title: `【潜伏】${ctx.name} 新闻催化，股价尚未启动`,
            summary: buildFactorSummary({
              kind: 'pre_move',
              ctx,
              news,
              theme,
              pct,
            }),
            newsTitle: news.title,
            newsUrl: news.url,
            pctChg: pct,
            ret20dPct: ctx.ret20dPct,
            theme,
            tradeDate,
            alerts,
            dedupeKey: `pre_move:${ctx.symbol}:${newsKey(news)}`,
          });
          continue;
        }
      }

      await createAlertIfNew({
        alertType: 'news_catalyst',
        severity: pct != null && pct > 5 ? 'watch' : 'urgent',
        symbol: ctx.symbol,
        name: ctx.name,
        title: `【资讯】${ctx.name} 出现新催化`,
        summary: buildFactorSummary({
          kind: 'news_catalyst',
          ctx,
          news,
          theme,
          pct,
        }),
        newsTitle: news.title,
        newsUrl: news.url,
        pctChg: pct,
        ret20dPct: ctx.ret20dPct,
        theme,
        tradeDate,
        alerts,
        dedupeKey: `news_catalyst:${ctx.symbol}:${newsKey(news)}`,
      });
    }

    if (!marketOpen || pct == null) continue;

    const theme = ctx.themes[0] ?? null;
    const notExtreme =
      ctx.ret20dPct == null || (ctx.ret20dPct >= -10 && ctx.ret20dPct < 30);

    if (
      theme &&
      pct >= 1.5 &&
      pct <= 7 &&
      notExtreme
    ) {
      await createAlertIfNew({
        alertType: 'early_move',
        severity: 'watch',
        symbol: ctx.symbol,
        name: ctx.name,
        title: `【启动】${ctx.name} 主线 "${theme}" 下温和走强`,
        summary: buildFactorSummary({
          kind: 'early_move',
          ctx,
          theme,
          pct,
        }),
        pctChg: pct,
        ret20dPct: ctx.ret20dPct,
        theme,
        tradeDate,
        alerts,
        dedupeKey: `early_move:${ctx.symbol}:${tradeDate}:${theme ?? 'none'}`,
      });
    }

    if (ctx.inWatchlist && Math.abs(pct) >= 3) {
      await createAlertIfNew({
        alertType: 'watchlist_surge',
        severity: Math.abs(pct) >= 5 ? 'urgent' : 'watch',
        symbol: ctx.symbol,
        name: ctx.name,
        title: `【自选】${ctx.name} 盘中波动 ${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`,
        summary: buildFactorSummary({
          kind: 'watchlist_surge',
          ctx,
          theme,
          pct,
        }),
        pctChg: pct,
        ret20dPct: ctx.ret20dPct,
        tradeDate,
        alerts,
        dedupeKey: `watchlist_surge:${ctx.symbol}:${tradeDate}`,
      });
    }
  }

  for (const theme of hotThemes.slice(0, 3)) {
    if (!isAShareRelevant(theme)) continue;
    const recent = newNews.find(
      (item) =>
        isAShareRelevant(item.title) && matchThemeInText(item.title, [theme]),
    );
    if (!recent) continue;

    await createAlertIfNew({
      alertType: 'theme_ignite',
      severity: 'info',
      symbol: null,
      name: null,
      title: `【主线】${theme} 出现新资讯`,
      summary: recent.title.slice(0, 100),
      newsTitle: recent.title,
      newsUrl: recent.url,
      theme,
      tradeDate,
      alerts,
      dedupeKey: `theme_ignite:${theme}:${tradeDate}`,
    });
  }

  await markNewsSeen(newsKeys);

  const elapsedMs = Date.now() - started;
  const summary = marketOpen
    ? `扫描 ${contexts.length} 只，新增 ${alerts.length} 条提醒（新资讯 ${newNews.length} 条）`
    : `非交易时段（${TRADING_HOURS_LABEL}），仅处理资讯 ${newNews.length} 条`;

  await saveMonitorPollRun({
    tradeDate,
    status: 'success',
    newsCount: hotNews.length,
    newNewsCount: newNews.length,
    alertCount: alerts.length,
    symbolsScanned: contexts.length,
    marketOpen,
    elapsedMs,
    summary,
  });

  let recommendations: MonitorPaperRecommendation[] = [];
  let paperActions: MonitorPaperAction[] = [];
  try {
    const { runMonitorPaperBridge } = await import('../paper/monitor-bridge.js');
    const bridgeAlerts = await listMonitorAlerts({ tradeDate, limit: 50 });
    const bridgeResult = await runMonitorPaperBridge({
      alerts: bridgeAlerts,
      tradeDate,
    });
    recommendations = bridgeResult.recommendations;
    paperActions = bridgeResult.paperActions;
  } catch (error) {
    paperActions = [
      {
        kind: 'buy',
        status: 'error',
        symbol: 'monitor',
        name: '消息雷达',
        reason: '消息推荐桥接失败',
        error: error instanceof Error ? error.message : String(error),
      },
    ];
  }

  return {
    tradeDate,
    marketOpen,
    newsCount: hotNews.length,
    newNewsCount: newNews.length,
    alertsCreated: alerts.length,
    symbolsScanned: contexts.length,
    alerts,
    hotNews: themeNews.slice(0, 12),
    newNews: newNews.slice(0, 12),
    hotThemes,
    recommendations,
    paperActions,
    elapsedMs,
    summary,
  };
}

const MONITOR_STATE_KEY = 'monitor-poll';
const DEFAULT_MIN_INTERVAL_MS = 90 * 1000;
const DEFAULT_LOCK_TIMEOUT_MS = 3 * 60 * 1000;

function emptySkippedResult(input: {
  tradeDate: string;
  marketOpen: boolean;
  summary: string;
  started: number;
}): MonitorPollResult {
  return {
    tradeDate: input.tradeDate,
    marketOpen: input.marketOpen,
    newsCount: 0,
    newNewsCount: 0,
    alertsCreated: 0,
    symbolsScanned: 0,
    alerts: [],
    hotNews: [],
    newNews: [],
    hotThemes: [],
    recommendations: [],
    paperActions: [],
    elapsedMs: Date.now() - input.started,
    summary: input.summary,
    skipped: true,
  };
}

export async function runMonitorPollManaged(options?: {
  force?: boolean;
  minIntervalMs?: number;
  lockTimeoutMs?: number;
}): Promise<MonitorPollResult> {
  const started = Date.now();
  const now = getBeijingNow();
  const tradeDate = formatTradeDate(now);
  const marketOpen = isTradingSession(now);
  const minIntervalMs = options?.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  const lockTimeoutMs = options?.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;

  const state = await getMonitorRuntimeState(MONITOR_STATE_KEY);
  if (!options?.force && state?.running && state.startedAt) {
    const runningFor = Date.now() - Date.parse(state.startedAt);
    if (Number.isFinite(runningFor) && runningFor < lockTimeoutMs) {
      return emptySkippedResult({
        tradeDate,
        marketOpen,
        started,
        summary: '已有监控扫描正在进行，跳过本次重复触发',
      });
    }
  }

  if (!options?.force && state?.finishedAt) {
    const sinceLast = Date.now() - Date.parse(state.finishedAt);
    if (Number.isFinite(sinceLast) && sinceLast < minIntervalMs) {
      return emptySkippedResult({
        tradeDate,
        marketOpen,
        started,
        summary: '距离上次扫描较近，复用已有结果',
      });
    }
  }

  await setMonitorRuntimeState(MONITOR_STATE_KEY, {
    running: true,
    startedAt: new Date(started).toISOString(),
  });

  try {
    const result = await runMonitorPoll({ force: options?.force });
    await setMonitorRuntimeState(MONITOR_STATE_KEY, {
      running: false,
      startedAt: new Date(started).toISOString(),
      finishedAt: new Date().toISOString(),
      summary: result.summary,
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await setMonitorRuntimeState(MONITOR_STATE_KEY, {
      running: false,
      startedAt: new Date(started).toISOString(),
      finishedAt: new Date().toISOString(),
      error: message,
    });
    throw error;
  }
}

export async function getMonitorStatus() {
  const now = getBeijingNow();
  const tradeDate = formatTradeDate(now);
  const { getLatestMonitorPollRun } = await import('./store.js');
  const { buildMonitorRecommendations, listRecentMonitorPaperActions, mergeMonitorPaperActionsForStatus } =
    await import('../paper/monitor-bridge.js');
  const { getAutoTrackSettings } = await import('./auto-track-policy.js');
  const { listWatchlistItems } = await import('../watchlist/store.js');

  const [lastRun, todayAlerts, recentPaperActions, watchlist] = await Promise.all([
    getLatestMonitorPollRun(),
    listMonitorAlerts({ tradeDate, limit: 50 }),
    listRecentMonitorPaperActions(20),
    listWatchlistItems(),
  ]);
  const recommendations = buildMonitorRecommendations(todayAlerts);
  const paperActions = mergeMonitorPaperActionsForStatus(
    [],
    recentPaperActions,
    20,
  );
  const autoTrack = await getAutoTrackSettings(watchlist.length);

  return {
    now: now.toISOString(),
    tradeDate,
    marketOpen: isTradingSession(now),
    tradingHours: TRADING_HOURS_LABEL,
    lastRun,
    todayAlerts,
    recommendations,
    paperActions,
    autoTrack,
    unacknowledgedCount: todayAlerts.filter((a) => !a.acknowledged).length,
  };
}

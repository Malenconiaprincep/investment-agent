import {
  addCalendarDays,
  formatTradeDateKey,
  normalizeTradeDateKey,
} from './date-range.js';
import {
  fetchEastMoneyColumnNews,
  fetchEastMoneyFastNews,
  fetchSinaFinanceRollNews,
} from '../market/free/market-news-feed.js';
import {
  fetchIwencaiHotNews,
  mergeHotNewsSources,
  parseNewsTime,
  type HotNewsItem,
} from '../market/hot-market-discovery.js';
import { isIwencaiMcpConfigured } from '../../mastra/mcp/iwencai.js';

export type EtfNewsFilterMode = 'off' | 'avoid_bearish' | 'require_bullish';

export type BacktestNewsLoadResult = {
  news: HotNewsItem[];
  sources: string[];
  timedOut?: boolean;
  warning?: string;
};

const DEFAULT_NEWS_TIMEOUT_MS = 12_000;
const IWENCAI_CALL_TIMEOUT_MS = 15_000;
const MAX_HISTORICAL_IWENCAI_ANCHORS = 3;

export type EtfNewsSentiment = {
  label: '利好' | '利空' | '中性' | '无相关';
  bullish: number;
  bearish: number;
  net: number;
  matchedCount: number;
  headlines: string[];
};

export type EtfNewsProfile = {
  symbol: string;
  name: string;
  keywords: string[];
};

const BULLISH_PATTERNS: RegExp[] = [
  /利好/,
  /上涨|走强|反弹|突破|新高/,
  /增长|预增|扭亏|景气|复苏/,
  /增持|回购|加仓|净流入|资金流入/,
  /政策支持|补贴|获批|订单|中标/,
  /降准|降息|宽松/,
];

const BEARISH_PATTERNS: RegExp[] = [
  /利空/,
  /下跌|走弱|暴跌|跳水|下行/,
  /减持|抛售|净流出|资金流出/,
  /亏损|预减|暴雷|退市/,
  /调查|处罚|立案|警示|违规/,
  /制裁|关税|暂停|限制/,
  /裁员|停产|延期/,
];

const MACRO_BEARISH_PATTERNS: RegExp[] = [
  /大盘.*跌|指数.*跌|A股.*跌/,
  /地缘.*风险|战争|冲突升级/,
  /流动性.*收紧|加息/,
];

const ETF_NEWS_PROFILES: EtfNewsProfile[] = [
  { symbol: '512880', name: '证券ETF', keywords: ['证券', '券商', '投行', '金融'] },
  {
    symbol: '512760',
    name: '芯片ETF国泰',
    keywords: ['半导体', '芯片', '集成电路', '晶圆'],
  },
  { symbol: '512010', name: '医药ETF', keywords: ['医药', '医疗', '生物', '创新药'] },
  { symbol: '512660', name: '军工ETF', keywords: ['军工', '国防', '航天', '航空'] },
  { symbol: '512800', name: '银行ETF', keywords: ['银行', '信贷', '息差', '金融'] },
  { symbol: '515790', name: '光伏ETF', keywords: ['光伏', '太阳能', '硅片', '组件'] },
  { symbol: '159530', name: '机器人ETF', keywords: ['机器人', '自动化', '智能制造'] },
  {
    symbol: '159995',
    name: '芯片ETF华夏',
    keywords: ['半导体', '芯片', '集成电路', '晶圆'],
  },
  { symbol: '515980', name: '人工智能ETF', keywords: ['人工智能', 'AI', '算力', '大模型'] },
  {
    symbol: '159781',
    name: '新能源车ETF',
    keywords: ['新能源', '汽车', '锂电', '电动车', '特斯拉'],
  },
  { symbol: '516160', name: '新能源ETF', keywords: ['新能源', '锂电', '储能', '光伏', '风电'] },
  {
    symbol: '159808',
    name: '创业板成长ETF',
    keywords: ['创业板', '成长', '科创', '中小盘'],
  },
  { symbol: '159920', name: '红利ETF', keywords: ['红利', '高股息', '分红', '价值'] },
  { symbol: '159941', name: '纳指ETF', keywords: ['纳指', '纳斯达克', '美股', '科技'] },
  { symbol: '513100', name: '纳指科技ETF', keywords: ['纳指', '纳斯达克', '美股', '科技'] },
  {
    symbol: '513050',
    name: '中概互联ETF',
    keywords: ['中概', '互联网', '港股', '阿里', '腾讯'],
  },
  { symbol: '513500', name: '标普500ETF', keywords: ['标普', '美股', '500'] },
  { symbol: '513520', name: '日经ETF华夏', keywords: ['日经', '日本', '日股', '海外'] },
  { symbol: '510300', name: '沪深300ETF', keywords: ['沪深300', '大盘', '蓝筹', 'A股'] },
  {
    symbol: '512480',
    name: '半导体ETF国联安',
    keywords: ['半导体', '芯片', '集成电路', '晶圆'],
  },
];

const profileBySymbol = new Map(
  ETF_NEWS_PROFILES.map((profile) => [profile.symbol, profile]),
);

export function getEtfNewsProfile(symbol: string, name: string): EtfNewsProfile {
  const known = profileBySymbol.get(symbol);
  if (known) return known;
  const base = name.replace(/ETF$/i, '').trim();
  return {
    symbol,
    name,
    keywords: base ? [base, 'ETF', 'A股'] : ['ETF', 'A股'],
  };
}

export function getStockNewsProfile(symbol: string, name: string): EtfNewsProfile {
  const cleanName = name
    .replace(/\s+/g, '')
    .replace(/股份有限公司|有限责任公司|有限公司|集团股份|集团|股份|A股|股票/g, '')
    .trim();
  const keywords = [
    name.trim(),
    cleanName,
    symbol.trim(),
  ].filter((keyword, index, all) => {
    return keyword.length >= 2 && all.indexOf(keyword) === index;
  });

  return {
    symbol,
    name,
    keywords: keywords.length > 0 ? keywords : [symbol],
  };
}

function countPatternHits(title: string, patterns: RegExp[]): number {
  return patterns.reduce((count, pattern) => count + (pattern.test(title) ? 1 : 0), 0);
}

function isRelevantToEtf(title: string, profile: EtfNewsProfile): boolean {
  const normalized = title.replace(/【[^】]+】/g, '');
  if (profile.keywords.some((keyword) => normalized.includes(keyword))) return true;
  if (normalized.includes(profile.name.replace(/ETF$/i, ''))) return true;
  if (/ETF|板块|概念|行业/.test(normalized) && profile.keywords.some((k) => normalized.includes(k.slice(0, 2)))) {
    return true;
  }
  return false;
}

export function scoreNewsTitleForEtf(
  title: string,
  profile: EtfNewsProfile,
): { bullish: number; bearish: number; relevant: boolean } {
  if (!isRelevantToEtf(title, profile)) {
    return { bullish: 0, bearish: 0, relevant: false };
  }

  const bullish = countPatternHits(title, BULLISH_PATTERNS);
  const bearish =
    countPatternHits(title, BEARISH_PATTERNS) +
    countPatternHits(title, MACRO_BEARISH_PATTERNS) * 0.5;

  return {
    bullish,
    bearish: Math.round(bearish),
    relevant: true,
  };
}

export function evaluateEtfNewsSentiment(input: {
  profile: EtfNewsProfile;
  news: HotNewsItem[];
}): EtfNewsSentiment {
  let bullish = 0;
  let bearish = 0;
  let matchedCount = 0;
  const headlines: string[] = [];

  for (const item of input.news) {
    const scored = scoreNewsTitleForEtf(item.title, input.profile);
    if (!scored.relevant) continue;
    matchedCount += 1;
    bullish += scored.bullish;
    bearish += scored.bearish;
    if (headlines.length < 3) headlines.push(item.title.slice(0, 48));
  }

  const net = bullish - bearish;
  let label: EtfNewsSentiment['label'] = '无相关';
  if (bullish + bearish > 0) {
    if (net >= 2) label = '利好';
    else if (net <= -2) label = '利空';
    else if (net > 0) label = '利好';
    else if (net < 0) label = '利空';
    else label = '中性';
  }

  return {
    label,
    bullish,
    bearish,
    net,
    matchedCount,
    headlines,
  };
}

export function shouldBlockEtfEntryByNews(
  sentiment: EtfNewsSentiment,
  mode: EtfNewsFilterMode,
): { blocked: boolean; reason: string } {
  if (mode === 'off') return { blocked: false, reason: '新闻过滤关闭' };

  if (mode === 'avoid_bearish') {
    if (sentiment.label === '利空' || sentiment.net <= -2) {
      return {
        blocked: true,
        reason: `近端新闻偏空（净分 ${sentiment.net}）`,
      };
    }
    if (sentiment.bearish >= 2 && sentiment.net < 0) {
      return {
        blocked: true,
        reason: `命中 ${sentiment.bearish} 条利空关键词`,
      };
    }
    return { blocked: false, reason: '新闻未触发拦截' };
  }

  if (sentiment.matchedCount === 0) {
    return { blocked: true, reason: '未找到相关利好新闻' };
  }
  if (sentiment.net <= 0) {
    return {
      blocked: true,
      reason: `新闻净分 ${sentiment.net}，未达利好要求`,
    };
  }
  return { blocked: false, reason: '新闻偏利好' };
}

function newsDateKey(item: HotNewsItem): string | null {
  const ts = parseNewsTime(item.datetime);
  if (!ts) return null;
  return new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
}

export function filterNewsForTradeDate(input: {
  news: HotNewsItem[];
  tradeDate: string;
  lookbackDays: number;
}): HotNewsItem[] {
  const target = normalizeTradeDateKey(input.tradeDate);
  const start = normalizeTradeDateKey(
    addCalendarDays(target, -Math.max(0, input.lookbackDays)),
  );

  return input.news.filter((item) => {
    const day = newsDateKey(item);
    if (!day) return false;
    const key = normalizeTradeDateKey(day);
    return key >= start && key <= target;
  });
}

function listMonthAnchors(startDate: string, endDate: string): string[] {
  const anchors: string[] = [];
  let y = Number(startDate.slice(0, 4));
  let m = Number(startDate.slice(4, 6));
  const endY = Number(endDate.slice(0, 4));
  const endM = Number(endDate.slice(4, 6));

  while (y < endY || (y === endY && m <= endM)) {
    const lastDay = new Date(y, m, 0).getDate();
    const anchor = `${y}${String(m).padStart(2, '0')}${String(lastDay).padStart(2, '0')}`;
    if (anchor >= startDate && anchor <= endDate) {
      anchors.push(formatTradeDateKey(anchor));
    }
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }

  return anchors;
}

function parseNewsTimeoutMs(): number {
  const fromEnv = Number(process.env.BACKTEST_NEWS_TIMEOUT_MS ?? DEFAULT_NEWS_TIMEOUT_MS);
  if (Number.isFinite(fromEnv) && fromEnv >= 3_000 && fromEnv <= 60_000) {
    return fromEnv;
  }
  return DEFAULT_NEWS_TIMEOUT_MS;
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function loadLiveEtfNews(limit = 80): Promise<HotNewsItem[]> {
  return fetchFastLiveNews(limit);
}

async function fetchFastLiveNews(limit: number): Promise<HotNewsItem[]> {
  const results = await Promise.allSettled([
    fetchEastMoneyFastNews(limit),
    fetchEastMoneyColumnNews(limit),
    fetchSinaFinanceRollNews(limit),
  ]);
  const lists = results
    .filter((result): result is PromiseFulfilledResult<HotNewsItem[]> => {
      return result.status === 'fulfilled' && result.value.length > 0;
    })
    .map((result) => result.value);
  return mergeHotNewsSources(lists);
}

async function fetchHistoricalIwencaiNews(input: {
  startDate: string;
  endDate: string;
}): Promise<HotNewsItem[]> {
  if (process.env.BACKTEST_NEWS_HISTORICAL !== '1') return [];
  if (!isIwencaiMcpConfigured()) return [];

  const anchors = listMonthAnchors(input.startDate, input.endDate);
  if (anchors.length === 0) return [];

  const sampled =
    anchors.length <= MAX_HISTORICAL_IWENCAI_ANCHORS
      ? anchors
      : [
          anchors[0],
          anchors[Math.floor(anchors.length / 2)],
          anchors.at(-1) as string,
        ];

  const lists: HotNewsItem[][] = [];
  for (const asOfDate of sampled) {
    const chunk = await withTimeout(
      fetchIwencaiHotNews(30, { asOfDate, lookbackDays: 10 }).then(
        (result) => result.items,
      ),
      IWENCAI_CALL_TIMEOUT_MS,
      [],
    );
    if (chunk.length > 0) lists.push(chunk);
  }
  return mergeHotNewsSources(lists);
}

async function loadBacktestNewsTimelineInner(input: {
  startDate: string;
  endDate: string;
}): Promise<BacktestNewsLoadResult> {
  const sources: string[] = [];
  const lists: HotNewsItem[][] = [];

  const live = await fetchFastLiveNews(80);
  if (live.length > 0) {
    lists.push(live);
    sources.push('eastmoney', 'sina');
  }

  const historical = await fetchHistoricalIwencaiNews(input);
  if (historical.length > 0) {
    lists.push(historical);
    sources.push('iwencai-historical');
  }

  const news = mergeHotNewsSources(lists);
  if (news.length === 0) {
    return {
      news: [],
      sources,
      warning:
        '未拉到新闻数据，回测继续执行；「拦截明显利空」模式下不会因新闻拦截买入。',
    };
  }

  return { news, sources };
}

export async function loadBacktestNewsTimeline(input: {
  startDate: string;
  endDate: string;
}): Promise<BacktestNewsLoadResult> {
  const timeoutMs = parseNewsTimeoutMs();
  const fallback: BacktestNewsLoadResult = {
    news: [],
    sources: [],
    timedOut: true,
    warning: `新闻加载超过 ${Math.round(timeoutMs / 1000)} 秒已跳过，回测继续；远端新闻仅覆盖近端窗口。`,
  };

  return withTimeout(loadBacktestNewsTimelineInner(input), timeoutMs, fallback);
}

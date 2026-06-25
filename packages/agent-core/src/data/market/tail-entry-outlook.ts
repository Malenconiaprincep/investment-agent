import {
  formatTradeDate,
  getBeijingNow,
  getNextTradeDateLabel,
} from '../paper/trading-calendar.js';
import { getCached, setCached } from './cache.js';
import { freeFetchJson } from './free/http.js';
import { isIwencaiMcpConfigured } from '../../mastra/mcp/iwencai.js';
import {
  fetchIwencaiBoardLeaderStocks,
  fetchIwencaiBoardLeaderStocksSplit,
  fetchIwencaiConceptBoardRankings,
  fetchIwencaiTopInflowStocksSplit,
} from './iwencai-tail-entry.js';
import {
  enrichTailEntryStockPick,
  pickBuyableTailEntryStocks,
  splitTailEntryStocks,
} from './tail-entry-filter.js';
import { isRetailTradableStock } from './asset-type.js';

const TTL_MS = 5 * 60 * 1000;
const EM_UT = 'bd1d9ddb04089700cf9c0f827cacfc64';
const EM_LIST_BASE =
  'https://push2delay.eastmoney.com/api/qt/clist/get?np=1&fltt=2&invt=2&ut=' +
  EM_UT;

const AVOID_BOARD_PATTERN =
  /热股|题材股|昨日涨停|昨日打|含一字|昨日连板|昨日首板/i;

const THEME_KEYWORDS = [
  '磷化工',
  '氟化工',
  '钛白粉',
  '小金属',
  '铅锌',
  '券商',
  '证券',
  '保险',
  '半导体',
  '封装',
  '化工',
  '稀土',
  'AI',
  '人工智能',
  '机器人',
  '新能源',
  '油气',
  '钻石',
  '钨',
];

export type TailEntryPriority = 'high' | 'medium' | 'low' | 'avoid';

export type TailEntryStockPick = {
  symbol: string;
  name: string;
  pctChg: number;
  netInflowWan: number;
  tier: 'first' | 'second' | 'speculative';
  tierLabel: string;
  logic: string;
  riskNote?: string;
};

export type TomorrowSectorPick = {
  boardCode: string;
  name: string;
  pctChg: number;
  netInflowYi: number;
  priority: TailEntryPriority;
  priorityStars: number;
  logic: string;
  leaders: TailEntryStockPick[];
  /** 已涨停，仅供观察，不建议尾盘买入 */
  limitUpLeaders: TailEntryStockPick[];
};

export type TailEntryPlan = {
  id: 'conservative' | 'aggressive' | 'speculative';
  label: string;
  sectors: string[];
  symbols: string[];
  note: string;
};

export type TailEntryOutlook = {
  tradeDate: string;
  nextTradeDate: string;
  generatedAt: string;
  hotThemes: string[];
  sectorPicks: TomorrowSectorPick[];
  topInflowStocks: TailEntryStockPick[];
  /** 主力净流入前列但已涨停，仅供观察 */
  limitUpInflowStocks: TailEntryStockPick[];
  plans: TailEntryPlan[];
  watchSignals: string[];
  avoidSectors: Array<{ name: string; reason: string }>;
  dataSource: 'eastmoney' | 'iwencai';
};

export type TailEntryRunStatus = 'success' | 'failed' | 'skipped' | 'empty';

export type TailEntryRun = {
  status: TailEntryRunStatus;
  message: string;
  sectorCount: number;
  stockCount: number;
  nextTradeDate?: string;
  ranAt: string;
};

export function createTailEntryRun(input: {
  status: TailEntryRunStatus;
  message: string;
  outlook?: TailEntryOutlook | null;
  nextTradeDate?: string;
}): TailEntryRun {
  return {
    status: input.status,
    message: input.message,
    sectorCount: input.outlook?.sectorPicks.length ?? 0,
    stockCount: input.outlook?.topInflowStocks.length ?? 0,
    nextTradeDate:
      input.outlook?.nextTradeDate ?? input.nextTradeDate ?? getNextTradeDateLabel(),
    ranAt: new Date().toISOString(),
  };
}

/** 旧记录无 tailEntryRun 字段时，从 fetchErrors / 摘要 markdown 推断 */
export function inferTailEntryRun(
  fetchErrors: string[] | undefined,
  outlook?: TailEntryOutlook | null,
  rotationSummary?: string | null,
): TailEntryRun | null {
  const line = fetchErrors?.find((item) => item.startsWith('tail-entry:'));
  if (outlook) {
    const hasData =
      outlook.sectorPicks.length > 0 || outlook.topInflowStocks.length > 0;
    return createTailEntryRun({
      status: hasData ? 'success' : 'empty',
      message: hasData
        ? `已生成 ${outlook.sectorPicks.length} 个优先板块、${outlook.topInflowStocks.length} 只净流入龙头`
        : '明日预判已执行，但无符合条件的板块或标的',
      outlook,
    });
  }
  if (
    !line &&
    rotationSummary &&
    (rotationSummary.includes('## 明日板块预判') ||
      rotationSummary.includes('## 尾盘参考标的'))
  ) {
    return createTailEntryRun({
      status: 'success',
      message: '明日预判已生成，详见下方卡片或「市场解读」中的明日板块预判',
      outlook: null,
    });
  }

  if (!line) return null;

  const detail = line.replace(/^tail-entry:\s*/, '').trim();
  if (detail.includes('明日预判') && /\d+\s*个板块/.test(detail)) {
    return createTailEntryRun({
      status: 'success',
      message: detail,
      outlook: null,
      nextTradeDate: getNextTradeDateLabel(),
    });
  }

  return createTailEntryRun({
    status: 'failed',
    message: detail.startsWith('明日预判')
      ? detail
      : `明日预判已执行，但数据拉取失败：${detail}`,
    outlook: null,
  });
}

type EmListRow = {
  f12?: string;
  f14?: string;
  f2?: number;
  f3?: number;
  /** 东财无数据时可能为 "-" 字符串 */
  f62?: number | string;
};

function parseEmMoneyFlow(value: unknown, scale: 'yi' | 'wan'): number {
  if (value == null || value === '' || value === '-') return 0;
  const n =
    typeof value === 'number'
      ? value
      : Number(String(value).replace(/,/g, ''));
  if (!Number.isFinite(n)) return 0;
  return scale === 'yi' ? n / 1e8 : n / 1e4;
}

export function formatNetInflowYi(value: number | null | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (n >= 0) return `${n.toFixed(1)} 亿`;
  return `-${Math.abs(n).toFixed(1)} 亿`;
}

type EmListResponse = {
  data?: {
    diff?: EmListRow[] | Record<string, EmListRow>;
  };
};

type ConceptBoard = {
  boardCode: string;
  name: string;
  pctChg: number;
  netInflowYi: number;
};

type BuildTailEntryOutlookInput = {
  hotThemes?: string[];
  sectorNames?: string[];
  candidateSymbols?: string[];
};

function normalizeDiff(diff: EmListResponse['data']): EmListRow[] {
  const raw = diff?.diff;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return Object.values(raw);
}

function toConceptBoard(row: EmListRow): ConceptBoard | null {
  const boardCode = String(row.f12 ?? '').trim();
  const name = String(row.f14 ?? '').trim();
  if (!boardCode || !name) return null;
  return {
    boardCode,
    name,
    pctChg: Number(row.f3 ?? 0),
    netInflowYi: parseEmMoneyFlow(row.f62, 'yi'),
  };
}

function toStockPick(row: EmListRow): TailEntryStockPick | null {
  const symbol = String(row.f12 ?? '').trim();
  const name = String(row.f14 ?? '').trim();
  if (!/^\d{6}$/.test(symbol) || !name) return null;
  if (!isRetailTradableStock(symbol)) return null;

  const pctChg = Number(row.f3 ?? 0);
  const netInflowWan = parseEmMoneyFlow(row.f62, 'wan');

  return enrichTailEntryStockPick({
    symbol,
    name,
    pctChg,
    netInflowWan,
    tier: netInflowWan >= 30000 ? 'first' : 'second',
    tierLabel: netInflowWan >= 30000 ? '中军' : '弹性',
    logic: '待筛选',
  });
}

export function formatTradeDateLabel(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  if (!y || !m || !d) return isoDate;
  return `${Number(m)}月${Number(d)}日`;
}

function themeMatchesBoard(theme: string, boardName: string): boolean {
  const compactTheme = theme.replace(/[，,。！？\s]/g, '').slice(0, 16);
  const compactBoard = boardName.replace(/概念|板块|行业/g, '');
  if (compactBoard.includes(compactTheme.slice(0, 4))) return true;
  if (compactTheme.includes(compactBoard.slice(0, 4))) return true;

  for (const keyword of THEME_KEYWORDS) {
    if (compactTheme.includes(keyword) && compactBoard.includes(keyword)) {
      return true;
    }
  }
  return false;
}

function scoreBoard(
  board: ConceptBoard,
  hotThemes: string[],
  iwencaiSectors: string[],
): { score: number; logic: string; priority: TailEntryPriority; stars: number } {
  if (AVOID_BOARD_PATTERN.test(board.name)) {
    return {
      score: -100,
      logic: '题材跟风或资金净流出，延续性偏弱',
      priority: 'avoid',
      stars: 1,
    };
  }

  let score = 0;
  const reasons: string[] = [];

  score += Math.min(Math.max(board.pctChg, 0), 12) * 2;
  if (board.pctChg >= 5) reasons.push(`今日涨幅 ${board.pctChg.toFixed(2)}%`);

  if (board.netInflowYi >= 0) {
    score += Math.min(board.netInflowYi, 80) * 1.2;
    if (board.netInflowYi >= 5) {
      reasons.push(`主力净流入 ${board.netInflowYi.toFixed(1)} 亿`);
    }
  } else {
    score -= 25;
    reasons.push(`资金净流出 ${Math.abs(board.netInflowYi).toFixed(1)} 亿`);
  }

  const themeHit = hotThemes.some((theme) => themeMatchesBoard(theme, board.name));
  if (themeHit) {
    score += 18;
    reasons.push('与今日热点新闻主题契合');
  }

  const sectorHit = iwencaiSectors.some((sector) =>
    themeMatchesBoard(sector, board.name),
  );
  if (sectorHit) {
    score += 12;
    reasons.push('与问财主线板块一致');
  }

  let priority: TailEntryPriority = 'low';
  let stars = 2;
  if (score >= 55) {
    priority = 'high';
    stars = 5;
  } else if (score >= 38) {
    priority = 'medium';
    stars = 4;
  } else if (score >= 20) {
    priority = 'low';
    stars = 3;
  }

  if (board.netInflowYi < -3 && board.pctChg >= 5) {
    priority = 'avoid';
    stars = 1;
    reasons.push('量价背离，谨慎追高');
  }

  return {
    score,
    logic: reasons.join('；') || '板块强度一般',
    priority,
    stars,
  };
}

async function fetchEmList(url: string): Promise<EmListRow[]> {
  const json = await freeFetchJson<EmListResponse>(url, {
    headers: { Referer: 'https://quote.eastmoney.com/' },
  });
  return normalizeDiff(json.data);
}

export async function fetchConceptBoardRankings(limit = 20): Promise<ConceptBoard[]> {
  const cacheKey = `em:concept-boards:${limit}`;
  const cached = getCached<ConceptBoard[]>(cacheKey);
  if (cached) return cached;

  const rows = await fetchEmList(
    `${EM_LIST_BASE}&pn=1&pz=${limit}&po=1&fid=f3&fs=m:90+t:3&fields=f12,f14,f2,f3,f62`,
  );

  const boards = rows
    .map(toConceptBoard)
    .filter((item): item is ConceptBoard => item != null);

  setCached(cacheKey, boards, TTL_MS);
  return boards;
}

export async function fetchBoardLeaderStocks(
  boardCode: string,
  limit = 5,
): Promise<TailEntryStockPick[]> {
  const cacheKey = `em:board-leaders:${boardCode}:${limit}`;
  const cached = getCached<TailEntryStockPick[]>(cacheKey);
  if (cached) return cached;

  const fetchSize = Math.max(limit * 4, 16);
  const [rowsByInflow, rowsByPct] = await Promise.all([
    fetchEmList(
      `${EM_LIST_BASE}&pn=1&pz=${fetchSize}&po=1&fid=f62&fs=b:${boardCode}&fields=f12,f14,f3,f62`,
    ),
    fetchEmList(
      `${EM_LIST_BASE}&pn=1&pz=${fetchSize}&po=1&fid=f3&fs=b:${boardCode}&fields=f12,f14,f3,f62`,
    ),
  ]);

  const merged = [...rowsByInflow, ...rowsByPct]
    .map(toStockPick)
    .filter((item): item is TailEntryStockPick => item != null);

  const picks = pickBuyableTailEntryStocks(merged, limit);

  setCached(cacheKey, picks, TTL_MS);
  return picks;
}

export async function fetchBoardLeaderStocksWithLimitUp(
  boardCode: string,
  limit = 5,
): Promise<{ buyable: TailEntryStockPick[]; limitUp: TailEntryStockPick[] }> {
  const fetchSize = Math.max(limit * 4, 16);
  const [rowsByInflow, rowsByPct] = await Promise.all([
    fetchEmList(
      `${EM_LIST_BASE}&pn=1&pz=${fetchSize}&po=1&fid=f62&fs=b:${boardCode}&fields=f12,f14,f3,f62`,
    ),
    fetchEmList(
      `${EM_LIST_BASE}&pn=1&pz=${fetchSize}&po=1&fid=f3&fs=b:${boardCode}&fields=f12,f14,f3,f62`,
    ),
  ]);

  const merged = [...rowsByInflow, ...rowsByPct]
    .map(toStockPick)
    .filter((item): item is TailEntryStockPick => item != null);

  return splitTailEntryStocks(merged, limit);
}

export async function fetchTopMainInflowStocks(
  limit = 10,
): Promise<TailEntryStockPick[]> {
  const cacheKey = `em:top-inflow:${limit}`;
  const cached = getCached<TailEntryStockPick[]>(cacheKey);
  if (cached) return cached;

  const rows = await fetchEmList(
    `${EM_LIST_BASE}&pn=1&pz=${Math.max(limit * 3, 24)}&po=1&fid=f62&fs=m:1+t:2,m:0+t:6&fields=f12,f14,f3,f62`,
  );

  const picks = pickBuyableTailEntryStocks(
    rows
      .map(toStockPick)
      .filter((item): item is TailEntryStockPick => item != null),
    limit,
  );

  setCached(cacheKey, picks, TTL_MS);
  return picks;
}

async function fetchTopMainInflowStocksSplit(limit = 10) {
  const rows = await fetchEmList(
    `${EM_LIST_BASE}&pn=1&pz=${Math.max(limit * 3, 24)}&po=1&fid=f62&fs=m:1+t:2,m:0+t:6&fields=f12,f14,f3,f62`,
  );
  const merged = rows
    .map(toStockPick)
    .filter((item): item is TailEntryStockPick => item != null);
  return splitTailEntryStocks(merged, limit);
}

function buildPlans(
  sectorPicks: TomorrowSectorPick[],
  topInflowStocks: TailEntryStockPick[],
): TailEntryPlan[] {
  const highSectors = sectorPicks.filter((s) => s.priority === 'high');
  const mediumSectors = sectorPicks.filter((s) => s.priority !== 'avoid').slice(0, 3);
  const conservativeSymbols = highSectors
    .flatMap((s) => s.leaders.filter((l) => l.tier !== 'speculative').slice(0, 1))
    .slice(0, 3)
    .map((s) => s.symbol);
  const aggressiveSymbols = topInflowStocks
    .filter((s) => s.tier !== 'speculative')
    .slice(0, 2)
    .map((s) => s.symbol);
  const speculativeSymbols = sectorPicks
    .flatMap((s) => s.leaders.filter((l) => l.tier === 'speculative').slice(0, 1))
    .slice(0, 2)
    .map((s) => s.symbol);

  return [
    {
      id: 'conservative' as const,
      label: '稳健',
      sectors: highSectors.slice(0, 2).map((s) => s.name),
      symbols: conservativeSymbols,
      note: '主线清晰、资金确认的中军标的，适合博弈明日惯性延续',
    },
    {
      id: 'aggressive' as const,
      label: '激进',
      sectors: mediumSectors.slice(0, 2).map((s) => s.name),
      symbols: aggressiveSymbols,
      note: '跟随全市场主力净流入龙头，波动更大',
    },
    {
      id: 'speculative' as const,
      label: '短线博弈',
      sectors: sectorPicks
        .filter((s) => s.leaders.some((l) => l.tier === 'speculative'))
        .slice(0, 2)
        .map((s) => s.name),
      symbols: speculativeSymbols,
      note: '今日涨停或尾盘异动，仅适合小仓博弈，需严格止损',
    },
  ].filter((plan) => plan.sectors.length > 0 || plan.symbols.length > 0) satisfies TailEntryPlan[];
}

function buildWatchSignals(sectorPicks: TomorrowSectorPick[]): string[] {
  const leaders = sectorPicks
    .filter((s) => s.priority === 'high')
    .map((s) => s.name)
    .slice(0, 3);

  return [
    leaders.length > 0
      ? `竞价观察 ${leaders.join('、')} 是否集体高开 2% 以上，验证主线延续`
      : '竞价观察今日强势板块是否延续高开',
    '若沪深成交额仍维持高位，趋势行情可延续；明显缩量则警惕获利回吐',
    '尾盘介入为 T+1，明日若高开过多性价比下降，可考虑 10:00 前分歧回踩',
    '关注盘中是否有与今日热点相冲突的新政策或地缘消息',
  ];
}

export async function buildTailEntryOutlook(
  input: BuildTailEntryOutlookInput = {},
): Promise<TailEntryOutlook> {
  try {
    return await buildTailEntryOutlookFromEastmoney(input);
  } catch (eastmoneyError) {
    if (!isIwencaiMcpConfigured()) {
      throw eastmoneyError;
    }
    const detail =
      eastmoneyError instanceof Error
        ? eastmoneyError.message
        : String(eastmoneyError);
    console.warn(
      `[tail-entry] 东财接口失败（${detail}），改用问财 MCP`,
    );
    return buildTailEntryOutlookFromIwencai(input);
  }
}

async function assembleTailEntryOutlook(
  input: BuildTailEntryOutlookInput,
  boards: ConceptBoard[],
  fetchTopInflowSplit: (
    limit: number,
  ) => Promise<{ buyable: TailEntryStockPick[]; limitUp: TailEntryStockPick[] }>,
  fetchBoardLeadersSplit: (
    boardCode: string,
    limit: number,
  ) => Promise<{ buyable: TailEntryStockPick[]; limitUp: TailEntryStockPick[] }>,
  dataSource: 'eastmoney' | 'iwencai',
): Promise<TailEntryOutlook> {
  const hotThemes = input.hotThemes ?? [];
  const iwencaiSectors = input.sectorNames ?? [];
  const now = getBeijingNow();

  const scored = boards
    .map((board) => {
      const result = scoreBoard(board, hotThemes, iwencaiSectors);
      return { board, ...result };
    })
    .sort((a, b) => b.score - a.score);

  const avoidSectors = scored
    .filter((item) => item.priority === 'avoid')
    .slice(0, 4)
    .map((item) => ({
      name: item.board.name,
      reason: item.logic,
    }));

  const focusBoards = scored
    .filter((item) => item.priority !== 'avoid')
    .slice(0, 5);

  const sectorPicks: TomorrowSectorPick[] = [];
  for (const item of focusBoards) {
    const { buyable, limitUp } = await fetchBoardLeadersSplit(
      item.board.boardCode,
      4,
    );
    sectorPicks.push({
      boardCode: item.board.boardCode,
      name: item.board.name,
      pctChg: item.board.pctChg,
      netInflowYi: item.board.netInflowYi,
      priority: item.priority,
      priorityStars: item.stars,
      logic: item.logic,
      leaders: buyable,
      limitUpLeaders: limitUp.slice(0, 3),
    });
  }

  const { buyable: topBuyable, limitUp: topLimitUp } =
    await fetchTopInflowSplit(8);

  return {
    tradeDate: formatTradeDate(now),
    nextTradeDate: getNextTradeDateLabel(now),
    generatedAt: now.toISOString(),
    hotThemes,
    sectorPicks,
    topInflowStocks: topBuyable,
    limitUpInflowStocks: topLimitUp.slice(0, 6),
    plans: buildPlans(sectorPicks, topBuyable),
    watchSignals: buildWatchSignals(sectorPicks),
    avoidSectors,
    dataSource,
  };
}

async function buildTailEntryOutlookFromEastmoney(
  input: BuildTailEntryOutlookInput = {},
): Promise<TailEntryOutlook> {
  const boards = await fetchConceptBoardRankings(20);

  return assembleTailEntryOutlook(
    input,
    boards,
    fetchTopMainInflowStocksSplit,
    fetchBoardLeaderStocksWithLimitUp,
    'eastmoney',
  );
}

async function buildTailEntryOutlookFromIwencai(
  input: BuildTailEntryOutlookInput = {},
): Promise<TailEntryOutlook> {
  const boards = await fetchIwencaiConceptBoardRankings(20);

  if (boards.length === 0) {
    throw new Error('问财 MCP 未返回板块数据');
  }

  return assembleTailEntryOutlook(
    input,
    boards,
    fetchIwencaiTopInflowStocksSplit,
    fetchIwencaiBoardLeaderStocksSplit,
    'iwencai',
  );
}

function priorityLabel(priority: TailEntryPriority, stars: number): string {
  if (priority === 'avoid') return '回避';
  return '★'.repeat(stars) + '☆'.repeat(Math.max(0, 5 - stars));
}

function formatStockRow(stock: TailEntryStockPick): string {
  const inflow =
    stock.netInflowWan >= 10000
      ? `${(stock.netInflowWan / 10000).toFixed(1)} 亿`
      : `${Math.round(stock.netInflowWan)} 万`;
  const risk = stock.riskNote ? `（${stock.riskNote}）` : '';
  return `| ${stock.symbol} | ${stock.name} | ${stock.pctChg.toFixed(2)}% | ${inflow} | ${stock.tierLabel} | ${stock.logic}${risk} |`;
}

export function formatTailEntryOutlookMarkdown(outlook: TailEntryOutlook): string {
  const nextLabel = formatTradeDateLabel(outlook.nextTradeDate);
  const lines: string[] = [
    `## 明日板块预判（${nextLabel}）`,
    '',
    '> 基于今日东财概念板块涨跌幅与主力资金流向，推断**下一交易日**可能延续的主线，供尾盘研究参考，非买卖建议。',
    '',
  ];

  if (outlook.sectorPicks.length > 0) {
    lines.push('### 优先关注', '');
    lines.push('| 优先级 | 板块 | 今日涨幅 | 主力净流入 | 延续逻辑 |');
    lines.push('|--------|------|----------|------------|----------|');
    for (const sector of outlook.sectorPicks) {
      const inflow = formatNetInflowYi(sector.netInflowYi);
      lines.push(
        `| ${priorityLabel(sector.priority, sector.priorityStars)} | ${sector.name} | ${sector.pctChg.toFixed(2)}% | ${inflow} | ${sector.logic} |`,
      );
    }
    lines.push('');
  }

  if (outlook.avoidSectors.length > 0) {
    lines.push('### 谨慎或回避', '');
    for (const item of outlook.avoidSectors) {
      lines.push(`- **${item.name}**：${item.reason}`);
    }
    lines.push('');
  }

  lines.push('## 尾盘参考标的', '');
  lines.push(
    '> 优先列出**未涨停、尾盘仍可买入**的标的；已涨停个股单独放在下方「排板观察」，不建议作为默认介入参考。',
    '',
  );

  const grouped = outlook.sectorPicks.filter((s) => s.leaders.length > 0);
  for (const sector of grouped.slice(0, 4)) {
    lines.push(`### ${sector.name} · 可介入`, '');
    lines.push('| 代码 | 名称 | 涨幅 | 净流入 | 定位 | 逻辑 |');
    lines.push('|------|------|------|--------|------|------|');
    for (const stock of sector.leaders) {
      lines.push(formatStockRow(stock));
    }
    lines.push('');
  }

  if (outlook.topInflowStocks.length > 0) {
    lines.push('### 全市场主力净流入 · 可介入', '');
    lines.push('| 代码 | 名称 | 涨幅 | 净流入 | 定位 | 逻辑 |');
    lines.push('|------|------|------|--------|------|------|');
    for (const stock of outlook.topInflowStocks.slice(0, 6)) {
      lines.push(formatStockRow(stock));
    }
    lines.push('');
  }

  const limitUpFromSectors = outlook.sectorPicks.flatMap((s) => s.limitUpLeaders ?? []);
  const limitUpAll = [...limitUpFromSectors, ...(outlook.limitUpInflowStocks ?? [])];
  const limitUpSeen = new Set<string>();
  const limitUpUnique = limitUpAll.filter((stock) => {
    if (limitUpSeen.has(stock.symbol)) return false;
    limitUpSeen.add(stock.symbol);
    return true;
  });

  if (limitUpUnique.length > 0) {
    lines.push('### 已涨停 · 排板观察（不建议默认追高）', '');
    lines.push('| 代码 | 名称 | 涨幅 | 净流入 | 说明 |');
    lines.push('|------|------|------|--------|------|');
    for (const stock of limitUpUnique.slice(0, 8)) {
      const inflow =
        stock.netInflowWan >= 10000
          ? `${(stock.netInflowWan / 10000).toFixed(1)} 亿`
          : `${Math.round(stock.netInflowWan)} 万`;
      lines.push(
        `| ${stock.symbol} | ${stock.name} | ${stock.pctChg.toFixed(2)}% | ${inflow} | ${stock.logic} |`,
      );
    }
    lines.push('');
  }

  if (grouped.length === 0 && outlook.topInflowStocks.length === 0) {
    lines.push(
      '_今日强势板块内普遍已涨停或接近涨停，暂无合适的尾盘可介入标的；可关注明日竞价分歧后再决策。_',
      '',
    );
  }

  if (outlook.plans.length > 0) {
    lines.push('### 操作思路（研究用）', '');
    for (const plan of outlook.plans) {
      const sectorText = plan.sectors.join('、') || '—';
      const symbolText = plan.symbols.join('、') || '—';
      lines.push(
        `- **${plan.label}**：板块 ${sectorText}；参考标的 ${symbolText}。${plan.note}`,
      );
    }
    lines.push('');
  }

  lines.push('### 明日开盘观察', '');
  for (const signal of outlook.watchSignals) {
    lines.push(`1. ${signal}`);
  }
  lines.push('');
  lines.push(
    `数据来源：${outlook.dataSource === 'iwencai' ? '问财 MCP' : 'eastmoney'}（概念板块涨跌幅、主力资金流向）`,
  );

  return lines.join('\n');
}

export function mergeTailEntryOutlookIntoSummary(
  summary: string,
  outlook: TailEntryOutlook | null,
): string {
  if (!outlook) return summary;

  const stripped = summary
    .replace(/\n## 明日板块预判[\s\S]*?(?=\n## |\n免责声明|$)/g, '')
    .replace(/\n## 尾盘参考标的[\s\S]*?(?=\n## |\n免责声明|$)/g, '')
    .trim();

  const appendix = formatTailEntryOutlookMarkdown(outlook);
  const disclaimerMatch = stripped.match(/(\n免责声明[\s\S]*)$/);
  if (disclaimerMatch) {
    const body = stripped.slice(0, disclaimerMatch.index).trim();
    return `${body}\n\n${appendix}\n\n${disclaimerMatch[1].trim()}`;
  }

  return `${stripped}\n\n${appendix}\n\n免责声明：本内容不构成投资建议。`;
}

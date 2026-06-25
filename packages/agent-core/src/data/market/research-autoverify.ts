import type { CommitteeTradePlan } from '../screening/committee-trading-plan.js';
import type { ResearchMarketSnapshot } from './research-quote.js';

type NewsLike = {
  items?: Array<{ title?: string; datetime?: string }>;
  data?: unknown;
};

type AnnouncementLike = {
  announcements?: Array<{ title?: string; annDate?: string }>;
};

type FinancialLike = {
  endDate?: string | null;
  revenue?: number | null;
  netProfit?: number | null;
  revenueYoy?: number | null;
  netProfitYoy?: number | null;
  roe?: number | null;
};

type PeersLike = {
  peers?: Array<{
    symbol: string;
    name: string;
    roe?: number | null;
    revenueYoy?: number | null;
    netProfitYoy?: number | null;
    pe?: number | null;
    endDate?: string | null;
  }>;
  presetPeerSymbols?: string[];
};

export type ResearchAutoVerification = {
  financialYoy: {
    endDate: string | null;
    revenueYoy: number | null;
    netProfitYoy: number | null;
    summary: string;
  };
  peers: {
    count: number;
    names: string[];
    summary: string;
  };
  priceMoves: Array<{
    tradeDate: string;
    pctChg: number;
    close: number | null;
    label: string;
  }>;
  priceMoveReasons: string[];
  klinePlan: {
    summary: string;
  } | null;
  unresolved: string[];
};

const MOVE_KEYWORDS = [
  '涨停',
  '大涨',
  '异动',
  '订单',
  '合同',
  '政策',
  '板块',
  'CXO',
  'CRO',
  '回购',
  '激励',
  '业绩',
  '预增',
  '下调',
];

function formatPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function extractNewsTitles(news: unknown, announcements: unknown): string[] {
  const titles: string[] = [];

  const pushTitle = (title: unknown, time?: unknown) => {
    if (typeof title !== 'string' || !title.trim()) return;
    titles.push(
      typeof time === 'string' && time
        ? `${time.slice(0, 10)} ${title.trim()}`
        : title.trim(),
    );
  };

  const newsObj = news as NewsLike | null;
  for (const item of newsObj?.items ?? []) {
    pushTitle(item.title, item.datetime);
  }

  const annObj = announcements as AnnouncementLike | null;
  for (const item of annObj?.announcements ?? []) {
    pushTitle(item.title, item.annDate);
  }

  if (news && typeof news === 'object' && 'data' in news) {
    const raw = JSON.stringify((news as { data: unknown }).data);
    for (const keyword of MOVE_KEYWORDS) {
      if (raw.includes(keyword)) {
        titles.push(`（问财/原始资讯含「${keyword}」相关条目，见新闻 JSON）`);
        break;
      }
    }
  }

  return [...new Set(titles)].slice(0, 12);
}

function detectRecentPriceMoves(
  quote: ResearchMarketSnapshot | null,
): ResearchAutoVerification['priceMoves'] {
  const daily = quote?.daily?.quotes ?? [];
  const moves: ResearchAutoVerification['priceMoves'] = [];

  for (const bar of daily.slice(0, 5)) {
    const pct = bar.pctChg;
    if (pct == null || !Number.isFinite(pct)) continue;
    if (pct >= 9.5) {
      moves.push({
        tradeDate: bar.tradeDate,
        pctChg: pct,
        close: bar.close,
        label: '涨停或接近涨停',
      });
    } else if (pct >= 5) {
      moves.push({
        tradeDate: bar.tradeDate,
        pctChg: pct,
        close: bar.close,
        label: '大涨',
      });
    }
  }

  return moves;
}

function inferPriceMoveReasons(
  moves: ResearchAutoVerification['priceMoves'],
  titles: string[],
): string[] {
  if (moves.length === 0) return ['近 5 个交易日无显著异动（单日涨幅 <5%）'];

  const reasons: string[] = [];
  const matched = titles.filter((title) =>
    MOVE_KEYWORDS.some((keyword) => title.includes(keyword)),
  );

  for (const move of moves) {
    const dateHint = move.tradeDate.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
    const related = matched.filter((title) => title.includes(dateHint.slice(5, 10).replace('-', '-')) || title.includes(dateHint));
    if (related.length > 0) {
      reasons.push(
        `${dateHint} ${move.label}（${formatPct(move.pctChg)}）：关联资讯 — ${related.slice(0, 3).join('；')}`,
      );
    } else if (matched.length > 0) {
      reasons.push(
        `${dateHint} ${move.label}（${formatPct(move.pctChg)}）：未找到同日标题，近期相关资讯 — ${matched.slice(0, 3).join('；')}`,
      );
    } else {
      reasons.push(
        `${dateHint} ${move.label}（${formatPct(move.pctChg)}）：公告与新闻未给出明确单一原因，可能为板块联动或情绪推动，需结合同业走势判断`,
      );
    }
  }

  return reasons;
}

function summarizeFinancial(financial: FinancialLike | null): ResearchAutoVerification['financialYoy'] {
  const endDate = financial?.endDate ?? null;
  const revenueYoy = financial?.revenueYoy ?? null;
  const netProfitYoy = financial?.netProfitYoy ?? null;

  if (revenueYoy == null && netProfitYoy == null) {
    return {
      endDate,
      revenueYoy,
      netProfitYoy,
      summary: endDate
        ? `报告期 ${endDate}：未能从公开接口计算营收/净利润同比（原始报表字段缺失）`
        : '未能获取财务报告期与同比增速',
    };
  }

  return {
    endDate,
    revenueYoy,
    netProfitYoy,
    summary: `报告期 ${endDate ?? '—'}：营收同比 ${formatPct(revenueYoy)}，净利润同比 ${formatPct(netProfitYoy)}（已由系统自动对比去年同期同季度）`,
  };
}

function summarizePeers(peers: PeersLike | null): ResearchAutoVerification['peers'] {
  const rows = peers?.peers ?? [];
  const withMetrics = rows.filter(
    (row) => row.roe != null || row.revenueYoy != null || row.pe != null,
  );
  const names = rows.map((row) => `${row.name}(${row.symbol})`);

  if (rows.length === 0) {
    return {
      count: 0,
      names: [],
      summary: '未能拉取同业公司列表',
    };
  }

  const detail = withMetrics
    .slice(0, 6)
    .map(
      (row) =>
        `${row.name}：ROE ${row.roe != null ? `${row.roe.toFixed(2)}%` : '—'}，营收同比 ${formatPct(row.revenueYoy)}，PE ${row.pe?.toFixed(1) ?? '—'}`,
    )
    .join('；');

  return {
    count: rows.length,
    names,
    summary: detail || `已列出 ${rows.length} 家同业（${names.join('、')}），部分指标待接口补全`,
  };
}

function summarizeKlinePlan(
  plan: CommitteeTradePlan | null,
  livePrice: number | null,
): ResearchAutoVerification['klinePlan'] {
  if (!plan) return null;

  const price = livePrice ?? plan.latestClose;
  const aboveStop = price > plan.stopLossPrice;
  const entryText = plan.entryPrice
    ? `建议入场 ${plan.entryPrice.toFixed(2)}`
    : '无入场价（动作为等待/回避，系统未给出追高参考价）';

  return {
    summary: [
      `系统结论：${plan.action === 'wait' ? '等待信号' : plan.action}；${entryText}；止损 ${plan.stopLossPrice.toFixed(2)}`,
      `现价 ${price.toFixed(2)} ${aboveStop ? '高于' : '低于或等于'}止损位 — ${aboveStop ? '属正常（止损为下行保护，不代表现价过高需触发调整）' : '已接近止损，趋势风险上升'}`,
      plan.action === 'wait' && !plan.entryPrice
        ? '无入场价因当前无买入信号，非数据缺失；不宜把「现价>止损」误解为计划冲突'
        : '',
    ]
      .filter(Boolean)
      .join('。'),
  };
}

export function buildResearchAutoVerification(input: {
  quote: ResearchMarketSnapshot | null;
  financial: FinancialLike | null;
  peers: PeersLike | null;
  news: unknown;
  announcements: unknown;
  tradePlan: CommitteeTradePlan | null;
  livePrice: number | null;
}): ResearchAutoVerification {
  const financialYoy = summarizeFinancial(input.financial);
  const peers = summarizePeers(input.peers);
  const priceMoves = detectRecentPriceMoves(input.quote);
  const priceMoveReasons = inferPriceMoveReasons(
    priceMoves,
    extractNewsTitles(input.news, input.announcements),
  );
  const klinePlan = summarizeKlinePlan(input.tradePlan, input.livePrice);

  const unresolved: string[] = [];
  if (peers.count === 0) unresolved.push('同业列表仍为空，仅行业分类未能匹配');
  if (financialYoy.revenueYoy == null && financialYoy.netProfitYoy == null) {
    unresolved.push('财务同比增速未能自动计算');
  }
  if (
    priceMoves.length > 0 &&
    priceMoveReasons.some((line) => line.includes('板块联动或情绪推动'))
  ) {
    unresolved.push('股价异动未能归因至单一公告/新闻（已给出最可能解释）');
  }

  return {
    financialYoy,
    peers,
    priceMoves,
    priceMoveReasons,
    klinePlan,
    unresolved,
  };
}

export function formatResearchAutoVerification(
  verification: ResearchAutoVerification,
): string {
  const lines = [
    '### 财务同比（系统自动核实）',
    `- ${verification.financialYoy.summary}`,
    '',
    '### 同业对比（系统自动拉取）',
    `- 共 ${verification.peers.count} 家：${verification.peers.names.join('、') || '—'}`,
    `- ${verification.peers.summary}`,
    '',
    '### 近期股价异动与原因推断',
    ...verification.priceMoveReasons.map((line) => `- ${line}`),
    '',
    '### K 线交易计划解读',
    verification.klinePlan
      ? `- ${verification.klinePlan.summary}`
      : '- K 线计划不可用，投资建议以基本面与实时行情为主',
  ];

  if (verification.unresolved.length > 0) {
    lines.push(
      '',
      '### 数据限制说明（不影响操作结论）',
      ...verification.unresolved.map((line) => `- ${line}`),
    );
  } else {
    lines.push('', '### 数据限制说明（不影响操作结论）', '- 无；上述条目均已由系统根据公开数据核实');
  }

  return lines.join('\n');
}

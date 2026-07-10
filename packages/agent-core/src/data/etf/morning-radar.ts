import { fetchIntradayQuotes } from '../market/free/intraday-quote.js';
import { getDailyQuote } from '../market/services.js';
import { formatTradeDate, getBeijingNow } from '../paper/trading-calendar.js';
import { ETF_POOL_19 } from './pool.js';
import {
  buildEtfTailPickCandidate,
  type EtfTailPickCandidate,
} from './rules.js';

export type EtfMorningRadarStage = 'open' | 'confirm';

export type EtfMorningRadarCandidate = {
  symbol: string;
  exchangeCode: string;
  name: string;
  price: number;
  changePct: number;
  volumeRatio: number;
  dailyTurnover: number;
  ma5: number;
  ma20: number;
  ma30: number;
  failCount: number;
  status: 'surge_watch' | 'follow_through' | 'pullback_wait';
  actionLabel: string;
  reasons: string[];
  note: string;
};

export type EtfMorningRadarResult = {
  tradeDate: string;
  stage: EtfMorningRadarStage;
  stageLabel: string;
  summary: string;
  candidates: EtfMorningRadarCandidate[];
  errors: string[];
  poolSize: number;
  generatedAt: string;
  elapsedMs: number;
};

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function formatMoney(value: number): string {
  if (value >= 1e8) return `${round(value / 1e8)} 亿`;
  if (value >= 1e4) return `${round(value / 1e4)} 万`;
  return `${Math.round(value)}`;
}

function stageLabel(stage: EtfMorningRadarStage): string {
  return stage === 'open' ? '早盘异动观察' : '10点承接确认';
}

function minTurnover(stage: EtfMorningRadarStage): number {
  return stage === 'open' ? 80_000_000 : 150_000_000;
}

function toRadarCandidate(
  item: EtfTailPickCandidate,
  stage: EtfMorningRadarStage,
): EtfMorningRadarCandidate | null {
  const turnoverOk = item.dailyTurnover >= minTurnover(stage);
  const surge =
    item.changePct >= 2.2 &&
    item.volumeRatio >= 1 &&
    (turnoverOk || item.changePct >= 4);
  if (!surge) return null;

  const trendConfirmed = item.price > item.ma30;
  const shortTrendReady = item.ma5 > item.ma20;
  const tooHot = item.changePct >= 5 || item.rsi >= 72;
  const followThrough =
    stage === 'confirm' &&
    trendConfirmed &&
    item.volumeRatio >= 1.2 &&
    item.dailyTurnover >= minTurnover(stage);

  const reasons = [
    `涨幅 ${item.changePct >= 0 ? '+' : ''}${item.changePct.toFixed(2)}%`,
    `量比 ${item.volumeRatio.toFixed(2)}`,
    `成交额 ${formatMoney(item.dailyTurnover)}`,
  ];
  if (trendConfirmed) reasons.push('站上 MA30');
  else reasons.push('仍在 MA30 下方');
  if (shortTrendReady) reasons.push('MA5 > MA20');
  else reasons.push('MA5 尚未上穿 MA20');
  if (tooHot) reasons.push('涨幅偏热，不追高');

  const status = followThrough
    ? 'follow_through'
    : tooHot
      ? 'pullback_wait'
      : 'surge_watch';

  return {
    symbol: item.symbol,
    exchangeCode: item.exchangeCode,
    name: item.name,
    price: item.price,
    changePct: item.changePct,
    volumeRatio: item.volumeRatio,
    dailyTurnover: item.dailyTurnover,
    ma5: item.ma5,
    ma20: item.ma20,
    ma30: item.ma30,
    failCount: item.failCount,
    status,
    actionLabel:
      status === 'follow_through'
        ? '承接确认，等尾盘'
        : status === 'pullback_wait'
          ? '强异动，等回踩'
          : '异动观察',
    reasons,
    note:
      '早盘雷达只负责发现机会，不作为买入推荐；是否买入等待 14:45 尾盘确认。',
  };
}

async function buildCandidate(
  poolItem: (typeof ETF_POOL_19)[number],
  quotes: Awaited<ReturnType<typeof fetchIntradayQuotes>>,
): Promise<EtfTailPickCandidate> {
  const quote = quotes.get(poolItem.symbol);
  if (!quote) throw new Error('缺少实时行情');
  const daily = await getDailyQuote(poolItem.symbol, 90);

  return buildEtfTailPickCandidate({
    symbol: poolItem.symbol,
    exchangeCode: poolItem.exchangeCode,
    name: quote.name || poolItem.name,
    price: quote.price,
    changePct: quote.pctChg,
    dailyTurnover: quote.amount,
    intradayVolume: quote.volume,
    bars: daily.quotes,
  });
}

function formatErrorWithCause(error: unknown): string {
  const messages: string[] = [];
  let current: unknown = error;

  for (let depth = 0; depth < 3 && current; depth += 1) {
    if (current instanceof Error && current.message) messages.push(current.message);
    if (typeof current !== 'object') break;
    const value = current as { cause?: unknown; code?: unknown };
    if (value.code != null) messages.push(String(value.code));
    current = value.cause;
  }

  return [...new Set(messages)].join(' / ') || String(error);
}

export async function runEtfMorningRadar(options: {
  stage?: EtfMorningRadarStage;
} = {}): Promise<EtfMorningRadarResult> {
  const started = Date.now();
  const stage = options.stage ?? 'open';
  const generatedAt = new Date().toISOString();
  const tradeDate = formatTradeDate(getBeijingNow());
  const errors: string[] = [];
  const candidates: EtfMorningRadarCandidate[] = [];
  let quotes: Awaited<ReturnType<typeof fetchIntradayQuotes>>;

  try {
    quotes = await fetchIntradayQuotes(ETF_POOL_19.map((item) => item.symbol));
  } catch (error) {
    errors.push(`实时行情：${formatErrorWithCause(error)}`);
    return {
      tradeDate,
      stage,
      stageLabel: stageLabel(stage),
      summary: `${stageLabel(stage)}：实时行情暂不可用，本次未作承接判断`,
      candidates,
      errors,
      poolSize: ETF_POOL_19.length,
      generatedAt,
      elapsedMs: Date.now() - started,
    };
  }

  if (quotes.size === 0) {
    errors.push('实时行情：上游接口未返回任何有效报价');
    return {
      tradeDate,
      stage,
      stageLabel: stageLabel(stage),
      summary: `${stageLabel(stage)}：实时行情暂不可用，本次未作承接判断`,
      candidates,
      errors,
      poolSize: ETF_POOL_19.length,
      generatedAt,
      elapsedMs: Date.now() - started,
    };
  }

  for (const item of ETF_POOL_19) {
    try {
      const base = await buildCandidate(item, quotes);
      const radar = toRadarCandidate(base, stage);
      if (radar) candidates.push(radar);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${item.exchangeCode} ${item.name}: ${message}`);
    }
  }

  const sorted = candidates
    .sort((a, b) => {
      const statusRank = (status: EtfMorningRadarCandidate['status']) =>
        status === 'follow_through' ? 0 : status === 'pullback_wait' ? 1 : 2;
      const rankDiff = statusRank(a.status) - statusRank(b.status);
      if (rankDiff !== 0) return rankDiff;
      if (a.changePct !== b.changePct) return b.changePct - a.changePct;
      return b.dailyTurnover - a.dailyTurnover;
    })
    .slice(0, 8);

  return {
    tradeDate,
    stage,
    stageLabel: stageLabel(stage),
    summary:
      sorted.length > 0
        ? `${stageLabel(stage)}：发现 ${sorted.length} 只 ETF 异动，均等待尾盘确认`
        : `${stageLabel(stage)}：暂无 ETF 异动`,
    candidates: sorted,
    errors,
    poolSize: ETF_POOL_19.length,
    generatedAt,
    elapsedMs: Date.now() - started,
  };
}

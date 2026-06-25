import {
  formatTradeDate,
  getBeijingNow,
} from '../paper/trading-calendar.js';
import {
  fetchIntradayQuote,
  type IntradayQuote,
} from './free/intraday-quote.js';
import { buildMeta } from './meta.js';
import { getDailyQuote } from './services.js';
import { toSymbol, toTsCode } from './symbols.js';

export type ResearchMarketSnapshot = {
  tsCode: string;
  symbol: string;
  asOf: string;
  tradeDate: string;
  currentPrice: number | null;
  currentPctChg: number | null;
  priceSource: 'intraday' | 'daily-close' | null;
  live: IntradayQuote | null;
  daily: Awaited<ReturnType<typeof getDailyQuote>>;
  dataSource: string;
  cached: boolean;
};

/** 研报采数：并行拉实时价 + 日 K，优先用查询时刻东财现价 */
export async function getResearchMarketSnapshot(
  symbol: string,
  days = 5,
): Promise<ResearchMarketSnapshot> {
  const tsCode = toTsCode(symbol);
  const code = toSymbol(tsCode);
  const now = getBeijingNow();

  const [liveResult, dailyResult] = await Promise.allSettled([
    fetchIntradayQuote(code),
    getDailyQuote(code, days),
  ]);

  const live = liveResult.status === 'fulfilled' ? liveResult.value : null;
  const daily =
    dailyResult.status === 'fulfilled'
      ? dailyResult.value
      : {
          tsCode,
          quotes: [],
          latestClose: null,
          latestPctChg: null,
          ...buildMeta('tencent', false),
        };

  const currentPrice = live?.price ?? daily.latestClose ?? null;
  const currentPctChg = live?.pctChg ?? daily.latestPctChg ?? null;
  const priceSource = live
    ? ('intraday' as const)
    : currentPrice != null
      ? ('daily-close' as const)
      : null;

  return {
    tsCode,
    symbol: code,
    asOf: now.toISOString(),
    tradeDate: formatTradeDate(now),
    currentPrice,
    currentPctChg,
    priceSource,
    live,
    daily,
    dataSource: live ? 'eastmoney-intraday' : daily.dataSource,
    cached: live ? false : daily.cached,
  };
}

export function formatResearchQuoteBlock(snapshot: ResearchMarketSnapshot): string {
  const beijingTime = new Date(snapshot.asOf).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });

  const lines = [
    `- 查询时刻（北京时间）：${beijingTime}`,
    `- 交易日：${snapshot.tradeDate}`,
  ];

  if (snapshot.live) {
    const pct =
      snapshot.live.pctChg >= 0
        ? `+${snapshot.live.pctChg.toFixed(2)}`
        : snapshot.live.pctChg.toFixed(2);
    lines.push(
      `- **此刻现价**：${snapshot.live.price.toFixed(2)} 元（${pct}%）`,
      `- 今开：${snapshot.live.open.toFixed(2)}  最高：${snapshot.live.high.toFixed(2)}  最低：${snapshot.live.low.toFixed(2)}  昨收：${snapshot.live.prevClose.toFixed(2)}`,
      `- 数据来源：东方财富实时行情（查询时刻快照）`,
    );
  } else if (snapshot.currentPrice != null) {
    const pct =
      snapshot.currentPctChg != null
        ? snapshot.currentPctChg >= 0
          ? `+${snapshot.currentPctChg.toFixed(2)}`
          : snapshot.currentPctChg.toFixed(2)
        : '—';
    lines.push(
      `- **此刻现价**：${snapshot.currentPrice.toFixed(2)} 元（${pct}%）`,
      `- 数据来源：日 K 最新收盘（实时接口暂不可用，非盘中快照）`,
    );
  } else {
    lines.push('- 实时与日 K 行情均不可用');
  }

  return lines.join('\n');
}

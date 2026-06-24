import { ETF_POOL_19 } from '../etf/pool.js';
import {
  buildEtfTailPickCandidate,
  type EtfTailPickCandidate,
} from '../etf/rules.js';
import type { OhlcvBar } from '../market/indicators.js';
import { fetchIntradayQuotes } from '../market/free/intraday-quote.js';
import { fetchDailyKlinesByTencentCode } from '../market/free/tencent.js';
import { getDailyQuote } from '../market/services.js';
import {
  hasLocalEtfDailyCsv,
  LOCAL_ETF_LOAD_ALL_DAYS,
} from '../market/local-csv/etf-daily.js';
import {
  barsWithClose,
  buildTradeGroups,
  calcReturnPct,
  findBarIndex,
  summarizeTrades,
} from './engine.js';
import {
  computeKlineDaysForRange,
  formatTradeDateKey,
  isTradeDateInRange,
  resolveBacktestDateRange,
} from './date-range.js';
import type {
  BacktestCurrentDecision,
  BacktestEquityPoint,
  BacktestExitReason,
  BacktestRunResult,
  BacktestSignal,
  BacktestSymbolSummary,
  BacktestTrade,
} from './types.js';

export type RunEtfBacktestInput = {
  days?: number;
  startDate?: string;
  endDate?: string;
  /** @deprecated 仅作 maxHoldDays 兼容入口，ETF 回测按策略止盈止损出场 */
  holdDays?: number[];
  maxHoldDays?: number;
  minSettlementDays?: number;
  maxFailCount?: number;
  includeWaitPullback?: boolean;
};

const DEFAULT_DAYS = 250;
const DEFAULT_MAX_HOLD_DAYS = 20;
const DEFAULT_MIN_SETTLEMENT_DAYS = 1;

type BenchmarkCandidate = {
  symbol: string;
  name: string;
  loadQuotes: (
    quoteDays: number,
  ) => Promise<Array<{ tradeDate: string; close: number | null }>>;
};

const BENCHMARK_CANDIDATES: BenchmarkCandidate[] = [
  {
    symbol: '000001.SH',
    name: '上证指数',
    loadQuotes: async (quoteDays) => {
      const data = await fetchDailyKlinesByTencentCode(
        'sh000001',
        quoteDays,
        '上证指数',
      );
      return data.quotes;
    },
  },
  {
    symbol: '510300',
    name: '沪深300ETF',
    loadQuotes: async (quoteDays) => {
      const days = hasLocalEtfDailyCsv('510300')
        ? LOCAL_ETF_LOAD_ALL_DAYS
        : quoteDays;
      const data = await getDailyQuote('510300', days);
      return data.quotes;
    },
  },
  {
    symbol: '510050',
    name: '上证50ETF',
    loadQuotes: async (quoteDays) => {
      const days = hasLocalEtfDailyCsv('510050')
        ? LOCAL_ETF_LOAD_ALL_DAYS
        : quoteDays;
      const data = await getDailyQuote('510050', days);
      return data.quotes;
    },
  },
];

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function resolveMaxHoldDays(input: RunEtfBacktestInput): number {
  if (input.maxHoldDays != null && Number.isFinite(input.maxHoldDays)) {
    return Math.max(1, Math.floor(input.maxHoldDays));
  }
  const legacy = input.holdDays
    ?.map((value) => Math.floor(value))
    .filter((value) => Number.isFinite(value) && value >= 1);
  if (legacy?.length) return Math.max(...legacy);
  return DEFAULT_MAX_HOLD_DAYS;
}

function resolveMinSettlementDays(input: RunEtfBacktestInput): number {
  if (input.minSettlementDays != null && Number.isFinite(input.minSettlementDays)) {
    return Math.max(0, Math.floor(input.minSettlementDays));
  }
  return DEFAULT_MIN_SETTLEMENT_DAYS;
}

type EtfStrategyExitOptions = {
  minSettlementDays: number;
  maxHoldDays: number;
  maxFailCount: number;
  symbol: string;
  exchangeCode: string;
  name: string;
  dailyTurnover: (bar: OhlcvBar) => number;
};

function createEtfStrategyTrade(
  signal: BacktestSignal,
  bars: OhlcvBar[],
  entryCandidate: EtfTailPickCandidate,
  options: EtfStrategyExitOptions,
): BacktestTrade | null {
  const filtered = barsWithClose(bars);
  const entryIndex = findBarIndex(filtered, signal.tradeDate);
  if (entryIndex < 0) return null;

  const entryTakeProfit = entryCandidate.operationPlan.takeProfitPrice;
  const minSettlement = Math.max(0, Math.floor(options.minSettlementDays));
  const maxHold = Math.max(1, Math.floor(options.maxHoldDays));

  const makeTrade = (
    exitIndex: number,
    exitPrice: number,
    exitReason: BacktestExitReason,
    exitMemo?: string,
  ): BacktestTrade => ({
    symbol: signal.symbol,
    name: signal.name,
    assetType: signal.assetType,
    strategy: signal.strategy,
    entryDate: signal.tradeDate,
    entryPrice: signal.entryPrice,
    exitDate: filtered[exitIndex].tradeDate,
    exitPrice,
    holdDays: entryIndex - exitIndex,
    returnPct: calcReturnPct(signal.entryPrice, exitPrice),
    exitReason,
    signal: exitMemo
      ? {
          ...signal,
          metadata: {
            ...signal.metadata,
            exitMemo,
          },
        }
      : signal,
  });

  for (let index = entryIndex - minSettlement; index >= 0; index -= 1) {
    const bar = filtered[index];
    const prev = filtered[index + 1];
    if (!bar?.close || !prev?.close) continue;

    const holdDays = entryIndex - index;
    const changePct = round(((bar.close - prev.close) / prev.close) * 100);
    const currentCandidate = buildEtfTailPickCandidate({
      symbol: options.symbol,
      exchangeCode: options.exchangeCode,
      name: options.name,
      price: bar.close,
      changePct,
      dailyTurnover: options.dailyTurnover(bar),
      intradayVolume: bar.vol ?? null,
      bars: filtered.slice(index),
    });
    const stopPrice = currentCandidate.stopPrice;

    if (stopPrice > 0 && bar.low != null && bar.low <= stopPrice) {
      return makeTrade(index, stopPrice, 'stop_loss', `技术止损 ${stopPrice}`);
    }

    if (entryTakeProfit > 0 && bar.high != null && bar.high >= entryTakeProfit) {
      return makeTrade(
        index,
        entryTakeProfit,
        'take_profit',
        `止盈 ${entryTakeProfit}`,
      );
    }

    if (
      currentCandidate.failCount > options.maxFailCount ||
      currentCandidate.operationPlan.action === 'avoid'
    ) {
      return makeTrade(
        index,
        bar.close,
        'signal_lost',
        `规则失效 failCount=${currentCandidate.failCount}`,
      );
    }

    if (holdDays >= maxHold) {
      return makeTrade(
        index,
        bar.close,
        'max_hold',
        `达到最大持有 ${maxHold} 个交易日`,
      );
    }
  }

  const latest = filtered[0];
  if (!latest?.close || entryIndex < minSettlement) return null;

  return {
    symbol: signal.symbol,
    name: signal.name,
    assetType: signal.assetType,
    strategy: signal.strategy,
    entryDate: signal.tradeDate,
    entryPrice: signal.entryPrice,
    exitDate: latest.tradeDate,
    exitPrice: latest.close,
    holdDays: entryIndex,
    returnPct: null,
    exitReason: 'end_of_data',
    signal,
  };
}

function estimateTurnover(close: number, volume: number | null): number {
  if (!volume || volume <= 0) return 0;
  return Math.round(close * volume * 100);
}

function dailyTurnover(
  bar: { close: number | null; vol: number | null; amount?: number | null },
): number {
  if (bar.amount != null && bar.amount > 0) return Math.round(bar.amount);
  if (bar.close == null) return 0;
  return estimateTurnover(bar.close, bar.vol);
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildEquityCurve(trades: BacktestTrade[]): BacktestEquityPoint[] {
  const byExitDate = new Map<string, BacktestTrade[]>();
  for (const trade of trades) {
    if (!trade.exitDate || trade.returnPct == null) continue;
    const items = byExitDate.get(trade.exitDate) ?? [];
    items.push(trade);
    byExitDate.set(trade.exitDate, items);
  }

  let equity = 100;
  return [...byExitDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tradeDate, closedTrades]) => {
      const avgReturn = avg(
        closedTrades
          .map((trade) => trade.returnPct)
          .filter((value): value is number => value != null),
      ) ?? 0;
      equity *= 1 + avgReturn / 100;
      return {
        tradeDate,
        equity: round(equity, 4),
        returnPct: round(equity - 100),
        closedTrades: closedTrades.length,
      };
    });
}

function buildBenchmarkCurve(
  bars: Array<{ tradeDate: string; close: number | null }>,
  dateRange: { startDate: string; endDate: string },
): BacktestEquityPoint[] {
  const inRange = bars
    .filter(
      (bar): bar is { tradeDate: string; close: number } =>
        bar.close != null && isTradeDateInRange(bar.tradeDate, dateRange),
    )
    .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  const startClose = inRange[0]?.close;
  if (!startClose || startClose <= 0) return [];

  return inRange.map((bar) => {
    const returnPct = round(((bar.close - startClose) / startClose) * 100);
    return {
      tradeDate: bar.tradeDate,
      equity: round(100 + returnPct, 4),
      returnPct,
      closedTrades: 0,
    };
  });
}

async function buildBenchmark(
  dateRange: { startDate: string; endDate: string },
  days: number,
): Promise<BacktestRunResult['benchmark'] | undefined> {
  const quoteDays = Math.max(days, computeKlineDaysForRange(dateRange, 10));

  for (const candidate of BENCHMARK_CANDIDATES) {
    try {
      const quotes = await candidate.loadQuotes(quoteDays);
      const curve = buildBenchmarkCurve(quotes, dateRange);
      if (curve.length === 0) continue;
      return {
        symbol: candidate.symbol,
        name: candidate.name,
        curve,
        finalReturnPct: curve.at(-1)?.returnPct ?? null,
      };
    } catch {
      // try next benchmark source
    }
  }

  return undefined;
}

function benchmarkNote(benchmark: NonNullable<BacktestRunResult['benchmark']>): string {
  if (benchmark.symbol === '000001.SH') {
    return `A股大盘基准使用 ${benchmark.name}（${benchmark.symbol}）同期涨跌幅。`;
  }
  return `A股大盘基准使用 ${benchmark.name}（${benchmark.symbol}）同期买入持有收益；上证指数不可用时已退回 ETF 代理。`;
}

function buildSymbolSummaries(trades: BacktestTrade[]): BacktestSymbolSummary[] {
  const bySymbol = new Map<string, BacktestTrade[]>();
  for (const trade of trades) {
    const items = bySymbol.get(trade.symbol) ?? [];
    items.push(trade);
    bySymbol.set(trade.symbol, items);
  }

  return [...bySymbol.entries()]
    .map(([symbol, items]) => ({
      symbol,
      name: items[0]?.name ?? symbol,
      assetType: 'etf' as const,
      ...summarizeTrades(items),
    }))
    .sort((a, b) => (b.avgReturnPct ?? -Infinity) - (a.avgReturnPct ?? -Infinity));
}

function decideCurrentAction(input: {
  symbol: string;
  name: string;
  price: number;
  changePct: number;
  dataSource: 'realtime' | 'daily';
  candidate: ReturnType<typeof buildEtfTailPickCandidate>;
}): BacktestCurrentDecision {
  const failedRules = input.candidate.ruleChecks
    .filter((rule) => !rule.passed)
    .map((rule) => rule.label);
  const passedRules = input.candidate.ruleChecks.length - failedRules.length;
  const action = input.candidate.operationPlan.action;

  if (input.candidate.status === 'passed' && action === 'buy_zone') {
    return {
      symbol: input.symbol,
      name: input.name,
      assetType: 'etf',
      action: 'buy',
      actionLabel: '买入/持有',
      price: input.price,
      changePct: input.changePct,
      failCount: input.candidate.failCount,
      passedRules,
      failedRules,
      reason: '严格通过 8 条 ETF 尾盘规则，价格在买入区附近。',
      dataSource: input.dataSource,
    };
  }

  if (input.candidate.status === 'passed' && action === 'wait_pullback') {
    return {
      symbol: input.symbol,
      name: input.name,
      assetType: 'etf',
      action: 'wait_pullback',
      actionLabel: '等回踩',
      price: input.price,
      changePct: input.changePct,
      failCount: input.candidate.failCount,
      passedRules,
      failedRules,
      reason: '规则通过但当日涨幅偏高，不追高，等回踩到买入区。',
      dataSource: input.dataSource,
    };
  }

  if (input.candidate.status === 'near_pass') {
    return {
      symbol: input.symbol,
      name: input.name,
      assetType: 'etf',
      action: 'watch',
      actionLabel: '观察',
      price: input.price,
      changePct: input.changePct,
      failCount: input.candidate.failCount,
      passedRules,
      failedRules,
      reason: '近通过但规则缺口未补齐，只进观察池。',
      dataSource: input.dataSource,
    };
  }

  return {
    symbol: input.symbol,
    name: input.name,
    assetType: 'etf',
    action: 'sell',
    actionLabel: '卖出/回避',
    price: input.price,
    changePct: input.changePct,
    failCount: input.candidate.failCount,
    passedRules,
    failedRules,
    reason: '未通过 ETF 尾盘规则；若已持有，按规则应退出或至少降仓回避。',
    dataSource: input.dataSource,
  };
}

export async function runEtfTailRulesBacktest(
  input: RunEtfBacktestInput = {},
): Promise<BacktestRunResult> {
  const dateRange = resolveBacktestDateRange({
    startDate: input.startDate,
    endDate: input.endDate,
    fallbackCalendarDays: input.days,
  });
  const maxHoldDays = resolveMaxHoldDays(input);
  const minSettlementDays = resolveMinSettlementDays(input);
  const days =
    input.startDate || input.endDate
      ? computeKlineDaysForRange(dateRange, 45 + maxHoldDays)
      : Math.max(60, Math.floor(input.days ?? DEFAULT_DAYS));
  const maxFailCount = Math.max(0, Math.floor(input.maxFailCount ?? 0));
  const trades: BacktestTrade[] = [];
  const symbols: BacktestRunResult['symbols'] = [];
  const currentDecisions: BacktestCurrentDecision[] = [];
  const realtimeQuotes = await fetchIntradayQuotes(
    ETF_POOL_19.map((item) => item.symbol),
  ).catch(() => new Map());
  let usedLocalCsv = false;

  for (const item of ETF_POOL_19) {
    try {
      const quoteDays = hasLocalEtfDailyCsv(item.symbol)
        ? LOCAL_ETF_LOAD_ALL_DAYS
        : days;
      if (quoteDays === LOCAL_ETF_LOAD_ALL_DAYS) usedLocalCsv = true;
      const data = await getDailyQuote(item.symbol, quoteDays);
      const bars = data.quotes.filter((bar) => bar.close != null);
      symbols.push({ symbol: item.symbol, name: item.name, assetType: 'etf' });

      const latest = bars[0];
      const prevLatest = bars[1];
      const realtime = realtimeQuotes.get(item.symbol);
      if (latest?.close && prevLatest?.close) {
        const decisionPrice = realtime?.price ?? latest.close;
        const decisionChangePct =
          realtime?.pctChg ?? round(((latest.close - prevLatest.close) / prevLatest.close) * 100);
        const decisionSource = realtime ? 'realtime' : 'daily';
        const decisionCandidate = buildEtfTailPickCandidate({
          symbol: item.symbol,
          exchangeCode: item.exchangeCode,
          name: realtime?.name || item.name,
          price: decisionPrice,
          changePct: decisionChangePct,
          dailyTurnover: realtime?.amount ?? dailyTurnover(latest),
          intradayVolume: realtime?.volume ?? latest.vol ?? null,
          bars,
        });
        currentDecisions.push(
          decideCurrentAction({
            symbol: item.symbol,
            name: realtime?.name || item.name,
            price: decisionPrice,
            changePct: decisionChangePct,
            dataSource: decisionSource,
            candidate: decisionCandidate,
          }),
        );
      }

      for (let index = 0; index < bars.length; index += 1) {
        const bar = bars[index];
        const prev = bars[index + 1];
        if (!bar?.close || !prev?.close || bars.length - index < 30) continue;
        if (!isTradeDateInRange(bar.tradeDate, dateRange)) continue;

        const changePct = round(((bar.close - prev.close) / prev.close) * 100);
        const candidate = buildEtfTailPickCandidate({
          symbol: item.symbol,
          exchangeCode: item.exchangeCode,
          name: item.name,
          price: bar.close,
          changePct,
          dailyTurnover: dailyTurnover(bar),
          intradayVolume: bar.vol ?? null,
          bars: bars.slice(index),
        });

        if (candidate.failCount > maxFailCount) continue;
        if (
          candidate.operationPlan.action === 'wait_pullback' &&
          !input.includeWaitPullback
        ) {
          continue;
        }
        if (
          candidate.operationPlan.action !== 'buy_zone' &&
          candidate.operationPlan.action !== 'wait_pullback'
        ) {
          continue;
        }

        const signal: BacktestSignal = {
          symbol: item.symbol,
          name: item.name,
          assetType: 'etf',
          strategy: 'etf-tail-rules',
          tradeDate: bar.tradeDate,
          entryPrice: bar.close,
          score: 8 - candidate.failCount,
          metadata: {
            status: candidate.status,
            failCount: candidate.failCount,
            operationAction: candidate.operationPlan.action,
            ruleChecks: candidate.ruleChecks,
            stopPrice: candidate.operationPlan.stopPrice,
            takeProfitPrice: candidate.operationPlan.takeProfitPrice,
            rsi: candidate.rsi,
            ma5: candidate.ma5,
            ma20: candidate.ma20,
            ma30: candidate.ma30,
            volumeRatio: candidate.volumeRatio,
            estimatedTurnover: candidate.dailyTurnover,
          },
        };
        const trade = createEtfStrategyTrade(signal, bars, candidate, {
          minSettlementDays,
          maxHoldDays,
          maxFailCount,
          symbol: item.symbol,
          exchangeCode: item.exchangeCode,
          name: item.name,
          dailyTurnover,
        });
        if (trade) trades.push(trade);
      }
    } catch (error) {
      symbols.push({
        symbol: item.symbol,
        name: item.name,
        assetType: 'etf',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const sortedTrades = trades.sort((a, b) => {
    if (a.entryDate !== b.entryDate) return a.entryDate.localeCompare(b.entryDate);
    if (a.symbol !== b.symbol) return a.symbol.localeCompare(b.symbol);
    return a.holdDays - b.holdDays;
  });
  const benchmark = await buildBenchmark(dateRange, days).catch(() => undefined);

  return {
    strategy: 'etf-tail-rules',
    generatedAt: new Date().toISOString(),
    requestedDays: days,
    startDate: formatTradeDateKey(dateRange.startDate),
    endDate: formatTradeDateKey(dateRange.endDate),
    holdDays: [maxHoldDays],
    symbols,
    trades: sortedTrades,
    metrics: summarizeTrades(sortedTrades),
    groups: buildTradeGroups(sortedTrades, [
      { key: 'all', label: '全部交易', predicate: () => true },
      {
        key: 'stop-loss',
        label: '止损出场',
        predicate: (trade) => trade.exitReason === 'stop_loss',
      },
      {
        key: 'take-profit',
        label: '止盈出场',
        predicate: (trade) => trade.exitReason === 'take_profit',
      },
      {
        key: 'signal-lost',
        label: '信号失效',
        predicate: (trade) => trade.exitReason === 'signal_lost',
      },
      {
        key: 'max-hold',
        label: '达到持有上限',
        predicate: (trade) => trade.exitReason === 'max_hold',
      },
      {
        key: 'buy-zone',
        label: '可关注买入区',
        predicate: (trade) => trade.signal.metadata?.operationAction === 'buy_zone',
      },
      {
        key: 'wait-pullback',
        label: '等回踩',
        predicate: (trade) =>
          trade.signal.metadata?.operationAction === 'wait_pullback',
      },
    ]),
    equityCurve: buildEquityCurve(sortedTrades),
    benchmark,
    symbolSummaries: buildSymbolSummaries(sortedTrades),
    currentDecisions: currentDecisions.sort((a, b) => {
      const order = { buy: 0, wait_pullback: 1, watch: 2, sell: 3 };
      if (order[a.action] !== order[b.action]) return order[a.action] - order[b.action];
      return a.failCount - b.failCount;
    }),
    notes: [
      `回测区间 ${formatTradeDateKey(dateRange.startDate)} 至 ${formatTradeDateKey(dateRange.endDate)}；仅统计该区间内触发的买入信号。`,
      `ETF 回测复用现有 8 条尾盘规则；尾盘买入后最早 T+${minSettlementDays} 起按策略出场：技术止损（20 日低 / MA30×0.97）、入场计划止盈价、规则失效，或最多持有 ${maxHoldDays} 个交易日兜底。`,
      `A 股 ETF 多为 T+1 可卖；回测在买入后第 ${minSettlementDays} 个交易日起逐日评估上述退出条件，卖出价优先用触发的止损/止盈价，否则用当日收盘价。`,
      usedLocalCsv
        ? '历史回测优先使用本地 ETF 前复权 CSV（含真实成交额）；缺失时退回腾讯前复权日 K。'
        : '历史回测使用腾讯前复权日 K；历史成交额使用日 K 收盘价 * 成交量 * 100 估算。',
      usedLocalCsv
        ? '本地 CSV 不受“最近 N 根”限制，可覆盖更长回测区间；结束日期仍会自动限制在今天。'
        : '行情接口只能拉取“截至今天的最近 N 根日 K”，不能获取未来数据；结束日期会自动限制在今天。',
      benchmark
        ? benchmarkNote(benchmark)
        : 'A股大盘基准暂未生成，已尝试上证指数、沪深300ETF、上证50ETF。',
      '当前尾盘决策优先使用东财实时行情，实时行情不可用时退回最新日 K。',
      input.includeWaitPullback
        ? '已纳入“等回踩”信号，并按触发日收盘价模拟入场。'
        : '默认只回测“可关注买入区”信号，跳过“等回踩”。',
    ],
  };
}

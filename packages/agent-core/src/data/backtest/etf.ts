import { ETF_POOL_19 } from '../etf/pool.js';
import { buildEtfTailPickCandidate } from '../etf/rules.js';
import { fetchIntradayQuotes } from '../market/free/intraday-quote.js';
import { getDailyQuote } from '../market/services.js';
import {
  buildTradeGroups,
  createFixedHoldTrade,
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
  BacktestRunResult,
  BacktestSignal,
  BacktestSymbolSummary,
  BacktestTrade,
} from './types.js';

export type RunEtfBacktestInput = {
  days?: number;
  startDate?: string;
  endDate?: string;
  holdDays?: number[];
  maxFailCount?: number;
  includeWaitPullback?: boolean;
};

const DEFAULT_DAYS = 250;
const DEFAULT_HOLD_DAYS = [5];

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function normalizeHoldDays(holdDays: number[] | undefined): number[] {
  const values = holdDays?.length ? holdDays : DEFAULT_HOLD_DAYS;
  return [...new Set(values.map((value) => Math.max(0, Math.floor(value))))]
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
}

function estimateTurnover(close: number, volume: number | null): number {
  if (!volume || volume <= 0) return 0;
  return Math.round(close * volume * 100);
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
  const maxHold = normalizeHoldDays(input.holdDays).at(-1) ?? DEFAULT_HOLD_DAYS[0];
  const days =
    input.startDate || input.endDate
      ? computeKlineDaysForRange(dateRange, 45 + maxHold)
      : Math.max(60, Math.floor(input.days ?? DEFAULT_DAYS));
  const holdDays = normalizeHoldDays(input.holdDays);
  const maxFailCount = Math.max(0, Math.floor(input.maxFailCount ?? 0));
  const trades: BacktestTrade[] = [];
  const symbols: BacktestRunResult['symbols'] = [];
  const currentDecisions: BacktestCurrentDecision[] = [];
  const realtimeQuotes = await fetchIntradayQuotes(
    ETF_POOL_19.map((item) => item.symbol),
  ).catch(() => new Map());

  for (const item of ETF_POOL_19) {
    try {
      const data = await getDailyQuote(item.symbol, days);
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
          dailyTurnover: realtime?.amount ?? estimateTurnover(latest.close, latest.vol),
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
          dailyTurnover: estimateTurnover(bar.close, bar.vol),
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

        for (const holdDay of holdDays) {
          const signal: BacktestSignal = {
            symbol: item.symbol,
            name: item.name,
            assetType: 'etf',
            strategy: 'etf-tail-rules',
            tradeDate: bar.tradeDate,
            entryPrice: bar.close,
            score: 8 - candidate.failCount,
            metadata: {
              fixedHoldDays: holdDay,
              status: candidate.status,
              failCount: candidate.failCount,
              operationAction: candidate.operationPlan.action,
              ruleChecks: candidate.ruleChecks,
              rsi: candidate.rsi,
              ma5: candidate.ma5,
              ma20: candidate.ma20,
              ma30: candidate.ma30,
              volumeRatio: candidate.volumeRatio,
              estimatedTurnover: candidate.dailyTurnover,
            },
          };
          const trade = createFixedHoldTrade(signal, bars, holdDay);
          if (trade) trades.push(trade);
        }
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

  return {
    strategy: 'etf-tail-rules',
    generatedAt: new Date().toISOString(),
    requestedDays: days,
    startDate: formatTradeDateKey(dateRange.startDate),
    endDate: formatTradeDateKey(dateRange.endDate),
    holdDays,
    symbols,
    trades: sortedTrades,
    metrics: summarizeTrades(sortedTrades),
    groups: buildTradeGroups(sortedTrades, [
      { key: 'all', label: '全部交易', predicate: () => true },
      ...holdDays.map((daysValue) => ({
        key: `hold-${daysValue}`,
        label: `持有 ${daysValue} 个交易日`,
        predicate: (trade: BacktestTrade) =>
          trade.signal.metadata?.fixedHoldDays === daysValue,
      })),
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
    symbolSummaries: buildSymbolSummaries(sortedTrades),
    currentDecisions: currentDecisions.sort((a, b) => {
      const order = { buy: 0, wait_pullback: 1, watch: 2, sell: 3 };
      if (order[a.action] !== order[b.action]) return order[a.action] - order[b.action];
      return a.failCount - b.failCount;
    }),
    notes: [
      `回测区间 ${formatTradeDateKey(dateRange.startDate)} 至 ${formatTradeDateKey(dateRange.endDate)}；仅统计该区间内触发的买入信号。`,
      `ETF 回测复用现有 8 条尾盘规则；默认含义是尾盘触发买入信号后持有 ${holdDays.join('/')} 个交易日。`,
      '行情接口只能拉取“截至今天的最近 N 根日 K”，不能获取未来数据；结束日期会自动限制在今天。',
      '历史回测使用腾讯前复权日 K；历史成交额使用日 K 收盘价 * 成交量 * 100 估算。',
      '当前尾盘决策优先使用东财实时行情，实时行情不可用时退回最新日 K。',
      input.includeWaitPullback
        ? '已纳入“等回踩”信号，并按触发日收盘价模拟入场。'
        : '默认只回测“可关注买入区”信号，跳过“等回踩”。',
    ],
  };
}

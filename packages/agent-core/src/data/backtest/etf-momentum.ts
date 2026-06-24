import { ETF_POOL_19 } from '../etf/pool.js';
import { getDailyQuote } from '../market/services.js';
import {
  hasLocalEtfDailyCsv,
  LOCAL_ETF_LOAD_ALL_DAYS,
} from '../market/local-csv/etf-daily.js';
import {
  buildTradeGroups,
  calcReturnPct,
  summarizeTrades,
} from './engine.js';
import {
  computeKlineDaysForRange,
  formatTradeDateKey,
  isTradeDateInRange,
  normalizeTradeDateKey,
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

export type RunEtfMomentumBacktestInput = {
  days?: number;
  startDate?: string;
  endDate?: string;
  topN?: number;
  momentumDays?: number;
  rebalanceDays?: number;
  trendMaDays?: number;
};

type MomentumBar = {
  tradeDate: string;
  close: number;
};

type EtfHistory = {
  symbol: string;
  name: string;
  bars: MomentumBar[];
  byDate: Map<string, MomentumBar & { index: number }>;
};

type MomentumPick = {
  history: EtfHistory;
  score: number;
  momentumPct: number;
  trendMa: number;
};

const DEFAULT_DAYS = 365;
const DEFAULT_TOP_N = 3;
const DEFAULT_MOMENTUM_DAYS = 20;
const DEFAULT_REBALANCE_DAYS = 10;
const DEFAULT_TREND_MA_DAYS = 20;
const BENCHMARK_SYMBOL = '510300';
const MARKET_REGIME_MA_DAYS = 20;
const BULL_RELAXED_TREND_MA_DAYS = 10;

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clampPositiveInt(
  value: number | undefined,
  fallback: number,
  min = 1,
  max = 120,
): number {
  if (value != null && Number.isFinite(value)) {
    return Math.min(max, Math.max(min, Math.floor(value)));
  }
  return fallback;
}

function toHistory(
  symbol: string,
  name: string,
  quotes: Array<{ tradeDate: string; close: number | null }>,
): EtfHistory {
  const bars = quotes
    .filter((bar): bar is { tradeDate: string; close: number } => {
      return bar.close != null && bar.close > 0;
    })
    .map((bar) => ({
      tradeDate: normalizeTradeDateKey(bar.tradeDate),
      close: bar.close,
    }))
    .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));

  return {
    symbol,
    name,
    bars,
    byDate: new Map(
      bars.map((bar, index) => [bar.tradeDate, { ...bar, index }]),
    ),
  };
}

function scoreMomentumPick(input: {
  history: EtfHistory;
  tradeDate: string;
  momentumDays: number;
  trendMaDays: number;
}): MomentumPick | null {
  const current = input.history.byDate.get(input.tradeDate);
  if (!current) return null;

  const lookback = Math.max(input.momentumDays, input.trendMaDays);
  if (current.index < lookback) return null;

  const past = input.history.bars[current.index - input.momentumDays];
  if (!past?.close) return null;

  const trendSlice = input.history.bars
    .slice(current.index - input.trendMaDays + 1, current.index + 1)
    .map((bar) => bar.close);
  const trendMa = avg(trendSlice);
  if (trendMa == null || current.close < trendMa) return null;

  const momentumPct = ((current.close - past.close) / past.close) * 100;
  return {
    history: input.history,
    score: momentumPct,
    momentumPct: round(momentumPct),
    trendMa: round(trendMa, 4),
  };
}

function resolveEffectiveTrendMaDays(input: {
  benchmarkHistory: EtfHistory | undefined;
  tradeDate: string;
  trendMaDays: number;
}): number {
  const benchmark = input.benchmarkHistory?.byDate.get(input.tradeDate);
  if (!benchmark || benchmark.index < MARKET_REGIME_MA_DAYS) {
    return input.trendMaDays;
  }

  const regimeSlice = input.benchmarkHistory!.bars
    .slice(benchmark.index - MARKET_REGIME_MA_DAYS + 1, benchmark.index + 1)
    .map((bar) => bar.close);
  const regimeMa = avg(regimeSlice);
  if (regimeMa != null && benchmark.close >= regimeMa) {
    return Math.min(input.trendMaDays, BULL_RELAXED_TREND_MA_DAYS);
  }

  return input.trendMaDays;
}

function buildBenchmarkSlotTrade(input: {
  history: EtfHistory;
  entryDate: string;
  exitDate: string;
  topN: number;
  momentumDays: number;
  rebalanceDays: number;
  trendMaDays: number;
  slotIndex: number;
}): BacktestTrade | null {
  const entry = input.history.byDate.get(input.entryDate);
  const exit = input.history.byDate.get(input.exitDate);
  if (!entry || !exit) return null;

  return {
    symbol: input.history.symbol,
    name: input.history.name,
    assetType: 'etf',
    strategy: 'etf-momentum-rotation',
    entryDate: input.entryDate,
    entryPrice: entry.close,
    exitDate: input.exitDate,
    exitPrice: exit.close,
    holdDays: Math.max(0, exit.index - entry.index),
    returnPct: calcReturnPct(entry.close, exit.close),
    exitReason: 'benchmark_fill',
    signal: {
      symbol: input.history.symbol,
      name: input.history.name,
      assetType: 'etf',
      strategy: 'etf-momentum-rotation',
      tradeDate: input.entryDate,
      entryPrice: entry.close,
      score: 0,
      metadata: {
        benchmarkFallback: true,
        slotIndex: input.slotIndex,
        topN: input.topN,
        momentumDays: input.momentumDays,
        rebalanceDays: input.rebalanceDays,
        trendMaDays: input.trendMaDays,
      },
    },
  };
}

function buildTrade(input: {
  pick: MomentumPick;
  entryDate: string;
  exitDate: string;
  topN: number;
  momentumDays: number;
  rebalanceDays: number;
  trendMaDays: number;
}): BacktestTrade | null {
  const entry = input.pick.history.byDate.get(input.entryDate);
  const exit = input.pick.history.byDate.get(input.exitDate);
  if (!entry || !exit) return null;

  const signal: BacktestSignal = {
    symbol: input.pick.history.symbol,
    name: input.pick.history.name,
    assetType: 'etf',
    strategy: 'etf-momentum-rotation',
    tradeDate: input.entryDate,
    entryPrice: entry.close,
    score: input.pick.score,
    metadata: {
      momentumPct: input.pick.momentumPct,
      trendMa: input.pick.trendMa,
      topN: input.topN,
      momentumDays: input.momentumDays,
      rebalanceDays: input.rebalanceDays,
      trendMaDays: input.trendMaDays,
    },
  };

  return {
    symbol: input.pick.history.symbol,
    name: input.pick.history.name,
    assetType: 'etf',
    strategy: 'etf-momentum-rotation',
    entryDate: input.entryDate,
    entryPrice: entry.close,
    exitDate: input.exitDate,
    exitPrice: exit.close,
    holdDays: Math.max(0, exit.index - entry.index),
    returnPct: calcReturnPct(entry.close, exit.close),
    exitReason: 'fixed_hold',
    signal,
  };
}

function buildMomentumEquityCurve(
  points: Array<{ tradeDate: string; equity: number; closedTrades: number }>,
): BacktestEquityPoint[] {
  return points.map((point) => ({
    tradeDate: point.tradeDate,
    equity: round(point.equity * 100, 4),
    returnPct: round((point.equity - 1) * 100),
    closedTrades: point.closedTrades,
  }));
}

function buildBenchmarkCurve(
  history: EtfHistory | undefined,
  dateRange: { startDate: string; endDate: string },
): BacktestEquityPoint[] {
  if (!history) return [];
  const bars = history.bars.filter((bar) =>
    isTradeDateInRange(bar.tradeDate, dateRange),
  );
  const start = bars[0]?.close;
  if (!start) return [];
  return bars.map((bar) => {
    const returnPct = ((bar.close - start) / start) * 100;
    return {
      tradeDate: bar.tradeDate,
      equity: round(100 + returnPct, 4),
      returnPct: round(returnPct),
      closedTrades: 0,
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

function buildCurrentDecisions(input: {
  histories: EtfHistory[];
  benchmarkHistory: EtfHistory | undefined;
  topN: number;
  momentumDays: number;
  trendMaDays: number;
}): BacktestCurrentDecision[] {
  const latestDate = [...new Set(input.histories.flatMap((item) => item.bars.map((bar) => bar.tradeDate)))]
    .sort()
    .at(-1);
  if (!latestDate) return [];

  const effectiveTrendMaDays = resolveEffectiveTrendMaDays({
    benchmarkHistory: input.benchmarkHistory,
    tradeDate: latestDate,
    trendMaDays: input.trendMaDays,
  });

  const ranked = input.histories
    .map((history) =>
      scoreMomentumPick({
        history,
        tradeDate: latestDate,
        momentumDays: input.momentumDays,
        trendMaDays: effectiveTrendMaDays,
      }),
    )
    .filter((pick): pick is MomentumPick => pick != null)
    .sort((a, b) => b.score - a.score);
  const selected = new Set(ranked.slice(0, input.topN).map((pick) => pick.history.symbol));

  return input.histories
    .map((history) => {
      const current = history.byDate.get(latestDate);
      const pick = ranked.find((item) => item.history.symbol === history.symbol);
      const isSelected = selected.has(history.symbol);
      return {
        symbol: history.symbol,
        name: history.name,
        assetType: 'etf' as const,
        action: isSelected ? ('buy' as const) : ('watch' as const),
        actionLabel: isSelected ? '轮动持有' : '等待轮动',
        price: current?.close ?? 0,
        changePct: pick?.momentumPct ?? 0,
        failCount: pick ? 0 : 1,
        passedRules: pick ? 2 : 0,
        failedRules: pick ? [] : [`未站上 MA${effectiveTrendMaDays} 或动量不足`],
        reason: pick
          ? `${input.momentumDays}日动量 ${pick.momentumPct.toFixed(2)}%，站上 MA${effectiveTrendMaDays}，按排名${isSelected ? '进入前' + input.topN : '未进入前' + input.topN}。`
          : `未满足 MA${effectiveTrendMaDays} 趋势过滤或缺少足够历史数据。`,
        dataSource: 'daily' as const,
      };
    })
    .sort((a, b) => {
      if (a.action !== b.action) return a.action === 'buy' ? -1 : 1;
      return b.changePct - a.changePct;
    });
}

export async function runEtfMomentumBacktest(
  input: RunEtfMomentumBacktestInput = {},
): Promise<BacktestRunResult> {
  const topN = clampPositiveInt(input.topN, DEFAULT_TOP_N, 1, 10);
  const momentumDays = clampPositiveInt(
    input.momentumDays,
    DEFAULT_MOMENTUM_DAYS,
    5,
    120,
  );
  const rebalanceDays = clampPositiveInt(
    input.rebalanceDays,
    DEFAULT_REBALANCE_DAYS,
    1,
    60,
  );
  const trendMaDays = clampPositiveInt(
    input.trendMaDays,
    DEFAULT_TREND_MA_DAYS,
    5,
    120,
  );

  const dateRange = resolveBacktestDateRange({
    startDate: input.startDate,
    endDate: input.endDate,
    fallbackCalendarDays: input.days ?? DEFAULT_DAYS,
  });
  const days =
    input.startDate || input.endDate
      ? computeKlineDaysForRange(dateRange, Math.max(momentumDays, trendMaDays) + 10)
      : Math.max(60, Math.floor(input.days ?? DEFAULT_DAYS));

  const histories: EtfHistory[] = [];
  const symbols: BacktestRunResult['symbols'] = [];
  let usedLocalCsv = false;

  for (const item of ETF_POOL_19) {
    try {
      const quoteDays = hasLocalEtfDailyCsv(item.symbol)
        ? LOCAL_ETF_LOAD_ALL_DAYS
        : days;
      if (quoteDays === LOCAL_ETF_LOAD_ALL_DAYS) usedLocalCsv = true;
      const data = await getDailyQuote(item.symbol, quoteDays);
      histories.push(toHistory(item.symbol, item.name, data.quotes));
      symbols.push({ symbol: item.symbol, name: item.name, assetType: 'etf' });
    } catch (error) {
      symbols.push({
        symbol: item.symbol,
        name: item.name,
        assetType: 'etf',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const benchmarkHistory = histories.find((item) => item.symbol === BENCHMARK_SYMBOL);
  const allDates = [...new Set(histories.flatMap((item) => item.bars.map((bar) => bar.tradeDate)))]
    .filter((date) => isTradeDateInRange(date, dateRange))
    .sort();
  const trades: BacktestTrade[] = [];
  const equityPoints: Array<{ tradeDate: string; equity: number; closedTrades: number }> = [];
  let equity = 1;
  let closedTrades = 0;

  for (let index = 0; index < allDates.length - 1; index += rebalanceDays) {
    const entryDate = allDates[index];
    const exitDate = allDates[Math.min(index + rebalanceDays, allDates.length - 1)];
    const effectiveTrendMaDays = resolveEffectiveTrendMaDays({
      benchmarkHistory,
      tradeDate: entryDate,
      trendMaDays,
    });
    const picks = histories
      .filter((history) => history.symbol !== BENCHMARK_SYMBOL)
      .map((history) =>
        scoreMomentumPick({
          history,
          tradeDate: entryDate,
          momentumDays,
          trendMaDays: effectiveTrendMaDays,
        }),
      )
      .filter((pick): pick is MomentumPick => pick != null)
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);

    const periodTrades: BacktestTrade[] = [];
    for (let slot = 0; slot < topN; slot += 1) {
      const pick = picks[slot];
      if (pick) {
        const trade = buildTrade({
          pick,
          entryDate,
          exitDate,
          topN,
          momentumDays,
          rebalanceDays,
          trendMaDays: effectiveTrendMaDays,
        });
        if (trade) periodTrades.push(trade);
        continue;
      }

      if (!benchmarkHistory) continue;
      const benchTrade = buildBenchmarkSlotTrade({
        history: benchmarkHistory,
        entryDate,
        exitDate,
        topN,
        momentumDays,
        rebalanceDays,
        trendMaDays: effectiveTrendMaDays,
        slotIndex: slot,
      });
      if (benchTrade) periodTrades.push(benchTrade);
    }

    const periodReturn = avg(
      periodTrades
        .map((trade) => trade.returnPct)
        .filter((value): value is number => value != null),
    ) ?? 0;

    trades.push(...periodTrades);
    closedTrades += periodTrades.length;
    equity *= 1 + periodReturn / 100;
    equityPoints.push({ tradeDate: exitDate, equity, closedTrades });
  }

  const sortedTrades = trades.sort((a, b) => {
    if (a.entryDate !== b.entryDate) return a.entryDate.localeCompare(b.entryDate);
    return (b.signal.score ?? 0) - (a.signal.score ?? 0);
  });
  const benchmarkCurve = buildBenchmarkCurve(benchmarkHistory, dateRange);

  return {
    strategy: 'etf-momentum-rotation',
    generatedAt: new Date().toISOString(),
    requestedDays: days,
    startDate: formatTradeDateKey(dateRange.startDate),
    endDate: formatTradeDateKey(dateRange.endDate),
    holdDays: [rebalanceDays],
    symbols,
    trades: sortedTrades,
    metrics: summarizeTrades(sortedTrades),
    groups: buildTradeGroups(sortedTrades, [
      { key: 'all', label: '全部轮动', predicate: () => true },
      {
        key: 'positive',
        label: '盈利轮动',
        predicate: (trade) => (trade.returnPct ?? 0) > 0,
      },
      {
        key: 'negative',
        label: '亏损轮动',
        predicate: (trade) => (trade.returnPct ?? 0) < 0,
      },
    ]),
    equityCurve: buildMomentumEquityCurve(equityPoints),
    benchmark:
      benchmarkCurve.length > 0
        ? {
            symbol: '510300',
            name: '沪深300ETF',
            curve: benchmarkCurve,
            finalReturnPct: benchmarkCurve.at(-1)?.returnPct ?? null,
          }
        : undefined,
    symbolSummaries: buildSymbolSummaries(sortedTrades),
    currentDecisions: buildCurrentDecisions({
      histories,
      benchmarkHistory,
      topN,
      momentumDays,
      trendMaDays,
    }),
    config: {
      topN,
      momentumDays,
      rebalanceDays,
      trendMaDays,
      maxConcurrentPositions: topN,
      noSymbolOverlap: true,
      newsFilter: 'off',
      rawSignalCount: sortedTrades.length,
    },
    notes: [
      `ETF 动量轮动：每 ${rebalanceDays} 个交易日调仓，选择 ${momentumDays} 日涨幅最高且站上 MA${trendMaDays} 的前 ${topN} 只 ETF 等权持有。`,
      `沪深300 站上 MA${MARKET_REGIME_MA_DAYS} 时，单只 ETF 趋势过滤放宽至 MA${BULL_RELAXED_TREND_MA_DAYS}，减少 V 型反弹踏空。`,
      `动量标的不足 ${topN} 只时，剩余仓位用 ${BENCHMARK_SYMBOL} 基准 ETF 兜底，避免空仓错过大盘反弹。`,
      '该策略不使用新闻过滤，避免历史新闻覆盖不足和标题情绪噪声影响回测。',
      '收益曲线按每期持仓槽位（动量 ETF + 基准兜底）的等权平均收益复利计算，基准为沪深300ETF同期买入持有收益。',
      usedLocalCsv
        ? '历史回测优先使用本地 ETF 前复权 CSV（含真实成交额）；缺失时退回腾讯前复权日 K。'
        : '历史回测使用腾讯前复权日 K。',
    ],
  };
}

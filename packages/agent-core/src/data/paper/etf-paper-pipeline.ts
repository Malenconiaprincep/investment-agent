import '../../config/load-env.js';

import { buildEtfEvergreenV3LivePlan } from '../backtest/etf-evergreen-v3.js';
import { buildEtfStableV2LivePlan } from '../backtest/etf-stable-v2.js';
import {
  generateEtfEvergreenCapitalReadiness,
  recordEtfEvergreenShadowPlan,
} from '../etf/capital-readiness.js';
import {
  calcEtfBuyCost,
  calcEtfBuyLotsByBudget,
  calcEtfSellProceeds,
  ETF_COMMISSION_RATE,
} from '../etf/trading-cost.js';
import { fetchIntradayQuotes } from '../market/free/intraday-quote.js';
import { resolvePaperExecutionPrice } from '../market/free/orderbook-quote.js';
import { getDailyQuote } from '../market/services.js';
import {
  ETF_T_PLUS_BUCKET,
  ETF_EVERGREEN_BUCKET,
  ETF_T_PLUS_BUDGET_PCT,
  ETF_T_PLUS_BUY_DIP_PCT,
  ETF_T_PLUS_MAX_TRADES_PER_DAY,
  ETF_T_PLUS_MIN_PROFIT_PCT,
  ETF_MOMENTUM_REBALANCE_DAYS,
  ETF_MOMENTUM_STOP_COOLDOWN_DAYS,
  ETF_MOMENTUM_STOP_LOSS_PCT,
  ETF_MOMENTUM_TOP_N,
} from './bucket.js';
import {
  formatEtfTargetRotationNote,
  loadEtfRotationContext,
} from './etf-rotation-news.js';
import {
  calcEtfPaperBuyShares,
  calcEtfProbeTargetShares,
  countEtfTargetSlots,
} from './etf-paper-sizing.js';
import { resolveNextEtfRebalanceDate } from './etf-paper-schedule.js';
import {
  executePaperTrade,
  getAvailableShares,
  getPaperAccountSummary,
  getPaperBucketState,
  listEquitySnapshots,
  listPaperPositions,
  listPaperTrades,
  saveEquitySnapshot,
  savePaperBucketState,
} from './store.js';
import {
  formatTradeDate,
  getBeijingNow,
  getNextTradeDateLabel,
  isEtfAutoRunWindow,
  isEtfTPlusRunWindow,
  isWeekday,
  roundToLot,
  shiftTradeDateLabel,
} from './trading-calendar.js';

const ETF_BUY_MAX_SPREAD_PCT = 0.5;
const ETF_BUY_HALF_POSITION_MIN_PREMIUM_PCT = 2;
const ETF_BUY_SKIP_PREMIUM_PCT = 4;
const ETF_T_PLUS_INTRADAY_NOTE_MARK = 'ETF 正T · 30分钟盘中监听';
const ETF_EVERGREEN_VALIDATION_PAUSE_REASON =
  '长青一号 V3 已通过历史准入并生成影子目标；双袖套实盘模拟执行仍在核验，暂不自动下单';

type EtfPaperBucket = 'etf' | typeof ETF_EVERGREEN_BUCKET | typeof ETF_T_PLUS_BUCKET;

export function isEtfEvergreenAutoTradingEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.ETF_EVERGREEN_ALLOW_TRADING === '1';
}

export type EtfPaperPipelineResult = {
  bucket?: EtfPaperBucket;
  tradeDate: string;
  nextTradeDate?: string;
  nextRebalanceDate?: string;
  lastRebalanceDate?: string | null;
  skipped?: boolean;
  shadowMode?: boolean;
  signalDate?: string;
  cashReservePct?: number;
  capitalReadiness?: {
    decision: string;
    canAcceptRealCapital: boolean;
    minimumRemainingTradingDays: number;
    estimatedEarliestReviewDate: string;
  };
  reason?: string;
  isRebalanceDay?: boolean;
  stopLosses?: Array<{ symbol: string; name: string; shares: number; price: number }>;
  sells?: Array<{ symbol: string; name: string; shares: number; price: number }>;
  buys?: Array<{ symbol: string; name: string; shares: number; price: number }>;
  buySkips?: Array<{
    symbol: string;
    name: string;
    reason: string;
    price?: number;
    prevClose?: number;
    premiumPct?: number;
    spreadPct?: number;
  }>;
  targets?: Array<{
    symbol: string;
    name: string;
    isBenchmarkFill: boolean;
    matchedThemes?: string[];
    themeBoost?: number;
    newsLabel?: string;
    targetWeightPct?: number;
    assetClass?: string;
    reason?: string;
  }>;
  hotThemes?: string[];
  rotationSummary?: string;
  tPlusTrades?: Array<{
    symbol: string;
    name: string;
    shares: number;
    buyPrice: number;
    sellPrice: number;
    profit: number;
    dipPct: number;
    reboundPct: number;
  }>;
  tPlusEntries?: Array<{
    symbol: string;
    name: string;
    shares: number;
    buyPrice: number;
    dipPct: number;
  }>;
  tPlusSkips?: Array<{
    symbol: string;
    name: string;
    reason: string;
    dipPct?: number;
    reboundPct?: number;
  }>;
  equity?: { totalValue: number; returnPct: number };
  error?: string;
};

function countTradingDaysSince(
  fromDate: string | null | undefined,
  toDate: string,
  benchmarkDates: string[],
): number {
  if (!fromDate) return Number.POSITIVE_INFINITY;
  const sorted = [...new Set(benchmarkDates.map((d) => d.replace(/-/g, '')))].sort();
  const fromKey = fromDate.replace(/-/g, '');
  const toKey = toDate.replace(/-/g, '');
  let count = 0;
  for (const key of sorted) {
    if (key <= fromKey) continue;
    if (key > toKey) break;
    count += 1;
  }
  return count;
}

function calcEtfSlotShares(input: {
  totalEquity: number;
  deployableScale: number;
  price: number;
  slotCount: number;
  isProbeEntry: boolean;
  currentMarketValue?: number;
  targetWeightPct?: number;
}): number {
  return calcEtfPaperBuyShares(input);
}

function roundPct(value: number): number {
  return Number(value.toFixed(2));
}

function isPositive(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value) && value > 0;
}

function computeSpreadPct(input: {
  bid1: number | null;
  ask1: number | null;
}): number | null {
  if (!isPositive(input.bid1) || !isPositive(input.ask1)) return null;
  if (input.ask1 < input.bid1) return null;
  const mid = (input.ask1 + input.bid1) / 2;
  if (mid <= 0) return null;
  return roundPct(((input.ask1 - input.bid1) / mid) * 100);
}

async function resolvePreviousClose(
  symbol: string,
  tradeDate: string,
): Promise<number | null> {
  const data = await getDailyQuote(symbol, 10);
  const tradeKey = tradeDate.replace(/-/g, '');
  const prior = data.quotes
    .filter((bar) => bar.close != null && bar.close > 0)
    .map((bar) => ({
      tradeDate: bar.tradeDate.replace(/-/g, ''),
      close: bar.close!,
    }))
    .filter((bar) => bar.tradeDate < tradeKey)
    .sort((a, b) => b.tradeDate.localeCompare(a.tradeDate))[0];
  if (prior) return prior.close;
  return data.latestClose != null && data.latestClose > 0 ? data.latestClose : null;
}

export function evaluateEtfBuyExecutionGuard(input: {
  shares: number;
  price: number;
  bid1: number | null;
  ask1: number | null;
  prevClose: number | null;
}): {
  action: 'buy' | 'half' | 'skip';
  shares: number;
  reason?: string;
  premiumPct?: number;
  spreadPct?: number;
} {
  const spreadPct = computeSpreadPct({ bid1: input.bid1, ask1: input.ask1 });
  if (spreadPct == null) {
    return {
      action: 'skip',
      shares: 0,
      reason: '盘口买一/卖一缺失或倒挂，暂缓买入',
    };
  }
  if (spreadPct > ETF_BUY_MAX_SPREAD_PCT) {
    return {
      action: 'skip',
      shares: 0,
      reason: `盘口价差 ${spreadPct.toFixed(2)}% > ${ETF_BUY_MAX_SPREAD_PCT}%`,
      spreadPct,
    };
  }

  if (!isPositive(input.prevClose)) {
    return {
      action: 'skip',
      shares: 0,
      reason: '缺少上一交易日收盘价，暂缓买入',
      spreadPct,
    };
  }

  const premiumPct = roundPct(((input.price - input.prevClose) / input.prevClose) * 100);
  if (premiumPct > ETF_BUY_SKIP_PREMIUM_PCT) {
    return {
      action: 'skip',
      shares: 0,
      reason: `买入价较昨收上涨 ${premiumPct.toFixed(2)}% > ${ETF_BUY_SKIP_PREMIUM_PCT}%`,
      premiumPct,
      spreadPct,
    };
  }

  if (premiumPct > ETF_BUY_HALF_POSITION_MIN_PREMIUM_PCT) {
    const halfShares = roundToLot(Math.floor(input.shares / 2));
    return {
      action: halfShares >= 100 ? 'half' : 'skip',
      shares: halfShares,
      reason:
        halfShares >= 100
          ? `买入价较昨收上涨 ${premiumPct.toFixed(2)}%，半仓执行`
          : '半仓不足 100 股整手，暂缓买入',
      premiumPct,
      spreadPct,
    };
  }

  return {
    action: 'buy',
    shares: input.shares,
    premiumPct,
    spreadPct,
  };
}

function etfStrategyNote(bucket: EtfPaperBucket, note: string): string {
  if (bucket === ETF_T_PLUS_BUCKET) return `ETF 正T仓动量${note}`;
  if (bucket === ETF_EVERGREEN_BUCKET) return `长青一号 V3 ${note}`;
  return `ETF 动量${note}`;
}

async function autoStopLossEtfPositions(tradeDate: string, bucket: EtfPaperBucket) {
  const stops: EtfPaperPipelineResult['stopLosses'] = [];
  const positions = await listPaperPositions(bucket);
  const state = await getPaperBucketState(bucket);
  const cooldownUntil = { ...state.cooldownUntil };

  for (const pos of positions) {
    try {
      const execution = await resolvePaperExecutionPrice(pos.symbol, 'sell');
      const returnPct = ((execution.price - pos.avgCost) / pos.avgCost) * 100;
      if (returnPct > ETF_MOMENTUM_STOP_LOSS_PCT) continue;

      const available = await getAvailableShares(pos.symbol, tradeDate, bucket);
      const shares = roundToLot(available);
      if (shares < 100) continue;

      await executePaperTrade({
        bucket,
        symbol: pos.symbol,
        name: pos.name,
        side: 'sell',
        shares,
        price: execution.price,
        tradeDate,
        source: 'auto',
        note: `${etfStrategyNote(bucket, '止损')} ${returnPct.toFixed(2)}%`,
        skipSessionCheck: true,
        useOrderBookPrice: false,
        priceIncludesSpread: true,
      });
      cooldownUntil[pos.symbol] = tradeDate;
      stops.push({
        symbol: pos.symbol,
        name: pos.name,
        shares,
        price: execution.price,
      });
    } catch {
      // skip per symbol
    }
  }

  await savePaperBucketState({ bucket, cooldownUntil });
  return stops;
}

function buildCooldownExclusions(
  cooldownUntil: Record<string, string>,
  tradeDate: string,
  benchmarkDates: string[],
): Set<string> {
  const excluded = new Set<string>();
  for (const [symbol, untilDate] of Object.entries(cooldownUntil)) {
    const days = countTradingDaysSince(untilDate, tradeDate, benchmarkDates);
    if (days < ETF_MOMENTUM_STOP_COOLDOWN_DAYS) excluded.add(symbol);
  }
  return excluded;
}

export async function runEtfPaperAutoPipeline(options?: {
  force?: boolean;
  bucket?: EtfPaperBucket;
}): Promise<EtfPaperPipelineResult> {
  const bucket = options?.bucket ?? 'etf';
  const tradeDate = formatTradeDate();
  const now = getBeijingNow();
  const nextTradeDate = getNextTradeDateLabel(now);

  if (!options?.force && !isWeekday(now)) {
    return { bucket, tradeDate, nextTradeDate, skipped: true, reason: '周末非交易日' };
  }
  if (!options?.force && !isEtfAutoRunWindow(now)) {
    return {
      bucket,
      tradeDate,
      nextTradeDate,
      skipped: true,
      reason: '非 A 股交易时段（9:30–11:30、13:00–15:00 北京时间）',
    };
  }

  const result: EtfPaperPipelineResult = { bucket, tradeDate, nextTradeDate };

  try {
    const benchmark = await getDailyQuote('510300', 120);
    const benchmarkDates = benchmark.quotes.map((bar) => bar.tradeDate);
    result.stopLosses = await autoStopLossEtfPositions(tradeDate, bucket);

    const bucketState = await getPaperBucketState(bucket);
    result.lastRebalanceDate = bucketState.lastRebalanceDate;
    result.nextRebalanceDate = resolveNextEtfRebalanceDate({
      lastRebalanceDate: bucketState.lastRebalanceDate,
      tradeDate,
    });
    const daysSinceRebalance = countTradingDaysSince(
      bucketState.lastRebalanceDate,
      tradeDate,
      benchmarkDates,
    );
    let isRebalanceDay =
      bucketState.lastRebalanceDate == null
      || daysSinceRebalance >= ETF_MOMENTUM_REBALANCE_DAYS;

    if (
      !isRebalanceDay
      && bucketState.lastRebalanceDate === tradeDate
    ) {
      const preSummary = await getPaperAccountSummary(bucket);
      const todayTrades = (await listPaperTrades(50, bucket)).filter(
        (trade) => trade.tradeDate === tradeDate,
      );
      if (preSummary.positions.length === 0 && todayTrades.length === 0) {
        isRebalanceDay = true;
        result.reason = '上次调仓未成交，今日重试';
      }
    }

    result.isRebalanceDay = isRebalanceDay;
    const evergreenPaused = bucket === ETF_EVERGREEN_BUCKET
      && !isEtfEvergreenAutoTradingEnabled();

    if (!isRebalanceDay && !evergreenPaused) {
      const equity = await saveEquitySnapshot(tradeDate, bucket);
      result.equity = { totalValue: equity.totalValue, returnPct: equity.returnPct };
      return result;
    }

    const excludedSymbols = buildCooldownExclusions(
      bucketState.cooldownUntil,
      tradeDate,
      benchmarkDates,
    );
    const rotationContext = await loadEtfRotationContext(tradeDate).catch(() => null);
    const summary = await getPaperAccountSummary(bucket);
    const equityHistory = await listEquitySnapshots(5_000, bucket);
    const equityPeak = Math.max(
      summary.account.initialCash,
      summary.totalValue,
      ...equityHistory.map((snapshot) => snapshot.totalValue),
    );
    const portfolioDrawdownPct = equityPeak > 0
      ? ((summary.totalValue - equityPeak) / equityPeak) * 100
      : 0;
    const planExecutionDate = bucket === ETF_EVERGREEN_BUCKET && !isWeekday(now)
      ? nextTradeDate
      : tradeDate;
    const plan = bucket === ETF_EVERGREEN_BUCKET
      ? await buildEtfEvergreenV3LivePlan({
          executionDate: planExecutionDate,
          portfolioDrawdownPct,
          excludedSymbols,
          rotationContext,
        })
      : await buildEtfStableV2LivePlan({
          executionDate: tradeDate,
          portfolioDrawdownPct,
          excludedSymbols,
          rotationContext,
        });
    result.signalDate = plan.signalDate;
    result.cashReservePct = 'cashReservePct' in plan ? plan.cashReservePct : undefined;
    result.hotThemes = plan.hotThemes;
    result.rotationSummary = plan.rotationSummary;
    result.targets = plan.targets;

    if (evergreenPaused) {
      const shadowPlan = {
        strategy: plan.strategy,
        signalDate: plan.signalDate,
        executionDate: plan.executionDate,
        generatedAt: new Date().toISOString(),
        cashReservePct: 'cashReservePct' in plan ? plan.cashReservePct : undefined,
        sleeves: 'sleeves' in plan ? plan.sleeves : undefined,
        targets: plan.targets.map((target) => ({
          symbol: target.symbol,
          name: target.name,
          targetWeightPct: target.targetWeightPct,
          assetClass: target.assetClass,
          reason: target.reason,
        })),
      };
      await savePaperBucketState({
        bucket,
        shadowPlan,
      });
      recordEtfEvergreenShadowPlan(shadowPlan);
      const readiness = await generateEtfEvergreenCapitalReadiness({ asOfDate: tradeDate });
      result.capitalReadiness = {
        decision: readiness.decision,
        canAcceptRealCapital: readiness.canAcceptRealCapital,
        minimumRemainingTradingDays: readiness.minimumRemainingTradingDays,
        estimatedEarliestReviewDate: readiness.estimatedEarliestReviewDate,
      };
      const equity = await saveEquitySnapshot(tradeDate, bucket);
      result.skipped = true;
      result.shadowMode = true;
      result.reason = ETF_EVERGREEN_VALIDATION_PAUSE_REASON;
      result.isRebalanceDay = false;
      result.equity = { totalValue: equity.totalValue, returnPct: equity.returnPct };
      return result;
    }

    const sells: NonNullable<EtfPaperPipelineResult['sells']> = [];
    const buys: NonNullable<EtfPaperPipelineResult['buys']> = [];
    const buySkips: NonNullable<EtfPaperPipelineResult['buySkips']> = [];

    for (const pos of summary.positions) {
      const target = plan.targets.find((item) => item.symbol === pos.symbol);
      const available = await getAvailableShares(pos.symbol, tradeDate, bucket);
      let shares = roundToLot(available);
      if (target) {
        const referencePrice = pos.latestPrice ?? pos.avgCost;
        const targetValue = summary.totalValue * target.targetWeightPct / 100;
        const currentValue = pos.marketValue ?? pos.shares * referencePrice;
        const excessValue = Math.max(0, currentValue - targetValue);
        shares = Math.min(
          shares,
          roundToLot(Math.floor(excessValue / Math.max(referencePrice, 0.0001))),
        );
      }
      if (shares < 100) continue;
      const execution = await resolvePaperExecutionPrice(pos.symbol, 'sell');
      await executePaperTrade({
        bucket,
        symbol: pos.symbol,
        name: pos.name,
        side: 'sell',
        shares,
        price: execution.price,
        tradeDate,
        source: 'auto',
        note: target
          ? etfStrategyNote(bucket, `目标权重再平衡至 ${target.targetWeightPct.toFixed(2)}%`)
          : etfStrategyNote(bucket, '调仓卖出'),
        skipSessionCheck: true,
        useOrderBookPrice: false,
        priceIncludesSpread: true,
      });
      sells.push({
        symbol: pos.symbol,
        name: pos.name,
        shares,
        price: execution.price,
      });
    }

    const refreshed = await getPaperAccountSummary(bucket);
    let remainingCash = refreshed.account.cash;
    const slotCounts = countEtfTargetSlots(plan.targets);

    for (const [symbol, slotCount] of slotCounts) {
      const target = plan.targets.find((item) => item.symbol === symbol);
      if (!target) continue;

      const existing = refreshed.positions.find((pos) => pos.symbol === symbol);
      const isProbeEntry = !existing;
      const execution = await resolvePaperExecutionPrice(symbol, 'buy');
      const currentMv =
        existing?.marketValue ??
        (existing?.shares && execution.price ? existing.shares * execution.price : 0);
      const plannedShares = calcEtfSlotShares({
        totalEquity: refreshed.totalValue,
        deployableScale: plan.regimeExposureScale,
        price: execution.price,
        slotCount,
        isProbeEntry,
        currentMarketValue: currentMv,
        targetWeightPct: target.targetWeightPct,
      });
      if (plannedShares < 100) continue;

      const prevClose = await resolvePreviousClose(symbol, tradeDate);
      const guard = evaluateEtfBuyExecutionGuard({
        shares: plannedShares,
        price: execution.price,
        bid1: execution.quote.bid1,
        ask1: execution.quote.ask1,
        prevClose,
      });
      if (guard.action === 'skip') {
        buySkips.push({
          symbol: target.symbol,
          name: target.name,
          reason: guard.reason ?? 'ETF 买入执行保护跳过',
          price: execution.price,
          prevClose: prevClose ?? undefined,
          premiumPct: guard.premiumPct,
          spreadPct: guard.spreadPct,
        });
        continue;
      }

      const affordable = calcEtfBuyLotsByBudget({
        budget: remainingCash,
        price: execution.price,
        commissionRate: ETF_COMMISSION_RATE,
        slippageRate: 0,
      });
      const shares = Math.min(guard.shares, affordable?.shares ?? 0);
      if (shares < 100) continue;
      const estimatedCost = calcEtfBuyCost({
        price: execution.price,
        shares,
        commissionRate: ETF_COMMISSION_RATE,
        slippageRate: 0,
      }).totalCost;
      if (estimatedCost > remainingCash) continue;

      const rotationNote = formatEtfTargetRotationNote({
        matchedThemes: target.matchedThemes,
        themeBoost: target.themeBoost,
        newsLabel: target.newsLabel,
      });
      const baseNote = isProbeEntry
        ? target.isBenchmarkFill
          ? etfStrategyNote(bucket, '建仓（宽基槽位）')
          : etfStrategyNote(bucket, '建仓')
        : target.isBenchmarkFill
          ? etfStrategyNote(bucket, '调仓加仓（宽基槽位）')
          : etfStrategyNote(bucket, '调仓加仓');

      const executionGuardNote = guard.reason
        ? `执行保护：${guard.reason}`
        : guard.premiumPct != null || guard.spreadPct != null
          ? `执行保护：较昨收 ${guard.premiumPct?.toFixed(2) ?? 'NA'}%，价差 ${guard.spreadPct?.toFixed(2) ?? 'NA'}%`
          : '';

      await executePaperTrade({
        bucket,
        symbol: target.symbol,
        name: target.name,
        side: 'buy',
        shares,
        price: execution.price,
        tradeDate,
        source: 'auto',
        note: [baseNote + rotationNote, executionGuardNote].filter(Boolean).join(' · '),
        skipSessionCheck: true,
        useOrderBookPrice: false,
        priceIncludesSpread: true,
      });
      buys.push({
        symbol: target.symbol,
        name: target.name,
        shares,
        price: execution.price,
      });
      remainingCash -= estimatedCost;
    }

    result.sells = sells;
    result.buys = buys;
    result.buySkips = buySkips;

    const refreshedAfter = await getPaperAccountSummary(bucket);
    const allTargetsHeld = plan.targets.every((target) =>
      refreshedAfter.positions.some((pos) => pos.symbol === target.symbol),
    );
    const hadActivity = sells.length > 0 || buys.length > 0;

    const hasPendingProtectedBuys = buySkips.length > 0 && !allTargetsHeld;

    if ((hadActivity && !hasPendingProtectedBuys) || allTargetsHeld) {
      await savePaperBucketState({
        bucket,
        lastRebalanceDate: tradeDate,
      });
      result.lastRebalanceDate = tradeDate;
      result.nextRebalanceDate = shiftTradeDateLabel(
        tradeDate,
        ETF_MOMENTUM_REBALANCE_DAYS,
      );
    } else if (hasPendingProtectedBuys) {
      result.reason = '部分目标因买入执行保护暂缓，下一轮盘中监听继续尝试';
      result.nextRebalanceDate = nextTradeDate;
    } else {
      result.reason =
        '调仓日但未成交（盘口价异常、预算不足或无法凑足 100 股整手）';
      result.nextRebalanceDate = nextTradeDate;
    }
    const equity = await saveEquitySnapshot(tradeDate, bucket);
    result.equity = { totalValue: equity.totalValue, returnPct: equity.returnPct };
    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    return result;
  }
}

function roundMoney(value: number): number {
  return Number(value.toFixed(2));
}

export async function runEtfTPlusPaperPipeline(options?: {
  force?: boolean;
}): Promise<EtfPaperPipelineResult> {
  const tradeDate = formatTradeDate();
  const now = getBeijingNow();
  const nextTradeDate = getNextTradeDateLabel(now);

  if (!options?.force && !isWeekday(now)) {
    return {
      bucket: ETF_T_PLUS_BUCKET,
      tradeDate,
      nextTradeDate,
      skipped: true,
      reason: '周末非交易日',
    };
  }
  if (!options?.force && !isEtfTPlusRunWindow(now)) {
    return {
      bucket: ETF_T_PLUS_BUCKET,
      tradeDate,
      nextTradeDate,
      skipped: true,
      reason: '非 ETF 正T监听窗口（A 股交易时段）',
    };
  }

  const result: EtfPaperPipelineResult = {
    bucket: ETF_T_PLUS_BUCKET,
    tradeDate,
    nextTradeDate,
    tPlusTrades: [],
    tPlusEntries: [],
    tPlusSkips: [],
  };

  try {
    const summary = await getPaperAccountSummary(ETF_T_PLUS_BUCKET);
    if (summary.positions.length === 0) {
      const equity = await saveEquitySnapshot(tradeDate, ETF_T_PLUS_BUCKET);
      return {
        ...result,
        skipped: true,
        reason: 'ETF 正T仓暂无底仓，请先执行 etf-t-plus-init 同步一次',
        equity: { totalValue: equity.totalValue, returnPct: equity.returnPct },
      };
    }

    const todayTrades = (await listPaperTrades(200, ETF_T_PLUS_BUCKET)).filter(
      (trade) =>
        trade.tradeDate === tradeDate && trade.note?.includes(ETF_T_PLUS_INTRADAY_NOTE_MARK),
    );
    const pendingBySymbol = new Map<
      string,
      { symbol: string; name: string; shares: number; buyPrice: number }
    >();
    const completedSymbols = new Set<string>();
    const entrySymbols = new Set<string>();
    for (const trade of todayTrades) {
      if (trade.side === 'buy') {
        entrySymbols.add(trade.symbol);
        const current = pendingBySymbol.get(trade.symbol);
        pendingBySymbol.set(trade.symbol, {
          symbol: trade.symbol,
          name: trade.name,
          shares: (current?.shares ?? 0) + trade.shares,
          buyPrice:
            ((current?.buyPrice ?? 0) * (current?.shares ?? 0) + trade.price * trade.shares) /
            ((current?.shares ?? 0) + trade.shares),
        });
      } else {
        completedSymbols.add(trade.symbol);
        const current = pendingBySymbol.get(trade.symbol);
        if (!current) continue;
        const remaining = current.shares - trade.shares;
        if (remaining > 0) {
          pendingBySymbol.set(trade.symbol, { ...current, shares: remaining });
        } else {
          pendingBySymbol.delete(trade.symbol);
        }
      }
    }
    let entriesToday = entrySymbols.size;

    const quoteMap = await fetchIntradayQuotes(summary.positions.map((pos) => pos.symbol));

    for (const pos of summary.positions) {
      const quote = quoteMap.get(pos.symbol);
      if (!quote || quote.prevClose <= 0 || quote.low <= 0 || quote.price <= 0) {
        result.tPlusSkips?.push({
          symbol: pos.symbol,
          name: pos.name,
          reason: '缺少有效盘中行情',
        });
        continue;
      }

      const pending = pendingBySymbol.get(pos.symbol);
      if (pending) {
        const sellExecution = await resolvePaperExecutionPrice(pos.symbol, 'sell');
        const sellPrice = sellExecution.price;
        const reboundPct = ((sellPrice - pending.buyPrice) / pending.buyPrice) * 100;
        if (reboundPct < ETF_T_PLUS_MIN_PROFIT_PCT) {
          result.tPlusSkips?.push({
            symbol: pos.symbol,
            name: pos.name,
            reason: `待卖仓当前反弹 ${roundPct(reboundPct).toFixed(2)}% 未达 ${ETF_T_PLUS_MIN_PROFIT_PCT}%`,
            reboundPct: roundPct(reboundPct),
          });
          continue;
        }

        const available = await getAvailableShares(pos.symbol, tradeDate, ETF_T_PLUS_BUCKET);
        const shares = roundToLot(Math.min(pending.shares, available));
        if (shares < 100) {
          result.tPlusSkips?.push({
            symbol: pos.symbol,
            name: pos.name,
            reason: '待卖旧底仓可卖份额不足 100 份',
            reboundPct: roundPct(reboundPct),
          });
          continue;
        }

        const buyCost = calcEtfBuyCost({ price: pending.buyPrice, shares });
        const sellProceeds = calcEtfSellProceeds({
          price: sellPrice,
          shares,
          commissionRate: ETF_COMMISSION_RATE,
          slippageRate: 0,
        });
        const profit = sellProceeds.netProceeds - buyCost.totalCost;
        if (profit <= 0) {
          result.tPlusSkips?.push({
            symbol: pos.symbol,
            name: pos.name,
            reason: '扣除交易成本后待卖利润不为正',
            reboundPct: roundPct(reboundPct),
          });
          continue;
        }

        const noteBase = [
          ETF_T_PLUS_INTRADAY_NOTE_MARK,
          `待卖买价=${pending.buyPrice.toFixed(3)}`,
          `当前卖价=${sellPrice.toFixed(3)}`,
          `预计利润=${roundMoney(profit).toFixed(2)}`,
        ].join(' · ');

        await executePaperTrade({
          bucket: ETF_T_PLUS_BUCKET,
          symbol: pos.symbol,
          name: pos.name,
          side: 'sell',
          shares,
          price: sellPrice,
          tradeDate,
          source: 'auto',
          note: `${noteBase} · 正T卖出旧底仓（监听成交）`,
          skipSessionCheck: true,
          useOrderBookPrice: false,
          priceIncludesSpread: true,
        });

        result.tPlusTrades?.push({
          symbol: pos.symbol,
          name: pos.name,
          shares,
          buyPrice: pending.buyPrice,
          sellPrice,
          profit: roundMoney(profit),
          dipPct: roundPct(((pending.buyPrice - quote.prevClose) / quote.prevClose) * 100),
          reboundPct: roundPct(reboundPct),
        });
        continue;
      }

      if (completedSymbols.has(pos.symbol) || entrySymbols.has(pos.symbol)) continue;
      if (entriesToday >= ETF_T_PLUS_MAX_TRADES_PER_DAY) break;

      const triggerPrice = quote.prevClose * (1 - ETF_T_PLUS_BUY_DIP_PCT / 100);
      const buyExecution = await resolvePaperExecutionPrice(pos.symbol, 'buy');
      const buyPrice = buyExecution.price;
      const dipPct = ((buyPrice - quote.prevClose) / quote.prevClose) * 100;
      if (buyPrice > triggerPrice) {
        result.tPlusSkips?.push({
          symbol: pos.symbol,
          name: pos.name,
          reason: `当前买价未触发 -${ETF_T_PLUS_BUY_DIP_PCT}% 低吸线`,
          dipPct: roundPct(dipPct),
        });
        continue;
      }

      const available = await getAvailableShares(pos.symbol, tradeDate, ETF_T_PLUS_BUCKET);
      const maxSellableShares = roundToLot(available);
      if (maxSellableShares < 100) {
        result.tPlusSkips?.push({
          symbol: pos.symbol,
          name: pos.name,
          reason: '旧底仓可卖份额不足 100 份',
          dipPct: roundPct(dipPct),
        });
        continue;
      }

      const budget = Math.min(
        summary.account.cash,
        (pos.marketValue ?? pos.shares * quote.price) * ETF_T_PLUS_BUDGET_PCT,
      );
      const buyLots = calcEtfBuyLotsByBudget({
        budget,
        price: buyPrice,
      });
      let shares = Math.min(buyLots?.shares ?? 0, maxSellableShares);
      shares = roundToLot(shares);
      if (shares < 100) {
        result.tPlusSkips?.push({
          symbol: pos.symbol,
          name: pos.name,
          reason: '正T预算不足 100 份整手',
          dipPct: roundPct(dipPct),
        });
        continue;
      }

      const noteBase = [
        ETF_T_PLUS_INTRADAY_NOTE_MARK,
        `低吸线=${triggerPrice.toFixed(3)}`,
        `当前买价=${buyPrice.toFixed(3)}`,
        `当前跌幅=${roundPct(dipPct).toFixed(2)}%`,
        `待卖利润线=${(buyPrice * (1 + ETF_T_PLUS_MIN_PROFIT_PCT / 100)).toFixed(3)}`,
      ].join(' · ');

      await executePaperTrade({
        bucket: ETF_T_PLUS_BUCKET,
        symbol: pos.symbol,
        name: pos.name,
        side: 'buy',
        shares,
        price: buyPrice,
        tradeDate,
        source: 'auto',
        note: `${noteBase} · 正T买入待卖（监听成交）`,
        skipSessionCheck: true,
        useOrderBookPrice: false,
        priceIncludesSpread: true,
      });

      result.tPlusEntries?.push({
        symbol: pos.symbol,
        name: pos.name,
        shares,
        buyPrice,
        dipPct: roundPct(dipPct),
      });
      entrySymbols.add(pos.symbol);
      entriesToday += 1;
    }

    if ((result.tPlusTrades?.length ?? 0) === 0 && (result.tPlusEntries?.length ?? 0) === 0) {
      result.reason =
        result.tPlusSkips && result.tPlusSkips.length > 0
          ? result.tPlusSkips.map((item) => `${item.name}:${item.reason}`).join('；')
          : '未出现正T机会';
    }

    const equity = await saveEquitySnapshot(tradeDate, ETF_T_PLUS_BUCKET);
    result.equity = { totalValue: equity.totalValue, returnPct: equity.returnPct };
    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    return result;
  }
}

/** 将 ETF 仓超仓持仓降至轻仓试探规模（管理修正，非正常交易） */
export async function rebalanceEtfToProbePosition(): Promise<{
  adjusted: Array<{
    symbol: string;
    name: string;
    beforeShares: number;
    targetShares: number;
    soldShares: number;
    price: number;
  }>;
  summary: Awaited<ReturnType<typeof getPaperAccountSummary>>;
}> {
  const summary = await getPaperAccountSummary('etf');
  const adjusted: Array<{
    symbol: string;
    name: string;
    beforeShares: number;
    targetShares: number;
    soldShares: number;
    price: number;
  }> = [];

  for (const pos of summary.positions) {
    const execution = await resolvePaperExecutionPrice(pos.symbol, 'sell');
    const targetShares = calcEtfProbeTargetShares({
      totalEquity: summary.totalValue,
      deployableScale: 1,
      price: execution.price,
    });
    const excess = roundToLot(pos.shares - targetShares);
    if (excess < 100) continue;

    await executePaperTrade({
      bucket: 'etf',
      symbol: pos.symbol,
      name: pos.name,
      side: 'sell',
      shares: excess,
      price: execution.price,
      source: 'manual',
      note: '仓位修正：超仓降至轻仓试探（约 25%）',
      skipSessionCheck: true,
      skipT1Check: true,
      useOrderBookPrice: false,
      priceIncludesSpread: true,
    });

    adjusted.push({
      symbol: pos.symbol,
      name: pos.name,
      beforeShares: pos.shares,
      targetShares,
      soldShares: excess,
      price: execution.price,
    });
  }

  return {
    adjusted,
    summary: await getPaperAccountSummary('etf'),
  };
}

export async function getEtfPaperAutoStatus() {
  const summary = await getPaperAccountSummary('etf');
  const state = await getPaperBucketState('etf');
  const recentTrades = await listPaperTrades(20, 'etf');
  const tradeDate = formatTradeDate();
  return {
    summary,
    bucketState: state,
    recentTrades,
    nextTradeDate: getNextTradeDateLabel(),
    nextRebalanceDate: resolveNextEtfRebalanceDate({
      lastRebalanceDate: state.lastRebalanceDate,
      tradeDate,
    }),
    strategy: 'etf-stable-v2',
    topN: ETF_MOMENTUM_TOP_N,
    rebalanceDays: ETF_MOMENTUM_REBALANCE_DAYS,
  };
}

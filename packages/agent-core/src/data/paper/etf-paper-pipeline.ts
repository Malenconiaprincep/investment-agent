import 'dotenv/config';

import { buildEtfMomentumLivePlan } from '../backtest/etf-momentum.js';
import { resolvePaperExecutionPrice } from '../market/free/orderbook-quote.js';
import { getDailyQuote } from '../market/services.js';
import {
  ETF_MOMENTUM_REBALANCE_DAYS,
  ETF_MOMENTUM_STOP_COOLDOWN_DAYS,
  ETF_MOMENTUM_STOP_LOSS_PCT,
  ETF_MOMENTUM_TOP_N,
} from './bucket.js';
import {
  executePaperTrade,
  getAvailableShares,
  getPaperAccountSummary,
  getPaperBucketState,
  listPaperPositions,
  listPaperTrades,
  saveEquitySnapshot,
  savePaperBucketState,
} from './store.js';
import {
  formatTradeDate,
  getBeijingNow,
  isPostMarketWindow,
  isWeekday,
  roundToLot,
} from './trading-calendar.js';

export type EtfPaperPipelineResult = {
  tradeDate: string;
  skipped?: boolean;
  reason?: string;
  isRebalanceDay?: boolean;
  stopLosses?: Array<{ symbol: string; name: string; shares: number; price: number }>;
  sells?: Array<{ symbol: string; name: string; shares: number; price: number }>;
  buys?: Array<{ symbol: string; name: string; shares: number; price: number }>;
  targets?: Array<{ symbol: string; name: string; isBenchmarkFill: boolean }>;
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
}): number {
  const deployable = input.totalEquity * input.deployableScale;
  const slotBudget = deployable / ETF_MOMENTUM_TOP_N;
  if (slotBudget <= 0 || input.price <= 0) return 0;
  return roundToLot(Math.floor(slotBudget / input.price));
}

async function autoStopLossEtfPositions(tradeDate: string) {
  const stops: EtfPaperPipelineResult['stopLosses'] = [];
  const positions = await listPaperPositions('etf');
  const state = await getPaperBucketState('etf');
  const cooldownUntil = { ...state.cooldownUntil };

  for (const pos of positions) {
    try {
      const execution = await resolvePaperExecutionPrice(pos.symbol, 'sell');
      const returnPct = ((execution.price - pos.avgCost) / pos.avgCost) * 100;
      if (returnPct > ETF_MOMENTUM_STOP_LOSS_PCT) continue;

      const available = await getAvailableShares(pos.symbol, tradeDate, 'etf');
      const shares = roundToLot(available);
      if (shares < 100) continue;

      await executePaperTrade({
        bucket: 'etf',
        symbol: pos.symbol,
        name: pos.name,
        side: 'sell',
        shares,
        price: execution.price,
        tradeDate,
        source: 'auto',
        note: `ETF 动量止损 ${returnPct.toFixed(2)}%`,
        skipSessionCheck: true,
        useOrderBookPrice: false,
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

  await savePaperBucketState({ bucket: 'etf', cooldownUntil });
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
}): Promise<EtfPaperPipelineResult> {
  const tradeDate = formatTradeDate();
  const now = getBeijingNow();

  if (!options?.force && !isWeekday(now)) {
    return { tradeDate, skipped: true, reason: '周末非交易日' };
  }
  if (!options?.force && !isPostMarketWindow(now)) {
    return {
      tradeDate,
      skipped: true,
      reason: '非收盘后窗口（ETF 调仓应在 15:05 后执行）',
    };
  }

  const result: EtfPaperPipelineResult = { tradeDate };

  try {
    const benchmark = await getDailyQuote('510300', 120);
    const benchmarkDates = benchmark.quotes.map((bar) => bar.tradeDate);
    result.stopLosses = await autoStopLossEtfPositions(tradeDate);

    const bucketState = await getPaperBucketState('etf');
    const daysSinceRebalance = countTradingDaysSince(
      bucketState.lastRebalanceDate,
      tradeDate,
      benchmarkDates,
    );
    const isRebalanceDay =
      bucketState.lastRebalanceDate == null
      || daysSinceRebalance >= ETF_MOMENTUM_REBALANCE_DAYS;
    result.isRebalanceDay = isRebalanceDay;

    if (!isRebalanceDay) {
      const equity = await saveEquitySnapshot(tradeDate, 'etf');
      result.equity = { totalValue: equity.totalValue, returnPct: equity.returnPct };
      return result;
    }

    const excludedSymbols = buildCooldownExclusions(
      bucketState.cooldownUntil,
      tradeDate,
      benchmarkDates,
    );
    const plan = await buildEtfMomentumLivePlan({ tradeDate, excludedSymbols });
    result.targets = plan.targets;

    const summary = await getPaperAccountSummary('etf');
    const targetSymbols = new Set(plan.targets.map((item) => item.symbol));
    const sells: NonNullable<EtfPaperPipelineResult['sells']> = [];
    const buys: NonNullable<EtfPaperPipelineResult['buys']> = [];

    for (const pos of summary.positions) {
      if (targetSymbols.has(pos.symbol)) continue;
      const available = await getAvailableShares(pos.symbol, tradeDate, 'etf');
      const shares = roundToLot(available);
      if (shares < 100) continue;
      const execution = await resolvePaperExecutionPrice(pos.symbol, 'sell');
      await executePaperTrade({
        bucket: 'etf',
        symbol: pos.symbol,
        name: pos.name,
        side: 'sell',
        shares,
        price: execution.price,
        tradeDate,
        source: 'auto',
        note: 'ETF 动量调仓卖出',
        skipSessionCheck: true,
        useOrderBookPrice: false,
      });
      sells.push({
        symbol: pos.symbol,
        name: pos.name,
        shares,
        price: execution.price,
      });
    }

    const refreshed = await getPaperAccountSummary('etf');
    const held = new Set(refreshed.positions.map((item) => item.symbol));

    for (const target of plan.targets) {
      if (held.has(target.symbol)) continue;
      const execution = await resolvePaperExecutionPrice(target.symbol, 'buy');
      const shares = calcEtfSlotShares({
        totalEquity: refreshed.totalValue,
        deployableScale: plan.regimeExposureScale,
        price: execution.price,
      });
      if (shares < 100) continue;
      if (execution.price * shares > refreshed.account.cash) continue;

      await executePaperTrade({
        bucket: 'etf',
        symbol: target.symbol,
        name: target.name,
        side: 'buy',
        shares,
        price: execution.price,
        tradeDate,
        source: 'auto',
        note: target.isBenchmarkFill ? 'ETF 动量调仓买入（宽基槽位）' : 'ETF 动量调仓买入',
        skipSessionCheck: true,
        useOrderBookPrice: false,
      });
      buys.push({
        symbol: target.symbol,
        name: target.name,
        shares,
        price: execution.price,
      });
    }

    await savePaperBucketState({
      bucket: 'etf',
      lastRebalanceDate: tradeDate,
    });

    result.sells = sells;
    result.buys = buys;
    const equity = await saveEquitySnapshot(tradeDate, 'etf');
    result.equity = { totalValue: equity.totalValue, returnPct: equity.returnPct };
    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    return result;
  }
}

export async function getEtfPaperAutoStatus() {
  const summary = await getPaperAccountSummary('etf');
  const state = await getPaperBucketState('etf');
  const recentTrades = await listPaperTrades(20, 'etf');
  return {
    summary,
    bucketState: state,
    recentTrades,
    strategy: 'etf-momentum-rotation',
    topN: ETF_MOMENTUM_TOP_N,
    rebalanceDays: ETF_MOMENTUM_REBALANCE_DAYS,
  };
}

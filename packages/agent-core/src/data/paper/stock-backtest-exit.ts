import {
  calcStockStrategyHoldMetrics,
  evaluateStockStrategyPaperExit,
} from '../backtest/diamond.js';
import { getDailyQuote } from '../market/services.js';
import { resolvePaperExecutionPrice } from '../market/free/orderbook-quote.js';
import type { StockBacktestPaperBucket } from './bucket.js';
import { STOCK_BACKTEST_BUCKETS } from './bucket.js';
import {
  executePaperTrade,
  getPaperAccountSummary,
  getPositionMeta,
  listPaperPositions,
  updateHighWaterMark,
} from './store.js';
import { formatTradeDate, getBeijingNow, isTradingSession } from './trading-calendar.js';

export type StockBacktestExitMonitorResult = {
  tradeDate: string;
  skipped?: boolean;
  reason?: string;
  sells: Array<{ bucket: StockBacktestPaperBucket; symbol: string; name: string; shares: number; price: number; reason: string }>;
};

async function autoSellStrategyExits(input: {
  bucket: StockBacktestPaperBucket;
  tradeDate: string;
  requireSession: boolean;
  useLivePrice: boolean;
}): Promise<StockBacktestExitMonitorResult['sells']> {
  const sells: StockBacktestExitMonitorResult['sells'] = [];
  const positions = await listPaperPositions(input.bucket);

  for (const pos of positions) {
    try {
      const meta = await getPositionMeta(pos.symbol, input.bucket);
      if (!meta?.entryDate) continue;

      const kline = await getDailyQuote(pos.symbol, 60);
      const metrics = calcStockStrategyHoldMetrics({
        symbol: pos.symbol,
        name: pos.name,
        bars: kline.quotes,
        entryTradeDate: meta.entryDate,
        asOfTradeDate: input.tradeDate,
      });
      if (!metrics) continue;

      let markPrice = kline.latestClose;
      if (input.useLivePrice) {
        try {
          const execution = await resolvePaperExecutionPrice(pos.symbol, 'sell');
          markPrice = execution.price;
        } catch {
          // fallback to daily close
        }
      }
      if (markPrice == null) continue;

      await updateHighWaterMark(pos.symbol, markPrice, input.bucket);
      const refreshedMeta = await getPositionMeta(pos.symbol, input.bucket);
      const exit = evaluateStockStrategyPaperExit({
        avgCost: pos.avgCost,
        close: markPrice,
        ma5: metrics.ma5,
        ma20: metrics.ma20,
        highWaterMark: refreshedMeta?.highWaterMark ?? null,
        diamondStrength: metrics.diamondStrength,
        holdDays: metrics.holdDays,
        weakSignalDays: metrics.weakSignalDays,
      });
      if (!exit) continue;

      const summary = await getPaperAccountSummary(input.bucket);
      const held = summary.positions.find((p) => p.symbol === pos.symbol);
      const available = held?.availableShares ?? 0;
      if (available < 100) continue;

      if (input.requireSession && !isTradingSession()) continue;

      const execution = await resolvePaperExecutionPrice(pos.symbol, 'sell');
      const shares = Math.floor(available / 100) * 100;
      await executePaperTrade({
        bucket: input.bucket,
        symbol: pos.symbol,
        name: pos.name,
        side: 'sell',
        shares,
        price: execution.price,
        tradeDate: input.tradeDate,
        source: 'auto',
        note: `回测策略监控出场：${exit.reason} · 成交价=${execution.priceSource}`,
        skipSessionCheck: !input.requireSession,
        useOrderBookPrice: false,
      });

      sells.push({
        bucket: input.bucket,
        symbol: pos.symbol,
        name: pos.name,
        shares,
        price: execution.price,
        reason: exit.reason,
      });
    } catch {
      // skip per symbol
    }
  }

  return sells;
}

export async function runStockBacktestPaperExitMonitor(options?: {
  requireSession?: boolean;
  useLivePrice?: boolean;
}): Promise<StockBacktestExitMonitorResult> {
  const tradeDate = formatTradeDate(getBeijingNow());
  const requireSession = options?.requireSession ?? true;
  const useLivePrice = options?.useLivePrice ?? requireSession;

  if (requireSession && !isTradingSession()) {
    return { tradeDate, skipped: true, reason: '非交易时段', sells: [] };
  }

  const sells: StockBacktestExitMonitorResult['sells'] = [];
  for (const bucket of STOCK_BACKTEST_BUCKETS) {
    sells.push(
      ...(await autoSellStrategyExits({
        bucket,
        tradeDate,
        requireSession,
        useLivePrice,
      })),
    );
  }

  return { tradeDate, sells };
}

/** @deprecated 使用 runStockBacktestPaperExitMonitor */
export async function runStockBacktestNewsExitMonitor(options?: {
  requireSession?: boolean;
  useLivePrice?: boolean;
}): Promise<StockBacktestExitMonitorResult> {
  return runStockBacktestPaperExitMonitor(options);
}

/** @deprecated 使用 runStockBacktestPaperExitMonitor */
export async function runStockBacktestExitMonitor(options?: {
  requireSession?: boolean;
  useLivePrice?: boolean;
}): Promise<StockBacktestExitMonitorResult> {
  return runStockBacktestPaperExitMonitor(options);
}

export { autoSellStrategyExits };

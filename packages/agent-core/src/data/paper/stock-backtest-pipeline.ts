import 'dotenv/config';

import {
  formatTradeDateKey,
  normalizeTradeDateKey,
} from '../backtest/date-range.js';
import {
  scanStockStrategyEntriesForDate,
  type StockStrategyEntryCandidate,
} from '../backtest/diamond.js';
import { isRetailTradableStock } from '../market/asset-type.js';
import { getDailyQuote } from '../market/services.js';
import { resolvePaperExecutionPrice } from '../market/free/orderbook-quote.js';
import type { StockBacktestPaperBucket } from './bucket.js';
import { BUCKET_LABELS } from './bucket.js';
import { checkMarketDataFreshness } from './market-data-freshness.js';
import { autoSellStrategyExits } from './stock-backtest-exit.js';
import {
  calcAutoBuyShares,
  executePaperTrade,
  finishAutoRun,
  getLatestAutoRunForDate,
  getLatestAutoRun,
  getPaperAccountSummary,
  listPaperPositions,
  saveEquitySnapshot,
  startAutoRun,
  updateHighWaterMark,
} from './store.js';
import {
  formatTradeDate,
  getBeijingNow,
  getExpectedMarketDataDate,
  isPreMarketMorningWindow,
  isPostMarketWindow,
} from './trading-calendar.js';

export type StockBacktestPaperResult = {
  bucket: StockBacktestPaperBucket;
  tradeDate: string;
  skipped?: boolean;
  reason?: string;
  dataFreshness?: ReturnType<typeof checkMarketDataFreshness>;
  scan?: {
    scanned: number;
    rawSignals: number;
    candidates: number;
  };
  trades?: {
    buys: Array<{ symbol: string; name: string; shares: number; price: number; memo: string }>;
    sells: Array<{ symbol: string; name: string; shares: number; price: number; reason: string }>;
  };
  equity?: {
    totalValue: number;
    returnPct: number;
  };
  error?: string;
};

async function refreshPositionMarks(
  bucket: StockBacktestPaperBucket,
  positions: Array<{ symbol: string }>,
) {
  for (const pos of positions) {
    try {
      const q = await getDailyQuote(pos.symbol, 2);
      if (q.latestClose != null) {
        await updateHighWaterMark(pos.symbol, q.latestClose, bucket);
      }
    } catch {
      // skip
    }
  }
}

async function autoSellExits(
  bucket: StockBacktestPaperBucket,
  tradeDate: string,
  options: { requireSession?: boolean; useLivePrice?: boolean } = {},
) {
  return autoSellStrategyExits({
    bucket,
    tradeDate,
    requireSession: options.requireSession ?? false,
    useLivePrice: options.useLivePrice ?? false,
  });
}

async function autoBuyCandidates(input: {
  bucket: StockBacktestPaperBucket;
  tradeDate: string;
  candidates: StockStrategyEntryCandidate[];
  useOrderBook: boolean;
}): Promise<NonNullable<StockBacktestPaperResult['trades']>['buys']> {
  const buys: NonNullable<StockBacktestPaperResult['trades']>['buys'] = [];
  const summary = await getPaperAccountSummary(input.bucket);
  const held = new Set(summary.positions.map((p) => p.symbol));

  for (const candidate of input.candidates) {
    if (!isRetailTradableStock(candidate.symbol)) continue;
    if (held.has(candidate.symbol)) continue;
    if (summary.positions.length + buys.length >= 5) break;

    try {
      const execution = input.useOrderBook
        ? await resolvePaperExecutionPrice(candidate.symbol, 'buy')
        : { price: candidate.entryPrice, priceSource: 'csv-close' as const };
      const price = execution.price;
      const shares = calcAutoBuyShares(summary.account.cash, price);
      if (shares < 100) continue;

      await executePaperTrade({
        bucket: input.bucket,
        symbol: candidate.symbol,
        name: candidate.name,
        side: 'buy',
        shares,
        price,
        tradeDate: input.tradeDate,
        source: 'auto',
        note: `回测策略：${input.bucket === 'stock-backtest-news' ? '策略+新闻' : '纯策略'} · 成交价=${execution.priceSource}`,
        entryMemo: candidate.memo,
        skipSessionCheck: true,
        useOrderBookPrice: false,
      });

      buys.push({
        symbol: candidate.symbol,
        name: candidate.name,
        shares,
        price,
        memo: candidate.memo,
      });
      summary.account.cash -= shares * price;
      held.add(candidate.symbol);
    } catch {
      // skip
    }
  }

  return buys;
}

async function runStockBacktestBucketPipeline(input: {
  bucket: StockBacktestPaperBucket;
  mode: 'entry_close' | 'preopen';
  newsFilter: 'off' | 'avoid_bearish';
  force?: boolean;
  dedupeDaily?: boolean;
  useLatestDataDate?: boolean;
  requirePostMarket?: boolean;
  requirePreMarket?: boolean;
}): Promise<StockBacktestPaperResult> {
  const now = getBeijingNow();
  const dataFreshness = checkMarketDataFreshness(now);
  const calendarTradeDate = formatTradeDate(now);
  const tradeDate =
    input.useLatestDataDate && dataFreshness.latestDataDate
      ? formatTradeDateKey(dataFreshness.latestDataDate)
      : calendarTradeDate;
  const bucketLabel = BUCKET_LABELS[input.bucket];
  const canUseLatestDataDateOutsidePostMarket =
    input.useLatestDataDate &&
    !dataFreshness.isTradingDay &&
    dataFreshness.latestDataDate != null &&
    normalizeTradeDateKey(dataFreshness.latestDataDate) >=
      normalizeTradeDateKey(dataFreshness.expectedDataDate);

  if (!input.force && !input.useLatestDataDate && !dataFreshness.isTradingDay) {
    return {
      bucket: input.bucket,
      tradeDate,
      skipped: true,
      reason: '非交易日',
      dataFreshness,
    };
  }

  if (
    !input.force &&
    input.requirePostMarket &&
    !isPostMarketWindow(now) &&
    !canUseLatestDataDateOutsidePostMarket
  ) {
    return {
      bucket: input.bucket,
      tradeDate,
      skipped: true,
      reason: '非收盘后窗口（回测策略仓应在数据更新后运行）',
      dataFreshness,
    };
  }

  if (!input.force && input.requirePreMarket && !isPreMarketMorningWindow(now)) {
    return {
      bucket: input.bucket,
      tradeDate,
      skipped: true,
      reason: '非早盘窗口（回测策略仓应在交易日前 08:00 左右运行买入）',
      dataFreshness,
    };
  }

  if (!input.force && !dataFreshness.isFresh) {
    return {
      bucket: input.bucket,
      tradeDate,
      skipped: true,
      reason: dataFreshness.reminder ?? '行情数据未更新',
      dataFreshness,
    };
  }

  if (input.dedupeDaily) {
    const latestRun = await getLatestAutoRunForDate(tradeDate, input.bucket);
    if (latestRun?.status === 'running') {
      return {
        bucket: input.bucket,
        tradeDate,
        skipped: true,
        reason: `${bucketLabel}今日检查正在执行中，不重复启动`,
        dataFreshness,
      };
    }
    if (latestRun?.status === 'ok') {
      return {
        bucket: input.bucket,
        tradeDate,
        skipped: true,
        reason: `${bucketLabel}今日已执行过回测策略检查，不重复交易`,
        dataFreshness,
        scan: latestRun.summary?.scan as StockBacktestPaperResult['scan'],
        trades: latestRun.summary?.trades as StockBacktestPaperResult['trades'],
        equity: latestRun.summary?.equity as StockBacktestPaperResult['equity'],
      };
    }
  }

  const runId = await startAutoRun(tradeDate, input.bucket);
  const result: StockBacktestPaperResult = { bucket: input.bucket, tradeDate, dataFreshness };

  try {
    await refreshPositionMarks(input.bucket, await listPaperPositions(input.bucket));

    const entryTradeDate =
      input.mode === 'preopen'
        ? tradeDate
        : input.useLatestDataDate
          ? tradeDate
          : getExpectedMarketDataDate(now);

    const exitSells =
      input.mode === 'preopen'
        ? []
        : await autoSellExits(input.bucket, tradeDate, {
            requireSession: false,
            useLivePrice: false,
          });

    const scan = await scanStockStrategyEntriesForDate({
      entryTradeDate,
      mode: input.mode,
      newsFilter: input.newsFilter,
    });
    result.scan = {
      scanned: scan.scanned,
      rawSignals: scan.rawSignals,
      candidates: scan.candidates.length,
    };

    const buys = await autoBuyCandidates({
      bucket: input.bucket,
      tradeDate,
      candidates: scan.candidates,
      useOrderBook: input.mode === 'preopen',
    });

    result.trades = {
      buys,
      sells: exitSells.map(({ symbol, name, shares, price, reason }) => ({
        symbol,
        name,
        shares,
        price,
        reason,
      })),
    };
    const equity = await saveEquitySnapshot(tradeDate, input.bucket);
    result.equity = { totalValue: equity.totalValue, returnPct: equity.returnPct };

    await finishAutoRun(runId, 'ok', {
      ...(result as Record<string, unknown>),
      bucketLabel,
    });
    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    await finishAutoRun(runId, 'error', result as Record<string, unknown>);
    return result;
  }
}

export async function runStockBacktestPaperPipeline(options?: {
  force?: boolean;
}): Promise<StockBacktestPaperResult> {
  return runStockBacktestBucketPipeline({
    bucket: 'stock-backtest',
    mode: 'preopen',
    newsFilter: 'off',
    force: options?.force,
    requirePreMarket: !options?.force,
  });
}

export async function runStockBacktestPaperManualCheck(options?: {
  force?: boolean;
}): Promise<StockBacktestPaperResult> {
  return runStockBacktestBucketPipeline({
    bucket: 'stock-backtest',
    mode: 'entry_close',
    newsFilter: 'off',
    force: options?.force,
    dedupeDaily: true,
    useLatestDataDate: true,
    requirePostMarket: !options?.force,
  });
}

export async function runStockBacktestNewsPaperPipeline(options?: {
  force?: boolean;
}): Promise<StockBacktestPaperResult> {
  return runStockBacktestBucketPipeline({
    bucket: 'stock-backtest-news',
    mode: 'preopen',
    newsFilter: 'avoid_bearish',
    force: options?.force,
    requirePreMarket: !options?.force,
  });
}

export async function getStockBacktestPaperStatus() {
  const latest = await getLatestAutoRun();
  const freshness = checkMarketDataFreshness();
  return { latestRun: latest, dataFreshness: freshness };
}

export { checkMarketDataFreshness };

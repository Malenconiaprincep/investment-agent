import {
  getPaperDualSummary,
  executePaperTrade,
  listPaperTrades,
  listEquitySnapshots,
  setPaperBucketCapital,
  clonePaperBucket,
} from '../data/paper/store.js';
import type { PaperBucket } from '../data/paper/bucket.js';
import { PAPER_BUCKETS, parsePaperBucket } from '../data/paper/bucket.js';

function parsePaperArgs(args: string[]): { bucket?: PaperBucket; rest: string[] } {
  let bucket: PaperBucket | undefined;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--bucket' && args[i + 1]) {
      const value = args[++i];
      bucket = parsePaperBucket(value) ?? undefined;
      continue;
    }
    if (args[i] === '--force') continue;
    rest.push(args[i]);
  }
  return { bucket, rest };
}

export async function dispatchPaper(args: string[]): Promise<string> {
  const command = args[0];
  const { bucket, rest } = parsePaperArgs(args.slice(1));

  if (command === 'account') {
    return JSON.stringify(await getPaperDualSummary());
  }

  if (command === 'trades') {
    const limit = Number(rest[0] ?? 100);
    return JSON.stringify({ trades: await listPaperTrades(limit, bucket) });
  }

  if (command === 'equity') {
    const limit = Number(rest[0] ?? 90);
    return JSON.stringify({ snapshots: await listEquitySnapshots(limit, bucket) });
  }

  if (command === 'set-capital') {
    const targetEquity = Number(rest[0] ?? 100_000);
    const buckets: PaperBucket[] = bucket ? [bucket] : [...PAPER_BUCKETS];
    return JSON.stringify({
      results: await Promise.all(
        buckets.map((item) =>
          setPaperBucketCapital({
            bucket: item,
            targetEquity,
          }),
        ),
      ),
    });
  }

  if (command === 'status') {
    const { getPaperAutoStatus } = await import('../data/paper/auto-pipeline.js');
    return JSON.stringify(await getPaperAutoStatus());
  }

  if (command === 'auto-run') {
    const { runPaperAutoPipeline } = await import('../data/paper/auto-pipeline.js');
    const force = args.includes('--force');
    return JSON.stringify(await runPaperAutoPipeline({ force }));
  }

  if (command === 'stock-auto-run') {
    const { runStockPaperAutoPipeline } = await import('../data/paper/auto-pipeline.js');
    const { notifyStockPaper } = await import('../data/notify/feishu-daily.js');
    const force = args.includes('--force');
    const result = await runStockPaperAutoPipeline({ force });
    await notifyStockPaper(result);
    return JSON.stringify(result);
  }

  if (command === 'stock-backtest-auto-run') {
    const { runStockBacktestPaperPipeline } = await import(
      '../data/paper/stock-backtest-pipeline.js'
    );
    const { notifyStockBacktestPaper } = await import('../data/notify/feishu-daily.js');
    const force = args.includes('--force');
    const result = await runStockBacktestPaperPipeline({ force });
    await notifyStockBacktestPaper(result);
    return JSON.stringify(result);
  }

  if (command === 'stock-backtest-manual-check') {
    const { runStockBacktestPaperManualCheck } = await import(
      '../data/paper/stock-backtest-pipeline.js'
    );
    const force = args.includes('--force');
    const result = await runStockBacktestPaperManualCheck({ force });
    return JSON.stringify(result);
  }

  if (command === 'stock-backtest-news-auto-run') {
    const { runStockBacktestNewsPaperPipeline } = await import(
      '../data/paper/stock-backtest-pipeline.js'
    );
    const { notifyStockBacktestPaper } = await import('../data/notify/feishu-daily.js');
    const force = args.includes('--force');
    const result = await runStockBacktestNewsPaperPipeline({ force });
    await notifyStockBacktestPaper(result);
    return JSON.stringify(result);
  }

  if (command === 'market-data-status') {
    const { checkMarketDataFreshness } = await import(
      '../data/paper/market-data-freshness.js'
    );
    return JSON.stringify(checkMarketDataFreshness());
  }

  if (command === 'etf-observation') {
    const { buildEtfObservationReport } = await import(
      '../data/paper/etf-observation.js'
    );
    return JSON.stringify(
      await buildEtfObservationReport({ persist: args.includes('--snapshot') }),
    );
  }

  if (command === 'etf-auto-run') {
    const { runEtfPaperAutoPipeline } = await import('../data/paper/etf-paper-pipeline.js');
    const { notifyEtfPaperMonitor } = await import('../data/notify/feishu-daily.js');
    const force = args.includes('--force');
    const result = await runEtfPaperAutoPipeline({ force });
    await notifyEtfPaperMonitor(result);
    return JSON.stringify(result);
  }

  if (command === 'etf-t-plus-init') {
    return JSON.stringify(
      await clonePaperBucket({
        source: 'etf',
        target: 'etf-t-plus',
        overwrite: args.includes('--force'),
      }),
    );
  }

  if (command === 'etf-t-plus-auto-run') {
    const { runEtfTPlusPaperPipeline } = await import(
      '../data/paper/etf-paper-pipeline.js'
    );
    const { notifyEtfPaperMonitor } = await import('../data/notify/feishu-daily.js');
    const force = args.includes('--force');
    const result = await runEtfTPlusPaperPipeline({ force });
    await notifyEtfPaperMonitor(result);
    return JSON.stringify(result);
  }

  if (command === 'fix-etf-probe') {
    const { rebalanceEtfToProbePosition } = await import(
      '../data/paper/etf-paper-pipeline.js'
    );
    return JSON.stringify(await rebalanceEtfToProbePosition());
  }

  if (command === 'trade') {
    const side = rest[0] as 'buy' | 'sell';
    const symbol = rest[1];
    const name = rest[2];
    const shares = Number(rest[3]);
    const priceArg = rest[4];
    const tradeBucket = bucket ?? 'stock';

    if (!side || !symbol || !name || !shares) {
      throw new Error(
        'Usage: trade <buy|sell> <symbol> <name> <shares> [price] [--bucket etf|etf-t-plus|stock]',
      );
    }

    const manualPrice =
      priceArg && Number.isFinite(Number(priceArg)) ? Number(priceArg) : undefined;

    return JSON.stringify(
      await executePaperTrade({
        bucket: tradeBucket,
        symbol,
        name,
        side,
        shares,
        price: manualPrice,
        useOrderBookPrice: manualPrice == null,
        source: 'manual',
      }),
    );
  }

  throw new Error(
    'Usage: account|trades|equity|set-capital [amount] [--bucket etf|etf-t-plus|stock|stock-backtest|stock-backtest-news]|status|auto-run|stock-auto-run|stock-backtest-auto-run|stock-backtest-manual-check|stock-backtest-news-auto-run|market-data-status|etf-observation [--snapshot]|etf-auto-run|etf-t-plus-init [--force]|etf-t-plus-auto-run|fix-etf-probe|trade ...',
  );
}

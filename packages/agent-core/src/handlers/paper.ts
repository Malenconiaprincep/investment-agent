import {
  getPaperAccountSummary,
  executePaperTrade,
  listPaperTrades,
  listEquitySnapshots,
} from '../data/paper/store.js';
import { getDailyQuote } from '../data/market/services.js';

export async function dispatchPaper(args: string[]): Promise<string> {
  const command = args[0];

  if (command === 'account') {
    return JSON.stringify(await getPaperAccountSummary());
  }

  if (command === 'trades') {
    const limit = Number(args[1] ?? 100);
    return JSON.stringify({ trades: await listPaperTrades(limit) });
  }

  if (command === 'equity') {
    const limit = Number(args[1] ?? 90);
    return JSON.stringify({ snapshots: await listEquitySnapshots(limit) });
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

  if (command === 'trade') {
    const side = args[1] as 'buy' | 'sell';
    const symbol = args[2];
    const name = args[3];
    const shares = Number(args[4]);
    const priceArg = args[5];

    if (!side || !symbol || !name || !shares) {
      throw new Error('Usage: trade <buy|sell> <symbol> <name> <shares> [price]');
    }

    let price = priceArg ? Number(priceArg) : null;
    if (price == null || !Number.isFinite(price)) {
      const q = await getDailyQuote(symbol, 2);
      price = q.latestClose;
    }
    if (price == null) throw new Error('无法获取最新价');

    return JSON.stringify(
      await executePaperTrade({
        symbol,
        name,
        side,
        shares,
        price,
        source: 'manual',
      }),
    );
  }

  throw new Error('Usage: account|trades|equity|status|auto-run|trade ...');
}

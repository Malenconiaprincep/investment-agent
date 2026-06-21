import 'dotenv/config';

import {
  getPaperAccountSummary,
  executePaperTrade,
  listPaperTrades,
  listEquitySnapshots,
} from '../data/paper/store.js';
import {
  getPaperAutoStatus,
  runPaperAutoPipeline,
} from '../data/paper/auto-pipeline.js';
import { getDailyQuote } from '../data/market/services.js';

async function main() {
  const command = process.argv[2];

  if (command === 'account') {
    process.stdout.write(JSON.stringify(await getPaperAccountSummary()));
    return;
  }

  if (command === 'trades') {
    const limit = Number(process.argv[3] ?? 100);
    process.stdout.write(JSON.stringify({ trades: await listPaperTrades(limit) }));
    return;
  }

  if (command === 'equity') {
    const limit = Number(process.argv[3] ?? 90);
    process.stdout.write(JSON.stringify({ snapshots: await listEquitySnapshots(limit) }));
    return;
  }

  if (command === 'status') {
    process.stdout.write(JSON.stringify(await getPaperAutoStatus()));
    return;
  }

  if (command === 'auto-run') {
    const force = process.argv.includes('--force');
    const result = await runPaperAutoPipeline({ force });
    process.stdout.write(JSON.stringify(result));
    return;
  }

  if (command === 'trade') {
    const side = process.argv[3] as 'buy' | 'sell';
    const symbol = process.argv[4];
    const name = process.argv[5];
    const shares = Number(process.argv[6]);
    const priceArg = process.argv[7];

    if (!side || !symbol || !name || !shares) {
      process.stderr.write(
        'Usage: paper-json.ts trade <buy|sell> <symbol> <name> <shares> [price]',
      );
      process.exit(1);
    }

    let price = priceArg ? Number(priceArg) : null;
    if (price == null || !Number.isFinite(price)) {
      const q = await getDailyQuote(symbol, 2);
      price = q.latestClose;
    }
    if (price == null) {
      process.stderr.write('无法获取最新价');
      process.exit(1);
    }

    const result = await executePaperTrade({
      symbol,
      name,
      side,
      shares,
      price,
      source: 'manual',
    });
    process.stdout.write(JSON.stringify(result));
    return;
  }

  process.stderr.write(
    'Usage: paper-json.ts account|trades|equity|status|auto-run|trade ...',
  );
  process.exit(1);
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

import 'dotenv/config';

import { getDailyQuote } from '../data/market/services.js';
import {
  executePaperTrade,
  getOrCreatePaperAccount,
  listPaperPositions,
  listPaperTrades,
} from '../data/paper/store.js';

async function main() {
  const command = process.argv[2];

  if (command === 'account') {
    const account = await getOrCreatePaperAccount();
    const positions = await listPaperPositions();
    let totalValue = account.cash;

    const enriched = [];
    for (const pos of positions) {
      let latestPrice: number | null = null;
      try {
        const q = await getDailyQuote(pos.symbol, 2);
        latestPrice = q.latestClose;
      } catch {
        latestPrice = pos.avgCost;
      }
      const marketValue = latestPrice ? pos.shares * latestPrice : null;
      if (marketValue) totalValue += marketValue;
      const pnlPct =
        latestPrice && pos.avgCost > 0
          ? Number((((latestPrice - pos.avgCost) / pos.avgCost) * 100).toFixed(2))
          : null;
      enriched.push({ ...pos, latestPrice, marketValue, pnlPct });
    }

    process.stdout.write(
      JSON.stringify({
        account,
        totalValue: Number(totalValue.toFixed(2)),
        returnPct: Number(
          (((totalValue - account.initialCash) / account.initialCash) * 100).toFixed(2),
        ),
        positions: enriched,
      }),
    );
    return;
  }

  if (command === 'trades') {
    process.stdout.write(JSON.stringify(await listPaperTrades()));
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
    });
    process.stdout.write(JSON.stringify(result));
    return;
  }

  process.stderr.write('Usage: paper-json.ts account|trades|trade ...');
  process.exit(1);
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

import 'dotenv/config';

import { formatTradeDate, getBeijingNow } from '../data/paper/trading-calendar.js';
import { runStockIntradayScan } from '../data/paper/stock-intraday-scan.js';
import { notifyStockIntradayCandidates } from '../data/notify/feishu-realtime.js';

async function main() {
  const tradeDate = formatTradeDate(getBeijingNow());
  const push = process.argv.includes('--push');
  const result = await runStockIntradayScan({
    tradeDate,
    force: true,
    marketOpen: true,
  });

  let pushed = 0;
  if (push) {
    pushed = await notifyStockIntradayCandidates({
      tradeDate,
      candidates: result.candidates,
    });
  }

  console.log(
    JSON.stringify(
      {
        ...result,
        feishuPushed: pushed,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

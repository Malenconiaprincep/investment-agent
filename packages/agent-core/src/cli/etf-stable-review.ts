import '../config/load-env.js';

import { generateEtfStableWeeklyReview } from '../data/etf/stable-review.js';

async function main() {
  const review = await generateEtfStableWeeklyReview();
  process.stdout.write(`${JSON.stringify(review, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});

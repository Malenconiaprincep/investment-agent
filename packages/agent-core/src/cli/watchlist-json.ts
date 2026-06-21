import 'dotenv/config';

import { dispatchWatchlist } from '../handlers/watchlist.js';

async function main() {
  const out = await dispatchWatchlist(process.argv.slice(2));
  process.stdout.write(out);
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

import 'dotenv/config';

import { dispatchBacktest } from '../handlers/backtest.js';

async function main() {
  const out = await dispatchBacktest(process.argv.slice(2));
  process.stdout.write(out);
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

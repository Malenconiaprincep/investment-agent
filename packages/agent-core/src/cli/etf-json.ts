import 'dotenv/config';

import { dispatchEtf } from '../handlers/etf.js';

async function main() {
  const out = await dispatchEtf(process.argv.slice(2));
  process.stdout.write(out);
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

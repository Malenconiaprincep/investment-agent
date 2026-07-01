import 'dotenv/config';

import { dispatchWorkSummary } from '../handlers/work-summary.js';

async function main() {
  const out = await dispatchWorkSummary(process.argv.slice(2));
  process.stdout.write(out);
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

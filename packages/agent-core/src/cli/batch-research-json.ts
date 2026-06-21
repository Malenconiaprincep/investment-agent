import 'dotenv/config';

import { dispatchBatchResearch } from '../handlers/batch-research.js';

async function main() {
  const out = await dispatchBatchResearch(process.argv.slice(2));
  process.stdout.write(out);
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

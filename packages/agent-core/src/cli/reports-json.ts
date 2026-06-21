import 'dotenv/config';

import { dispatchReports } from '../handlers/reports.js';

async function main() {
  const out = await dispatchReports(process.argv.slice(2));
  process.stdout.write(out);
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

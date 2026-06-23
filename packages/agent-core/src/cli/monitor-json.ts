import 'dotenv/config';

import { dispatchMonitor } from '../handlers/monitor.js';

async function main() {
  const out = await dispatchMonitor(process.argv.slice(2));
  process.stdout.write(out);
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

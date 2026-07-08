import '../config/load-env.js';

import { dispatchScreenings } from '../handlers/screenings.js';

async function main() {
  const out = await dispatchScreenings(process.argv.slice(2));
  process.stdout.write(out);
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

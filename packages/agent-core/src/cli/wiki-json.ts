import '../config/load-env.js';

import { dispatchWiki } from '../handlers/wiki.js';

async function main() {
  const out = await dispatchWiki(process.argv.slice(2));
  process.stdout.write(out);
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

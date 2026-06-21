import 'dotenv/config';

import { dispatchPaper } from '../handlers/paper.js';

async function main() {
  const out = await dispatchPaper(process.argv.slice(2));
  process.stdout.write(out);
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

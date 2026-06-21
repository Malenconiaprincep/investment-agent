import 'dotenv/config';

import { dispatchFeedback } from '../handlers/feedback.js';

async function main() {
  const out = await dispatchFeedback(process.argv.slice(2));
  process.stdout.write(out);
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

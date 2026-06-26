import 'dotenv/config';

import { dispatchNotify } from '../handlers/notify.js';

async function main() {
  const args = process.argv.slice(2);
  const stdout = await dispatchNotify(args.length > 0 ? args : ['test']);
  console.log(stdout);
  const parsed = JSON.parse(stdout) as { ok?: boolean };
  if (parsed.ok === false) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

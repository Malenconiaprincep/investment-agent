import 'dotenv/config';

import { runResearchWorkflow } from '../api/run-research-workflow.js';

async function main() {
  const symbol = process.argv[2];
  const query = process.argv.slice(2).join(' ').trim();

  const input = symbol && /^\d{6}$/.test(symbol)
    ? { symbol }
    : query
      ? { query }
      : { symbol: '600519' };

  const result = await runResearchWorkflow(input);
  process.stdout.write(JSON.stringify(result));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(message);
  process.exit(1);
});

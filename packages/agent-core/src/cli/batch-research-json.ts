import 'dotenv/config';

import { runResearchWorkflow } from '../api/run-research-workflow.js';

async function main() {
  const symbols = process.argv.slice(2).filter((item) => /^\d{6}$/.test(item));

  if (symbols.length === 0) {
    process.stderr.write('Usage: batch-research-json.ts <symbol...>');
    process.exit(1);
  }

  const results = [];

  for (const symbol of symbols.slice(0, 5)) {
    const started = Date.now();
    try {
      const output = await runResearchWorkflow({ symbol });
      results.push({
        symbol,
        name: output.name,
        passed: output.passed,
        reportId: output.reportId,
        elapsedMs: Date.now() - started,
      });
    } catch (error) {
      results.push({
        symbol,
        name: symbol,
        passed: false,
        error: error instanceof Error ? error.message : String(error),
        elapsedMs: Date.now() - started,
      });
    }
  }

  process.stdout.write(JSON.stringify({ results }));
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

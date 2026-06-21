import { runResearchWorkflow } from '../api/run-research-workflow.js';

export async function dispatchBatchResearch(args: string[]): Promise<string> {
  const symbols = args.filter((item) => /^\d{6}$/.test(item));
  if (symbols.length === 0) {
    throw new Error('Usage: batch-research <symbol...>');
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

  return JSON.stringify({ results });
}

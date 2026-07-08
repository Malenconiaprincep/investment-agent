import '../config/load-env.js';

import { runDataQualityHarness } from '../eval/data-quality-harness.js';

function readCsvArg(args: string[], name: string): string[] | undefined {
  const prefix = `--${name}=`;
  const raw = args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  if (!raw) return undefined;
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function readNumberArg(args: string[], name: string): number | undefined {
  const prefix = `--${name}=`;
  const raw = args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const report = runDataQualityHarness({
    etfSymbols: readCsvArg(args, 'etf'),
    stockSymbols: readCsvArg(args, 'stock'),
    lookbackDays: readNumberArg(args, 'lookback'),
    maxGapWeekdays: readNumberArg(args, 'max-gap-weekdays'),
    maxEtfMovePct: readNumberArg(args, 'max-etf-move-pct'),
    maxStockMovePct: readNumberArg(args, 'max-stock-move-pct'),
  });

  const compact = args.includes('--compact');
  process.stdout.write(JSON.stringify(report, null, compact ? 0 : 2));
  process.stdout.write('\n');

  if (!report.passed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.stderr.write('\n');
  process.exit(1);
});

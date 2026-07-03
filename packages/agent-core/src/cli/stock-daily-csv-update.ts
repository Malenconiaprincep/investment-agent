import 'dotenv/config';

import { updateStockDailyCsvPool } from '../data/market/local-csv/etf-daily-update.js';

function parseCsvList(value: string | undefined): string[] | undefined {
  const items = value
    ?.split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return items && items.length > 0 ? items : undefined;
}

function parseNumberArg(args: string[], name: string): number | undefined {
  const arg = args.find((item) => item.startsWith(`--${name}=`));
  if (!arg) return undefined;
  const parsed = Number(arg.split('=').slice(1).join('='));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseArgs(args: string[]) {
  const options: Parameters<typeof updateStockDailyCsvPool>[0] = {
    includeLocal: true,
    includeActive: true,
  };

  const days = parseNumberArg(args, 'days');
  if (days != null) options.days = days;

  const symbolsArg = args.find((item) => item.startsWith('--symbols='));
  const symbols = parseCsvList(symbolsArg?.split('=').slice(1).join('='));
  if (symbols) options.symbols = symbols;

  if (args.includes('--include-local')) options.includeLocal = true;
  if (args.includes('--no-include-local')) options.includeLocal = false;
  if (args.includes('--include-active')) options.includeActive = true;
  if (args.includes('--no-include-active')) options.includeActive = false;

  const maxSymbols = parseNumberArg(args, 'max');
  if (maxSymbols != null) options.maxSymbols = maxSymbols;
  const delayMs = parseNumberArg(args, 'delay-ms');
  if (delayMs != null) options.delayMs = delayMs;
  const retryCount = parseNumberArg(args, 'retries');
  if (retryCount != null) options.retryCount = retryCount;
  const retryRounds = parseNumberArg(args, 'retry-rounds');
  if (retryRounds != null) options.retryRounds = retryRounds;
  const retryRoundDelayMs = parseNumberArg(args, 'retry-round-delay-ms');
  if (retryRoundDelayMs != null) options.retryRoundDelayMs = retryRoundDelayMs;
  const timeoutMs = parseNumberArg(args, 'timeout-ms');
  if (timeoutMs != null) options.timeoutMs = timeoutMs;

  return options;
}

async function main() {
  const result = await updateStockDailyCsvPool(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

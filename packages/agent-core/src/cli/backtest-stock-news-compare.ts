import 'dotenv/config';

import {
  runStockNewsCompare,
  type StockNewsCompareInput,
} from '../data/backtest/stock-news-compare.js';
import type { BacktestSymbolInput } from '../data/backtest/diamond.js';

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseSymbols(raw: string | undefined): BacktestSymbolInput[] {
  if (!raw?.trim() || raw === 'all') return [];
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [symbol, name] = item.split(':');
      return {
        symbol: symbol.trim(),
        ...(name?.trim() ? { name: name.trim() } : {}),
      };
    });
}

function parseFlag(args: string[], flag: string): string | undefined {
  const arg = args.find((item) => item.startsWith(`${flag}=`));
  return arg?.split('=').slice(1).join('=').trim() || undefined;
}

function parseFlagInt(args: string[], flag: string): number | undefined {
  const raw = parseFlag(args, flag);
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : undefined;
}

function parseFlagNumber(args: string[], flag: string): number | undefined {
  const raw = parseFlag(args, flag);
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function parsePercentFlag(args: string[], flag: string): number | undefined {
  const value = parseFlagNumber(args, flag);
  if (value == null) return undefined;
  return value > 1 ? value / 100 : value;
}

function parseInput(args: string[]): StockNewsCompareInput {
  const symbols = parseSymbols(args[0]);
  const universe = args.includes('--universe=retail-stock')
    ? 'retail-stock'
    : undefined;

  if (!universe && symbols.length === 0) {
    throw new Error(
      'Usage: backtest-stock-news-compare <symbols|all> [days] [--universe=retail-stock] [--from=YYYY-MM-DD] [--to=YYYY-MM-DD] [--max-concurrent=N] [--news-lookback=N] [--capital=N] [--stop-loss=8] [--take-profit=20]',
    );
  }

  return {
    symbols,
    universe,
    days: parsePositiveInt(args[1], 365),
    startDate: parseFlag(args, '--from'),
    endDate: parseFlag(args, '--to'),
    initialCapital: parseFlagNumber(args, '--capital'),
    maxConcurrentPositions: parseFlagInt(args, '--max-concurrent'),
    newsLookbackDays: parseFlagInt(args, '--news-lookback'),
    stopLossPct: parsePercentFlag(args, '--stop-loss'),
    takeProfitPct: parsePercentFlag(args, '--take-profit'),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const result = await runStockNewsCompare(parseInput(args));
  const { runs: _runs, ...summary } = result;
  const output = args.includes('--include-runs') ? result : summary;
  process.stdout.write(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

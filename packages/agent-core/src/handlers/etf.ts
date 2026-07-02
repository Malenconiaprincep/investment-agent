import { runEtfTailPick } from '../data/etf/tail-picker.js';
import {
  runEtfMorningRadar,
  type EtfMorningRadarStage,
} from '../data/etf/morning-radar.js';
import {
  getLatestEtfTailPickRun,
  listEtfTailPickRuns,
} from '../data/etf/store.js';

export async function dispatchEtf(args: string[]): Promise<string> {
  const command = args[0];

  if (command === 'tail-pick') {
    const force = args.includes('--force');
    return JSON.stringify(await runEtfTailPick({ force }));
  }

  if (command === 'morning-radar') {
    const stageArg = args[1];
    const stage: EtfMorningRadarStage =
      stageArg === 'confirm' ? 'confirm' : 'open';
    return JSON.stringify(await runEtfMorningRadar({ stage }));
  }

  if (command === 'latest') {
    return JSON.stringify({ latest: await getLatestEtfTailPickRun() });
  }

  if (command === 'list') {
    const limit = Number(args[1] ?? 20);
    return JSON.stringify({ runs: await listEtfTailPickRuns(limit) });
  }

  if (command === 'update-daily-csv') {
    const options = parseDailyCsvArgs(args.slice(1));
    const { updateEtfDailyCsvPool } = await import(
      '../data/market/local-csv/etf-daily-update.js'
    );
    return JSON.stringify(await updateEtfDailyCsvPool(options));
  }

  if (command === 'update-stock-daily-csv') {
    const options = parseDailyCsvArgs(args.slice(1));
    const { updateStockDailyCsvPool } = await import(
      '../data/market/local-csv/etf-daily-update.js'
    );
    return JSON.stringify(await updateStockDailyCsvPool(options));
  }

  throw new Error(
    'Usage: tail-pick [--force]|morning-radar [open|confirm]|latest|list [limit]|update-daily-csv [--days=N] [--symbols=510300,512880] [--include-local|--no-include-local] [--max=N] [--delay-ms=N]|update-stock-daily-csv [--days=N] [--symbols=600519,300750] [--include-local|--no-include-local] [--include-active|--no-include-active] [--max=N] [--delay-ms=N]',
  );
}

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

function parseDailyCsvArgs(args: string[]): {
  days?: number;
  symbols?: string[];
  includeLocal?: boolean;
  includeActive?: boolean;
  maxSymbols?: number;
  delayMs?: number;
} {
  const options: {
    days?: number;
    symbols?: string[];
    includeLocal?: boolean;
    includeActive?: boolean;
    maxSymbols?: number;
    delayMs?: number;
  } = {};

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

  return options;
}

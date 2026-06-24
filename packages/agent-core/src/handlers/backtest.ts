import {
  runDiamondBacktest,
  type BacktestSymbolInput,
} from '../data/backtest/diamond.js';
import { runEtfTailRulesBacktest } from '../data/backtest/etf.js';
import { computeScreeningBacktest } from '../data/screening/backtest.js';
import { getScreeningSession } from '../data/screening/store.js';

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseHoldDays(value: string | undefined): number[] | undefined {
  if (!value) return undefined;
  const parsed = value
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item >= 0)
    .map(Math.floor);
  return parsed.length > 0 ? parsed : undefined;
}

function parseSymbols(raw: string | undefined): BacktestSymbolInput[] {
  if (!raw?.trim()) return [];
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

function parseMaxFailCount(args: string[]): number | undefined {
  const arg = args.find((item) => item.startsWith('--max-fail='));
  if (!arg) return undefined;
  const value = Number(arg.split('=')[1]);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}

function parseDateArg(args: string[], flag: string): string | undefined {
  const arg = args.find((item) => item.startsWith(`${flag}=`));
  const value = arg?.split('=').slice(1).join('=').trim();
  return value || undefined;
}

export async function dispatchBacktest(args: string[]): Promise<string> {
  const command = args[0];

  if (command === 'diamond' || command === 'diamond-momentum') {
    const symbols = parseSymbols(args[1]);
    if (symbols.length === 0) {
      throw new Error('请提供 symbols，例如: diamond 600519,000001 250 1,3,5');
    }

    return JSON.stringify(
      await runDiamondBacktest({
        symbols,
        strategy: command === 'diamond' ? 'red-diamond' : 'red-diamond-momentum',
        days: parsePositiveInt(args[2], 250),
        holdDays: parseHoldDays(args[3]),
      }),
    );
  }

  if (command === 'etf') {
    const startDate = parseDateArg(args, '--from');
    const endDate = parseDateArg(args, '--to');
    return JSON.stringify(
      await runEtfTailRulesBacktest({
        days: parsePositiveInt(args[1], 250),
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
        holdDays: parseHoldDays(args[2]),
        includeWaitPullback: args.includes('--include-wait-pullback'),
        maxFailCount: parseMaxFailCount(args),
      }),
    );
  }

  if (command === 'screening') {
    const id = args[1];
    if (!id) throw new Error('请提供 screening id');
    const session = await getScreeningSession(id);
    if (!session) throw new Error(`Screening session not found: ${id}`);
    const holdArg = args[2];
    const holdDays =
      !holdArg || holdArg === 'auto' || holdArg === '0' ? 0 : Number(holdArg);

    return JSON.stringify(
      await computeScreeningBacktest({
        screeningId: session.id,
        screenedAt: session.createdAt,
        candidates: session.candidates,
        holdDays: Number.isFinite(holdDays) && holdDays >= 0 ? holdDays : 0,
      }),
    );
  }

  throw new Error(
    'Usage: diamond <symbols> [days] [holdDaysCsv] | diamond-momentum <symbols> [days] | etf [days] [holdDaysCsv] [--include-wait-pullback] [--max-fail=N] | screening <id> [days]',
  );
}

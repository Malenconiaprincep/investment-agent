import {
  runDiamondBacktest,
  type BacktestSymbolInput,
} from '../data/backtest/diamond.js';
import { runEtfMomentumBacktest } from '../data/backtest/etf-momentum.js';
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

function parseExitMaxFailCount(args: string[]): number | undefined {
  const arg = args.find((item) => item.startsWith('--exit-max-fail='));
  if (!arg) return undefined;
  const value = Number(arg.split('=')[1]);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}

function parseMaxConcurrent(args: string[]): number | undefined {
  const arg = args.find((item) => item.startsWith('--max-concurrent='));
  if (!arg) return undefined;
  const value = Number(arg.split('=')[1]);
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : undefined;
}

function parseNewsFilter(args: string[]): 'off' | 'avoid_bearish' | 'require_bullish' | undefined {
  const arg = args.find((item) => item.startsWith('--news-filter='));
  const value = arg?.split('=')[1]?.trim();
  if (value === 'off' || value === 'avoid_bearish' || value === 'require_bullish') {
    return value;
  }
  return undefined;
}

function parseNewsLookback(args: string[]): number | undefined {
  const arg = args.find((item) => item.startsWith('--news-lookback='));
  if (!arg) return undefined;
  const value = Number(arg.split('=')[1]);
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : undefined;
}

function parseFlagInt(args: string[], flag: string): number | undefined {
  const arg = args.find((item) => item.startsWith(`${flag}=`));
  if (!arg) return undefined;
  const value = Number(arg.split('=').slice(1).join('='));
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : undefined;
}

function parseDateArg(args: string[], flag: string): string | undefined {
  const arg = args.find((item) => item.startsWith(`${flag}=`));
  const value = arg?.split('=').slice(1).join('=').trim();
  return value || undefined;
}

function parseStockUniverse(args: string[]): 'retail-stock' | undefined {
  const arg = args.find((item) => item.startsWith('--universe='));
  const value = arg?.split('=').slice(1).join('=').trim();
  return value === 'retail-stock' ? value : undefined;
}

export async function dispatchBacktest(args: string[]): Promise<string> {
  const command = args[0];

  if (command === 'stock' || command === 'diamond' || command === 'diamond-momentum') {
    const universe = parseStockUniverse(args);
    const symbols = parseSymbols(args[1]);
    if (!universe && symbols.length === 0) {
      throw new Error('请提供 symbols，例如: stock 600519,000001 250，或使用 --universe=retail-stock');
    }

    return JSON.stringify(
      await runDiamondBacktest({
        symbols,
        universe,
        strategy: command === 'diamond' ? 'red-diamond' : 'red-diamond-momentum',
        days: parsePositiveInt(args[2], 250),
        holdDays: parseHoldDays(args[3]),
        startDate: parseDateArg(args, '--from'),
        endDate: parseDateArg(args, '--to'),
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
        exitMaxFailCount: parseExitMaxFailCount(args),
        maxConcurrentPositions: parseMaxConcurrent(args),
        newsFilter: parseNewsFilter(args),
        newsLookbackDays: parseNewsLookback(args),
      }),
    );
  }

  if (command === 'etf-momentum') {
    const startDate = parseDateArg(args, '--from');
    const endDate = parseDateArg(args, '--to');
    return JSON.stringify(
      await runEtfMomentumBacktest({
        days: parsePositiveInt(args[1], 365),
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
        topN: parseFlagInt(args, '--top'),
        momentumDays: parseFlagInt(args, '--momentum'),
        rebalanceDays: parseFlagInt(args, '--rebalance'),
        trendMaDays: parseFlagInt(args, '--trend-ma'),
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
    'Usage: stock <symbols|all> [days] [--universe=retail-stock] [--from=YYYY-MM-DD] [--to=YYYY-MM-DD] | diamond <symbols|all> [days] [holdDaysCsv] [--universe=retail-stock] [--from=YYYY-MM-DD] [--to=YYYY-MM-DD] | diamond-momentum <symbols|all> [days] [--universe=retail-stock] [--from=YYYY-MM-DD] [--to=YYYY-MM-DD] | etf [days] [holdDaysCsv] [--include-wait-pullback] [--max-fail=N] [--exit-max-fail=N] [--max-concurrent=N] [--news-filter=avoid_bearish|require_bullish|off] [--news-lookback=N] | etf-momentum [days] [--top=N] [--momentum=N] [--rebalance=N] [--trend-ma=N] | screening <id> [days]',
  );
}

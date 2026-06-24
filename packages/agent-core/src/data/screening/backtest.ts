import { getDailyQuote } from '../market/services.js';
import { inferAssetType } from '../market/asset-type.js';

export type CandidateReturn = {
  symbol: string;
  name: string;
  assetType: 'stock' | 'etf';
  diamondStrength: 'red' | 'blue' | null;
  baselineDate: string | null;
  baselineClose: number | null;
  latestDate: string | null;
  latestClose: number | null;
  returnPct: number | null;
  holdDays: number;
  error?: string;
};

export type CandidateReturnGroup = {
  key: string;
  label: string;
  count: number;
  validCount: number;
  avgReturnPct: number | null;
  medianReturnPct: number | null;
  winRatePct: number | null;
  bestReturnPct: number | null;
  worstReturnPct: number | null;
};

export type ScreeningBacktestResult = {
  screeningId: string;
  screenedAt: string;
  /** 0 = 入选至今；>0 = 持有 N 个交易日 */
  holdDays: number;
  mode: 'to-today' | 'fixed';
  computedAt: string;
  candidates: CandidateReturn[];
  avgReturnPct: number | null;
  groups: CandidateReturnGroup[];
};

function parseTradeDate(tradeDate: string): Date {
  const y = tradeDate.slice(0, 4);
  const m = tradeDate.slice(4, 6);
  const d = tradeDate.slice(6, 8);
  return new Date(`${y}-${m}-${d}T00:00:00+08:00`);
}

function findBaselineQuote(
  quotes: Array<{ tradeDate: string; close: number | null }>,
  screenedAt: string,
) {
  const target = new Date(screenedAt).getTime();
  let best: (typeof quotes)[number] | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;

  for (const quote of quotes) {
    if (quote.close == null) continue;
    const delta = Math.abs(parseTradeDate(quote.tradeDate).getTime() - target);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = quote;
    }
  }

  return best;
}

function sortQuotesAsc(
  quotes: Array<{ tradeDate: string; close: number | null }>,
) {
  return [...quotes]
    .filter((quote) => quote.close != null)
    .sort(
      (a, b) =>
        parseTradeDate(a.tradeDate).getTime() -
        parseTradeDate(b.tradeDate).getTime(),
    );
}

function findHoldEndQuote(
  quotes: Array<{ tradeDate: string; close: number | null }>,
  baseline: { tradeDate: string; close: number | null },
  holdDays: number,
) {
  const sorted = sortQuotesAsc(quotes);
  const baselineIndex = sorted.findIndex(
    (quote) => quote.tradeDate === baseline.tradeDate,
  );
  if (baselineIndex < 0) return null;

  const endIndex = baselineIndex + holdDays;
  if (endIndex >= sorted.length) {
    return sorted.at(-1) ?? null;
  }

  return sorted[endIndex] ?? null;
}

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function summarizeCandidateReturns(
  key: string,
  label: string,
  candidates: CandidateReturn[],
): CandidateReturnGroup {
  const returns = candidates
    .map((item) => item.returnPct)
    .filter((value): value is number => value != null);
  const sorted = [...returns].sort((a, b) => a - b);
  const wins = returns.filter((value) => value > 0);
  const median =
    sorted.length === 0
      ? null
      : sorted.length % 2 === 1
        ? sorted[Math.floor(sorted.length / 2)]
        : round((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2);

  return {
    key,
    label,
    count: candidates.length,
    validCount: returns.length,
    avgReturnPct:
      returns.length > 0
        ? round(returns.reduce((sum, value) => sum + value, 0) / returns.length)
        : null,
    medianReturnPct: median,
    winRatePct: returns.length > 0 ? round((wins.length / returns.length) * 100) : null,
    bestReturnPct: returns.length > 0 ? round(Math.max(...returns)) : null,
    worstReturnPct: returns.length > 0 ? round(Math.min(...returns)) : null,
  };
}

function buildGroups(candidates: CandidateReturn[]): CandidateReturnGroup[] {
  const groups: Array<{
    key: string;
    label: string;
    predicate: (item: CandidateReturn) => boolean;
  }> = [
    { key: 'all', label: '全部候选', predicate: () => true },
    { key: 'stock', label: '股票候选', predicate: (item) => item.assetType === 'stock' },
    { key: 'etf', label: 'ETF 候选', predicate: (item) => item.assetType === 'etf' },
    {
      key: 'red-diamond',
      label: '红钻候选',
      predicate: (item) => item.diamondStrength === 'red',
    },
    {
      key: 'blue-diamond',
      label: '蓝钻候选',
      predicate: (item) => item.diamondStrength === 'blue',
    },
    {
      key: 'no-diamond',
      label: '无钻石候选',
      predicate: (item) => item.diamondStrength == null,
    },
  ];

  return groups.map((group) =>
    summarizeCandidateReturns(
      group.key,
      group.label,
      candidates.filter(group.predicate),
    ),
  );
}

/** 按选股日距今跨度估算需拉取的 K 线根数（上限 250） */
export function computeKlineDaysNeeded(
  screenedAt: string,
  holdDays = 0,
): number {
  const elapsedCalendarDays = Math.max(
    1,
    Math.ceil(
      (Date.now() - new Date(screenedAt).getTime()) / (24 * 60 * 60 * 1000),
    ),
  );
  const tradingEstimate = Math.ceil(elapsedCalendarDays * 5 / 7);
  return Math.min(Math.max(tradingEstimate + 15, holdDays + 15, 30), 250);
}

export async function computeScreeningBacktest(input: {
  screeningId: string;
  screenedAt: string;
  candidates: Array<{
    symbol: string;
    name: string;
    assetType?: 'stock' | 'etf';
    diamond?: { strength: 'red' | 'blue' } | null;
  }>;
  /** 0 或未传 = 入选至今；正整数 = 持有 N 个交易日 */
  holdDays?: number;
}): Promise<ScreeningBacktestResult> {
  const holdDays = input.holdDays ?? 0;
  const mode = holdDays > 0 ? 'fixed' : 'to-today';
  const klineDays = computeKlineDaysNeeded(input.screenedAt, holdDays);
  const results: CandidateReturn[] = [];

  for (const candidate of input.candidates) {
    try {
      const data = await getDailyQuote(candidate.symbol, klineDays);
      const assetType = candidate.assetType ?? inferAssetType(candidate.symbol);
      const diamondStrength = candidate.diamond?.strength ?? null;
      const baseline = findBaselineQuote(data.quotes, input.screenedAt);
      const baselineClose = baseline?.close ?? null;

      const endQuote =
        mode === 'to-today'
          ? {
              tradeDate: data.quotes[0]?.tradeDate ?? null,
              close: data.latestClose,
            }
          : baseline
            ? findHoldEndQuote(data.quotes, baseline, holdDays)
            : null;

      const latestClose = endQuote?.close ?? null;
      const latestDate = endQuote?.tradeDate ?? null;

      let returnPct: number | null = null;
      if (baselineClose != null && latestClose != null && baselineClose > 0) {
        returnPct = Number(
          (((latestClose - baselineClose) / baselineClose) * 100).toFixed(2),
        );
      }

      results.push({
        symbol: candidate.symbol,
        name: candidate.name,
        assetType,
        diamondStrength,
        baselineDate: baseline?.tradeDate ?? null,
        baselineClose,
        latestDate,
        latestClose,
        returnPct,
        holdDays: mode === 'fixed' ? holdDays : 0,
      });
    } catch (error) {
      results.push({
        symbol: candidate.symbol,
        name: candidate.name,
        assetType: candidate.assetType ?? inferAssetType(candidate.symbol),
        diamondStrength: candidate.diamond?.strength ?? null,
        baselineDate: null,
        baselineClose: null,
        latestDate: null,
        latestClose: null,
        returnPct: null,
        holdDays,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const validReturns = results
    .map((item) => item.returnPct)
    .filter((value): value is number => value != null);

  const avgReturnPct =
    validReturns.length > 0
      ? Number(
          (
            validReturns.reduce((sum, value) => sum + value, 0) /
            validReturns.length
          ).toFixed(2),
        )
      : null;

  return {
    screeningId: input.screeningId,
    screenedAt: input.screenedAt,
    holdDays,
    mode,
    computedAt: new Date().toISOString(),
    candidates: results,
    avgReturnPct,
    groups: buildGroups(results),
  };
}

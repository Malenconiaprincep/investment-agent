import { getDailyQuote } from '../market/services.js';

export type CandidateReturn = {
  symbol: string;
  name: string;
  baselineDate: string | null;
  baselineClose: number | null;
  latestClose: number | null;
  returnPct: number | null;
  holdDays: number;
  error?: string;
};

export type ScreeningBacktestResult = {
  screeningId: string;
  screenedAt: string;
  holdDays: number;
  computedAt: string;
  candidates: CandidateReturn[];
  avgReturnPct: number | null;
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

export async function computeScreeningBacktest(input: {
  screeningId: string;
  screenedAt: string;
  candidates: Array<{ symbol: string; name: string }>;
  holdDays?: number;
}): Promise<ScreeningBacktestResult> {
  const holdDays = input.holdDays ?? 5;
  const klineDays = Math.max(holdDays + 10, 30);
  const results: CandidateReturn[] = [];

  for (const candidate of input.candidates) {
    try {
      const data = await getDailyQuote(candidate.symbol, klineDays);
      const baseline = findBaselineQuote(data.quotes, input.screenedAt);
      const latestClose = data.latestClose;
      const baselineClose = baseline?.close ?? null;

      let returnPct: number | null = null;
      if (baselineClose != null && latestClose != null && baselineClose > 0) {
        returnPct = Number(
          (((latestClose - baselineClose) / baselineClose) * 100).toFixed(2),
        );
      }

      results.push({
        symbol: candidate.symbol,
        name: candidate.name,
        baselineDate: baseline?.tradeDate ?? null,
        baselineClose,
        latestClose,
        returnPct,
        holdDays,
      });
    } catch (error) {
      results.push({
        symbol: candidate.symbol,
        name: candidate.name,
        baselineDate: null,
        baselineClose: null,
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
    computedAt: new Date().toISOString(),
    candidates: results,
    avgReturnPct,
  };
}

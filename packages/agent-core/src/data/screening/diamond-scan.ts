import {
  scanDiamondSignalAtDate,
  type DiamondSignalResult,
} from '../market/diamond-signal.js';
import { saveDiamondSignal } from '../watchlist/store.js';

export type ScreeningCandidateDiamond = {
  strength: 'red' | 'blue';
  score: number;
  tradeDate: string;
  close: number;
  reasons: string[];
};

export type ScreeningCandidateWithDiamond = {
  symbol: string;
  name: string;
  thesis: string;
  dataSource: string;
  industry?: string | null;
  diamond?: ScreeningCandidateDiamond | null;
};

function toCandidateDiamond(
  signal: DiamondSignalResult,
): ScreeningCandidateDiamond {
  return {
    strength: signal.strength,
    score: signal.score,
    tradeDate: signal.tradeDate,
    close: signal.close,
    reasons: signal.reasons,
  };
}

function diamondRank(candidate: ScreeningCandidateWithDiamond): number {
  if (candidate.diamond?.strength === 'red') return 0;
  if (candidate.diamond?.strength === 'blue') return 1;
  return 2;
}

export function sortCandidatesByDiamond<T extends ScreeningCandidateWithDiamond>(
  candidates: T[],
): T[] {
  return [...candidates].sort((a, b) => {
    const rankDiff = diamondRank(a) - diamondRank(b);
    if (rankDiff !== 0) return rankDiff;
    return (b.diamond?.score ?? 0) - (a.diamond?.score ?? 0);
  });
}

export async function scanScreeningCandidatesDiamonds(input: {
  candidates: ScreeningCandidateWithDiamond[];
  asOfDate?: string;
  persist?: boolean;
}): Promise<{
  candidates: ScreeningCandidateWithDiamond[];
  diamondPicks: ScreeningCandidateWithDiamond[];
}> {
  const scanned: ScreeningCandidateWithDiamond[] = [];

  for (const candidate of input.candidates) {
    try {
      const signal = await scanDiamondSignalAtDate(
        candidate.symbol,
        candidate.name,
        input.asOfDate,
      );
      if (!signal) {
        scanned.push({ ...candidate, diamond: null });
        continue;
      }

      const diamond = toCandidateDiamond(signal);
      if (input.persist !== false) {
        await saveDiamondSignal({
          symbol: signal.symbol,
          name: signal.name,
          strength: signal.strength,
          score: signal.score,
          tradeDate: signal.tradeDate,
          close: signal.close,
          reasons: signal.reasons,
        }).catch(() => {});
      }

      scanned.push({ ...candidate, diamond });
    } catch {
      scanned.push({ ...candidate, diamond: null });
    }
  }

  const sorted = sortCandidatesByDiamond(scanned);
  const diamondPicks = sorted.filter((item) => item.diamond != null);

  return { candidates: sorted, diamondPicks };
}

import { isTradeSymbol } from '../market/asset-type.js';
import { fetchIntradayQuote } from '../market/free/intraday-quote.js';
import { getDailyQuote } from '../market/services.js';
import { addWatchlistItem } from '../watchlist/store.js';
import type { ScreeningSessionRecord } from './store.js';

export type ScreeningWatchlistGrade = 'A' | 'B' | 'C';

export type ScreeningWatchlistSyncItem = {
  symbol: string;
  name: string;
  assetType: 'stock' | 'etf';
  grade: ScreeningWatchlistGrade;
  reason: string;
};

export type ScreeningWatchlistSyncResult = {
  screeningId: string;
  added: ScreeningWatchlistSyncItem[];
  skipped: Array<{ symbol: string; name: string; reason: string }>;
  ranAt: string;
};

const DEFAULT_STOCK_LIMIT = 3;
const DEFAULT_ETF_LIMIT = 2;

function limitFromEnv(key: string, fallback: number): number {
  const raw = Number(process.env[key]);
  if (Number.isFinite(raw) && raw >= 0 && raw <= 10) return raw;
  return fallback;
}

export function gradeScreeningCandidate(
  candidate: ScreeningSessionRecord['candidates'][number],
): ScreeningWatchlistGrade {
  const score = candidate.factorScore?.total ?? 0;
  const outlook = candidate.factorScore?.outlook;
  const diamond = candidate.diamond?.strength;

  if (diamond === 'red' || outlook === 'mainline-trend' || score >= 65) {
    return 'A';
  }
  if (diamond === 'blue' || outlook === 'long-watch' || score >= 55) {
    return 'B';
  }
  return 'C';
}

function gradeLabel(grade: ScreeningWatchlistGrade): string {
  if (grade === 'A') return 'A 重点';
  if (grade === 'B') return 'B 升温';
  return 'C 跟踪';
}

function candidateRank(candidate: ScreeningSessionRecord['candidates'][number]): number {
  const grade = gradeScreeningCandidate(candidate);
  const gradeScore = grade === 'A' ? 3 : grade === 'B' ? 2 : 1;
  const factorScore = candidate.factorScore?.total ?? 0;
  const diamondScore =
    candidate.diamond?.strength === 'red'
      ? 25
      : candidate.diamond?.strength === 'blue'
        ? 12
        : 0;
  return gradeScore * 1000 + factorScore + diamondScore;
}

export function selectScreeningWatchlistCandidates(
  session: ScreeningSessionRecord,
  options?: {
    stockLimit?: number;
    etfLimit?: number;
  },
): ScreeningWatchlistSyncItem[] {
  const stockLimit =
    options?.stockLimit ?? limitFromEnv('SCREENING_WATCHLIST_STOCK_LIMIT', DEFAULT_STOCK_LIMIT);
  const etfLimit =
    options?.etfLimit ?? limitFromEnv('SCREENING_WATCHLIST_ETF_LIMIT', DEFAULT_ETF_LIMIT);

  const ranked = session.candidates
    .filter((candidate) => isTradeSymbol(candidate.symbol))
    .map((candidate) => ({
      candidate,
      assetType: candidate.assetType === 'etf' ? 'etf' as const : 'stock' as const,
      rank: candidateRank(candidate),
    }))
    .sort((a, b) => b.rank - a.rank);

  const picked: ScreeningWatchlistSyncItem[] = [];
  const counts = { stock: 0, etf: 0 };
  for (const item of ranked) {
    const limit = item.assetType === 'etf' ? etfLimit : stockLimit;
    if (counts[item.assetType] >= limit) continue;
    counts[item.assetType] += 1;

    const grade = gradeScreeningCandidate(item.candidate);
    const score = item.candidate.factorScore?.total;
    const outlook = item.candidate.factorScore?.outlookLabel;
    const diamond = item.candidate.diamond?.strength;
    const parts = [
      `${gradeLabel(grade)}：智能选股自动入池`,
      item.assetType === 'etf' ? 'ETF 观察' : '股票观察',
      score != null ? `因子 ${score} 分` : null,
      outlook ?? null,
      diamond ? `${diamond === 'red' ? '红钻' : '蓝钻'} ${item.candidate.diamond?.score ?? ''}`.trim() : null,
      item.candidate.thesis,
    ].filter(Boolean);

    picked.push({
      symbol: item.candidate.symbol,
      name: item.candidate.name,
      assetType: item.assetType,
      grade,
      reason: parts.join(' · ').slice(0, 120),
    });
  }

  return picked;
}

async function resolveEntryPrice(symbol: string): Promise<number | undefined> {
  const live = await fetchIntradayQuote(symbol).catch(() => null);
  if (live?.price != null && live.price > 0) return live.price;
  const quote = await getDailyQuote(symbol, 2).catch(() => null);
  return quote?.latestClose ?? undefined;
}

export async function syncScreeningSessionToWatchlist(
  session: ScreeningSessionRecord,
  options?: {
    stockLimit?: number;
    etfLimit?: number;
  },
): Promise<ScreeningWatchlistSyncResult> {
  const selected = selectScreeningWatchlistCandidates(session, options);
  const added: ScreeningWatchlistSyncItem[] = [];
  const skipped: ScreeningWatchlistSyncResult['skipped'] = [];

  for (const item of selected) {
    try {
      await addWatchlistItem({
        symbol: item.symbol,
        name: item.name,
        reason: item.reason,
        sourceType: 'screening',
        sourceId: session.id,
        entryPrice: await resolveEntryPrice(item.symbol),
        entryDate: session.createdAt.slice(0, 10),
      });
      added.push(item);
    } catch (error) {
      skipped.push({
        symbol: item.symbol,
        name: item.name,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    screeningId: session.id,
    added,
    skipped,
    ranAt: new Date().toISOString(),
  };
}

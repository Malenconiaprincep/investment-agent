import { fetchIntradayQuote } from '../market/free/intraday-quote.js';
import { isRetailTradableStock } from '../market/asset-type.js';
import { isLikelyLimitUp } from '../market/price-limit.js';
import { getScreeningSession, listScreeningSessions } from '../screening/store.js';
import { listWatchlistItems } from '../watchlist/store.js';
import { checkMomentumBuyReady } from '../paper/monitor-bridge.js';
import { listPaperPositions } from '../paper/store.js';

export type StockIntradayCandidate = {
  symbol: string;
  name: string;
  price: number | null;
  pctChg: number | null;
  memo: string;
  source: 'watchlist' | 'screening';
};

async function isBlockedByLimitUp(symbol: string, name: string): Promise<boolean> {
  try {
    const quote = await fetchIntradayQuote(symbol);
    if (
      quote &&
      isLikelyLimitUp({
        symbol,
        name: quote.name || name,
        pctChg: quote.pctChg,
        price: quote.price,
        prevClose: quote.prevClose,
      })
    ) {
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

async function collectScanUniverse(): Promise<
  Array<{ symbol: string; name: string; source: StockIntradayCandidate['source'] }>
> {
  const map = new Map<
    string,
    { symbol: string; name: string; source: StockIntradayCandidate['source'] }
  >();

  for (const item of await listWatchlistItems()) {
    map.set(item.symbol, {
      symbol: item.symbol,
      name: item.name,
      source: 'watchlist',
    });
  }

  const sessions = await listScreeningSessions({ limit: 1 });
  const latest = sessions[0]?.id
    ? await getScreeningSession(sessions[0].id)
    : null;
  for (const candidate of latest?.candidates ?? []) {
    const existing = map.get(candidate.symbol);
    if (existing) {
      existing.name = candidate.name;
    } else {
      map.set(candidate.symbol, {
        symbol: candidate.symbol,
        name: candidate.name,
        source: 'screening',
      });
    }
  }

  return [...map.values()];
}

/** 交易时段扫描：红钻 + 动量 checklist 达标，且未持仓 */
export async function scanStockIntradayBuyCandidates(): Promise<StockIntradayCandidate[]> {
  const held = new Set(
    (await listPaperPositions('stock')).map((position) => position.symbol),
  );
  const universe = await collectScanUniverse();
  const results: StockIntradayCandidate[] = [];

  for (const item of universe) {
    if (!isRetailTradableStock(item.symbol)) continue;
    if (held.has(item.symbol)) continue;

    try {
      if (await isBlockedByLimitUp(item.symbol, item.name)) continue;

      const momentum = await checkMomentumBuyReady(item.symbol, item.name);
      if (!momentum.ready) continue;

      const quote = await fetchIntradayQuote(item.symbol).catch(() => null);
      results.push({
        symbol: item.symbol,
        name: item.name,
        price: quote?.price ?? momentum.price ?? null,
        pctChg: quote?.pctChg ?? null,
        memo: momentum.memo,
        source: item.source,
      });
    } catch {
      // 单票失败不阻断
    }
  }

  return results;
}

export type StockIntradayScanResult = {
  tradeDate: string;
  scanned: number;
  candidates: StockIntradayCandidate[];
  skipped?: boolean;
  reason?: string;
};

export async function runStockIntradayScan(input: {
  tradeDate: string;
  force?: boolean;
  marketOpen?: boolean;
}): Promise<StockIntradayScanResult> {
  if (!input.force && input.marketOpen === false) {
    return {
      tradeDate: input.tradeDate,
      scanned: 0,
      candidates: [],
      skipped: true,
      reason: '非交易时段',
    };
  }

  const universe = await collectScanUniverse();
  const candidates = await scanStockIntradayBuyCandidates();
  return {
    tradeDate: input.tradeDate,
    scanned: universe.length,
    candidates,
  };
}

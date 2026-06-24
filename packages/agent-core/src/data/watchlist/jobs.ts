import { getDailyQuote } from '../market/services.js';
import { scanDiamondSignal } from '../market/diamond-signal.js';
import { purgeExpiredWatchlistItems } from './retention.js';
import {
  listWatchlistItems,
  saveDiamondSignal,
  saveWatchlistSnapshot,
} from './store.js';

export async function runDailyWatchlistSnapshot() {
  const purge = await purgeExpiredWatchlistItems();
  const items = await listWatchlistItems();
  const results = [];

  for (const item of items) {
    try {
      const quote = await getDailyQuote(item.symbol, 5);
      const latest = quote.quotes[0];
      if (!latest?.close) continue;

      let diamondStrength: 'red' | 'blue' | null = null;
      try {
        const signal = await scanDiamondSignal(item.symbol, item.name, 60);
        if (signal) {
          diamondStrength = signal.strength;
          await saveDiamondSignal({
            symbol: signal.symbol,
            name: signal.name,
            strength: signal.strength,
            score: signal.score,
            tradeDate: signal.tradeDate,
            close: signal.close,
            reasons: signal.reasons,
          });
        }
      } catch {
        // ignore diamond scan errors per symbol
      }

      const vsEntryPct =
        item.entryPrice && item.entryPrice > 0
          ? Number(
              (
                ((latest.close - item.entryPrice) / item.entryPrice) *
                100
              ).toFixed(2),
            )
          : null;

      await saveWatchlistSnapshot({
        watchlistId: item.id,
        symbol: item.symbol,
        tradeDate: latest.tradeDate,
        close: latest.close,
        pctChg: latest.pctChg,
        vsEntryPct,
        diamondStrength,
      });

      results.push({
        symbol: item.symbol,
        close: latest.close,
        pctChg: latest.pctChg,
        vsEntryPct,
        diamondStrength,
      });
    } catch (error) {
      results.push({
        symbol: item.symbol,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    count: items.length,
    results,
    purge,
    ranAt: new Date().toISOString(),
  };
}

export async function scanWatchlistDiamondSignals() {
  const items = await listWatchlistItems();
  const signals = [];

  for (const item of items) {
    try {
      const signal = await scanDiamondSignal(item.symbol, item.name, 60);
      if (!signal) continue;
      const saved = await saveDiamondSignal({
        symbol: signal.symbol,
        name: signal.name,
        strength: signal.strength,
        score: signal.score,
        tradeDate: signal.tradeDate,
        close: signal.close,
        reasons: signal.reasons,
      });
      signals.push(saved);
    } catch {
      // skip
    }
  }

  return { scanned: items.length, signals, ranAt: new Date().toISOString() };
}

export async function scanSymbolsDiamondSignals(
  symbols: Array<{ symbol: string; name: string }>,
) {
  const signals = [];
  for (const item of symbols.slice(0, 30)) {
    try {
      const signal = await scanDiamondSignal(item.symbol, item.name, 60);
      if (!signal) continue;
      const saved = await saveDiamondSignal({
        symbol: signal.symbol,
        name: signal.name,
        strength: signal.strength,
        score: signal.score,
        tradeDate: signal.tradeDate,
        close: signal.close,
        reasons: signal.reasons,
      });
      signals.push(saved);
    } catch {
      // skip
    }
  }
  return signals;
}

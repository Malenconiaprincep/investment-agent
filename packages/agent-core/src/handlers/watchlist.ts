import { getDailyQuote, getStockBasic } from '../data/market/services.js';
import {
  detectDiamondSignal,
  scanDiamondSignalHistory,
} from '../data/market/diamond-signal.js';
import { analyzeMomentum } from '../data/paper/momentum.js';
import {
  addWatchlistItem,
  getWatchlistItem,
  listDiamondSignals,
  listLatestSnapshots,
  listWatchlistItems,
  listWeeklyReviews,
  getWeeklyReview,
  removeWatchlistItem,
  listSnapshotsForSymbol,
} from '../data/watchlist/store.js';
import {
  runDailyWatchlistSnapshot,
  scanSymbolsDiamondSignals,
  scanWatchlistDiamondSignals,
} from '../data/watchlist/jobs.js';
import { generateWeeklyReview } from '../data/watchlist/weekly-review.js';
import { listScreeningSessions, getScreeningSession } from '../data/screening/store.js';

export async function dispatchWatchlist(args: string[]): Promise<string> {
  const command = args[0];

  if (command === 'list') {
    const items = await listWatchlistItems();
    const snapshots = await listLatestSnapshots();
    const snapMap = Object.fromEntries(snapshots.map((s) => [s.symbol, s]));
    return JSON.stringify(items.map((i) => ({ ...i, latest: snapMap[i.symbol] ?? null })));
  }

  if (command === 'add') {
    const symbol = args[1];
    const name = args[2];
    const reason = args[3];
    if (!symbol || !name) {
      throw new Error('Usage: add <symbol> <name> [reason]');
    }
    const quote = await getDailyQuote(symbol, 2).catch(() => null);
    const item = await addWatchlistItem({
      symbol,
      name,
      reason,
      entryPrice: quote?.latestClose ?? undefined,
      sourceType: 'manual',
    });
    return JSON.stringify(item);
  }

  if (command === 'remove' && args[1]) {
    await removeWatchlistItem(args[1]);
    return JSON.stringify({ ok: true });
  }

  if (command === 'get' && args[1]) {
    const item = await getWatchlistItem(args[1]);
    if (!item) throw new Error('Not found');
    const kline = await getDailyQuote(item.symbol, 120);
    const bars = kline.quotes.filter((q) => q.close != null);
    const snapshots = await listSnapshotsForSymbol(item.symbol, 30);
    let liveSignal = null;
    try {
      liveSignal = detectDiamondSignal(item.symbol, item.name, bars);
    } catch {
      liveSignal = null;
    }
    const diamondHistory = scanDiamondSignalHistory(item.symbol, item.name, bars, 120);
    const momentum = analyzeMomentum(item.symbol, item.name, bars, liveSignal);
    return JSON.stringify({ item, kline, snapshots, diamondSignal: liveSignal, diamondHistory, momentum });
  }

  if (command === 'kline' && args[1]) {
    const days = Number(args[2] ?? 120);
    const kline = await getDailyQuote(args[1], days);
    let diamondSignal = null;
    try {
      diamondSignal = detectDiamondSignal(args[1], args[1], kline.quotes);
    } catch {
      diamondSignal = null;
    }
    return JSON.stringify({ ...kline, diamondSignal });
  }

  if (command === 'stock-chart' && args[1]) {
    const symbol = args[1];
    const days = Number(args[2] ?? 120);
    const basic = await getStockBasic(symbol);
    const kline = await getDailyQuote(symbol, days);
    const bars = kline.quotes.filter((q) => q.close != null);
    const diamondHistory = scanDiamondSignalHistory(basic.symbol, basic.name, bars, days);
    let latestDiamond = null;
    try {
      latestDiamond = detectDiamondSignal(basic.symbol, basic.name, bars);
    } catch {
      latestDiamond = null;
    }
    const momentum = analyzeMomentum(basic.symbol, basic.name, bars, latestDiamond);
    return JSON.stringify({
      symbol: basic.symbol,
      name: basic.name,
      kline,
      diamondHistory,
      latestDiamond,
      momentum,
    });
  }

  if (command === 'snapshot-daily') {
    return JSON.stringify(await runDailyWatchlistSnapshot());
  }

  if (command === 'diamond-scan') {
    const mode = args[1] ?? 'watchlist';
    if (mode === 'watchlist') {
      return JSON.stringify(await scanWatchlistDiamondSignals());
    }
    if (mode === 'latest-screening') {
      const sessions = await listScreeningSessions({ limit: 1 });
      const sessionId = sessions[0]?.id;
      const full = sessionId ? await getScreeningSession(sessionId) : null;
      const symbols = (full?.candidates ?? []).map((c) => ({
        symbol: c.symbol,
        name: c.name,
      }));
      const signals = await scanSymbolsDiamondSignals(symbols);
      return JSON.stringify({ scanned: symbols.length, signals });
    }
    throw new Error('Usage: diamond-scan watchlist|latest-screening');
  }

  if (command === 'diamond-list') {
    const signals = await listDiamondSignals(Number(args[1] ?? 50));
    return JSON.stringify({ signals });
  }

  if (command === 'weekly-generate') {
    return JSON.stringify(await generateWeeklyReview());
  }

  if (command === 'weekly-list') {
    return JSON.stringify(await listWeeklyReviews());
  }

  if (command === 'weekly-get' && args[1]) {
    const review = await getWeeklyReview(args[1]);
    if (!review) throw new Error('Not found');
    return JSON.stringify(review);
  }

  if (command === 'today-summary') {
    const items = await listWatchlistItems();
    const snapshots = await listLatestSnapshots();
    return JSON.stringify({ items, snapshots, date: new Date().toISOString().slice(0, 10) });
  }

  throw new Error(
    'Usage: list|add|remove|get|kline|stock-chart|snapshot-daily|diamond-scan|diamond-list|weekly-generate|weekly-list|weekly-get|today-summary',
  );
}

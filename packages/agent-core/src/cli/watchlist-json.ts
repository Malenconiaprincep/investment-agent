import 'dotenv/config';

import { getDailyQuote } from '../data/market/services.js';
import { detectDiamondSignal } from '../data/market/diamond-signal.js';
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

async function main() {
  const command = process.argv[2];

  if (command === 'list') {
    const items = await listWatchlistItems();
    const snapshots = await listLatestSnapshots();
    const snapMap = Object.fromEntries(snapshots.map((s) => [s.symbol, s]));
    process.stdout.write(
      JSON.stringify(items.map((i) => ({ ...i, latest: snapMap[i.symbol] ?? null }))),
    );
    return;
  }

  if (command === 'add') {
    const symbol = process.argv[3];
    const name = process.argv[4];
    const reason = process.argv[5];
    if (!symbol || !name) {
      process.stderr.write('Usage: watchlist-json.ts add <symbol> <name> [reason]');
      process.exit(1);
    }
    const quote = await getDailyQuote(symbol, 2).catch(() => null);
    const item = await addWatchlistItem({
      symbol,
      name,
      reason,
      entryPrice: quote?.latestClose ?? undefined,
      sourceType: 'manual',
    });
    process.stdout.write(JSON.stringify(item));
    return;
  }

  if (command === 'remove' && process.argv[3]) {
    await removeWatchlistItem(process.argv[3]);
    process.stdout.write(JSON.stringify({ ok: true }));
    return;
  }

  if (command === 'get' && process.argv[3]) {
    const item = await getWatchlistItem(process.argv[3]);
    if (!item) {
      process.stderr.write('Not found');
      process.exit(1);
    }
    const kline = await getDailyQuote(item.symbol, 120);
    const snapshots = await listSnapshotsForSymbol(item.symbol, 30);
    let liveSignal = null;
    try {
      liveSignal = detectDiamondSignal(item.symbol, item.name, kline.quotes);
    } catch {
      liveSignal = null;
    }
    const momentum = analyzeMomentum(item.symbol, item.name, kline.quotes, liveSignal);
    process.stdout.write(
      JSON.stringify({ item, kline, snapshots, diamondSignal: liveSignal, momentum }),
    );
    return;
  }

  if (command === 'kline' && process.argv[3]) {
    const days = Number(process.argv[4] ?? 120);
    const kline = await getDailyQuote(process.argv[3], days);
    let diamondSignal = null;
    try {
      diamondSignal = detectDiamondSignal(
        process.argv[3],
        process.argv[3],
        kline.quotes,
      );
    } catch {
      diamondSignal = null;
    }
    process.stdout.write(JSON.stringify({ ...kline, diamondSignal }));
    return;
  }

  if (command === 'snapshot-daily') {
    const result = await runDailyWatchlistSnapshot();
    process.stdout.write(JSON.stringify(result));
    return;
  }

  if (command === 'diamond-scan') {
    const mode = process.argv[3] ?? 'watchlist';
    if (mode === 'watchlist') {
      const result = await scanWatchlistDiamondSignals();
      process.stdout.write(JSON.stringify(result));
      return;
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
      process.stdout.write(JSON.stringify({ scanned: symbols.length, signals }));
      return;
    }
    process.stderr.write('Usage: diamond-scan watchlist|latest-screening');
    process.exit(1);
  }

  if (command === 'diamond-list') {
    const signals = await listDiamondSignals(Number(process.argv[3] ?? 50));
    process.stdout.write(JSON.stringify({ signals }));
    return;
  }

  if (command === 'weekly-generate') {
    const review = await generateWeeklyReview();
    process.stdout.write(JSON.stringify(review));
    return;
  }

  if (command === 'weekly-list') {
    process.stdout.write(JSON.stringify(await listWeeklyReviews()));
    return;
  }

  if (command === 'weekly-get' && process.argv[3]) {
    const review = await getWeeklyReview(process.argv[3]);
    if (!review) {
      process.stderr.write('Not found');
      process.exit(1);
    }
    process.stdout.write(JSON.stringify(review));
    return;
  }

  if (command === 'today-summary') {
    const items = await listWatchlistItems();
    const snapshots = await listLatestSnapshots();
    process.stdout.write(JSON.stringify({ items, snapshots, date: new Date().toISOString().slice(0, 10) }));
    return;
  }

  process.stderr.write(
    'Usage: watchlist-json.ts list|add|remove|get|kline|snapshot-daily|diamond-scan|diamond-list|weekly-generate|weekly-list|weekly-get|today-summary',
  );
  process.exit(1);
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

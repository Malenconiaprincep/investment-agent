import { createClient, type Client } from '@libsql/client';
import { getPrimaryLibsqlOptions } from '../libsql-config.js';

export type WatchlistItem = {
  id: string;
  symbol: string;
  name: string;
  reason: string | null;
  sourceType: 'report' | 'screening' | 'manual' | 'signal' | null;
  sourceId: string | null;
  entryPrice: number | null;
  entryDate: string | null;
  active: boolean;
  createdAt: string;
};

export type WatchlistSnapshot = {
  id: string;
  watchlistId: string;
  symbol: string;
  tradeDate: string;
  close: number;
  pctChg: number | null;
  vsEntryPct: number | null;
  diamondStrength: 'red' | 'blue' | null;
  snapshotAt: string;
};

export type DiamondSignalRecord = {
  id: string;
  symbol: string;
  name: string;
  strength: 'red' | 'blue';
  score: number;
  tradeDate: string;
  close: number;
  reasons: string[];
  createdAt: string;
};

export type WeeklyReviewRecord = {
  id: string;
  weekStart: string;
  weekEnd: string;
  title: string;
  content: string;
  stats: {
    watchlistCount: number;
    avgReturnPct: number | null;
    bestSymbol: string | null;
    worstSymbol: string | null;
    diamondRedCount: number;
    diamondBlueCount: number;
  };
  createdAt: string;
};

let client: Client | null = null;
let migrated = false;

async function getDb(): Promise<Client> {
  if (!client) {
    client = createClient(getPrimaryLibsqlOptions());
  }

  if (!migrated) {
    await client.batch([
      `CREATE TABLE IF NOT EXISTS watchlist_items (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        name TEXT NOT NULL,
        reason TEXT,
        source_type TEXT,
        source_id TEXT,
        entry_price REAL,
        entry_date TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_watchlist_symbol ON watchlist_items(symbol)`,
      `CREATE TABLE IF NOT EXISTS watchlist_snapshots (
        id TEXT PRIMARY KEY,
        watchlist_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        trade_date TEXT NOT NULL,
        close REAL NOT NULL,
        pct_chg REAL,
        vs_entry_pct REAL,
        diamond_strength TEXT,
        snapshot_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_watchlist_snapshots_symbol ON watchlist_snapshots(symbol, trade_date)`,
      `CREATE TABLE IF NOT EXISTS diamond_signals (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        name TEXT NOT NULL,
        strength TEXT NOT NULL,
        score INTEGER NOT NULL,
        trade_date TEXT NOT NULL,
        close REAL NOT NULL,
        reasons TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_diamond_signals_date ON diamond_signals(trade_date)`,
      `CREATE TABLE IF NOT EXISTS weekly_reviews (
        id TEXT PRIMARY KEY,
        week_start TEXT NOT NULL,
        week_end TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        stats TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
    ]);
    migrated = true;
  }

  return client;
}

export async function addWatchlistItem(input: {
  symbol: string;
  name: string;
  reason?: string;
  sourceType?: WatchlistItem['sourceType'];
  sourceId?: string;
  entryPrice?: number;
  entryDate?: string;
}): Promise<WatchlistItem> {
  const db = await getDb();
  const existing = await db.execute({
    sql: `SELECT id FROM watchlist_items WHERE symbol = ? AND active = 1 LIMIT 1`,
    args: [input.symbol],
  });

  if (existing.rows.length > 0) {
    const id = String(existing.rows[0].id);
    await db.execute({
      sql: `UPDATE watchlist_items SET name = ?, reason = COALESCE(?, reason),
            source_type = COALESCE(?, source_type), source_id = COALESCE(?, source_id),
            entry_price = COALESCE(?, entry_price), entry_date = COALESCE(?, entry_date)
            WHERE id = ?`,
      args: [
        input.name,
        input.reason ?? null,
        input.sourceType ?? null,
        input.sourceId ?? null,
        input.entryPrice ?? null,
        input.entryDate ?? null,
        id,
      ],
    });
    const item = await getWatchlistItem(id);
    if (!item) throw new Error('watchlist update failed');
    return item;
  }

  const count = await db.execute({
    sql: `SELECT COUNT(*) AS cnt FROM watchlist_items WHERE active = 1`,
  });
  const countRow = count.rows[0] as Record<string, unknown> | undefined;
  const total = Number(countRow?.cnt ?? 0);
  if (total >= 20) {
    throw new Error('监控池最多 20 只股票');
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO watchlist_items
          (id, symbol, name, reason, source_type, source_id, entry_price, entry_date, active, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    args: [
      id,
      input.symbol,
      input.name,
      input.reason ?? null,
      input.sourceType ?? null,
      input.sourceId ?? null,
      input.entryPrice ?? null,
      input.entryDate ?? new Date().toISOString().slice(0, 10),
      createdAt,
    ],
  });

  return {
    id,
    symbol: input.symbol,
    name: input.name,
    reason: input.reason ?? null,
    sourceType: input.sourceType ?? null,
    sourceId: input.sourceId ?? null,
    entryPrice: input.entryPrice ?? null,
    entryDate: input.entryDate ?? new Date().toISOString().slice(0, 10),
    active: true,
    createdAt,
  };
}

function mapWatchlistRow(row: Record<string, unknown>): WatchlistItem {
  return {
    id: String(row.id),
    symbol: String(row.symbol),
    name: String(row.name),
    reason: row.reason == null ? null : String(row.reason),
    sourceType: row.source_type as WatchlistItem['sourceType'],
    sourceId: row.source_id == null ? null : String(row.source_id),
    entryPrice: row.entry_price == null ? null : Number(row.entry_price),
    entryDate: row.entry_date == null ? null : String(row.entry_date),
    active: Number(row.active) === 1,
    createdAt: String(row.created_at),
  };
}

export async function listWatchlistItems(): Promise<WatchlistItem[]> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM watchlist_items WHERE active = 1 ORDER BY created_at DESC`,
  });
  return result.rows.map((row) => mapWatchlistRow(row as Record<string, unknown>));
}

export async function getWatchlistItem(id: string): Promise<WatchlistItem | null> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM watchlist_items WHERE id = ?`,
    args: [id],
  });
  const row = result.rows[0] as Record<string, unknown> | undefined;
  return row ? mapWatchlistRow(row) : null;
}

export async function removeWatchlistItem(id: string): Promise<void> {
  const db = await getDb();
  await db.execute({
    sql: `UPDATE watchlist_items SET active = 0 WHERE id = ?`,
    args: [id],
  });
}

export async function saveWatchlistSnapshot(input: {
  watchlistId: string;
  symbol: string;
  tradeDate: string;
  close: number;
  pctChg: number | null;
  vsEntryPct: number | null;
  diamondStrength?: 'red' | 'blue' | null;
}): Promise<void> {
  const db = await getDb();
  const id = crypto.randomUUID();
  await db.execute({
    sql: `INSERT INTO watchlist_snapshots
          (id, watchlist_id, symbol, trade_date, close, pct_chg, vs_entry_pct, diamond_strength, snapshot_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      input.watchlistId,
      input.symbol,
      input.tradeDate,
      input.close,
      input.pctChg,
      input.vsEntryPct,
      input.diamondStrength ?? null,
      new Date().toISOString(),
    ],
  });
}

export async function listSnapshotsForSymbol(
  symbol: string,
  limit = 30,
): Promise<WatchlistSnapshot[]> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM watchlist_snapshots WHERE symbol = ?
          ORDER BY snapshot_at DESC LIMIT ?`,
    args: [symbol, limit],
  });
  return result.rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: String(r.id),
      watchlistId: String(r.watchlist_id),
      symbol: String(r.symbol),
      tradeDate: String(r.trade_date),
      close: Number(r.close),
      pctChg: r.pct_chg == null ? null : Number(r.pct_chg),
      vsEntryPct: r.vs_entry_pct == null ? null : Number(r.vs_entry_pct),
      diamondStrength: r.diamond_strength as WatchlistSnapshot['diamondStrength'],
      snapshotAt: String(r.snapshot_at),
    };
  });
}

export async function listLatestSnapshots(): Promise<WatchlistSnapshot[]> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT s.* FROM watchlist_snapshots s
          INNER JOIN (
            SELECT symbol, MAX(snapshot_at) AS max_at
            FROM watchlist_snapshots GROUP BY symbol
          ) latest ON s.symbol = latest.symbol AND s.snapshot_at = latest.max_at
          ORDER BY s.symbol`,
  });
  return result.rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: String(r.id),
      watchlistId: String(r.watchlist_id),
      symbol: String(r.symbol),
      tradeDate: String(r.trade_date),
      close: Number(r.close),
      pctChg: r.pct_chg == null ? null : Number(r.pct_chg),
      vsEntryPct: r.vs_entry_pct == null ? null : Number(r.vs_entry_pct),
      diamondStrength: r.diamond_strength as WatchlistSnapshot['diamondStrength'],
      snapshotAt: String(r.snapshot_at),
    };
  });
}

export async function saveDiamondSignal(input: {
  symbol: string;
  name: string;
  strength: 'red' | 'blue';
  score: number;
  tradeDate: string;
  close: number;
  reasons: string[];
}): Promise<DiamondSignalRecord> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO diamond_signals
          (id, symbol, name, strength, score, trade_date, close, reasons, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      input.symbol,
      input.name,
      input.strength,
      input.score,
      input.tradeDate,
      input.close,
      JSON.stringify(input.reasons),
      createdAt,
    ],
  });
  return {
    id,
    symbol: input.symbol,
    name: input.name,
    strength: input.strength,
    score: input.score,
    tradeDate: input.tradeDate,
    close: input.close,
    reasons: input.reasons,
    createdAt,
  };
}

export async function listDiamondSignals(limit = 50): Promise<DiamondSignalRecord[]> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM diamond_signals ORDER BY created_at DESC LIMIT ?`,
    args: [limit],
  });
  return result.rows.map((row) => {
    const r = row as Record<string, unknown>;
    const reasonsRaw = String(r.reasons ?? '[]');
    let reasons: string[] = [];
    try {
      const parsed = JSON.parse(reasonsRaw) as unknown;
      reasons = Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      reasons = [];
    }
    return {
      id: String(r.id),
      symbol: String(r.symbol),
      name: String(r.name),
      strength: r.strength as 'red' | 'blue',
      score: Number(r.score),
      tradeDate: String(r.trade_date),
      close: Number(r.close),
      reasons,
      createdAt: String(r.created_at),
    };
  });
}

export async function saveWeeklyReview(input: {
  weekStart: string;
  weekEnd: string;
  title: string;
  content: string;
  stats: WeeklyReviewRecord['stats'];
}): Promise<WeeklyReviewRecord> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO weekly_reviews (id, week_start, week_end, title, content, stats, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      input.weekStart,
      input.weekEnd,
      input.title,
      input.content,
      JSON.stringify(input.stats),
      createdAt,
    ],
  });
  return {
    id,
    weekStart: input.weekStart,
    weekEnd: input.weekEnd,
    title: input.title,
    content: input.content,
    stats: input.stats,
    createdAt,
  };
}

export async function listWeeklyReviews(limit = 12): Promise<WeeklyReviewRecord[]> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM weekly_reviews ORDER BY created_at DESC LIMIT ?`,
    args: [limit],
  });
  return result.rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: String(r.id),
      weekStart: String(r.week_start),
      weekEnd: String(r.week_end),
      title: String(r.title),
      content: String(r.content),
      stats: JSON.parse(String(r.stats)) as WeeklyReviewRecord['stats'],
      createdAt: String(r.created_at),
    };
  });
}

export async function getWeeklyReview(id: string): Promise<WeeklyReviewRecord | null> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM weekly_reviews WHERE id = ?`,
    args: [id],
  });
  const r = result.rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    id: String(r.id),
    weekStart: String(r.week_start),
    weekEnd: String(r.week_end),
    title: String(r.title),
    content: String(r.content),
    stats: JSON.parse(String(r.stats)) as WeeklyReviewRecord['stats'],
    createdAt: String(r.created_at),
  };
}

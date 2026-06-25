import { createClient, type Client } from '@libsql/client';
import { getPrimaryLibsqlOptions } from '../libsql-config.js';
import { getDailyQuote } from '../market/services.js';
import { resolvePaperExecutionPrice } from '../market/free/orderbook-quote.js';
import {
  BUCKET_INITIAL_CASH,
  BUCKET_MAX_POSITIONS,
  STOCK_POSITION_BUDGET_PCT,
  type PaperBucket,
  resolvePaperBucket,
} from './bucket.js';
import {
  formatTradeDate,
  roundToLot,
} from './trading-calendar.js';
import { calcStopLoss } from './momentum.js';

export type PaperAccount = {
  id: string;
  cash: number;
  initialCash: number;
  createdAt: string;
};

export type PaperTrade = {
  id: string;
  bucket: PaperBucket;
  symbol: string;
  name: string;
  side: 'buy' | 'sell';
  shares: number;
  price: number;
  amount: number;
  tradeDate: string;
  tradedAt: string;
  source: 'manual' | 'auto';
  note: string | null;
};

export type PaperPosition = {
  symbol: string;
  name: string;
  shares: number;
  avgCost: number;
  availableShares: number;
  frozenShares: number;
  latestPrice: number | null;
  marketValue: number | null;
  pnlPct: number | null;
  stopLoss: number | null;
  highWaterMark: number | null;
  entryMemo: string | null;
};

export type PaperEquitySnapshot = {
  id: string;
  bucket: PaperBucket;
  tradeDate: string;
  totalValue: number;
  cash: number;
  marketValue: number;
  returnPct: number;
  createdAt: string;
};

export type PaperBucketState = {
  bucket: PaperBucket;
  lastRebalanceDate: string | null;
  cooldownUntil: Record<string, string>;
  updatedAt: string;
};

export type PaperAutoRun = {
  id: string;
  tradeDate: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'ok' | 'skipped' | 'error';
  summary: Record<string, unknown> | null;
};

const LEGACY_DEFAULT_CASH = 50_000;
const MAX_POSITIONS = BUCKET_MAX_POSITIONS.stock;
const POSITION_BUDGET_PCT = STOCK_POSITION_BUDGET_PCT;

let client: Client | null = null;
let migrated = false;
let bucketMigrated = false;

async function getDb(): Promise<Client> {
  if (!client) {
    client = createClient(getPrimaryLibsqlOptions());
  }

  if (!migrated) {
    await client.batch([
      `CREATE TABLE IF NOT EXISTS paper_accounts (
        id TEXT PRIMARY KEY,
        cash REAL NOT NULL,
        initial_cash REAL NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS paper_trades (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        name TEXT NOT NULL,
        side TEXT NOT NULL,
        shares INTEGER NOT NULL,
        price REAL NOT NULL,
        amount REAL NOT NULL,
        traded_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS paper_positions (
        symbol TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        shares INTEGER NOT NULL,
        avg_cost REAL NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS paper_lots (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        shares INTEGER NOT NULL,
        remaining_shares INTEGER NOT NULL,
        buy_price REAL NOT NULL,
        buy_date TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS paper_equity_snapshots (
        id TEXT PRIMARY KEY,
        trade_date TEXT NOT NULL UNIQUE,
        total_value REAL NOT NULL,
        cash REAL NOT NULL,
        market_value REAL NOT NULL,
        return_pct REAL NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS paper_auto_runs (
        id TEXT PRIMARY KEY,
        trade_date TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        status TEXT NOT NULL,
        summary_json TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS paper_position_meta (
        symbol TEXT PRIMARY KEY,
        stop_loss REAL NOT NULL,
        high_water_mark REAL NOT NULL,
        entry_memo TEXT,
        entry_date TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    ]);

    for (const sql of [
      `ALTER TABLE paper_trades ADD COLUMN trade_date TEXT`,
      `ALTER TABLE paper_trades ADD COLUMN source TEXT DEFAULT 'manual'`,
      `ALTER TABLE paper_trades ADD COLUMN note TEXT`,
    ]) {
      try {
        await client.execute(sql);
      } catch {
        // column exists
      }
    }

    await backfillLotsFromTrades(client);
    await backfillPositionMeta(client);
    migrated = true;
  }

  if (!bucketMigrated) {
    await migrateBucketSchema(client);
    bucketMigrated = true;
  }

  return client;
}

async function columnExists(db: Client, table: string, column: string): Promise<boolean> {
  const info = await db.execute(`PRAGMA table_info(${table})`);
  return info.rows.some((row) => String((row as Record<string, unknown>).name) === column);
}

async function migrateBucketSchema(db: Client): Promise<void> {
  for (const sql of [
    `ALTER TABLE paper_accounts ADD COLUMN bucket TEXT NOT NULL DEFAULT 'stock'`,
    `ALTER TABLE paper_trades ADD COLUMN bucket TEXT NOT NULL DEFAULT 'stock'`,
    `ALTER TABLE paper_lots ADD COLUMN bucket TEXT NOT NULL DEFAULT 'stock'`,
    `ALTER TABLE paper_auto_runs ADD COLUMN bucket TEXT NOT NULL DEFAULT 'stock'`,
  ]) {
    try {
      await db.execute(sql);
    } catch {
      // column exists
    }
  }

  if (!(await columnExists(db, 'paper_positions', 'bucket'))) {
    await db.batch([
      `CREATE TABLE paper_positions_v2 (
        bucket TEXT NOT NULL DEFAULT 'stock',
        symbol TEXT NOT NULL,
        name TEXT NOT NULL,
        shares INTEGER NOT NULL,
        avg_cost REAL NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (bucket, symbol)
      )`,
      `INSERT INTO paper_positions_v2 (bucket, symbol, name, shares, avg_cost, updated_at)
       SELECT 'stock', symbol, name, shares, avg_cost, updated_at FROM paper_positions`,
      `DROP TABLE paper_positions`,
      `ALTER TABLE paper_positions_v2 RENAME TO paper_positions`,
    ]);
  }

  if (!(await columnExists(db, 'paper_position_meta', 'bucket'))) {
    await db.batch([
      `CREATE TABLE paper_position_meta_v2 (
        bucket TEXT NOT NULL DEFAULT 'stock',
        symbol TEXT NOT NULL,
        stop_loss REAL NOT NULL,
        high_water_mark REAL NOT NULL,
        entry_memo TEXT,
        entry_date TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (bucket, symbol)
      )`,
      `INSERT INTO paper_position_meta_v2 (bucket, symbol, stop_loss, high_water_mark, entry_memo, entry_date, updated_at)
       SELECT 'stock', symbol, stop_loss, high_water_mark, entry_memo, entry_date, updated_at FROM paper_position_meta`,
      `DROP TABLE paper_position_meta`,
      `ALTER TABLE paper_position_meta_v2 RENAME TO paper_position_meta`,
    ]);
  }

  if (!(await columnExists(db, 'paper_equity_snapshots', 'bucket'))) {
    await db.batch([
      `CREATE TABLE paper_equity_snapshots_v2 (
        id TEXT PRIMARY KEY,
        bucket TEXT NOT NULL DEFAULT 'stock',
        trade_date TEXT NOT NULL,
        total_value REAL NOT NULL,
        cash REAL NOT NULL,
        market_value REAL NOT NULL,
        return_pct REAL NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(bucket, trade_date)
      )`,
      `INSERT INTO paper_equity_snapshots_v2 (id, bucket, trade_date, total_value, cash, market_value, return_pct, created_at)
       SELECT id, 'stock', trade_date, total_value, cash, market_value, return_pct, created_at FROM paper_equity_snapshots`,
      `DROP TABLE paper_equity_snapshots`,
      `ALTER TABLE paper_equity_snapshots_v2 RENAME TO paper_equity_snapshots`,
    ]);
  }

  await db.execute(`CREATE TABLE IF NOT EXISTS paper_bucket_state (
    bucket TEXT PRIMARY KEY,
    last_rebalance_date TEXT,
    cooldown_json TEXT,
    updated_at TEXT NOT NULL
  )`);

  for (const bucket of ['stock', 'etf'] as PaperBucket[]) {
    const existing = await db.execute({
      sql: `SELECT id FROM paper_accounts WHERE bucket = ? LIMIT 1`,
      args: [bucket],
    });
    if (existing.rows.length > 0) continue;

    if (bucket === 'stock') {
      const legacy = await db.execute(`SELECT * FROM paper_accounts LIMIT 1`);
      if (legacy.rows.length > 0) {
        const row = legacy.rows[0] as Record<string, unknown>;
        await db.execute({
          sql: `UPDATE paper_accounts SET bucket = 'stock' WHERE id = ?`,
          args: [String(row.id)],
        });
        continue;
      }
    }

    await db.execute({
      sql: `INSERT INTO paper_accounts (id, bucket, cash, initial_cash, created_at) VALUES (?, ?, ?, ?, ?)`,
      args: [
        crypto.randomUUID(),
        bucket,
        BUCKET_INITIAL_CASH[bucket],
        BUCKET_INITIAL_CASH[bucket],
        new Date().toISOString(),
      ],
    });
  }
}

async function backfillLotsFromTrades(db: Client) {
  const lots = await db.execute(`SELECT COUNT(*) AS c FROM paper_lots`);
  if (Number((lots.rows[0] as Record<string, unknown>).c) > 0) return;

  const buys = await db.execute({
    sql: `SELECT * FROM paper_trades WHERE side = 'buy' ORDER BY traded_at ASC`,
  });

  for (const row of buys.rows) {
    const r = row as Record<string, unknown>;
    const tradeDate =
      r.trade_date != null
        ? String(r.trade_date)
        : formatTradeDate(new Date(String(r.traded_at)));
    await db.execute({
      sql: `INSERT INTO paper_lots (id, symbol, shares, remaining_shares, buy_price, buy_date, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        crypto.randomUUID(),
        String(r.symbol),
        Number(r.shares),
        Number(r.shares),
        Number(r.price),
        tradeDate,
        String(r.traded_at),
      ],
    });
  }

  const sells = await db.execute({
    sql: `SELECT * FROM paper_trades WHERE side = 'sell' ORDER BY traded_at ASC`,
  });

  for (const row of sells.rows) {
    const r = row as Record<string, unknown>;
    let remaining = Number(r.shares);
    const symbol = String(r.symbol);
    const lotRows = await db.execute({
      sql: `SELECT * FROM paper_lots WHERE symbol = ? AND remaining_shares > 0 ORDER BY buy_date ASC, created_at ASC`,
      args: [symbol],
    });
    for (const lotRow of lotRows.rows) {
      if (remaining <= 0) break;
      const lot = lotRow as Record<string, unknown>;
      const lotRemaining = Number(lot.remaining_shares);
      const deduct = Math.min(lotRemaining, remaining);
      await db.execute({
        sql: `UPDATE paper_lots SET remaining_shares = ? WHERE id = ?`,
        args: [lotRemaining - deduct, String(lot.id)],
      });
      remaining -= deduct;
    }
  }
}

async function backfillPositionMeta(db: Client) {
  const positions = await db.execute(`SELECT * FROM paper_positions`);
  for (const row of positions.rows) {
    const r = row as Record<string, unknown>;
    const symbol = String(r.symbol);
    const exists = await db.execute({
      sql: `SELECT 1 FROM paper_position_meta WHERE symbol = ? LIMIT 1`,
      args: [symbol],
    });
    if (exists.rows.length > 0) continue;
    const avgCost = Number(r.avg_cost);
    await db.execute({
      sql: `INSERT INTO paper_position_meta (symbol, stop_loss, high_water_mark, entry_memo, entry_date, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        symbol,
        calcStopLoss(avgCost),
        avgCost,
        null,
        formatTradeDate(),
        new Date().toISOString(),
      ],
    });
  }
}

export async function getOrCreatePaperAccount(
  bucket: PaperBucket = 'stock',
): Promise<PaperAccount & { bucket: PaperBucket }> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM paper_accounts WHERE bucket = ? ORDER BY created_at ASC LIMIT 1`,
    args: [bucket],
  });

  if (result.rows.length > 0) {
    const r = result.rows[0] as Record<string, unknown>;
    return {
      id: String(r.id),
      bucket,
      cash: Number(r.cash),
      initialCash: Number(r.initial_cash),
      createdAt: String(r.created_at),
    };
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const initialCash = BUCKET_INITIAL_CASH[bucket];
  await db.execute({
    sql: `INSERT INTO paper_accounts (id, bucket, cash, initial_cash, created_at) VALUES (?, ?, ?, ?, ?)`,
    args: [id, bucket, initialCash, initialCash, createdAt],
  });
  return { id, bucket, cash: initialCash, initialCash, createdAt };
}

async function getPosition(symbol: string, bucket: PaperBucket = 'stock') {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM paper_positions WHERE bucket = ? AND symbol = ?`,
    args: [bucket, symbol],
  });
  const r = result.rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    symbol: String(r.symbol),
    name: String(r.name),
    shares: Number(r.shares),
    avgCost: Number(r.avg_cost),
    updatedAt: String(r.updated_at),
  };
}

export async function getAvailableShares(
  symbol: string,
  tradeDate: string = formatTradeDate(),
  bucket: PaperBucket = 'stock',
): Promise<number> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT COALESCE(SUM(remaining_shares), 0) AS total
          FROM paper_lots
          WHERE bucket = ? AND symbol = ? AND buy_date < ? AND remaining_shares > 0`,
    args: [bucket, symbol, tradeDate],
  });
  return Number((result.rows[0] as Record<string, unknown>).total);
}

async function deductLots(
  symbol: string,
  shares: number,
  tradeDate: string,
  bucket: PaperBucket = 'stock',
): Promise<void> {
  const db = await getDb();
  let remaining = shares;
  const lots = await db.execute({
    sql: `SELECT * FROM paper_lots
          WHERE bucket = ? AND symbol = ? AND buy_date < ? AND remaining_shares > 0
          ORDER BY buy_date ASC, created_at ASC`,
    args: [bucket, symbol, tradeDate],
  });

  for (const row of lots.rows) {
    if (remaining <= 0) break;
    const lot = row as Record<string, unknown>;
    const lotRemaining = Number(lot.remaining_shares);
    const deduct = Math.min(lotRemaining, remaining);
    await db.execute({
      sql: `UPDATE paper_lots SET remaining_shares = ? WHERE id = ?`,
      args: [lotRemaining - deduct, String(lot.id)],
    });
    remaining -= deduct;
  }

  if (remaining > 0) {
    throw new Error('T+1 可卖数量不足');
  }
}

export async function getPositionMeta(
  symbol: string,
  bucket: PaperBucket = 'stock',
) {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM paper_position_meta WHERE bucket = ? AND symbol = ?`,
    args: [bucket, symbol],
  });
  const r = result.rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    symbol: String(r.symbol),
    stopLoss: Number(r.stop_loss),
    highWaterMark: Number(r.high_water_mark),
    entryMemo: r.entry_memo != null ? String(r.entry_memo) : null,
    entryDate: String(r.entry_date),
    updatedAt: String(r.updated_at),
  };
}

export async function upsertPositionMeta(input: {
  symbol: string;
  bucket?: PaperBucket;
  stopLoss: number;
  highWaterMark: number;
  entryMemo?: string;
  entryDate?: string;
}): Promise<void> {
  const bucket = input.bucket ?? 'stock';
  const db = await getDb();
  const existing = await getPositionMeta(input.symbol, bucket);
  const now = new Date().toISOString();
  const hwm = existing
    ? Math.max(existing.highWaterMark, input.highWaterMark)
    : input.highWaterMark;

  if (existing) {
    await db.execute({
      sql: `UPDATE paper_position_meta
            SET stop_loss = ?, high_water_mark = ?, entry_memo = COALESCE(?, entry_memo), updated_at = ?
            WHERE bucket = ? AND symbol = ?`,
      args: [input.stopLoss, hwm, input.entryMemo ?? null, now, bucket, input.symbol],
    });
    return;
  }

  await db.execute({
    sql: `INSERT INTO paper_position_meta (bucket, symbol, stop_loss, high_water_mark, entry_memo, entry_date, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      bucket,
      input.symbol,
      input.stopLoss,
      input.highWaterMark,
      input.entryMemo ?? null,
      input.entryDate ?? formatTradeDate(),
      now,
    ],
  });
}

export async function updateHighWaterMark(
  symbol: string,
  close: number,
  bucket: PaperBucket = 'stock',
): Promise<void> {
  const meta = await getPositionMeta(symbol, bucket);
  if (!meta || close <= meta.highWaterMark) return;
  const db = await getDb();
  await db.execute({
    sql: `UPDATE paper_position_meta SET high_water_mark = ?, updated_at = ? WHERE bucket = ? AND symbol = ?`,
    args: [close, new Date().toISOString(), bucket, symbol],
  });
}

async function deletePositionMeta(
  symbol: string,
  bucket: PaperBucket = 'stock',
): Promise<void> {
  const db = await getDb();
  await db.execute({
    sql: `DELETE FROM paper_position_meta WHERE bucket = ? AND symbol = ?`,
    args: [bucket, symbol],
  });
}

async function addLot(input: {
  bucket: PaperBucket;
  symbol: string;
  shares: number;
  buyPrice: number;
  buyDate: string;
}): Promise<void> {
  const db = await getDb();
  await db.execute({
    sql: `INSERT INTO paper_lots (id, bucket, symbol, shares, remaining_shares, buy_price, buy_date, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      crypto.randomUUID(),
      input.bucket,
      input.symbol,
      input.shares,
      input.shares,
      input.buyPrice,
      input.buyDate,
      new Date().toISOString(),
    ],
  });
}

export async function executePaperTrade(input: {
  bucket?: PaperBucket;
  symbol: string;
  name: string;
  side: 'buy' | 'sell';
  shares: number;
  price?: number;
  tradeDate?: string;
  source?: 'manual' | 'auto';
  note?: string;
  entryMemo?: string;
  skipSessionCheck?: boolean;
  useOrderBookPrice?: boolean;
}): Promise<{ trade: PaperTrade; account: PaperAccount & { bucket: PaperBucket } }> {
  const bucket = input.bucket ?? 'stock';
  const tradeDate = input.tradeDate ?? formatTradeDate();
  const source = input.source ?? 'manual';
  const shares = roundToLot(input.shares);
  const maxPositions = BUCKET_MAX_POSITIONS[bucket];

  let price = input.price;
  let priceSourceNote = '';
  if (price == null || !Number.isFinite(price) || input.useOrderBookPrice) {
    const execution = await resolvePaperExecutionPrice(input.symbol, input.side);
    price = execution.price;
    priceSourceNote = execution.priceSource;
  }
  if (price == null || !Number.isFinite(price) || price <= 0) {
    throw new Error('无法获取有效成交价');
  }

  if (shares <= 0) {
    throw new Error('股数须为 100 的整数倍，价格须大于 0');
  }

  if (!input.skipSessionCheck && source === 'manual') {
    const { assertTradingSession } = await import('./trading-calendar.js');
    assertTradingSession();
  }

  const db = await getDb();
  const account = await getOrCreatePaperAccount(bucket);
  const amount = Number((shares * price).toFixed(2));
  const pos = await getPosition(input.symbol, bucket);
  const noteSuffix = priceSourceNote ? `成交价=${priceSourceNote}` : '';
  const mergedNote = [input.note, noteSuffix].filter(Boolean).join(' · ') || null;

  if (input.side === 'buy') {
    if (account.cash < amount) {
      throw new Error(`${bucket === 'etf' ? 'ETF 仓' : '股票仓'}资金不足`);
    }
    const positions = await listPaperPositions(bucket);
    if (!pos && positions.length >= maxPositions) {
      throw new Error(`最多持有 ${maxPositions} 只${bucket === 'etf' ? ' ETF' : ''}`);
    }

    const newCash = Number((account.cash - amount).toFixed(2));
    const newShares = (pos?.shares ?? 0) + shares;
    const newAvg =
      newShares === 0
        ? price
        : Number(
            (
              ((pos?.avgCost ?? 0) * (pos?.shares ?? 0) + price * shares) /
              newShares
            ).toFixed(4),
          );

    await db.execute({
      sql: `UPDATE paper_accounts SET cash = ? WHERE id = ?`,
      args: [newCash, account.id],
    });

    await db.execute({
      sql: `INSERT INTO paper_positions (bucket, symbol, name, shares, avg_cost, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(bucket, symbol) DO UPDATE SET
              name = excluded.name,
              shares = excluded.shares,
              avg_cost = excluded.avg_cost,
              updated_at = excluded.updated_at`,
      args: [bucket, input.symbol, input.name, newShares, newAvg, new Date().toISOString()],
    });

    await addLot({
      bucket,
      symbol: input.symbol,
      shares,
      buyPrice: price,
      buyDate: tradeDate,
    });

    const existingMeta = await getPositionMeta(input.symbol, bucket);
    await upsertPositionMeta({
      bucket,
      symbol: input.symbol,
      stopLoss: calcStopLoss(newAvg),
      highWaterMark: Math.max(price, existingMeta?.highWaterMark ?? price),
      entryMemo: input.entryMemo,
      entryDate: tradeDate,
    });
  } else {
    if (!pos || pos.shares < shares) {
      throw new Error('持仓不足，无法卖出');
    }
    const available = await getAvailableShares(input.symbol, tradeDate, bucket);
    if (shares > available) {
      throw new Error(
        `T+1 限制：今日可卖 ${available} 股（共 ${pos.shares} 股，${pos.shares - available} 股今日买入冻结）`,
      );
    }

    await deductLots(input.symbol, shares, tradeDate, bucket);

    const newShares = pos.shares - shares;
    const newCash = Number((account.cash + amount).toFixed(2));

    await db.execute({
      sql: `UPDATE paper_accounts SET cash = ? WHERE id = ?`,
      args: [newCash, account.id],
    });

    if (newShares === 0) {
      await db.execute({
        sql: `DELETE FROM paper_positions WHERE bucket = ? AND symbol = ?`,
        args: [bucket, input.symbol],
      });
      await deletePositionMeta(input.symbol, bucket);
    } else {
      await db.execute({
        sql: `UPDATE paper_positions SET shares = ?, updated_at = ? WHERE bucket = ? AND symbol = ?`,
        args: [newShares, new Date().toISOString(), bucket, input.symbol],
      });
    }
  }

  const tradeId = crypto.randomUUID();
  const tradedAt = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO paper_trades (id, bucket, symbol, name, side, shares, price, amount, traded_at, trade_date, source, note)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      tradeId,
      bucket,
      input.symbol,
      input.name,
      input.side,
      shares,
      price,
      amount,
      tradedAt,
      tradeDate,
      source,
      mergedNote,
    ],
  });

  const updatedAccount = await getOrCreatePaperAccount(bucket);
  return {
    trade: {
      id: tradeId,
      bucket,
      symbol: input.symbol,
      name: input.name,
      side: input.side,
      shares,
      price,
      amount,
      tradeDate,
      tradedAt,
      source,
      note: mergedNote,
    },
    account: updatedAccount,
  };
}

export async function listPaperPositions(
  bucket: PaperBucket = 'stock',
): Promise<Pick<PaperPosition, 'symbol' | 'name' | 'shares' | 'avgCost'>[]> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM paper_positions WHERE bucket = ? ORDER BY symbol`,
    args: [bucket],
  });
  return result.rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      symbol: String(r.symbol),
      name: String(r.name),
      shares: Number(r.shares),
      avgCost: Number(r.avg_cost),
    };
  });
}

function mapTradeRow(r: Record<string, unknown>): PaperTrade {
  return {
    id: String(r.id),
    bucket: resolvePaperBucket(r.bucket != null ? String(r.bucket) : 'stock'),
    symbol: String(r.symbol),
    name: String(r.name),
    side: r.side as 'buy' | 'sell',
    shares: Number(r.shares),
    price: Number(r.price),
    amount: Number(r.amount),
    tradeDate: r.trade_date != null ? String(r.trade_date) : formatTradeDate(new Date(String(r.traded_at))),
    tradedAt: String(r.traded_at),
    source: (r.source as 'manual' | 'auto') ?? 'manual',
    note: r.note != null ? String(r.note) : null,
  };
}

export async function listPaperTrades(
  limit = 50,
  bucket?: PaperBucket,
): Promise<PaperTrade[]> {
  const db = await getDb();
  const result = bucket
    ? await db.execute({
        sql: `SELECT * FROM paper_trades WHERE bucket = ? ORDER BY traded_at DESC LIMIT ?`,
        args: [bucket, limit],
      })
    : await db.execute({
        sql: `SELECT * FROM paper_trades ORDER BY traded_at DESC LIMIT ?`,
        args: [limit],
      });
  return result.rows.map((row) => mapTradeRow(row as Record<string, unknown>));
}

export async function getPaperAccountSummary(bucket: PaperBucket = 'stock') {
  const account = await getOrCreatePaperAccount(bucket);
  const tradeDate = formatTradeDate();
  const positions = await listPaperPositions(bucket);
  let totalValue = account.cash;
  let marketValue = 0;

  const enriched: PaperPosition[] = [];
  for (const pos of positions) {
    let latestPrice: number | null = null;
    try {
      const q = await getDailyQuote(pos.symbol, 2);
      latestPrice = q.latestClose;
    } catch {
      latestPrice = pos.avgCost;
    }
    const mv = latestPrice ? pos.shares * latestPrice : null;
    if (mv) {
      totalValue += mv;
      marketValue += mv;
    }
    const availableShares = await getAvailableShares(pos.symbol, tradeDate, bucket);
    const pnlPct =
      latestPrice && pos.avgCost > 0
        ? Number((((latestPrice - pos.avgCost) / pos.avgCost) * 100).toFixed(2))
        : null;
    const meta = await getPositionMeta(pos.symbol, bucket);
    enriched.push({
      ...pos,
      availableShares,
      frozenShares: pos.shares - availableShares,
      latestPrice,
      marketValue: mv,
      pnlPct,
      stopLoss: meta?.stopLoss ?? calcStopLoss(pos.avgCost),
      highWaterMark: meta?.highWaterMark ?? null,
      entryMemo: meta?.entryMemo ?? null,
    });
  }

  return {
    bucket,
    account,
    totalValue: Number(totalValue.toFixed(2)),
    marketValue: Number(marketValue.toFixed(2)),
    returnPct: Number(
      (((totalValue - account.initialCash) / account.initialCash) * 100).toFixed(2),
    ),
    positions: enriched,
    tradeDate,
    isTradingSession: (await import('./trading-calendar.js')).isTradingSession(),
  };
}

export async function getPaperDualSummary() {
  const [etf, stock] = await Promise.all([
    getPaperAccountSummary('etf'),
    getPaperAccountSummary('stock'),
  ]);
  const totalInitial = etf.account.initialCash + stock.account.initialCash;
  const totalValue = etf.totalValue + stock.totalValue;
  return {
    etf,
    stock,
    combined: {
      totalValue: Number(totalValue.toFixed(2)),
      initialCash: totalInitial,
      returnPct:
        totalInitial > 0
          ? Number((((totalValue - totalInitial) / totalInitial) * 100).toFixed(2))
          : 0,
      tradeDate: etf.tradeDate,
      isTradingSession: etf.isTradingSession,
    },
  };
}

export async function getPaperBucketState(
  bucket: PaperBucket,
): Promise<PaperBucketState> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM paper_bucket_state WHERE bucket = ?`,
    args: [bucket],
  });
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) {
    return {
      bucket,
      lastRebalanceDate: null,
      cooldownUntil: {},
      updatedAt: new Date().toISOString(),
    };
  }
  return {
    bucket,
    lastRebalanceDate:
      row.last_rebalance_date != null ? String(row.last_rebalance_date) : null,
    cooldownUntil: row.cooldown_json
      ? (JSON.parse(String(row.cooldown_json)) as Record<string, string>)
      : {},
    updatedAt: String(row.updated_at),
  };
}

export async function savePaperBucketState(input: {
  bucket: PaperBucket;
  lastRebalanceDate?: string | null;
  cooldownUntil?: Record<string, string>;
}): Promise<PaperBucketState> {
  const db = await getDb();
  const current = await getPaperBucketState(input.bucket);
  const next: PaperBucketState = {
    bucket: input.bucket,
    lastRebalanceDate:
      input.lastRebalanceDate !== undefined
        ? input.lastRebalanceDate
        : current.lastRebalanceDate,
    cooldownUntil: input.cooldownUntil ?? current.cooldownUntil,
    updatedAt: new Date().toISOString(),
  };
  await db.execute({
    sql: `INSERT INTO paper_bucket_state (bucket, last_rebalance_date, cooldown_json, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(bucket) DO UPDATE SET
            last_rebalance_date = excluded.last_rebalance_date,
            cooldown_json = excluded.cooldown_json,
            updated_at = excluded.updated_at`,
    args: [
      next.bucket,
      next.lastRebalanceDate,
      JSON.stringify(next.cooldownUntil),
      next.updatedAt,
    ],
  });
  return next;
}

export async function saveEquitySnapshot(
  tradeDate = formatTradeDate(),
  bucket: PaperBucket = 'stock',
): Promise<PaperEquitySnapshot> {
  const summary = await getPaperAccountSummary(bucket);
  const db = await getDb();
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  await db.execute({
    sql: `INSERT INTO paper_equity_snapshots (id, bucket, trade_date, total_value, cash, market_value, return_pct, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(bucket, trade_date) DO UPDATE SET
            total_value = excluded.total_value,
            cash = excluded.cash,
            market_value = excluded.market_value,
            return_pct = excluded.return_pct,
            created_at = excluded.created_at`,
    args: [
      id,
      bucket,
      tradeDate,
      summary.totalValue,
      summary.account.cash,
      summary.marketValue,
      summary.returnPct,
      createdAt,
    ],
  });

  return {
    id,
    bucket,
    tradeDate,
    totalValue: summary.totalValue,
    cash: summary.account.cash,
    marketValue: summary.marketValue,
    returnPct: summary.returnPct,
    createdAt,
  };
}

export async function listEquitySnapshots(
  limit = 90,
  bucket?: PaperBucket,
): Promise<PaperEquitySnapshot[]> {
  const db = await getDb();
  const result = bucket
    ? await db.execute({
        sql: `SELECT * FROM paper_equity_snapshots WHERE bucket = ? ORDER BY trade_date ASC LIMIT ?`,
        args: [bucket, limit],
      })
    : await db.execute({
        sql: `SELECT * FROM paper_equity_snapshots ORDER BY trade_date ASC LIMIT ?`,
        args: [limit],
      });
  return result.rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: String(r.id),
      bucket: resolvePaperBucket(r.bucket != null ? String(r.bucket) : 'stock'),
      tradeDate: String(r.trade_date),
      totalValue: Number(r.total_value),
      cash: Number(r.cash),
      marketValue: Number(r.market_value),
      returnPct: Number(r.return_pct),
      createdAt: String(r.created_at),
    };
  });
}

export async function startAutoRun(tradeDate: string): Promise<string> {
  const db = await getDb();
  const id = crypto.randomUUID();
  await db.execute({
    sql: `INSERT INTO paper_auto_runs (id, trade_date, started_at, status) VALUES (?, ?, ?, ?)`,
    args: [id, tradeDate, new Date().toISOString(), 'running'],
  });
  return id;
}

export async function finishAutoRun(
  id: string,
  status: PaperAutoRun['status'],
  summary: Record<string, unknown>,
): Promise<void> {
  const db = await getDb();
  await db.execute({
    sql: `UPDATE paper_auto_runs SET finished_at = ?, status = ?, summary_json = ? WHERE id = ?`,
    args: [new Date().toISOString(), status, JSON.stringify(summary), id],
  });
}

export async function getLatestAutoRun(): Promise<PaperAutoRun | null> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM paper_auto_runs ORDER BY started_at DESC LIMIT 1`,
  });
  const r = result.rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    id: String(r.id),
    tradeDate: String(r.trade_date),
    startedAt: String(r.started_at),
    finishedAt: r.finished_at != null ? String(r.finished_at) : null,
    status: r.status as PaperAutoRun['status'],
    summary: r.summary_json ? (JSON.parse(String(r.summary_json)) as Record<string, unknown>) : null,
  };
}

export function calcAutoBuyShares(cash: number, price: number): number {
  const budget = cash * POSITION_BUDGET_PCT;
  const raw = roundToLot(Math.floor(budget / price));
  return raw >= 100 ? raw : 0;
}

export { MAX_POSITIONS, POSITION_BUDGET_PCT };

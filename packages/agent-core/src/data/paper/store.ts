import { createClient, type Client } from '@libsql/client';
import { getPrimaryLibsqlOptions } from '../libsql-config.js';

export type PaperAccount = {
  id: string;
  cash: number;
  initialCash: number;
  createdAt: string;
};

export type PaperTrade = {
  id: string;
  symbol: string;
  name: string;
  side: 'buy' | 'sell';
  shares: number;
  price: number;
  amount: number;
  tradedAt: string;
};

export type PaperPosition = {
  symbol: string;
  name: string;
  shares: number;
  avgCost: number;
  latestPrice: number | null;
  marketValue: number | null;
  pnlPct: number | null;
};

const DEFAULT_CASH = 1_000_000;

let client: Client | null = null;
let migrated = false;

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
    ]);
    migrated = true;
  }

  return client;
}

export async function getOrCreatePaperAccount(): Promise<PaperAccount> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM paper_accounts ORDER BY created_at ASC LIMIT 1`,
  });

  if (result.rows.length > 0) {
    const r = result.rows[0] as Record<string, unknown>;
    return {
      id: String(r.id),
      cash: Number(r.cash),
      initialCash: Number(r.initial_cash),
      createdAt: String(r.created_at),
    };
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO paper_accounts (id, cash, initial_cash, created_at) VALUES (?, ?, ?, ?)`,
    args: [id, DEFAULT_CASH, DEFAULT_CASH, createdAt],
  });
  return { id, cash: DEFAULT_CASH, initialCash: DEFAULT_CASH, createdAt };
}

async function getPosition(symbol: string) {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM paper_positions WHERE symbol = ?`,
    args: [symbol],
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

export async function executePaperTrade(input: {
  symbol: string;
  name: string;
  side: 'buy' | 'sell';
  shares: number;
  price: number;
}): Promise<{ trade: PaperTrade; account: PaperAccount }> {
  if (input.shares <= 0 || input.price <= 0) {
    throw new Error('股数与价格须大于 0');
  }

  const db = await getDb();
  const account = await getOrCreatePaperAccount();
  const amount = Number((input.shares * input.price).toFixed(2));
  const pos = await getPosition(input.symbol);

  if (input.side === 'buy') {
    if (account.cash < amount) {
      throw new Error('模拟账户资金不足');
    }
    const newCash = Number((account.cash - amount).toFixed(2));
    const newShares = (pos?.shares ?? 0) + input.shares;
    const newAvg =
      newShares === 0
        ? input.price
        : Number(
            (
              ((pos?.avgCost ?? 0) * (pos?.shares ?? 0) +
                input.price * input.shares) /
              newShares
            ).toFixed(4),
          );

    await db.execute({
      sql: `UPDATE paper_accounts SET cash = ? WHERE id = ?`,
      args: [newCash, account.id],
    });

    await db.execute({
      sql: `INSERT INTO paper_positions (symbol, name, shares, avg_cost, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(symbol) DO UPDATE SET
              name = excluded.name,
              shares = excluded.shares,
              avg_cost = excluded.avg_cost,
              updated_at = excluded.updated_at`,
      args: [
        input.symbol,
        input.name,
        newShares,
        newAvg,
        new Date().toISOString(),
      ],
    });
  } else {
    if (!pos || pos.shares < input.shares) {
      throw new Error('持仓不足，无法卖出');
    }
    const newShares = pos.shares - input.shares;
    const newCash = Number((account.cash + amount).toFixed(2));

    await db.execute({
      sql: `UPDATE paper_accounts SET cash = ? WHERE id = ?`,
      args: [newCash, account.id],
    });

    if (newShares === 0) {
      await db.execute({
        sql: `DELETE FROM paper_positions WHERE symbol = ?`,
        args: [input.symbol],
      });
    } else {
      await db.execute({
        sql: `UPDATE paper_positions SET shares = ?, updated_at = ? WHERE symbol = ?`,
        args: [newShares, new Date().toISOString(), input.symbol],
      });
    }
  }

  const tradeId = crypto.randomUUID();
  const tradedAt = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO paper_trades (id, symbol, name, side, shares, price, amount, traded_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      tradeId,
      input.symbol,
      input.name,
      input.side,
      input.shares,
      input.price,
      amount,
      tradedAt,
    ],
  });

  const updatedAccount = await getOrCreatePaperAccount();
  return {
    trade: {
      id: tradeId,
      symbol: input.symbol,
      name: input.name,
      side: input.side,
      shares: input.shares,
      price: input.price,
      amount,
      tradedAt,
    },
    account: updatedAccount,
  };
}

export async function listPaperPositions(): Promise<
  Omit<PaperPosition, 'latestPrice' | 'marketValue' | 'pnlPct'>[]
> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM paper_positions ORDER BY symbol`,
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

export async function listPaperTrades(limit = 50): Promise<PaperTrade[]> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM paper_trades ORDER BY traded_at DESC LIMIT ?`,
    args: [limit],
  });
  return result.rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: String(r.id),
      symbol: String(r.symbol),
      name: String(r.name),
      side: r.side as 'buy' | 'sell',
      shares: Number(r.shares),
      price: Number(r.price),
      amount: Number(r.amount),
      tradedAt: String(r.traded_at),
    };
  });
}

import { createClient, type Client } from '@libsql/client';
import { getPrimaryLibsqlOptions } from '../libsql-config.js';
import type {
  BacktestEquityPoint,
  BacktestPortfolioSnapshot,
  BacktestRunResult,
  BacktestTrade,
} from './types.js';

export type BacktestRunRecord = {
  id: string;
  strategy: string;
  assetType: 'stock' | 'etf' | 'mixed';
  generatedAt: string;
  createdAt: string;
  requestedDays: number;
  startDate: string | null;
  endDate: string | null;
  tradeCount: number;
  validTradeCount: number;
  finalReturnPct: number | null;
  initialCapital: number | null;
};

export type SaveBacktestRunOptions = {
  source?: string;
  args?: string[];
};

let client: Client | null = null;
let migrated = false;

async function getDb(): Promise<Client> {
  if (!client) {
    client = createClient(getPrimaryLibsqlOptions('backtests.db'));
  }

  if (!migrated) {
    await client.batch([
      `CREATE TABLE IF NOT EXISTS backtest_runs (
        id TEXT PRIMARY KEY,
        strategy TEXT NOT NULL,
        asset_type TEXT NOT NULL,
        source TEXT,
        args_json TEXT NOT NULL DEFAULT '[]',
        generated_at TEXT NOT NULL,
        requested_days INTEGER NOT NULL,
        start_date TEXT,
        end_date TEXT,
        hold_days_json TEXT NOT NULL DEFAULT '[]',
        symbols_json TEXT NOT NULL DEFAULT '[]',
        metrics_json TEXT NOT NULL,
        groups_json TEXT NOT NULL DEFAULT '[]',
        config_json TEXT NOT NULL DEFAULT '{}',
        notes_json TEXT NOT NULL DEFAULT '[]',
        benchmark_json TEXT NOT NULL DEFAULT 'null',
        result_json TEXT NOT NULL,
        trade_count INTEGER NOT NULL,
        valid_trade_count INTEGER NOT NULL,
        final_return_pct REAL,
        initial_capital REAL,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS backtest_trades (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        sequence_no INTEGER NOT NULL,
        symbol TEXT NOT NULL,
        name TEXT NOT NULL,
        asset_type TEXT NOT NULL,
        strategy TEXT NOT NULL,
        entry_date TEXT NOT NULL,
        entry_price REAL NOT NULL,
        exit_date TEXT,
        exit_price REAL,
        hold_days INTEGER NOT NULL,
        return_pct REAL,
        exit_reason TEXT NOT NULL,
        signal_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS backtest_equity_points (
        run_id TEXT NOT NULL,
        trade_date TEXT NOT NULL,
        equity REAL NOT NULL,
        return_pct REAL NOT NULL,
        closed_trades INTEGER NOT NULL,
        PRIMARY KEY (run_id, trade_date)
      )`,
      `CREATE TABLE IF NOT EXISTS backtest_portfolio_snapshots (
        run_id TEXT NOT NULL,
        trade_date TEXT NOT NULL,
        cash REAL NOT NULL,
        invested_market_value REAL NOT NULL,
        total_value REAL NOT NULL,
        return_pct REAL NOT NULL,
        closed_trades INTEGER NOT NULL,
        positions_json TEXT NOT NULL,
        PRIMARY KEY (run_id, trade_date)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_backtest_runs_created_at
        ON backtest_runs(created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_backtest_runs_strategy
        ON backtest_runs(strategy, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_backtest_trades_run_id
        ON backtest_trades(run_id, sequence_no)`,
      `CREATE INDEX IF NOT EXISTS idx_backtest_trades_symbol
        ON backtest_trades(symbol, entry_date DESC)`,
    ]);
    migrated = true;
  }

  return client;
}

function inferAssetType(result: BacktestRunResult): BacktestRunRecord['assetType'] {
  const assetTypes = new Set([
    ...result.symbols.map((symbol) => symbol.assetType),
    ...result.trades.map((trade) => trade.assetType),
  ]);
  if (assetTypes.size === 1) {
    const [assetType] = assetTypes;
    if (assetType === 'stock' || assetType === 'etf') return assetType;
  }
  if (result.strategy.startsWith('etf-')) return 'etf';
  if (result.strategy.startsWith('red-diamond')) return 'stock';
  return 'mixed';
}

function finalReturnPct(points: BacktestEquityPoint[] | undefined): number | null {
  if (!points?.length) return null;
  return points.at(-1)?.returnPct ?? null;
}

function insertTradeStatement(
  runId: string,
  trade: BacktestTrade,
  sequenceNo: number,
  createdAt: string,
) {
  return {
    sql: `INSERT INTO backtest_trades (
      id, run_id, sequence_no, symbol, name, asset_type, strategy,
      entry_date, entry_price, exit_date, exit_price, hold_days, return_pct,
      exit_reason, signal_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      crypto.randomUUID(),
      runId,
      sequenceNo,
      trade.symbol,
      trade.name,
      trade.assetType,
      trade.strategy,
      trade.entryDate,
      trade.entryPrice,
      trade.exitDate,
      trade.exitPrice,
      trade.holdDays,
      trade.returnPct,
      trade.exitReason,
      JSON.stringify(trade.signal),
      createdAt,
    ],
  };
}

function insertEquityStatement(runId: string, point: BacktestEquityPoint) {
  return {
    sql: `INSERT INTO backtest_equity_points (
      run_id, trade_date, equity, return_pct, closed_trades
    ) VALUES (?, ?, ?, ?, ?)`,
    args: [
      runId,
      point.tradeDate,
      point.equity,
      point.returnPct,
      point.closedTrades,
    ],
  };
}

function insertSnapshotStatement(
  runId: string,
  snapshot: BacktestPortfolioSnapshot,
) {
  return {
    sql: `INSERT INTO backtest_portfolio_snapshots (
      run_id, trade_date, cash, invested_market_value, total_value,
      return_pct, closed_trades, positions_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      runId,
      snapshot.tradeDate,
      snapshot.cash,
      snapshot.investedMarketValue,
      snapshot.totalValue,
      snapshot.returnPct,
      snapshot.closedTrades,
      JSON.stringify(snapshot.positions),
    ],
  };
}

export async function saveBacktestRun(
  result: BacktestRunResult,
  options: SaveBacktestRunOptions = {},
): Promise<BacktestRunRecord> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const assetType = inferAssetType(result);
  const finalReturn = finalReturnPct(result.equityCurve);
  const initialCapital =
    typeof result.config?.initialCapital === 'number'
      ? result.config.initialCapital
      : null;

  await db.execute({
    sql: `INSERT INTO backtest_runs (
      id, strategy, asset_type, source, args_json, generated_at, requested_days,
      start_date, end_date, hold_days_json, symbols_json, metrics_json,
      groups_json, config_json, notes_json, benchmark_json, result_json,
      trade_count, valid_trade_count, final_return_pct, initial_capital, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      result.strategy,
      assetType,
      options.source ?? null,
      JSON.stringify(options.args ?? []),
      result.generatedAt,
      result.requestedDays,
      result.startDate ?? null,
      result.endDate ?? null,
      JSON.stringify(result.holdDays),
      JSON.stringify(result.symbols),
      JSON.stringify(result.metrics),
      JSON.stringify(result.groups),
      JSON.stringify(result.config ?? {}),
      JSON.stringify(result.notes),
      JSON.stringify(result.benchmark ?? null),
      JSON.stringify(result),
      result.metrics.tradeCount,
      result.metrics.validTradeCount,
      finalReturn,
      initialCapital,
      createdAt,
    ],
  });

  for (let index = 0; index < result.trades.length; index += 100) {
    const chunk = result.trades.slice(index, index + 100);
    await db.batch(
      chunk.map((trade, offset) =>
        insertTradeStatement(id, trade, index + offset, createdAt),
      ),
    );
  }

  const equityCurve = result.equityCurve ?? [];
  for (let index = 0; index < equityCurve.length; index += 200) {
    await db.batch(
      equityCurve.slice(index, index + 200).map((point) =>
        insertEquityStatement(id, point),
      ),
    );
  }

  const snapshots = result.portfolioSnapshots ?? [];
  for (let index = 0; index < snapshots.length; index += 100) {
    await db.batch(
      snapshots.slice(index, index + 100).map((snapshot) =>
        insertSnapshotStatement(id, snapshot),
      ),
    );
  }

  return {
    id,
    strategy: result.strategy,
    assetType,
    generatedAt: result.generatedAt,
    createdAt,
    requestedDays: result.requestedDays,
    startDate: result.startDate ?? null,
    endDate: result.endDate ?? null,
    tradeCount: result.metrics.tradeCount,
    validTradeCount: result.metrics.validTradeCount,
    finalReturnPct: finalReturn,
    initialCapital,
  };
}

export async function listBacktestRuns(limit = 20): Promise<BacktestRunRecord[]> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT id, strategy, asset_type, generated_at, created_at,
      requested_days, start_date, end_date, trade_count, valid_trade_count,
      final_return_pct, initial_capital
      FROM backtest_runs
      ORDER BY created_at DESC
      LIMIT ?`,
    args: [Math.max(1, Math.floor(limit))],
  });

  return result.rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: String(r.id),
      strategy: String(r.strategy),
      assetType:
        r.asset_type === 'stock' || r.asset_type === 'etf'
          ? r.asset_type
          : 'mixed',
      generatedAt: String(r.generated_at),
      createdAt: String(r.created_at),
      requestedDays: Number(r.requested_days),
      startDate: r.start_date == null ? null : String(r.start_date),
      endDate: r.end_date == null ? null : String(r.end_date),
      tradeCount: Number(r.trade_count),
      validTradeCount: Number(r.valid_trade_count),
      finalReturnPct:
        r.final_return_pct == null ? null : Number(r.final_return_pct),
      initialCapital:
        r.initial_capital == null ? null : Number(r.initial_capital),
    };
  });
}

import { createClient, type Client } from '@libsql/client';
import { getPrimaryLibsqlOptions } from '../libsql-config.js';

export type MonitorAlertType =
  | 'news_catalyst'
  | 'pre_move'
  | 'early_move'
  | 'watchlist_surge'
  | 'theme_ignite';

export type MonitorAlertSeverity = 'info' | 'watch' | 'urgent';

export type MonitorAlert = {
  id: string;
  alertType: MonitorAlertType;
  severity: MonitorAlertSeverity;
  symbol: string | null;
  name: string | null;
  title: string;
  summary: string;
  newsTitle: string | null;
  newsUrl: string | null;
  pctChg: number | null;
  ret20dPct: number | null;
  theme: string | null;
  tradeDate: string;
  createdAt: string;
  acknowledged: boolean;
};

export type MonitorPollRun = {
  id: string;
  tradeDate: string;
  status: 'success' | 'partial' | 'skipped';
  newsCount: number;
  newNewsCount: number;
  alertCount: number;
  symbolsScanned: number;
  marketOpen: boolean;
  elapsedMs: number;
  summary: string;
  createdAt: string;
};

export type MonitorNewsEvent = {
  newsKey: string;
  title: string;
  url: string | null;
  source: string | null;
  publishedAt: string | null;
  firstSeenAt: string;
};

export type MonitorRuntimeState = {
  running?: boolean;
  startedAt?: string;
  finishedAt?: string;
  lastRunId?: string;
  summary?: string;
  error?: string;
};

let client: Client | null = null;
let migrated = false;

async function getDb(): Promise<Client> {
  if (!client) {
    client = createClient(getPrimaryLibsqlOptions());
  }

  if (!migrated) {
    await client.batch([
      `CREATE TABLE IF NOT EXISTS monitor_alerts (
        id TEXT PRIMARY KEY,
        alert_type TEXT NOT NULL,
        severity TEXT NOT NULL,
        symbol TEXT,
        name TEXT,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        news_title TEXT,
        news_url TEXT,
        pct_chg REAL,
        ret20d_pct REAL,
        theme TEXT,
        trade_date TEXT NOT NULL,
        created_at TEXT NOT NULL,
        acknowledged INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE INDEX IF NOT EXISTS idx_monitor_alerts_date ON monitor_alerts(trade_date, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_monitor_alerts_symbol ON monitor_alerts(symbol, alert_type, trade_date)`,
      `CREATE TABLE IF NOT EXISTS monitor_poll_runs (
        id TEXT PRIMARY KEY,
        trade_date TEXT NOT NULL,
        status TEXT NOT NULL,
        news_count INTEGER NOT NULL,
        new_news_count INTEGER NOT NULL,
        alert_count INTEGER NOT NULL,
        symbols_scanned INTEGER NOT NULL,
        market_open INTEGER NOT NULL,
        elapsed_ms INTEGER NOT NULL,
        summary TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_monitor_poll_runs_date ON monitor_poll_runs(trade_date, created_at DESC)`,
      `CREATE TABLE IF NOT EXISTS monitor_news_seen (
        news_key TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        first_seen_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS monitor_news_events (
        news_key TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        url TEXT,
        source TEXT,
        published_at TEXT,
        first_seen_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_monitor_news_events_seen ON monitor_news_events(first_seen_at DESC)`,
      `CREATE TABLE IF NOT EXISTS monitor_alert_dedupe (
        dedupe_key TEXT PRIMARY KEY,
        alert_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS monitor_runtime_state (
        state_key TEXT PRIMARY KEY,
        state_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    ]);
    migrated = true;
  }

  return client;
}

function mapAlertRow(row: Record<string, unknown>): MonitorAlert {
  return {
    id: String(row.id),
    alertType: row.alert_type as MonitorAlertType,
    severity: row.severity as MonitorAlertSeverity,
    symbol: row.symbol == null ? null : String(row.symbol),
    name: row.name == null ? null : String(row.name),
    title: String(row.title),
    summary: String(row.summary),
    newsTitle: row.news_title == null ? null : String(row.news_title),
    newsUrl: row.news_url == null ? null : String(row.news_url),
    pctChg: row.pct_chg == null ? null : Number(row.pct_chg),
    ret20dPct: row.ret20d_pct == null ? null : Number(row.ret20d_pct),
    theme: row.theme == null ? null : String(row.theme),
    tradeDate: String(row.trade_date),
    createdAt: String(row.created_at),
    acknowledged: Number(row.acknowledged) === 1,
  };
}

export async function saveMonitorAlert(
  input: Omit<MonitorAlert, 'id' | 'createdAt' | 'acknowledged'>,
): Promise<MonitorAlert> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  await db.execute({
    sql: `INSERT INTO monitor_alerts
          (id, alert_type, severity, symbol, name, title, summary, news_title, news_url,
           pct_chg, ret20d_pct, theme, trade_date, created_at, acknowledged)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    args: [
      id,
      input.alertType,
      input.severity,
      input.symbol,
      input.name,
      input.title,
      input.summary,
      input.newsTitle,
      input.newsUrl,
      input.pctChg,
      input.ret20dPct,
      input.theme,
      input.tradeDate,
      createdAt,
    ],
  });

  return { ...input, id, createdAt, acknowledged: false };
}

export async function hasRecentAlert(input: {
  symbol: string | null;
  alertType: MonitorAlertType;
  tradeDate: string;
  withinHours?: number;
}): Promise<boolean> {
  const db = await getDb();
  const withinHours = input.withinHours ?? 3;
  const cutoff = new Date(Date.now() - withinHours * 60 * 60 * 1000).toISOString();

  const result = await db.execute({
    sql: `SELECT id FROM monitor_alerts
          WHERE alert_type = ? AND trade_date = ? AND created_at >= ?
          AND (${input.symbol ? 'symbol = ?' : 'symbol IS NULL'})
          LIMIT 1`,
    args: input.symbol
      ? [input.alertType, input.tradeDate, cutoff, input.symbol]
      : [input.alertType, input.tradeDate, cutoff],
  });

  return result.rows.length > 0;
}

export async function hasAlertDedupeKey(dedupeKey: string): Promise<boolean> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT dedupe_key FROM monitor_alert_dedupe WHERE dedupe_key = ? LIMIT 1`,
    args: [dedupeKey],
  });
  return result.rows.length > 0;
}

export async function saveAlertDedupeKey(input: {
  dedupeKey: string;
  alertId: string;
}): Promise<void> {
  const db = await getDb();
  await db.execute({
    sql: `INSERT OR IGNORE INTO monitor_alert_dedupe (dedupe_key, alert_id, created_at)
          VALUES (?, ?, ?)`,
    args: [input.dedupeKey, input.alertId, new Date().toISOString()],
  });
}

export async function listMonitorAlerts(input?: {
  tradeDate?: string;
  limit?: number;
  unacknowledgedOnly?: boolean;
}): Promise<MonitorAlert[]> {
  const db = await getDb();
  const limit = input?.limit ?? 80;
  const conditions: string[] = [];
  const args: Array<string | number> = [];

  if (input?.tradeDate) {
    conditions.push('trade_date = ?');
    args.push(input.tradeDate);
  }
  if (input?.unacknowledgedOnly) {
    conditions.push('acknowledged = 0');
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  args.push(limit);

  const result = await db.execute({
    sql: `SELECT * FROM monitor_alerts ${where} ORDER BY created_at DESC LIMIT ?`,
    args,
  });

  return result.rows.map((row) => mapAlertRow(row as Record<string, unknown>));
}

export async function acknowledgeMonitorAlert(id: string): Promise<void> {
  const db = await getDb();
  await db.execute({
    sql: `UPDATE monitor_alerts SET acknowledged = 1 WHERE id = ?`,
    args: [id],
  });
}

export async function saveMonitorPollRun(
  input: Omit<MonitorPollRun, 'id' | 'createdAt'>,
): Promise<MonitorPollRun> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  await db.execute({
    sql: `INSERT INTO monitor_poll_runs
          (id, trade_date, status, news_count, new_news_count, alert_count,
           symbols_scanned, market_open, elapsed_ms, summary, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      input.tradeDate,
      input.status,
      input.newsCount,
      input.newNewsCount,
      input.alertCount,
      input.symbolsScanned,
      input.marketOpen ? 1 : 0,
      input.elapsedMs,
      input.summary,
      createdAt,
    ],
  });

  return { ...input, id, createdAt };
}

export async function getLatestMonitorPollRun(): Promise<MonitorPollRun | null> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM monitor_poll_runs ORDER BY created_at DESC LIMIT 1`,
  });
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  return {
    id: String(row.id),
    tradeDate: String(row.trade_date),
    status: row.status as MonitorPollRun['status'],
    newsCount: Number(row.news_count),
    newNewsCount: Number(row.new_news_count),
    alertCount: Number(row.alert_count),
    symbolsScanned: Number(row.symbols_scanned),
    marketOpen: Number(row.market_open) === 1,
    elapsedMs: Number(row.elapsed_ms),
    summary: String(row.summary),
    createdAt: String(row.created_at),
  };
}

type NewsSeenInput = {
  key: string;
  title: string;
  url?: string | null;
  source?: string | null;
  publishedAt?: string | null;
};

export async function markNewsSeen(items: NewsSeenInput[]) {
  if (items.length === 0) return;
  const db = await getDb();
  const now = new Date().toISOString();

  for (const item of items) {
    await db.execute({
      sql: `INSERT OR IGNORE INTO monitor_news_seen (news_key, title, first_seen_at) VALUES (?, ?, ?)`,
      args: [item.key, item.title, now],
    });
    await db.execute({
      sql: `INSERT OR IGNORE INTO monitor_news_events
            (news_key, title, url, source, published_at, first_seen_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        item.key,
        item.title,
        item.url ?? null,
        item.source ?? null,
        item.publishedAt ?? null,
        now,
      ],
    });
  }
}

export async function filterUnseenNews(
  items: Array<{ key: string; title: string }>,
): Promise<Array<{ key: string; title: string }>> {
  if (items.length === 0) return [];
  const db = await getDb();
  const unseen: Array<{ key: string; title: string }> = [];

  for (const item of items) {
    const result = await db.execute({
      sql: `SELECT news_key FROM monitor_news_events WHERE news_key = ? LIMIT 1`,
      args: [item.key],
    });
    if (result.rows.length === 0) unseen.push(item);
  }

  return unseen;
}

export async function getMonitorRuntimeState(
  key = 'default',
): Promise<MonitorRuntimeState | null> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT state_json FROM monitor_runtime_state WHERE state_key = ? LIMIT 1`,
    args: [key],
  });
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  try {
    return JSON.parse(String(row.state_json)) as MonitorRuntimeState;
  } catch {
    return null;
  }
}

export async function setMonitorRuntimeState(
  key: string,
  state: MonitorRuntimeState,
): Promise<void> {
  const db = await getDb();
  await db.execute({
    sql: `INSERT INTO monitor_runtime_state (state_key, state_json, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(state_key) DO UPDATE SET
            state_json = excluded.state_json,
            updated_at = excluded.updated_at`,
    args: [key, JSON.stringify(state), new Date().toISOString()],
  });
}

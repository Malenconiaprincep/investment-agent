import { createClient, type Client } from '@libsql/client';
import { getPrimaryLibsqlOptions } from '../libsql-config.js';

export type HotNewsItem = {
  title: string;
  datetime: string;
  url: string | null;
};

export type ScreeningSessionRecord = {
  id: string;
  query: string;
  sectors: Array<{ name: string; reason: string; dataSource: string }>;
  candidates: Array<{
    symbol: string;
    name: string;
    thesis: string;
    dataSource: string;
  }>;
  rotationSummary: string;
  hotNews: HotNewsItem[];
  hotThemes: string[];
  mode: 'auto' | 'manual';
  passed: boolean;
  elapsedMs: number | null;
  createdAt: string;
};

export type ScreeningSessionSummary = Omit<
  ScreeningSessionRecord,
  'rotationSummary' | 'sectors' | 'candidates' | 'hotNews'
> & {
  sectorCount: number;
  candidateCount: number;
};

export type CommitteeSessionRecord = {
  id: string;
  screeningSessionId: string | null;
  candidates: Array<{ symbol: string; name: string }>;
  memo: string;
  passed: boolean;
  elapsedMs: number | null;
  createdAt: string;
};

export type SaveScreeningInput = {
  query: string;
  sectors: ScreeningSessionRecord['sectors'];
  candidates: ScreeningSessionRecord['candidates'];
  rotationSummary: string;
  hotNews?: HotNewsItem[];
  hotThemes?: string[];
  mode?: 'auto' | 'manual';
  passed: boolean;
  screenedAt: string;
  elapsedMs?: number;
};

export type ListScreeningSessionsOptions = {
  limit?: number;
};

export type SaveCommitteeInput = {
  screeningSessionId?: string | null;
  candidates: Array<{ symbol: string; name: string }>;
  memo: string;
  passed: boolean;
  completedAt: string;
  elapsedMs?: number;
};

let client: Client | null = null;
let migrated = false;

async function getDb(): Promise<Client> {
  if (!client) {
    client = createClient(getPrimaryLibsqlOptions());
  }

  if (!migrated) {
    await client.batch([
      `CREATE TABLE IF NOT EXISTS screening_sessions (
        id TEXT PRIMARY KEY,
        query TEXT NOT NULL,
        sectors TEXT NOT NULL,
        candidates TEXT NOT NULL,
        rotation_summary TEXT NOT NULL,
        hot_news TEXT NOT NULL DEFAULT '[]',
        hot_themes TEXT NOT NULL DEFAULT '[]',
        mode TEXT NOT NULL DEFAULT 'auto',
        passed INTEGER NOT NULL DEFAULT 0,
        elapsed_ms INTEGER,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS committee_sessions (
        id TEXT PRIMARY KEY,
        screening_session_id TEXT,
        candidates TEXT NOT NULL,
        memo TEXT NOT NULL,
        passed INTEGER NOT NULL DEFAULT 0,
        elapsed_ms INTEGER,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_screening_sessions_created_at
        ON screening_sessions(created_at DESC)`,
    ]);
    await ensureScreeningSessionColumns(client);
    migrated = true;
  }

  return client;
}

async function ensureScreeningSessionColumns(db: Client) {
  const alters = [
    `ALTER TABLE screening_sessions ADD COLUMN hot_news TEXT NOT NULL DEFAULT '[]'`,
    `ALTER TABLE screening_sessions ADD COLUMN hot_themes TEXT NOT NULL DEFAULT '[]'`,
    `ALTER TABLE screening_sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'auto'`,
  ];
  for (const sql of alters) {
    try {
      await db.execute(sql);
    } catch {
      // column already exists
    }
  }
}

function mapScreeningRow(row: Record<string, unknown>): ScreeningSessionRecord {
  return {
    id: String(row.id),
    query: String(row.query),
    sectors: JSON.parse(String(row.sectors)) as ScreeningSessionRecord['sectors'],
    candidates: JSON.parse(
      String(row.candidates),
    ) as ScreeningSessionRecord['candidates'],
    rotationSummary: String(row.rotation_summary),
    hotNews: JSON.parse(String(row.hot_news ?? '[]')) as HotNewsItem[],
    hotThemes: JSON.parse(String(row.hot_themes ?? '[]')) as string[],
    mode: row.mode === 'manual' ? 'manual' : 'auto',
    passed: Boolean(row.passed),
    elapsedMs:
      row.elapsed_ms == null ? null : Number(row.elapsed_ms),
    createdAt: String(row.created_at),
  };
}

function mapScreeningSummary(row: Record<string, unknown>): ScreeningSessionSummary {
  const sectors = JSON.parse(String(row.sectors)) as ScreeningSessionRecord['sectors'];
  const candidates = JSON.parse(
    String(row.candidates),
  ) as ScreeningSessionRecord['candidates'];

  return {
    id: String(row.id),
    query: String(row.query),
    hotThemes: JSON.parse(String(row.hot_themes ?? '[]')) as string[],
    mode: row.mode === 'manual' ? 'manual' : 'auto',
    passed: Boolean(row.passed),
    elapsedMs:
      row.elapsed_ms == null ? null : Number(row.elapsed_ms),
    createdAt: String(row.created_at),
    sectorCount: sectors.length,
    candidateCount: candidates.length,
  };
}

export async function saveScreeningSession(
  input: SaveScreeningInput,
): Promise<ScreeningSessionRecord> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const createdAt = input.screenedAt || new Date().toISOString();

  await db.execute({
    sql: `INSERT INTO screening_sessions (
      id, query, sectors, candidates, rotation_summary,
      hot_news, hot_themes, mode, passed, elapsed_ms, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      input.query,
      JSON.stringify(input.sectors),
      JSON.stringify(input.candidates),
      input.rotationSummary,
      JSON.stringify(input.hotNews ?? []),
      JSON.stringify(input.hotThemes ?? []),
      input.mode ?? 'auto',
      input.passed ? 1 : 0,
      input.elapsedMs ?? null,
      createdAt,
    ],
  });

  return {
    id,
    query: input.query,
    sectors: input.sectors,
    candidates: input.candidates,
    rotationSummary: input.rotationSummary,
    hotNews: input.hotNews ?? [],
    hotThemes: input.hotThemes ?? [],
    mode: input.mode ?? 'auto',
    passed: input.passed,
    elapsedMs: input.elapsedMs ?? null,
    createdAt,
  };
}

export async function saveCommitteeSession(
  input: SaveCommitteeInput,
): Promise<CommitteeSessionRecord> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const createdAt = input.completedAt || new Date().toISOString();

  await db.execute({
    sql: `INSERT INTO committee_sessions (
      id, screening_session_id, candidates, memo, passed, elapsed_ms, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      input.screeningSessionId ?? null,
      JSON.stringify(input.candidates),
      input.memo,
      input.passed ? 1 : 0,
      input.elapsedMs ?? null,
      createdAt,
    ],
  });

  return {
    id,
    screeningSessionId: input.screeningSessionId ?? null,
    candidates: input.candidates,
    memo: input.memo,
    passed: input.passed,
    elapsedMs: input.elapsedMs ?? null,
    createdAt,
  };
}

export async function getScreeningSession(
  id: string,
): Promise<ScreeningSessionRecord | null> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM screening_sessions WHERE id = ?`,
    args: [id],
  });

  if (result.rows.length === 0) return null;

  return mapScreeningRow(result.rows[0] as Record<string, unknown>);
}

export async function listScreeningSessions(
  options: ListScreeningSessionsOptions = {},
): Promise<ScreeningSessionSummary[]> {
  const db = await getDb();
  const limit = options.limit ?? 50;

  const result = await db.execute({
    sql: `SELECT id, query, sectors, candidates, hot_themes, mode, passed, elapsed_ms, created_at
          FROM screening_sessions
          ORDER BY created_at DESC
          LIMIT ?`,
    args: [limit],
  });

  return result.rows.map((row) =>
    mapScreeningSummary(row as Record<string, unknown>),
  );
}

export async function getCommitteeSessionByScreeningId(
  screeningSessionId: string,
): Promise<CommitteeSessionRecord | null> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM committee_sessions
          WHERE screening_session_id = ?
          ORDER BY created_at DESC
          LIMIT 1`,
    args: [screeningSessionId],
  });

  if (result.rows.length === 0) return null;

  const row = result.rows[0] as Record<string, unknown>;
  return {
    id: String(row.id),
    screeningSessionId:
      row.screening_session_id == null
        ? null
        : String(row.screening_session_id),
    candidates: JSON.parse(String(row.candidates)) as CommitteeSessionRecord['candidates'],
    memo: String(row.memo),
    passed: Boolean(row.passed),
    elapsedMs:
      row.elapsed_ms == null ? null : Number(row.elapsed_ms),
    createdAt: String(row.created_at),
  };
}

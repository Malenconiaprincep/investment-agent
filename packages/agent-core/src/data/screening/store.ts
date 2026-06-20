import { createClient, type Client } from '@libsql/client';
import { DATA_DIR } from '../../mastra/config/paths.js';

const DB_URL = `file:${DATA_DIR}/research-reports.db`;

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
  passed: boolean;
  elapsedMs: number | null;
  createdAt: string;
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
  passed: boolean;
  screenedAt: string;
  elapsedMs?: number;
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
    client = createClient({ url: DB_URL });
  }

  if (!migrated) {
    await client.batch([
      `CREATE TABLE IF NOT EXISTS screening_sessions (
        id TEXT PRIMARY KEY,
        query TEXT NOT NULL,
        sectors TEXT NOT NULL,
        candidates TEXT NOT NULL,
        rotation_summary TEXT NOT NULL,
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
    ]);
    migrated = true;
  }

  return client;
}

export async function saveScreeningSession(
  input: SaveScreeningInput,
): Promise<ScreeningSessionRecord> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const createdAt = input.screenedAt || new Date().toISOString();

  await db.execute({
    sql: `INSERT INTO screening_sessions (
      id, query, sectors, candidates, rotation_summary, passed, elapsed_ms, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      input.query,
      JSON.stringify(input.sectors),
      JSON.stringify(input.candidates),
      input.rotationSummary,
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

  const row = result.rows[0] as Record<string, unknown>;
  return {
    id: String(row.id),
    query: String(row.query),
    sectors: JSON.parse(String(row.sectors)) as ScreeningSessionRecord['sectors'],
    candidates: JSON.parse(String(row.candidates)) as ScreeningSessionRecord['candidates'],
    rotationSummary: String(row.rotation_summary),
    passed: Boolean(row.passed),
    elapsedMs:
      row.elapsed_ms == null ? null : Number(row.elapsed_ms),
    createdAt: String(row.created_at),
  };
}

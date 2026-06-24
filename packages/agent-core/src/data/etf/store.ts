import { createClient, type Client } from '@libsql/client';
import { getPrimaryLibsqlOptions } from '../libsql-config.js';
import type { EtfTailPickCandidate } from './rules.js';

export type EtfTailPickRunStatus = 'success' | '0_PASS' | 'skipped' | 'failed';

export type EtfTailPickRun = {
  id: string;
  tradeDate: string;
  status: EtfTailPickRunStatus;
  summary: string;
  generatedAt: string;
  elapsedMs: number | null;
  passedCount: number;
  nearPassCount: number;
  candidates: EtfTailPickCandidate[];
};

export type SaveEtfTailPickRunInput = Omit<EtfTailPickRun, 'id'>;

let client: Client | null = null;
let migrated = false;

async function getDb(): Promise<Client> {
  if (!client) {
    client = createClient(getPrimaryLibsqlOptions());
  }

  if (!migrated) {
    await client.batch([
      `CREATE TABLE IF NOT EXISTS etf_tail_pick_runs (
        id TEXT PRIMARY KEY,
        trade_date TEXT NOT NULL,
        status TEXT NOT NULL,
        summary TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        elapsed_ms INTEGER,
        passed_count INTEGER NOT NULL,
        near_pass_count INTEGER NOT NULL,
        candidates TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_etf_tail_pick_runs_generated_at
        ON etf_tail_pick_runs(generated_at DESC)`,
    ]);
    migrated = true;
  }

  return client;
}

function mapRun(row: Record<string, unknown>): EtfTailPickRun {
  return {
    id: String(row.id),
    tradeDate: String(row.trade_date),
    status: String(row.status) as EtfTailPickRunStatus,
    summary: String(row.summary),
    generatedAt: String(row.generated_at),
    elapsedMs: row.elapsed_ms == null ? null : Number(row.elapsed_ms),
    passedCount: Number(row.passed_count ?? 0),
    nearPassCount: Number(row.near_pass_count ?? 0),
    candidates: JSON.parse(String(row.candidates ?? '[]')) as EtfTailPickCandidate[],
  };
}

export async function saveEtfTailPickRun(
  input: SaveEtfTailPickRunInput,
): Promise<EtfTailPickRun> {
  const db = await getDb();
  const id = crypto.randomUUID();

  await db.execute({
    sql: `INSERT INTO etf_tail_pick_runs (
      id, trade_date, status, summary, generated_at, elapsed_ms,
      passed_count, near_pass_count, candidates
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      input.tradeDate,
      input.status,
      input.summary,
      input.generatedAt,
      input.elapsedMs,
      input.passedCount,
      input.nearPassCount,
      JSON.stringify(input.candidates),
    ],
  });

  return {
    id,
    ...input,
  };
}

export async function listEtfTailPickRuns(limit = 20): Promise<EtfTailPickRun[]> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM etf_tail_pick_runs
      ORDER BY generated_at DESC
      LIMIT ?`,
    args: [limit],
  });

  return result.rows.map((row) => mapRun(row as Record<string, unknown>));
}

export async function getLatestEtfTailPickRun(): Promise<EtfTailPickRun | null> {
  const runs = await listEtfTailPickRuns(1);
  return runs[0] ?? null;
}

import { createClient, type Client } from '@libsql/client';
import { getPrimaryLibsqlOptions } from '../libsql-config.js';
import type { ResearchWorkflowOutput } from '../../api/run-research-workflow.js';

export type ResearchReportRecord = {
  id: string;
  symbol: string;
  name: string;
  report: string;
  passed: boolean;
  missingSections: string[];
  missingKeywords: string[];
  elapsedMs: number | null;
  createdAt: string;
};

export type ResearchReportSummary = Omit<ResearchReportRecord, 'report'>;

export type SaveResearchReportInput = ResearchWorkflowOutput & {
  elapsedMs?: number;
};

export type ListResearchReportsOptions = {
  symbol?: string;
  limit?: number;
};

let client: Client | null = null;
let migrated = false;

async function getDb(): Promise<Client> {
  if (!client) {
    client = createClient(getPrimaryLibsqlOptions());
  }

  if (!migrated) {
    await client.batch([
      `CREATE TABLE IF NOT EXISTS research_reports (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        name TEXT NOT NULL,
        report TEXT NOT NULL,
        passed INTEGER NOT NULL DEFAULT 0,
        missing_sections TEXT NOT NULL DEFAULT '[]',
        missing_keywords TEXT NOT NULL DEFAULT '[]',
        elapsed_ms INTEGER,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_research_reports_symbol
        ON research_reports(symbol)`,
      `CREATE INDEX IF NOT EXISTS idx_research_reports_created_at
        ON research_reports(created_at DESC)`,
    ]);
    migrated = true;
  }

  return client;
}

function mapRow(row: Record<string, unknown>): ResearchReportRecord {
  return {
    id: String(row.id),
    symbol: String(row.symbol),
    name: String(row.name),
    report: String(row.report),
    passed: Boolean(row.passed),
    missingSections: JSON.parse(String(row.missing_sections)) as string[],
    missingKeywords: JSON.parse(String(row.missing_keywords)) as string[],
    elapsedMs:
      row.elapsed_ms === null || row.elapsed_ms === undefined
        ? null
        : Number(row.elapsed_ms),
    createdAt: String(row.created_at),
  };
}

function mapSummary(row: Record<string, unknown>): ResearchReportSummary {
  return {
    id: String(row.id),
    symbol: String(row.symbol),
    name: String(row.name),
    passed: Boolean(row.passed),
    missingSections: JSON.parse(String(row.missing_sections)) as string[],
    missingKeywords: JSON.parse(String(row.missing_keywords)) as string[],
    elapsedMs:
      row.elapsed_ms === null || row.elapsed_ms === undefined
        ? null
        : Number(row.elapsed_ms),
    createdAt: String(row.created_at),
  };
}

export async function saveResearchReport(
  input: SaveResearchReportInput,
): Promise<ResearchReportRecord> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const createdAt = input.workflowCompletedAt || new Date().toISOString();

  await db.execute({
    sql: `INSERT INTO research_reports (
      id, symbol, name, report, passed,
      missing_sections, missing_keywords, elapsed_ms, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      input.symbol,
      input.name,
      input.report,
      input.passed ? 1 : 0,
      JSON.stringify(input.missingSections),
      JSON.stringify(input.missingKeywords),
      input.elapsedMs ?? null,
      createdAt,
    ],
  });

  return {
    id,
    symbol: input.symbol,
    name: input.name,
    report: input.report,
    passed: input.passed,
    missingSections: input.missingSections,
    missingKeywords: input.missingKeywords,
    elapsedMs: input.elapsedMs ?? null,
    createdAt,
  };
}

export async function listResearchReports(
  options: ListResearchReportsOptions = {},
): Promise<ResearchReportSummary[]> {
  const db = await getDb();
  const limit = options.limit ?? 50;

  const result = options.symbol
    ? await db.execute({
        sql: `SELECT id, symbol, name, passed, missing_sections, missing_keywords,
              elapsed_ms, created_at
              FROM research_reports
              WHERE symbol = ?
              ORDER BY created_at DESC
              LIMIT ?`,
        args: [options.symbol, limit],
      })
    : await db.execute({
        sql: `SELECT id, symbol, name, passed, missing_sections, missing_keywords,
              elapsed_ms, created_at
              FROM research_reports
              ORDER BY created_at DESC
              LIMIT ?`,
        args: [limit],
      });

  return result.rows.map((row) => mapSummary(row as Record<string, unknown>));
}

export async function getResearchReport(
  id: string,
): Promise<ResearchReportRecord | null> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM research_reports WHERE id = ?`,
    args: [id],
  });

  if (result.rows.length === 0) {
    return null;
  }

  return mapRow(result.rows[0] as Record<string, unknown>);
}

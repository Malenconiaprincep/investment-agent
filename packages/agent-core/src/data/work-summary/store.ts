import { createClient, type Client } from '@libsql/client';
import { getPrimaryLibsqlOptions } from '../libsql-config.js';
import type { WorkSummaryReport } from './summary.js';

export type WorkSummaryRunSummary = {
  id: string;
  generatedAt: string;
  createdAt: string;
  overallScore: number;
  grade: WorkSummaryReport['score']['grade'];
  paperReturnPct: number | null;
  backtestAvgReturnPct: number | null;
  riskScore: number;
  coverageScore: number;
  validationScore: number;
  iterationScore: number;
  urgentAlerts: number;
  unacknowledgedAlerts: number;
};

export type WorkSummaryRunRecord = WorkSummaryRunSummary & {
  report: WorkSummaryReport;
};

let client: Client | null = null;
let migrated = false;

async function getDb(): Promise<Client> {
  if (!client) {
    client = createClient(getPrimaryLibsqlOptions('work-summary.db'));
  }

  if (!migrated) {
    await client.batch([
      `CREATE TABLE IF NOT EXISTS work_summary_runs (
        id TEXT PRIMARY KEY,
        generated_at TEXT NOT NULL,
        overall_score INTEGER NOT NULL,
        grade TEXT NOT NULL,
        paper_return_pct REAL,
        backtest_avg_return_pct REAL,
        risk_score INTEGER NOT NULL,
        coverage_score INTEGER NOT NULL,
        validation_score INTEGER NOT NULL,
        iteration_score INTEGER NOT NULL,
        urgent_alerts INTEGER NOT NULL,
        unacknowledged_alerts INTEGER NOT NULL,
        report_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_work_summary_runs_created_at
        ON work_summary_runs(created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_work_summary_runs_generated_at
        ON work_summary_runs(generated_at DESC)`,
    ]);
    migrated = true;
  }

  return client;
}

function componentScore(report: WorkSummaryReport, key: string): number {
  return report.score.components.find((component) => component.key === key)?.score ?? 0;
}

function mapSummaryRow(row: Record<string, unknown>): WorkSummaryRunSummary {
  return {
    id: String(row.id),
    generatedAt: String(row.generated_at),
    createdAt: String(row.created_at),
    overallScore: Number(row.overall_score),
    grade: row.grade as WorkSummaryRunSummary['grade'],
    paperReturnPct:
      row.paper_return_pct == null ? null : Number(row.paper_return_pct),
    backtestAvgReturnPct:
      row.backtest_avg_return_pct == null
        ? null
        : Number(row.backtest_avg_return_pct),
    riskScore: Number(row.risk_score),
    coverageScore: Number(row.coverage_score),
    validationScore: Number(row.validation_score),
    iterationScore: Number(row.iteration_score),
    urgentAlerts: Number(row.urgent_alerts),
    unacknowledgedAlerts: Number(row.unacknowledged_alerts),
  };
}

function mapRecordRow(row: Record<string, unknown>): WorkSummaryRunRecord {
  return {
    ...mapSummaryRow(row),
    report: JSON.parse(String(row.report_json)) as WorkSummaryReport,
  };
}

export async function saveWorkSummaryRun(
  report: WorkSummaryReport,
): Promise<WorkSummaryRunRecord> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const validationScore = componentScore(report, 'validation');
  const iterationScore = componentScore(report, 'iteration');

  await db.execute({
    sql: `INSERT INTO work_summary_runs (
      id, generated_at, overall_score, grade, paper_return_pct,
      backtest_avg_return_pct, risk_score, coverage_score, validation_score,
      iteration_score, urgent_alerts, unacknowledged_alerts, report_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      report.generatedAt,
      report.score.overall,
      report.score.grade,
      report.performance.paperReturnPct,
      report.performance.backtestAvgReturnPct,
      report.risk.score,
      report.coverage.score,
      validationScore,
      iterationScore,
      report.risk.urgentAlerts,
      report.risk.unacknowledgedAlerts,
      JSON.stringify(report),
      createdAt,
    ],
  });

  return {
    id,
    generatedAt: report.generatedAt,
    createdAt,
    overallScore: report.score.overall,
    grade: report.score.grade,
    paperReturnPct: report.performance.paperReturnPct,
    backtestAvgReturnPct: report.performance.backtestAvgReturnPct,
    riskScore: report.risk.score,
    coverageScore: report.coverage.score,
    validationScore,
    iterationScore,
    urgentAlerts: report.risk.urgentAlerts,
    unacknowledgedAlerts: report.risk.unacknowledgedAlerts,
    report,
  };
}

export async function listWorkSummaryRuns(
  limit = 30,
): Promise<WorkSummaryRunSummary[]> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT id, generated_at, overall_score, grade, paper_return_pct,
      backtest_avg_return_pct, risk_score, coverage_score, validation_score,
      iteration_score, urgent_alerts, unacknowledged_alerts, created_at
      FROM work_summary_runs
      ORDER BY created_at DESC
      LIMIT ?`,
    args: [Math.max(1, Math.min(120, Math.floor(limit)))],
  });

  return result.rows.map((row) => mapSummaryRow(row as Record<string, unknown>));
}

export async function getWorkSummaryRun(
  id: string,
): Promise<WorkSummaryRunRecord | null> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM work_summary_runs WHERE id = ?`,
    args: [id],
  });
  const row = result.rows[0] as Record<string, unknown> | undefined;
  return row ? mapRecordRow(row) : null;
}

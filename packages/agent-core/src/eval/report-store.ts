import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../mastra/config/paths.js';

export type EvalSuiteResult = {
  name: string;
  total: number;
  passed: number;
  failed: number;
  elapsedMs: number;
  skipped?: number;
};

export type EvalReport = {
  ranAt: string;
  elapsedMs: number;
  passRate: number;
  suites: EvalSuiteResult[];
  failures: Array<{ suite: string; id: string; detail: string }>;
};

const REPORT_PATH = path.join(DATA_DIR, 'eval-latest.json');

export function saveEvalReport(report: EvalReport): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf-8');
}

export function getEvalReportPath() {
  return REPORT_PATH;
}

export function computePassRate(suites: EvalSuiteResult[]): number {
  const total = suites.reduce((sum, suite) => sum + suite.total, 0);
  const passed = suites.reduce((sum, suite) => sum + suite.passed, 0);
  if (total === 0) return 0;
  return Number(((passed / total) * 100).toFixed(1));
}

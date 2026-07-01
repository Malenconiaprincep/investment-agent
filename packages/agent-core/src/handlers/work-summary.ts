import { buildWorkSummaryReport } from '../data/work-summary/summary.js';
import {
  getWorkSummaryRun,
  listWorkSummaryRuns,
  saveWorkSummaryRun,
  type WorkSummaryRunSummary,
} from '../data/work-summary/store.js';

type WorkSummaryComparison = {
  previous: WorkSummaryRunSummary | null;
  scoreDelta: number | null;
  paperReturnDeltaPct: number | null;
  riskScoreDelta: number | null;
  coverageScoreDelta: number | null;
  verdict: 'improved' | 'worse' | 'flat' | 'unknown';
};

function deltaNumber(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null) return null;
  return Number((current - previous).toFixed(2));
}

function compareRuns(
  current: WorkSummaryRunSummary,
  previous: WorkSummaryRunSummary | null,
): WorkSummaryComparison {
  if (!previous) {
    return {
      previous: null,
      scoreDelta: null,
      paperReturnDeltaPct: null,
      riskScoreDelta: null,
      coverageScoreDelta: null,
      verdict: 'unknown',
    };
  }

  const scoreDelta = deltaNumber(current.overallScore, previous.overallScore);
  const paperReturnDeltaPct = deltaNumber(
    current.paperReturnPct,
    previous.paperReturnPct,
  );
  const riskScoreDelta = deltaNumber(current.riskScore, previous.riskScore);
  const coverageScoreDelta = deltaNumber(
    current.coverageScore,
    previous.coverageScore,
  );
  const compositeDelta =
    (scoreDelta ?? 0) +
    (riskScoreDelta ?? 0) * 0.4 +
    (paperReturnDeltaPct ?? 0) * 3;

  return {
    previous,
    scoreDelta,
    paperReturnDeltaPct,
    riskScoreDelta,
    coverageScoreDelta,
    verdict:
      compositeDelta > 1
        ? 'improved'
        : compositeDelta < -1
          ? 'worse'
          : 'flat',
  };
}

export async function dispatchWorkSummary(args: string[]): Promise<string> {
  const command = args[0] ?? 'latest';

  if (command === 'report') {
    return JSON.stringify(await buildWorkSummaryReport());
  }

  if (command === 'latest' || command === 'snapshot') {
    const report = await buildWorkSummaryReport();
    const saved = await saveWorkSummaryRun(report);
    const current: WorkSummaryRunSummary = {
      id: saved.id,
      generatedAt: saved.generatedAt,
      createdAt: saved.createdAt,
      overallScore: saved.overallScore,
      grade: saved.grade,
      paperReturnPct: saved.paperReturnPct,
      backtestAvgReturnPct: saved.backtestAvgReturnPct,
      riskScore: saved.riskScore,
      coverageScore: saved.coverageScore,
      validationScore: saved.validationScore,
      iterationScore: saved.iterationScore,
      urgentAlerts: saved.urgentAlerts,
      unacknowledgedAlerts: saved.unacknowledgedAlerts,
    };
    const history = await listWorkSummaryRuns(30);
    const previous = history.find((run) => run.id !== current.id) ?? null;
    return JSON.stringify({
      report,
      current,
      history,
      comparison: compareRuns(current, previous),
    });
  }

  if (command === 'history') {
    const limit = Number(args[1] ?? 30);
    return JSON.stringify({
      history: await listWorkSummaryRuns(
        Number.isFinite(limit) ? Math.floor(limit) : 30,
      ),
    });
  }

  if (command === 'get' && args[1]) {
    const run = await getWorkSummaryRun(args[1]);
    if (!run) throw new Error(`Work summary run not found: ${args[1]}`);
    return JSON.stringify({ run });
  }

  throw new Error('Usage: latest|snapshot|history [limit]|get <id>|report');
}

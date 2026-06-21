import 'dotenv/config';

import { readFileSync } from 'node:fs';
import {
  compareScreeningSessions,
} from '../data/screening/compare.js';
import {
  computeScreeningBacktest,
} from '../data/screening/backtest.js';
import {
  getCommitteeSessionByScreeningId,
  getScreeningSession,
  listScreeningSessions,
} from '../data/screening/store.js';
import { getFeedbackSummary } from '../data/feedback/store.js';
import { getEvalReportPath } from '../eval/report-store.js';

async function main() {
  const command = process.argv[2];
  const arg1 = process.argv[3];
  const arg2 = process.argv[4];

  if (command === 'list') {
    const sessions = await listScreeningSessions({ limit: 100 });
    process.stdout.write(JSON.stringify(sessions));
    return;
  }

  if (command === 'get' && arg1) {
    const session = await getScreeningSession(arg1);
    if (!session) {
      process.stderr.write(`Screening session not found: ${arg1}`);
      process.exit(1);
    }

    const [committee, feedback] = await Promise.all([
      getCommitteeSessionByScreeningId(arg1),
      getFeedbackSummary('screening', arg1),
    ]);

    process.stdout.write(JSON.stringify({ ...session, committee, feedback }));
    return;
  }

  if (command === 'compare' && arg1 && arg2) {
    const [base, target] = await Promise.all([
      getScreeningSession(arg1),
      getScreeningSession(arg2),
    ]);

    if (!base || !target) {
      process.stderr.write('Screening session not found');
      process.exit(1);
    }

    process.stdout.write(
      JSON.stringify(compareScreeningSessions(base, target)),
    );
    return;
  }

  if (command === 'backtest' && arg1) {
    const session = await getScreeningSession(arg1);
    if (!session) {
      process.stderr.write(`Screening session not found: ${arg1}`);
      process.exit(1);
    }

    const holdDays = Number(process.argv[4] ?? 5);
    const result = await computeScreeningBacktest({
      screeningId: session.id,
      screenedAt: session.createdAt,
      candidates: session.candidates,
      holdDays: Number.isFinite(holdDays) ? holdDays : 5,
    });
    process.stdout.write(JSON.stringify(result));
    return;
  }

  if (command === 'eval-report') {
    try {
      const raw = readFileSync(getEvalReportPath(), 'utf-8');
      process.stdout.write(raw);
    } catch {
      process.stdout.write('null');
    }
    return;
  }

  process.stderr.write(
    'Usage: screenings-json.ts list | get <id> | compare <a> <b> | backtest <id> [days] | eval-report',
  );
  process.exit(1);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(message);
  process.exit(1);
});

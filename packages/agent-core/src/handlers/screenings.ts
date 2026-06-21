import { readFileSync } from 'node:fs';
import { compareScreeningSessions } from '../data/screening/compare.js';
import { computeScreeningBacktest } from '../data/screening/backtest.js';
import {
  getCommitteeSessionByScreeningId,
  getScreeningSession,
  listScreeningSessions,
} from '../data/screening/store.js';
import { getFeedbackSummary } from '../data/feedback/store.js';
import { getEvalReportPath } from '../eval/report-store.js';

export async function dispatchScreenings(args: string[]): Promise<string> {
  const command = args[0];
  const arg1 = args[1];
  const arg2 = args[2];

  if (command === 'list') {
    return JSON.stringify(await listScreeningSessions({ limit: 100 }));
  }

  if (command === 'get' && arg1) {
    const session = await getScreeningSession(arg1);
    if (!session) throw new Error(`Screening session not found: ${arg1}`);
    const [committee, feedback] = await Promise.all([
      getCommitteeSessionByScreeningId(arg1),
      getFeedbackSummary('screening', arg1),
    ]);
    return JSON.stringify({ ...session, committee, feedback });
  }

  if (command === 'compare' && arg1 && arg2) {
    const [base, target] = await Promise.all([
      getScreeningSession(arg1),
      getScreeningSession(arg2),
    ]);
    if (!base || !target) throw new Error('Screening session not found');
    return JSON.stringify(compareScreeningSessions(base, target));
  }

  if (command === 'backtest' && arg1) {
    const session = await getScreeningSession(arg1);
    if (!session) throw new Error(`Screening session not found: ${arg1}`);
    const holdArg = args[2];
    const holdDays =
      !holdArg || holdArg === 'auto' || holdArg === '0' ? 0 : Number(holdArg);
    return JSON.stringify(
      await computeScreeningBacktest({
        screeningId: session.id,
        screenedAt: session.createdAt,
        candidates: session.candidates,
        holdDays: Number.isFinite(holdDays) && holdDays >= 0 ? holdDays : 0,
      }),
    );
  }

  if (command === 'eval-report') {
    try {
      return readFileSync(getEvalReportPath(), 'utf-8');
    } catch {
      return 'null';
    }
  }

  throw new Error('Usage: list | get <id> | compare <a> <b> | backtest <id> [days] | eval-report');
}

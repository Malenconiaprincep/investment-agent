import { getResearchReport, listResearchReports } from '../data/reports/store.js';
import { getFeedbackSummary } from '../data/feedback/store.js';

export async function dispatchReports(args: string[]): Promise<string> {
  const command = args[0];
  const id = args[1];

  if (command === 'list') {
    const symbol = args[2];
    const reports = await listResearchReports({
      symbol: symbol && /^\d{6}$/.test(symbol) ? symbol : undefined,
      limit: 100,
    });
    return JSON.stringify(reports);
  }

  if (command === 'get' && id) {
    const report = await getResearchReport(id);
    if (!report) throw new Error(`Report not found: ${id}`);
    const feedback = await getFeedbackSummary('report', id);
    return JSON.stringify({ ...report, feedback });
  }

  throw new Error('Usage: list [symbol] | get <id>');
}

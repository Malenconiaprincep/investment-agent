import 'dotenv/config';

import {
  getResearchReport,
  listResearchReports,
} from '../data/reports/store.js';

async function main() {
  const command = process.argv[2];
  const id = process.argv[3];

  if (command === 'list') {
    const symbol = process.argv[4];
    const reports = await listResearchReports({
      symbol: symbol && /^\d{6}$/.test(symbol) ? symbol : undefined,
      limit: 100,
    });
    process.stdout.write(JSON.stringify(reports));
    return;
  }

  if (command === 'get' && id) {
    const report = await getResearchReport(id);
    if (!report) {
      process.stderr.write(`Report not found: ${id}`);
      process.exit(1);
    }
    process.stdout.write(JSON.stringify(report));
    return;
  }

  process.stderr.write('Usage: reports-json.ts list [symbol] | get <id>');
  process.exit(1);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(message);
  process.exit(1);
});

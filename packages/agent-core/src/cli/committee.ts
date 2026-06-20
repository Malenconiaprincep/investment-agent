import 'dotenv/config';

import { runCommitteeStream } from '../api/run-committee-stream.js';

async function main() {
  const arg = process.argv.slice(2).join(' ').trim();
  const symbols = arg.match(/\d{6}/g) ?? ['600519', '000001'];
  const candidates = symbols.map((symbol) => ({ symbol, name: symbol }));

  await runCommitteeStream({ candidates, maxAnalyze: 3 }, (event) => {
    if (event.type === 'step') console.log(`\n[${event.label}]`);
    if (event.type === 'specialist') {
      console.log(`  ${event.role}: ${event.status}`);
    }
    if (event.type === 'token') process.stdout.write(event.text);
    if (event.type === 'done') {
      console.log(`\n\n质检: ${event.passed ? 'PASS' : 'FAIL'}`);
    }
    if (event.type === 'error') console.error('ERROR:', event.message);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

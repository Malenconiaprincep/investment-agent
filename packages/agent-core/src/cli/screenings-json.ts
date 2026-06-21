import 'dotenv/config';

import {
  getCommitteeSessionByScreeningId,
  getScreeningSession,
  listScreeningSessions,
} from '../data/screening/store.js';

async function main() {
  const command = process.argv[2];
  const id = process.argv[3];

  if (command === 'list') {
    const sessions = await listScreeningSessions({ limit: 100 });
    process.stdout.write(JSON.stringify(sessions));
    return;
  }

  if (command === 'get' && id) {
    const session = await getScreeningSession(id);
    if (!session) {
      process.stderr.write(`Screening session not found: ${id}`);
      process.exit(1);
    }

    const committee = await getCommitteeSessionByScreeningId(id);
    process.stdout.write(JSON.stringify({ ...session, committee }));
    return;
  }

  process.stderr.write('Usage: screenings-json.ts list | get <id>');
  process.exit(1);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(message);
  process.exit(1);
});

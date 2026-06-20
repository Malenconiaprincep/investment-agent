import fs from 'node:fs';

import 'dotenv/config';

import type { ScreenStreamEvent } from '../api/run-sector-screen-stream.js';
import { runSectorScreenStream } from '../api/run-sector-screen-stream.js';

function parseInput(argv: string[]) {
  const query = argv.join(' ').trim();
  if (!query) {
    return { maxCandidates: 10, excludeSt: true };
  }
  return { query, maxCandidates: 10, excludeSt: true };
}

function emitSSE(event: ScreenStreamEvent) {
  const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  fs.writeSync(1, payload);
}

async function main() {
  const input = parseInput(process.argv.slice(2));
  await runSectorScreenStream(input, emitSSE);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  emitSSE({ type: 'error', message });
  process.exit(1);
});

import fs from 'node:fs';

import 'dotenv/config';

import type { ResearchStreamEvent } from '../api/run-research-workflow-stream.js';
import { runResearchWorkflowStream } from '../api/run-research-workflow-stream.js';

function parseInput(argv: string[]) {
  const symbolArg = argv.find((arg) => /^\d{6}$/.test(arg));
  const query = argv.join(' ').trim();

  if (symbolArg) {
    return { symbol: symbolArg };
  }

  if (query) {
    return { query };
  }

  return { symbol: '600519' };
}

function emitSSE(event: ResearchStreamEvent) {
  const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  fs.writeSync(1, payload);
}

async function main() {
  const input = parseInput(process.argv.slice(2));
  await runResearchWorkflowStream(input, emitSSE);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  emitSSE({ type: 'error', message });
  process.exit(1);
});

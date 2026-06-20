import fs from 'node:fs';

import 'dotenv/config';

import type { CommitteeStreamEvent } from '../api/run-committee-stream.js';
import { runCommitteeStream } from '../api/run-committee-stream.js';

function parseCandidates(argv: string[]) {
  const envJson = process.env.COMMITTEE_CANDIDATES_JSON?.trim();
  if (envJson) {
    try {
      const parsed = JSON.parse(envJson) as Array<{
        symbol: string;
        name: string;
      }>;
      if (parsed.length > 0) {
        return {
          candidates: parsed,
          screeningSessionId:
            process.env.COMMITTEE_SCREENING_SESSION_ID?.trim() || undefined,
        };
      }
    } catch {
      // fall through
    }
  }

  const arg = argv.join(' ').trim();
  if (!arg) {
    return {
      candidates: [
        { symbol: '600519', name: '贵州茅台' },
        { symbol: '000001', name: '平安银行' },
      ],
    };
  }

  const symbols = arg.match(/\d{6}/g) ?? [];
  return {
    candidates: symbols.map((symbol) => ({ symbol, name: symbol })),
  };
}

function emitSSE(event: CommitteeStreamEvent) {
  fs.writeSync(1, `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

async function main() {
  const input = parseCandidates(process.argv.slice(2));
  await runCommitteeStream({ ...input, maxAnalyze: 3 }, emitSSE);
}

main().catch((error) => {
  emitSSE({
    type: 'error',
    message: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});

import { runEtfTailPick } from '../data/etf/tail-picker.js';
import {
  getLatestEtfTailPickRun,
  listEtfTailPickRuns,
} from '../data/etf/store.js';

export async function dispatchEtf(args: string[]): Promise<string> {
  const command = args[0];

  if (command === 'tail-pick') {
    const force = args.includes('--force');
    return JSON.stringify(await runEtfTailPick({ force }));
  }

  if (command === 'latest') {
    return JSON.stringify({ latest: await getLatestEtfTailPickRun() });
  }

  if (command === 'list') {
    const limit = Number(args[1] ?? 20);
    return JSON.stringify({ runs: await listEtfTailPickRuns(limit) });
  }

  throw new Error('Usage: tail-pick [--force]|latest|list [limit]');
}

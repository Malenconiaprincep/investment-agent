import { runEtfTailPick } from '../data/etf/tail-picker.js';
import {
  runEtfMorningRadar,
  type EtfMorningRadarStage,
} from '../data/etf/morning-radar.js';
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

  if (command === 'morning-radar') {
    const stageArg = args[1];
    const stage: EtfMorningRadarStage =
      stageArg === 'confirm' ? 'confirm' : 'open';
    return JSON.stringify(await runEtfMorningRadar({ stage }));
  }

  if (command === 'latest') {
    return JSON.stringify({ latest: await getLatestEtfTailPickRun() });
  }

  if (command === 'list') {
    const limit = Number(args[1] ?? 20);
    return JSON.stringify({ runs: await listEtfTailPickRuns(limit) });
  }

  throw new Error('Usage: tail-pick [--force]|morning-radar [open|confirm]|latest|list [limit]');
}

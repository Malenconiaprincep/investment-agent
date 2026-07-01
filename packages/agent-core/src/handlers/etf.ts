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

  if (command === 'update-daily-csv') {
    const daysArg = args.find((item) => item.startsWith('--days='));
    const symbolsArg = args.find((item) => item.startsWith('--symbols='));
    const days = daysArg ? Number(daysArg.split('=')[1]) : undefined;
    const symbols = symbolsArg
      ? symbolsArg
          .split('=')
          .slice(1)
          .join('=')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      : undefined;
    const { updateEtfDailyCsvPool } = await import(
      '../data/market/local-csv/etf-daily-update.js'
    );
    return JSON.stringify(
      await updateEtfDailyCsvPool({
        ...(Number.isFinite(days) ? { days } : {}),
        ...(symbols && symbols.length > 0 ? { symbols } : {}),
      }),
    );
  }

  throw new Error(
    'Usage: tail-pick [--force]|morning-radar [open|confirm]|latest|list [limit]|update-daily-csv [--days=N] [--symbols=510300,512880]',
  );
}

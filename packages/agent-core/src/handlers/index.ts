import { dispatchWatchlist } from './watchlist.js';
import { dispatchPaper } from './paper.js';
import { dispatchReports } from './reports.js';
import { dispatchScreenings } from './screenings.js';
import { dispatchFeedback } from './feedback.js';
import { dispatchBatchResearch } from './batch-research.js';
import { dispatchMonitor } from './monitor.js';
import { dispatchEtf } from './etf.js';
import { dispatchBacktest } from './backtest.js';
import { dispatchNotify } from './notify.js';

export type CliModule =
  | 'watchlist'
  | 'paper'
  | 'reports'
  | 'screenings'
  | 'feedback'
  | 'batch-research'
  | 'monitor'
  | 'etf'
  | 'backtest'
  | 'notify';

const DISPATCHERS: Record<CliModule, (args: string[]) => Promise<string>> = {
  watchlist: dispatchWatchlist,
  paper: dispatchPaper,
  reports: dispatchReports,
  screenings: dispatchScreenings,
  feedback: dispatchFeedback,
  'batch-research': dispatchBatchResearch,
  monitor: dispatchMonitor,
  etf: dispatchEtf,
  backtest: dispatchBacktest,
  notify: dispatchNotify,
};

export async function dispatchCliModule(
  module: string,
  args: string[],
): Promise<string> {
  const handler = DISPATCHERS[module as CliModule];
  if (!handler) {
    throw new Error(`未知模块: ${module}`);
  }
  return handler(args);
}

export function isCliModule(module: string): module is CliModule {
  return module in DISPATCHERS;
}

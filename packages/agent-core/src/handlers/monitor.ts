import {
  acknowledgeMonitorAlert,
  listMonitorAlerts,
} from '../data/monitor/store.js';
import {
  getMonitorStatus,
  runMonitorPollManaged,
} from '../data/monitor/engine.js';
import {
  getAutoTrackSettings,
  setAutoTrackMode,
  type AutoTrackMode,
} from '../data/monitor/auto-track-policy.js';
import { listWatchlistItems } from '../data/watchlist/store.js';

export async function dispatchMonitor(args: string[]): Promise<string> {
  const command = args[0];

  if (command === 'poll') {
    const force = args.includes('--force');
    return JSON.stringify(await runMonitorPollManaged({ force }));
  }

  if (command === 'status') {
    return JSON.stringify(await getMonitorStatus());
  }

  if (command === 'settings') {
    const watchlist = await listWatchlistItems();
    return JSON.stringify(await getAutoTrackSettings(watchlist.length));
  }

  if (command === 'set-mode' && args[1]) {
    const mode = args[1] as AutoTrackMode;
    if (mode !== 'balanced' && mode !== 'aggressive' && mode !== 'notify_only') {
      throw new Error('模式须为 balanced | aggressive | notify_only');
    }
    await setAutoTrackMode(mode);
    const watchlist = await listWatchlistItems();
    return JSON.stringify(await getAutoTrackSettings(watchlist.length));
  }

  if (command === 'alerts') {
    const tradeDate = args[1];
    const limit = Number(args[2] ?? 50);
    const alerts = await listMonitorAlerts({ tradeDate, limit });
    return JSON.stringify({ alerts });
  }

  if (command === 'ack' && args[1]) {
    await acknowledgeMonitorAlert(args[1]);
    return JSON.stringify({ ok: true });
  }

  throw new Error(
    'Usage: poll [--force]|status|settings|set-mode <balanced|aggressive|notify_only>|alerts [tradeDate] [limit]|ack <id>',
  );
}

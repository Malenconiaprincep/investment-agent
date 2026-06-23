import {
  acknowledgeMonitorAlert,
  listMonitorAlerts,
} from '../data/monitor/store.js';
import {
  getMonitorStatus,
  runMonitorPollManaged,
} from '../data/monitor/engine.js';

export async function dispatchMonitor(args: string[]): Promise<string> {
  const command = args[0];

  if (command === 'poll') {
    const force = args.includes('--force');
    return JSON.stringify(await runMonitorPollManaged({ force }));
  }

  if (command === 'status') {
    return JSON.stringify(await getMonitorStatus());
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

  throw new Error('Usage: poll [--force]|status|alerts [tradeDate] [limit]|ack <id>');
}

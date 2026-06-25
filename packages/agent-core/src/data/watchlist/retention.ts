import { getBeijingNow } from '../paper/trading-calendar.js';
import { listPaperPositions } from '../paper/store.js';
import {
  listWatchlistItems,
  removeWatchlistItem,
  type WatchlistItem,
} from './store.js';

export type WatchlistRetentionDays = {
  auto: number;
  manual: number;
};

export type WatchlistPurgeResult = {
  removed: number;
  protected: number;
  removedSymbols: string[];
  retentionDays: WatchlistRetentionDays;
  ranAt: string;
};

function parseRetentionDays(envKey: string, fallback: number): number {
  const fromEnv = Number(process.env[envKey]);
  if (Number.isFinite(fromEnv) && fromEnv >= 1 && fromEnv <= 90) return fromEnv;
  return fallback;
}

export function getWatchlistRetentionDays(): WatchlistRetentionDays {
  return {
    auto: parseRetentionDays('WATCHLIST_RETENTION_DAYS_AUTO', 3),
    manual: parseRetentionDays('WATCHLIST_RETENTION_DAYS_MANUAL', 7),
  };
}

function retentionDaysForSource(
  sourceType: WatchlistItem['sourceType'],
  retention: WatchlistRetentionDays,
): number {
  if (sourceType === 'signal' || sourceType === 'screening') return retention.auto;
  return retention.manual;
}

export function getWatchlistExpiryCutoffIso(input: {
  sourceType: WatchlistItem['sourceType'];
  now?: Date;
  retention?: WatchlistRetentionDays;
}): string {
  const retention = input.retention ?? getWatchlistRetentionDays();
  const days = retentionDaysForSource(input.sourceType, retention);
  const cutoff = new Date(input.now ?? getBeijingNow());
  cutoff.setDate(cutoff.getDate() - days);
  return cutoff.toISOString();
}

export function isWatchlistItemExpired(
  item: WatchlistItem,
  now: Date = getBeijingNow(),
  retention?: WatchlistRetentionDays,
): boolean {
  const cutoffIso = getWatchlistExpiryCutoffIso({
    sourceType: item.sourceType,
    now,
    retention,
  });
  return item.createdAt < cutoffIso;
}

export function describeWatchlistRetentionRules(
  retention: WatchlistRetentionDays = getWatchlistRetentionDays(),
): Array<{ label: string; detail: string }> {
  return [
    {
      label: '自动清理',
      detail: `雷达/扫描加池保留 ${retention.auto} 天；手动/研报保留 ${retention.manual} 天，到期自动移出`,
    },
    {
      label: '模拟盘保护',
      detail: '已持有模拟仓位的标的不自动移出',
    },
  ];
}

export async function purgeExpiredWatchlistItems(): Promise<WatchlistPurgeResult> {
  const retention = getWatchlistRetentionDays();
  const now = getBeijingNow();
  const items = await listWatchlistItems();
  const positions = await listPaperPositions('stock');
  const heldSymbols = new Set(
    positions.filter((p) => p.shares > 0).map((p) => p.symbol),
  );

  let removed = 0;
  let protectedCount = 0;
  const removedSymbols: string[] = [];

  for (const item of items) {
    if (heldSymbols.has(item.symbol)) {
      protectedCount += 1;
      continue;
    }
    if (!isWatchlistItemExpired(item, now, retention)) continue;
    await removeWatchlistItem(item.id);
    removed += 1;
    removedSymbols.push(item.symbol);
  }

  return {
    removed,
    protected: protectedCount,
    removedSymbols,
    retentionDays: retention,
    ranAt: new Date().toISOString(),
  };
}

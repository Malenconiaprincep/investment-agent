'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import {
  loadSeenMonitorKeys,
  monitorNotifyKey,
  saveSeenMonitorKeys,
  showBrowserNotification,
} from '@/lib/browser-notify';
import { useWatchlistPanel } from '@/components/WatchlistPanelContext';

type MonitorAlert = {
  id: string;
  symbol: string | null;
  name: string | null;
  title: string;
  summary: string;
};

type MonitorRecommendation = {
  alertId: string;
  symbol: string | null;
  name: string | null;
  status: string;
  reason: string;
};

type MonitorPaperAction = {
  kind: 'buy' | 'sell' | 'track';
  status: string;
  symbol: string;
  name: string;
  alertId?: string;
  reason: string;
};

type MonitorStatus = {
  todayAlerts: MonitorAlert[];
  recommendations: MonitorRecommendation[];
  paperActions: MonitorPaperAction[];
};

const POLL_MS = 30_000;

function seedAndCollectNewKeys(
  seen: Set<string>,
  status: MonitorStatus,
  seeded: boolean,
): Array<{ key: string; title: string; body: string }> {
  const notifications: Array<{ key: string; title: string; body: string }> = [];

  for (const alert of status.todayAlerts) {
    if (!alert.symbol) continue;
    const key = monitorNotifyKey('alert', alert.id);
    if (!seen.has(key)) {
      seen.add(key);
      if (seeded) {
        notifications.push({
          key,
          title: `消息雷达 · ${alert.name ?? alert.symbol}`,
          body: alert.summary.slice(0, 80),
        });
      }
    }
  }

  for (const item of status.recommendations) {
    if (!item.symbol) continue;
    const key = monitorNotifyKey('rec', item.alertId);
    if (!seen.has(key)) {
      seen.add(key);
      if (seeded && (item.status === 'tracked' || item.status === 'bought')) {
        const statusText = item.status === 'bought' ? '已买入模拟盘' : '已加入跟踪池';
        notifications.push({
          key,
          title: `自动跟踪 · ${item.name ?? item.symbol}`,
          body: `${statusText}：${item.reason}`.slice(0, 120),
        });
      }
    }
  }

  for (const action of status.paperActions) {
    if (action.kind !== 'buy' && action.kind !== 'sell') continue;
    if (action.status !== 'bought' && action.status !== 'sold') continue;
    const key = monitorNotifyKey(
      action.kind,
      action.alertId ?? `${action.symbol}:${action.status}`,
    );
    if (!seen.has(key)) {
      seen.add(key);
      if (seeded) {
        notifications.push({
          key,
          title:
            action.kind === 'buy'
              ? `模拟盘买入 · ${action.name}`
              : `模拟盘卖出 · ${action.name}`,
          body: action.reason.slice(0, 80),
        });
      }
    }
  }

  return notifications;
}

export function MonitorBackgroundNotifier() {
  const pathname = usePathname();
  const { refresh } = useWatchlistPanel();
  const seededRef = useRef(false);
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (pathname === '/login') return;

    seenRef.current = loadSeenMonitorKeys();

    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch('/api/monitor');
        const data = (await res.json()) as MonitorStatus & { error?: string };
        if (!res.ok || cancelled) return;

        const pending = seedAndCollectNewKeys(
          seenRef.current,
          data,
          seededRef.current,
        );
        saveSeenMonitorKeys(seenRef.current);

        if (!seededRef.current) {
          seededRef.current = true;
          return;
        }

        if (pending.length > 0) {
          refresh();
        }

        for (const item of pending.slice(0, 3)) {
          showBrowserNotification({
            title: item.title,
            body: item.body,
            tag: item.key,
          });
        }
      } catch {
        // 后台轮询失败不阻断
      }
    }

    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pathname, refresh]);

  return null;
}

'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  ensureNotificationPermission,
  getNotificationPermission,
  isBrowserNotificationSupported,
} from '@/lib/browser-notify';
import { useWatchlistPanel } from '@/components/WatchlistPanelContext';

type WatchlistItem = {
  id: string;
  symbol: string;
  name: string;
  reason: string | null;
  sourceType: string | null;
  entryPrice: number | null;
  latest?: {
    close: number;
    pctChg: number | null;
    vsEntryPct: number | null;
    diamondStrength: 'red' | 'blue' | null;
  } | null;
};

function fmtPct(v: number | null | undefined) {
  if (v == null) return '—';
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function sourceLabel(sourceType: string | null) {
  if (sourceType === 'signal') return '雷达';
  if (sourceType === 'screening') return '扫描';
  if (sourceType === 'report') return '研报';
  return '手动';
}

export function WatchlistPanel() {
  const { open, setOpen, toggle, setItemCount, refreshToken } = useWatchlistPanel();
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notifyPermission, setNotifyPermission] = useState<
    NotificationPermission | 'unsupported'
  >('default');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/watchlist');
      const data = (await res.json()) as { items?: WatchlistItem[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? '加载失败');
      const nextItems = data.items ?? [];
      setItems(nextItems);
      setItemCount(nextItems.length);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [setItemCount]);

  useEffect(() => {
    if (isBrowserNotificationSupported()) {
      setNotifyPermission(getNotificationPermission());
    } else {
      setNotifyPermission('unsupported');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [open, load]);

  async function handleEnableNotify() {
    const permission = await ensureNotificationPermission();
    setNotifyPermission(permission);
  }

  return (
    <>
      <button
        type="button"
        className={`watchlist-panel-tab${open ? ' watchlist-panel-tab--hidden' : ''}`}
        onClick={toggle}
        aria-expanded={open}
        aria-controls="watchlist-panel"
      >
        跟踪池
      </button>

      <aside
        id="watchlist-panel"
        className={`watchlist-panel${open ? ' watchlist-panel--open' : ''}`}
        aria-label="跟踪池"
      >
        <div className="watchlist-panel-head">
          <div>
            <strong>跟踪池</strong>
            <span className="watchlist-panel-count">{items.length} 只</span>
          </div>
          <button
            type="button"
            className="watchlist-panel-close"
            onClick={() => setOpen(false)}
            aria-label="收起跟踪池"
          >
            ×
          </button>
        </div>

        <p className="watchlist-panel-hint">
          消息雷达识别后会自动加入；红钻+动量达标后写入模拟盘。过期未入模拟盘的标的会自动移出。
        </p>

        {notifyPermission !== 'granted' && notifyPermission !== 'unsupported' && (
          <button
            type="button"
            className="button button-secondary watchlist-panel-notify"
            onClick={() => void handleEnableNotify()}
          >
            开启浏览器通知
          </button>
        )}

        {loading && <div className="watchlist-panel-empty">加载中…</div>}
        {error && <div className="error watchlist-panel-error">{error}</div>}

        {!loading && items.length === 0 && (
          <div className="watchlist-panel-empty">
            暂无跟踪标的。消息雷达发现个股后会自动出现在这里。
          </div>
        )}

        <ul className="watchlist-panel-list">
          {items.map((item) => (
            <li key={item.id}>
              <Link href={`/watchlist/${item.id}`} className="watchlist-panel-item">
                <div className="watchlist-panel-item-head">
                  <strong>{item.name}</strong>
                  <span className="watchlist-panel-item-code">{item.symbol}</span>
                </div>
                <div className="watchlist-panel-item-meta">
                  <span className="watchlist-panel-source">{sourceLabel(item.sourceType)}</span>
                  <span>今日 {fmtPct(item.latest?.pctChg)}</span>
                  <span>自加入 {fmtPct(item.latest?.vsEntryPct)}</span>
                </div>
                {item.reason ? (
                  <p className="watchlist-panel-item-reason">{item.reason}</p>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>

        <div className="watchlist-panel-foot">
          <Link href="/monitor" className="saved-link">
            消息雷达
          </Link>
          <Link href="/signals" className="saved-link">
            信号提醒
          </Link>
        </div>
      </aside>

      {open ? (
        <button
          type="button"
          className="watchlist-panel-backdrop"
          aria-label="关闭跟踪池"
          onClick={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

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
  entryDate: string | null;
  createdAt: string;
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

function pctTone(v: number | null | undefined) {
  if (v == null) return 'watchlist-panel-pct--empty';
  if (v > 0) return 'watchlist-panel-pct--up';
  if (v < 0) return 'watchlist-panel-pct--down';
  return 'watchlist-panel-pct--flat';
}

function fmtPrice(v: number | null | undefined) {
  if (v == null) return '—';
  return v.toFixed(2);
}

function fmtJoinTime(item: WatchlistItem) {
  const raw = item.createdAt || item.entryDate;
  if (!raw) return item.entryDate ?? '—';
  const time = Date.parse(raw);
  if (!Number.isFinite(time)) return item.entryDate ?? raw;

  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(time));
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';

  return `${pick('month')}/${pick('day')} ${pick('hour')}:${pick('minute')}`;
}

function sourceLabel(sourceType: string | null) {
  if (sourceType === 'signal') return '雷达';
  if (sourceType === 'screening') return '扫描';
  if (sourceType === 'report') return '研报';
  return '手动';
}

function watchLevel(item: WatchlistItem) {
  const diamond = item.latest?.diamondStrength;
  const today = item.latest?.pctChg;
  const sinceEntry = item.latest?.vsEntryPct;
  const reason = item.reason ?? '';

  if (diamond === 'red') {
    return {
      label: 'S 红钻',
      className: 'watchlist-level--hot',
      title: '红钻信号，优先进入动量与 AI 复核队列',
    };
  }
  if (diamond === 'blue') {
    return {
      label: 'A 蓝钻',
      className: 'watchlist-level--warm',
      title: '蓝钻关注，趋势温和但尚未到强买点',
    };
  }
  if ((today ?? 0) >= 5 || (sinceEntry ?? 0) >= 8) {
    return {
      label: 'B 升温',
      className: 'watchlist-level--rise',
      title: '涨幅升温，留意是否补出红钻与动量确认',
    };
  }
  if ((sinceEntry ?? 0) <= -5) {
    return {
      label: 'R 回撤',
      className: 'watchlist-level--risk',
      title: '自加入后回撤较大，优先复核入池逻辑或移出',
    };
  }
  if (item.sourceType === 'screening' && reason.startsWith('A 重点')) {
    return {
      label: 'A 重点',
      className: 'watchlist-level--warm',
      title: '智能选股重点入池，等待新闻催化、红钻与动量确认',
    };
  }
  if (item.sourceType === 'screening' && reason.startsWith('B 升温')) {
    return {
      label: 'B 升温',
      className: 'watchlist-level--rise',
      title: '智能选股升温入池，等待盘中催化和价格信号确认',
    };
  }
  if (item.sourceType === 'signal') {
    return {
      label: 'C 雷达',
      className: 'watchlist-level--track',
      title: '消息雷达入池，等待红钻与动量确认',
    };
  }
  if (item.sourceType === 'screening' || item.sourceType === 'report') {
    return {
      label: 'C 研究',
      className: 'watchlist-level--track',
      title: '研究/扫描入池，等待价格信号确认',
    };
  }
  return {
    label: 'D 手动',
    className: 'watchlist-level--manual',
    title: '手动观察标的，当前不自动买入模拟盘',
  };
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
          {items.map((item) => {
            const level = watchLevel(item);
            return (
              <li key={item.id}>
                <Link href={`/watchlist/${item.id}`} className="watchlist-panel-item">
                  <div className="watchlist-panel-item-head">
                    <strong>{item.name}</strong>
                    <span className="watchlist-panel-item-code">{item.symbol}</span>
                  </div>
                  <div className="watchlist-panel-item-entry">
                    <span>加入 {fmtJoinTime(item)}</span>
                    <span>加入价 {fmtPrice(item.entryPrice)}</span>
                  </div>
                  <div className="watchlist-panel-item-meta">
                    <span
                      className={`watchlist-panel-level ${level.className}`}
                      title={level.title}
                    >
                      {level.label}
                    </span>
                    <span className="watchlist-panel-source">
                      {sourceLabel(item.sourceType)}
                    </span>
                    <span className={pctTone(item.latest?.pctChg)}>
                      今日 {fmtPct(item.latest?.pctChg)}
                    </span>
                    <span
                      className={pctTone(item.latest?.vsEntryPct)}
                      title={
                        item.entryPrice == null
                          ? '缺少加入价，暂不能计算自加入涨幅'
                          : undefined
                      }
                    >
                      自加入 {fmtPct(item.latest?.vsEntryPct)}
                    </span>
                  </div>
                  {item.reason ? (
                    <p className="watchlist-panel-item-reason">{item.reason}</p>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="watchlist-panel-foot">
          <Link href="/watchlist" className="saved-link">
            工作台
          </Link>
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

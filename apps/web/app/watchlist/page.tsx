'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DualPaperPayload } from '@/lib/paper-dual';
import radarStyles from './watchlist-radar.module.css';

type WatchlistItem = {
  id: string;
  symbol: string;
  name: string;
  reason: string | null;
  sourceType: 'report' | 'screening' | 'manual' | 'signal' | null;
  sourceId: string | null;
  entryPrice: number | null;
  entryDate: string | null;
  createdAt: string;
  latest?: {
    close: number;
    pctChg: number | null;
    vsEntryPct: number | null;
    diamondStrength: 'red' | 'blue' | null;
    tradeDate?: string;
  } | null;
};

type MonitorNewsItem = {
  newsKey: string;
  title: string;
  url: string | null;
  source: string | null;
  publishedAt: string | null;
  firstSeenAt: string;
};

type MonitorAlertItem = {
  id: string;
  title: string;
  summary: string;
  newsTitle: string | null;
  newsUrl: string | null;
  theme: string | null;
  symbol: string | null;
  name: string | null;
  createdAt: string;
};

type MonitorStatus = {
  now: string;
  background?: {
    enabled: boolean;
    intervalMs: number;
    running: boolean;
    nextRunAt: string | null;
    summary: string | null;
    error: string | null;
  };
  lastRun: {
    createdAt: string;
    summary: string;
    newsCount: number;
    alertCount: number;
    newNewsCount: number;
    symbolsScanned: number;
    elapsedMs: number;
  } | null;
  recentNews?: MonitorNewsItem[];
  todayAlerts?: MonitorAlertItem[];
  autoTrack?: {
    modeLabel: string;
    watchlistCount: number;
    watchlistLimit: number;
  };
};

type MonitorPollResponse = {
  summary?: string;
  error?: string;
};

type WatchLevelKey = 'hot' | 'warm' | 'rise' | 'risk' | 'track' | 'manual';
type FilterKey = 'all' | WatchLevelKey | 'held';

type WatchLevel = {
  key: WatchLevelKey;
  label: string;
  className: string;
  status: string;
};

function fmtPct(v: number | null | undefined) {
  if (v == null) return '-';
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function fmtPrice(v: number | null | undefined) {
  if (v == null) return '-';
  return v.toFixed(2);
}

function fmtTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Shanghai',
    });
  } catch {
    return iso;
  }
}

function fmtDuration(ms: number | undefined) {
  if (!ms || ms < 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${Math.round(ms / 1000)}s`;
}

function fmtInterval(ms: number | undefined) {
  if (!ms || ms < 0) return '—';
  const minutes = Math.round(ms / 60_000);
  if (minutes >= 1) return `${minutes} 分钟`;
  return `${Math.round(ms / 1000)} 秒`;
}

function fmtCountdown(iso: string | null | undefined, nowMs: number) {
  if (!iso) return '等待首次扫描后计算';
  const target = Date.parse(iso);
  if (!Number.isFinite(target)) return fmtTime(iso);
  const diffMs = target - nowMs;
  if (diffMs <= 0) return '即将开始';
  const totalSeconds = Math.ceil(diffMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds} 秒后`;
  return `${minutes} 分 ${seconds.toString().padStart(2, '0')} 秒后`;
}

function pctClassName(v: number | null | undefined) {
  if (v == null) return 'watchlist-workbench-pct watchlist-workbench-pct--empty';
  if (v > 0) return 'watchlist-workbench-pct watchlist-workbench-pct--up';
  if (v < 0) return 'watchlist-workbench-pct watchlist-workbench-pct--down';
  return 'watchlist-workbench-pct';
}

function sourceLabel(sourceType: WatchlistItem['sourceType']) {
  if (sourceType === 'signal') return '消息雷达';
  if (sourceType === 'screening') return '选股扫描';
  if (sourceType === 'report') return '研报';
  return '手动';
}

function watchLevel(item: WatchlistItem): WatchLevel {
  const diamond = item.latest?.diamondStrength;
  const today = item.latest?.pctChg;
  const sinceEntry = item.latest?.vsEntryPct;

  if (diamond === 'red') {
    return {
      key: 'hot',
      label: 'S 红钻',
      className: 'watchlist-level--hot',
      status: '待动量/AI 复核',
    };
  }
  if (diamond === 'blue') {
    return {
      key: 'warm',
      label: 'A 蓝钻',
      className: 'watchlist-level--warm',
      status: '温和关注',
    };
  }
  if ((today ?? 0) >= 5 || (sinceEntry ?? 0) >= 8) {
    return {
      key: 'rise',
      label: 'B 升温',
      className: 'watchlist-level--rise',
      status: '等待信号确认',
    };
  }
  if ((sinceEntry ?? 0) <= -5) {
    return {
      key: 'risk',
      label: 'R 回撤',
      className: 'watchlist-level--risk',
      status: '优先复核',
    };
  }
  if (item.sourceType === 'manual') {
    return {
      key: 'manual',
      label: 'D 手动',
      className: 'watchlist-level--manual',
      status: '人工观察',
    };
  }
  return {
    key: 'track',
    label: item.sourceType === 'signal' ? 'C 雷达' : 'C 研究',
    className: 'watchlist-level--track',
    status: '等待红钻',
  };
}

function ageDays(item: WatchlistItem) {
  const raw = item.entryDate ?? item.createdAt;
  const start = new Date(raw);
  if (Number.isNaN(start.getTime())) return null;
  const diff = Date.now() - start.getTime();
  return Math.max(0, Math.floor(diff / 86_400_000));
}

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'hot', label: 'S 红钻' },
  { key: 'warm', label: 'A 蓝钻' },
  { key: 'rise', label: 'B 升温' },
  { key: 'risk', label: 'R 回撤' },
  { key: 'track', label: 'C 跟踪' },
  { key: 'manual', label: 'D 手动' },
  { key: 'held', label: '已进模拟盘' },
];

export default function WatchlistPage() {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [heldSymbols, setHeldSymbols] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [query, setQuery] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [monitorStatus, setMonitorStatus] = useState<MonitorStatus | null>(null);
  const [monitorPolling, setMonitorPolling] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [newsExpanded, setNewsExpanded] = useState(false);

  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoading(true);
    }
    setError(null);
    try {
      const [watchlistRes, paperRes, monitorRes] = await Promise.all([
        fetch('/api/watchlist'),
        fetch('/api/paper').catch(() => null),
        fetch('/api/monitor').catch(() => null),
      ]);
      const watchlistJson = (await watchlistRes.json()) as {
        items?: WatchlistItem[];
        error?: string;
      };
      if (!watchlistRes.ok) {
        throw new Error(watchlistJson.error ?? '跟踪池加载失败');
      }

      setItems(watchlistJson.items ?? []);

      if (paperRes?.ok) {
        const paper = (await paperRes.json()) as DualPaperPayload;
        setHeldSymbols(new Set((paper.stock.positions ?? []).map((p) => p.symbol)));
      } else {
        setHeldSymbols(new Set());
      }

      if (monitorRes?.ok) {
        setMonitorStatus((await monitorRes.json()) as MonitorStatus);
      } else {
        setMonitorStatus(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => void load({ silent: true }), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  async function runMonitorScan() {
    if (monitorPolling) return;
    setMonitorPolling(true);
    setError(null);
    try {
      const res = await fetch('/api/monitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'force' }),
      });
      const data = (await res.json()) as MonitorPollResponse;
      if (!res.ok) throw new Error(data.error ?? '扫描失败');
      setScanMessage(data.summary ? `本次扫描：${data.summary}` : '本次扫描已完成');
      await load({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : '扫描失败');
      setScanMessage(null);
    } finally {
      setMonitorPolling(false);
    }
  }

  async function handleDelete(item: WatchlistItem) {
    const confirmed = window.confirm(
      `确定从跟踪池删除 ${item.name}（${item.symbol}）吗？`,
    );
    if (!confirmed) return;

    setDeletingId(item.id);
    setError(null);
    try {
      const res = await fetch(`/api/watchlist/${encodeURIComponent(item.id)}`, {
        method: 'DELETE',
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? '删除失败');
      setItems((current) => current.filter((entry) => entry.id !== item.id));
      setHeldSymbols((current) => {
        const next = new Set(current);
        next.delete(item.symbol);
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeletingId(null);
    }
  }

  const rows = useMemo(
    () =>
      items.map((item) => ({
        item,
        level: watchLevel(item),
        held: heldSymbols.has(item.symbol),
        age: ageDays(item),
      })),
    [heldSymbols, items],
  );

  const filteredRows = useMemo(() => {
    const q = query.trim();
    return rows.filter(({ item, level, held }) => {
      if (filter === 'held' && !held) return false;
      if (filter !== 'all' && filter !== 'held' && level.key !== filter) return false;
      if (!q) return true;
      return item.symbol.includes(q) || item.name.includes(q);
    });
  }, [filter, query, rows]);

  const stats = useMemo(() => {
    const activeReturns = rows
      .map(({ item }) => item.latest?.vsEntryPct)
      .filter((v): v is number => v != null);
    const avgReturn =
      activeReturns.length > 0
        ? activeReturns.reduce((sum, v) => sum + v, 0) / activeReturns.length
        : null;
    return {
      total: rows.length,
      hot: rows.filter((r) => r.level.key === 'hot').length,
      warm: rows.filter((r) => r.level.key === 'warm').length,
      risk: rows.filter((r) => r.level.key === 'risk').length,
      held: rows.filter((r) => r.held).length,
      avgReturn,
    };
  }, [rows]);

  const radarNews = useMemo(() => {
    const fromEvents = monitorStatus?.recentNews ?? [];
    if (fromEvents.length > 0) return fromEvents;

    const seen = new Set<string>();
    const fromAlerts: MonitorNewsItem[] = [];
    for (const alert of monitorStatus?.todayAlerts ?? []) {
      const title = alert.newsTitle?.trim() || alert.title.trim();
      if (!title || seen.has(title)) continue;
      seen.add(title);
      fromAlerts.push({
        newsKey: alert.id,
        title,
        url: alert.newsUrl,
        source: alert.theme ?? (alert.name ? `${alert.name}` : '雷达提醒'),
        publishedAt: null,
        firstSeenAt: alert.createdAt,
      });
    }
    return fromAlerts;
  }, [monitorStatus?.recentNews, monitorStatus?.todayAlerts]);

  const visibleNews = newsExpanded ? radarNews : radarNews.slice(0, 6);

  return (
    <main className="page page--workspace">
      <header className="page-header">
        <h1 className="page-title">跟踪池</h1>
        <p className="page-description">
          消息雷达负责发现机会并自动入池；跟踪池负责等待红钻/蓝钻、动量确认和模拟盘买入条件。
        </p>
      </header>

      <section className="monitor-console watchlist-radar-console" aria-label="消息雷达">
        <div className="monitor-console-head">
          <div className="monitor-status-bar">
            <span
              className={`monitor-pill${
                monitorPolling || monitorStatus?.background?.running
                  ? ' monitor-pill--scanning'
                  : ' monitor-pill--auto'
              }`}
            >
              {monitorPolling
                ? '⟳ 手动扫描中'
                : monitorStatus?.background?.running
                  ? '⟳ 后台扫描中'
                  : monitorStatus?.background?.enabled
                    ? '◉ 雷达轮询开启'
                    : '○ 雷达轮询关闭'}
            </span>
            <span className="monitor-meta">
              根据热门信息、候选池和跟踪池指标自动筛选入池标的
            </span>
          </div>

          <div className="monitor-console-actions">
            <button
              type="button"
              className="button"
              disabled={monitorPolling}
              onClick={() => void runMonitorScan()}
            >
              {monitorPolling ? '扫描中…' : '立即扫描'}
            </button>
            <Link href="/monitor/settings" className="button button-secondary">
              雷达设置
            </Link>
          </div>
        </div>

        <div
          className={`monitor-scan-status${
            monitorPolling || monitorStatus?.background?.running
              ? ' monitor-scan-status--active'
              : ''
          }`}
          role="status"
        >
          <div className="monitor-scan-status-main">
            <span className="monitor-scan-pulse" aria-hidden />
            <div>
              <strong>
                {monitorPolling
                  ? '正在手动扫描'
                  : monitorStatus?.background?.running
                    ? '后台正在扫描'
                    : monitorStatus?.background?.enabled
                      ? '后台轮询已开启'
                      : '后台轮询已关闭'}
              </strong>
              <span>
                {monitorStatus?.background?.enabled
                  ? `扫描间隔 ${fmtInterval(monitorStatus.background.intervalMs)} · 符合条件会自动进入下方跟踪池`
                  : '可在设置里的定时任务中开启自动轮询'}
              </span>
              {monitorStatus?.background && !monitorStatus.background.enabled && (
                <Link href="/settings#scheduled-tasks" className="monitor-scan-status-link">
                  去开启
                </Link>
              )}
            </div>
          </div>
          <div className="monitor-scan-status-grid">
            <span>
              <em>上次扫描</em>
              <strong>
                {monitorStatus?.lastRun ? fmtTime(monitorStatus.lastRun.createdAt) : '暂无'}
              </strong>
            </span>
            <span>
              <em>下次预计</em>
              <strong>
                {monitorStatus?.background?.running
                  ? '本轮完成后'
                  : fmtCountdown(monitorStatus?.background?.nextRunAt, nowMs)}
              </strong>
            </span>
            <span>
              <em>最新结果</em>
              <strong>
                {monitorStatus?.background?.error
                  ? '上轮失败'
                  : monitorStatus?.background?.summary ??
                    monitorStatus?.lastRun?.summary ??
                    '等待扫描'}
              </strong>
            </span>
          </div>
        </div>

        {monitorStatus?.lastRun && (
          <p className="monitor-last-run">
            上次 {fmtTime(monitorStatus.lastRun.createdAt)} · 耗时{' '}
            {fmtDuration(monitorStatus.lastRun.elapsedMs)} · 扫描{' '}
            {monitorStatus.lastRun.symbolsScanned} 只，新增{' '}
            {monitorStatus.lastRun.alertCount} 条提醒
          </p>
        )}
        {scanMessage && !error && (
          <div className="notice" role="status">
            {scanMessage}
          </div>
        )}

        <div className={radarStyles.radarNews}>
          <div className={radarStyles.radarNewsHead}>
            <h2 className={radarStyles.radarNewsTitle}>热点资讯</h2>
            <span className={`muted ${radarStyles.radarNewsCount}`}>
              {radarNews.length > 0
                ? `${radarNews.length} 条`
                : monitorStatus?.lastRun
                  ? `本轮扫描 ${monitorStatus.lastRun.newsCount} 条源资讯`
                  : '等待扫描'}
            </span>
          </div>
          {visibleNews.length > 0 ? (
            <>
              <ul className="monitor-news-feed" aria-label="雷达热点资讯">
                {visibleNews.map((item) => (
                  <li key={item.newsKey} className={`monitor-news-feed-item ${radarStyles.radarNewsFeedItem}`}>
                    <span className="monitor-news-feed-time">
                      {fmtTime(item.publishedAt ?? item.firstSeenAt)}
                    </span>
                    {item.url ? (
                      <a
                        href={item.url}
                        className="monitor-news-feed-title"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {item.title}
                      </a>
                    ) : (
                      <span className="monitor-news-feed-title">{item.title}</span>
                    )}
                  </li>
                ))}
              </ul>
              {radarNews.length > 6 ? (
                <button
                  type="button"
                  className="button button-secondary monitor-news-feed-toggle"
                  onClick={() => setNewsExpanded((prev) => !prev)}
                >
                  {newsExpanded ? '收起资讯' : `展开全部 ${radarNews.length} 条`}
                </button>
              ) : null}
            </>
          ) : (
            <p className={`${radarStyles.radarNewsEmpty} muted`}>
              暂无资讯。开启后台轮询或点击「立即扫描」后，雷达抓取的热点新闻会显示在这里。
            </p>
          )}
        </div>
      </section>

      <section className="watchlist-workbench-metrics" aria-label="跟踪池概览">
        <Metric label="跟踪标的" value={`${stats.total} 只`} />
        <Metric label="红/蓝钻" value={`${stats.hot}/${stats.warm}`} />
        <Metric label="已进模拟盘" value={`${stats.held} 只`} />
        <Metric label="回撤复核" value={`${stats.risk} 只`} />
        <Metric label="平均自加入" value={fmtPct(stats.avgReturn)} tone={stats.avgReturn} />
      </section>

      <section className="watchlist-workbench-controls">
        <div className="watchlist-workbench-tabs" role="tablist" aria-label="跟踪池筛选">
          {FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`watchlist-workbench-tab${filter === item.key ? ' watchlist-workbench-tab--active' : ''}`}
              onClick={() => setFilter(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="watchlist-workbench-search">
          <input
            className="input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索代码或名称"
          />
          <button type="button" className="button button-secondary" onClick={() => void load()}>
            刷新
          </button>
        </div>
      </section>

      {loading && <div className="list-loading">加载跟踪池…</div>}
      {error && <div className="error">{error}</div>}

      {!loading && !error && filteredRows.length === 0 && (
        <div className="empty-state">当前筛选下没有标的。</div>
      )}

      {!loading && !error && filteredRows.length > 0 && (
        <section className="section watchlist-workbench-table">
          <div className="table-scroll-wrap">
            <table className="candidate-table">
              <thead>
                <tr>
                  <th>标的</th>
                  <th>等级</th>
                  <th>状态</th>
                  <th>今日</th>
                  <th>自加入</th>
                  <th>加入信息</th>
                  <th>动作</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map(({ item, level, held, age }) => (
                  <tr key={item.id}>
                    <td>
                      <Link href={`/watchlist/${item.id}`} className="watchlist-workbench-symbol">
                        <strong>{item.name}</strong>
                        <span>{item.symbol}</span>
                      </Link>
                      {item.reason && (
                        <p className="watchlist-workbench-reason">{item.reason}</p>
                      )}
                    </td>
                    <td>
                      <span className={`watchlist-panel-level ${level.className}`}>
                        {level.label}
                      </span>
                    </td>
                    <td>
                      <span className={held ? 'watchlist-workbench-status watchlist-workbench-status--held' : 'watchlist-workbench-status'}>
                        {held ? '已进模拟盘' : level.status}
                      </span>
                    </td>
                    <td className={pctClassName(item.latest?.pctChg)}>
                      {fmtPct(item.latest?.pctChg)}
                    </td>
                    <td className={pctClassName(item.latest?.vsEntryPct)}>
                      {fmtPct(item.latest?.vsEntryPct)}
                    </td>
                    <td>
                      <div className="watchlist-workbench-entry">
                        <span>{sourceLabel(item.sourceType)}</span>
                        <span>
                          {item.entryDate ?? '-'}
                          {age != null ? ` · ${age} 天` : ''}
                        </span>
                        <span>加入价 {fmtPrice(item.entryPrice)}</span>
                      </div>
                    </td>
                    <td>
                      <div className="watchlist-workbench-actions">
                        <Link href={`/watchlist/${item.id}`} className="saved-link">
                          详情
                        </Link>
                        <Link href={`/research?symbol=${item.symbol}`} className="saved-link">
                          研报
                        </Link>
                        <Link href={`/demo/stock/${item.symbol}`} className="saved-link">
                          图表
                        </Link>
                        <button
                          type="button"
                          className="saved-link saved-link--danger watchlist-workbench-delete"
                          disabled={deletingId === item.id}
                          onClick={() => void handleDelete(item)}
                        >
                          {deletingId === item.id ? '删除中…' : '删除'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: number | null;
}) {
  return (
    <div className="watchlist-workbench-metric">
      <span>{label}</span>
      <strong className={tone == null ? undefined : pctClassName(tone)}>{value}</strong>
    </div>
  );
}

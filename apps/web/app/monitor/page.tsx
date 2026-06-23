'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';

type MonitorAlert = {
  id: string;
  alertType: string;
  severity: 'info' | 'watch' | 'urgent';
  symbol: string | null;
  name: string | null;
  title: string;
  summary: string;
  newsTitle: string | null;
  newsUrl: string | null;
  pctChg: number | null;
  ret20dPct: number | null;
  theme: string | null;
  tradeDate: string;
  createdAt: string;
  acknowledged: boolean;
};

type MonitorStatus = {
  tradeDate: string;
  marketOpen: boolean;
  tradingHours: string;
  unacknowledgedCount: number;
  lastRun: {
    createdAt: string;
    summary: string;
    alertCount: number;
    newNewsCount: number;
  } | null;
  todayAlerts: MonitorAlert[];
};

const ALERT_LABEL: Record<string, string> = {
  pre_move: '潜伏',
  news_catalyst: '资讯',
  early_move: '启动',
  watchlist_surge: '自选',
  theme_ignite: '主线',
};

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

function fmtPct(v: number | null | undefined) {
  if (v == null) return '—';
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
}

export default function MonitorPage() {
  const [status, setStatus] = useState<MonitorStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/monitor');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? '加载失败');
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  async function runPoll() {
    setPolling(true);
    setError(null);
    try {
      const res = await fetch('/api/monitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'poll' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? '扫描失败');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '扫描失败');
    } finally {
      setPolling(false);
    }
  }

  const alerts = status?.todayAlerts ?? [];
  const urgentAlerts = alerts.filter((a) => a.severity === 'urgent' && !a.acknowledged);
  const preMoveAlerts = alerts.filter((a) => a.alertType === 'pre_move');

  return (
    <main className="page page--list">
      <PageHeader
        title="实时监控"
        description="结合 7×24 快讯与盘中行情，优先提示「有新闻催化、尚未大涨」的标的，避免事后追涨。"
      />

      <div className="list-stack">
        <div className="list-stack-head">
          <div className="monitor-status-bar">
            <span
              className={`monitor-pill${status?.marketOpen ? ' monitor-pill--live' : ''}`}
            >
              {status?.marketOpen ? '● 交易中' : '○ 非交易时段'}
            </span>
            <span className="monitor-meta">
              {status?.tradingHours ?? 'A 股交易时段 9:30–11:30、13:00–15:00'}
            </span>
            {status?.lastRun && (
              <span className="monitor-meta">
                上次扫描 {fmtTime(status.lastRun.createdAt)} ·{' '}
                {status.lastRun.summary}
              </span>
            )}
            {status && status.unacknowledgedCount > 0 && (
              <span className="monitor-meta monitor-meta--accent">
                {status.unacknowledgedCount} 条未读提醒
              </span>
            )}
          </div>

          <nav className="page-toolbar">
            <button
              type="button"
              className="button"
              disabled={polling}
              onClick={() => void runPoll()}
            >
              {polling ? '扫描中…' : '立即扫描'}
            </button>
            <Link href="/watchlist" className="button button-secondary">
              我的自选
            </Link>
            <Link href="/screen" className="button button-secondary">
              智能选股
            </Link>
          </nav>

          {loading && <div className="list-loading">加载监控…</div>}
          {error && <div className="error">{error}</div>}

          {!loading && urgentAlerts.length > 0 && (
            <div className="monitor-highlight">
              <strong>优先关注（{urgentAlerts.length}）</strong>
              <p>以下标的出现新催化且涨幅尚小，适合提前跟踪而非追涨已大涨股。</p>
            </div>
          )}
        </div>

        {!loading && alerts.length === 0 && (
          <div className="empty-state">
            今日暂无提醒。点击「立即扫描」拉取最新资讯与行情，或等待 Cron 自动轮询。
          </div>
        )}

        {preMoveAlerts.length > 0 && (
          <section className="monitor-section">
            <h2 className="section-title">潜伏机会</h2>
            <div className="history-list">
              {preMoveAlerts.map((alert) => (
                <AlertCard key={alert.id} alert={alert} />
              ))}
            </div>
          </section>
        )}

        {alerts.length > 0 && (
          <section className="monitor-section">
            <h2 className="section-title">全部提醒</h2>
            <div className="history-list">
              {alerts.map((alert) => (
                <AlertCard key={alert.id} alert={alert} />
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function AlertCard({ alert }: { alert: MonitorAlert }) {
  const typeLabel = ALERT_LABEL[alert.alertType] ?? alert.alertType;

  return (
    <article
      className={`history-card monitor-card monitor-card--${alert.severity}${alert.acknowledged ? ' monitor-card--read' : ''}`}
    >
      <div className="history-card-main">
        <span className={`monitor-type monitor-type--${alert.alertType}`}>
          {typeLabel}
        </span>
        <strong>{alert.title}</strong>
        <span className="history-card-time">{fmtTime(alert.createdAt)}</span>
      </div>

      <p className="monitor-summary">{alert.summary}</p>

      <div className="history-card-meta">
        {alert.symbol && (
          <span>
            {alert.name} ({alert.symbol})
          </span>
        )}
        {alert.pctChg != null && <span>涨幅 {fmtPct(alert.pctChg)}</span>}
        {alert.ret20dPct != null && <span>20日 {fmtPct(alert.ret20dPct)}</span>}
        {alert.theme && <span>主线 {alert.theme}</span>}
      </div>

      {alert.newsTitle && (
        <p className="monitor-news">
          {alert.newsUrl ? (
            <a href={alert.newsUrl} target="_blank" rel="noopener noreferrer">
              {alert.newsTitle}
            </a>
          ) : (
            alert.newsTitle
          )}
        </p>
      )}
    </article>
  );
}

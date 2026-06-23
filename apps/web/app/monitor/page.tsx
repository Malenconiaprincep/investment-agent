'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { AddToWatchlistButton } from '@/components/ui/AddToWatchlistButton';

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

type MonitorPaperRecommendation = {
  alertId: string;
  alertType: string;
  level: 'auto_buy' | 'watch' | 'info';
  symbol: string | null;
  name: string | null;
  reason: string;
  status: 'recommended' | 'bought' | 'skipped' | 'error';
  skipReason?: string;
  error?: string;
  shares?: number;
  price?: number;
  tradeId?: string;
};

type MonitorPaperAction = {
  kind: 'buy' | 'sell';
  status: 'bought' | 'sold' | 'skipped' | 'error';
  symbol: string;
  name: string;
  reason: string;
  alertId?: string;
  shares?: number;
  price?: number;
  tradeId?: string;
  error?: string;
};

type MonitorPollResponse = {
  recommendations?: MonitorPaperRecommendation[];
  paperActions?: MonitorPaperAction[];
  error?: string;
};

const ALERT_LABEL: Record<string, string> = {
  pre_move: '潜伏',
  news_catalyst: '资讯',
  early_move: '启动',
  watchlist_surge: '自选',
  theme_ignite: '主线',
};

/** 盘中每 5 分钟；非交易时段每 10 分钟扫资讯 */
const SCAN_INTERVAL_OPEN_MS = 5 * 60 * 1000;
const SCAN_INTERVAL_CLOSED_MS = 10 * 60 * 1000;
const REFRESH_INTERVAL_MS = 30 * 1000;

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

function fmtCountdown(ms: number) {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function MonitorPage() {
  const [status, setStatus] = useState<MonitorStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const [autoScan, setAutoScan] = useState(true);
  const [nextScanAt, setNextScanAt] = useState<number | null>(null);
  const [countdown, setCountdown] = useState('');
  const [lastRecommendations, setLastRecommendations] = useState<
    MonitorPaperRecommendation[]
  >([]);
  const [lastPaperActions, setLastPaperActions] = useState<MonitorPaperAction[]>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const scanningRef = useRef(false);
  const marketOpenRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/monitor');
      const data = (await res.json()) as MonitorStatus & { error?: string };
      if (!res.ok) throw new Error(data.error ?? '加载失败');
      setStatus(data);
      marketOpenRef.current = data.marketOpen;
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setLoading(false);
    }
  }, []);

  const runPoll = useCallback(
    async (options?: { silent?: boolean }) => {
      if (scanningRef.current) return;
      scanningRef.current = true;
      setPolling(true);
      try {
        const res = await fetch('/api/monitor', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'poll' }),
        });
        const data = (await res.json()) as MonitorPollResponse;
        if (!res.ok) throw new Error(data.error ?? '扫描失败');
        setLastRecommendations(data.recommendations ?? []);
        setLastPaperActions(data.paperActions ?? []);
        await load();
      } catch (err) {
        if (!options?.silent) {
          setError(err instanceof Error ? err.message : '扫描失败');
        }
      } finally {
        scanningRef.current = false;
        setPolling(false);
      }
    },
    [load],
  );

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!autoScan) {
      setNextScanAt(null);
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const scheduleNext = () => {
      const interval = marketOpenRef.current
        ? SCAN_INTERVAL_OPEN_MS
        : SCAN_INTERVAL_CLOSED_MS;
      setNextScanAt(Date.now() + interval);
      timeoutId = setTimeout(() => void scanLoop(false), interval);
    };

    async function scanLoop(isFirst: boolean) {
      if (cancelled) return;
      await runPoll({ silent: !isFirst });
      if (cancelled) return;
      scheduleNext();
    }

    void scanLoop(true);

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [autoScan, runPoll]);

  useEffect(() => {
    if (!nextScanAt || !autoScan) {
      setCountdown('');
      return;
    }
    const tick = () => setCountdown(fmtCountdown(nextScanAt - Date.now()));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [nextScanAt, autoScan]);

  const alerts = status?.todayAlerts ?? [];
  const urgentAlerts = alerts.filter(
    (a) => a.severity === 'urgent' && !a.acknowledged,
  );
  const preMoveAlerts = alerts.filter((a) => a.alertType === 'pre_move');

  return (
    <main className="page page--list">
      <PageHeader
        title="消息雷达"
        description="打开本页即可自动扫描：结合 7×24 快讯与盘中行情，生成消息推荐；高置信潜伏机会会自动写入模拟盘。"
      />

      <div className="list-stack">
        <div className="list-stack-head">
          <div className="monitor-status-bar">
            <span
              className={`monitor-pill${status?.marketOpen ? ' monitor-pill--live' : ''}`}
            >
              {status?.marketOpen ? '● 交易中' : '○ 非交易时段'}
            </span>
            {autoScan && (
              <span
                className={`monitor-pill${polling ? ' monitor-pill--scanning' : ' monitor-pill--auto'}`}
              >
                {polling ? '⟳ 扫描中' : '◉ 自动监控'}
              </span>
            )}
            <span className="monitor-meta">
              {status?.tradingHours ?? 'A 股交易时段 9:30–11:30、13:00–15:00'}
            </span>
            {autoScan && countdown && !polling && (
              <span className="monitor-meta">下次扫描 {countdown}</span>
            )}
            {status?.lastRun && (
              <span className="monitor-meta">
                上次 {fmtTime(status.lastRun.createdAt)} · {status.lastRun.summary}
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
              className={`button${autoScan ? ' button-secondary' : ''}`}
              disabled={polling}
              onClick={() => setAutoScan((v) => !v)}
            >
              {autoScan ? '暂停自动' : '开启自动'}
            </button>
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
            {autoScan
              ? '正在自动扫描资讯与行情，有新提醒会出现在下方。首次扫描可能需要 1–2 分钟。'
              : '今日暂无提醒。点击「开启自动」或「立即扫描」开始监控。'}
          </div>
        )}

        {lastRecommendations.length > 0 && (
          <section className="monitor-section">
            <h2 className="section-title">消息推荐</h2>
            <div className="history-list">
              {lastRecommendations.map((item) => (
                <RecommendationCard key={item.alertId} item={item} />
              ))}
            </div>
          </section>
        )}

        {lastPaperActions.length > 0 && (
          <section className="monitor-section">
            <h2 className="section-title">自动交易记录</h2>
            <div className="history-list">
              {lastPaperActions.map((item, index) => (
                <PaperActionCard key={`${item.kind}-${item.symbol}-${index}`} item={item} />
              ))}
            </div>
          </section>
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

function recommendationLabel(level: MonitorPaperRecommendation['level']) {
  if (level === 'auto_buy') return '自动买入候选';
  if (level === 'watch') return '观察推荐';
  return '消息记录';
}

function statusLabel(status: MonitorPaperRecommendation['status']) {
  if (status === 'bought') return '已自动买入';
  if (status === 'skipped') return '已跳过';
  if (status === 'error') return '执行失败';
  return '待观察';
}

function RecommendationCard({ item }: { item: MonitorPaperRecommendation }) {
  return (
    <article className={`history-card monitor-card monitor-recommendation monitor-recommendation--${item.level}`}>
      <div className="history-card-main">
        <span className={`monitor-type monitor-recommendation-type--${item.level}`}>
          {recommendationLabel(item.level)}
        </span>
        <strong>
          {item.name ?? '未识别标的'}
          {item.symbol ? ` (${item.symbol})` : ''}
        </strong>
        <span className="history-card-time">{statusLabel(item.status)}</span>
      </div>

      <p className="monitor-summary">
        {item.skipReason ?? item.error ?? item.reason}
      </p>

      {(item.shares || item.price) && (
        <div className="history-card-meta">
          {item.shares ? <span>股数 {item.shares}</span> : null}
          {item.price ? <span>价格 {item.price.toFixed(2)}</span> : null}
        </div>
      )}

      <div className="monitor-card-actions">
        {item.status === 'bought' && (
          <Link href="/paper" className="saved-link">
            查看模拟盘
          </Link>
        )}
        {item.symbol && (
          <Link href={`/?symbol=${item.symbol}`} className="saved-link">
            生成研报
          </Link>
        )}
        {item.symbol && item.name && (
          <AddToWatchlistButton
            symbol={item.symbol}
            name={item.name}
            reason="消息雷达推荐"
            sourceType="signal"
            sourceId={item.alertId}
          />
        )}
      </div>
    </article>
  );
}

function paperActionLabel(item: MonitorPaperAction) {
  if (item.status === 'bought') return '自动买入';
  if (item.status === 'sold') return '自动卖出';
  if (item.status === 'skipped') return '跳过';
  return '失败';
}

function PaperActionCard({ item }: { item: MonitorPaperAction }) {
  return (
    <article className={`history-card monitor-card monitor-card--${item.status === 'error' ? 'urgent' : 'watch'}`}>
      <div className="history-card-main">
        <span className="monitor-type monitor-recommendation-type--auto_buy">
          {paperActionLabel(item)}
        </span>
        <strong>
          {item.name} ({item.symbol})
        </strong>
        <span className="history-card-time">
          {item.kind === 'buy' ? '买入检查' : '卖出检查'}
        </span>
      </div>
      <p className="monitor-summary">{item.error ?? item.reason}</p>
      <div className="history-card-meta">
        {item.shares ? <span>股数 {item.shares}</span> : null}
        {item.price ? <span>价格 {item.price.toFixed(2)}</span> : null}
        <Link href="/paper" className="saved-link">
          交易流水
        </Link>
      </div>
    </article>
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

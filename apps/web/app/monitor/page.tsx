'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { MonitorStockInsight } from '@/components/monitor/MonitorStockInsight';
import { OpenWatchlistPanelButton } from '@/components/OpenWatchlistPanelButton';
import { useWatchlistPanel } from '@/components/WatchlistPanelContext';

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
    newsCount: number;
    alertCount: number;
    newNewsCount: number;
    symbolsScanned: number;
    marketOpen: boolean;
    elapsedMs: number;
  } | null;
  todayAlerts: MonitorAlert[];
  recommendations: MonitorPaperRecommendation[];
  paperActions: MonitorPaperAction[];
};

type MonitorPaperRecommendation = {
  alertId: string;
  alertType: string;
  level: 'auto_buy' | 'watch' | 'info';
  symbol: string | null;
  name: string | null;
  theme: string | null;
  pctChg: number | null;
  ret20dPct: number | null;
  eventPoints: string[];
  reason: string;
  status: 'recommended' | 'tracked' | 'bought' | 'skipped' | 'error';
  skipReason?: string;
  error?: string;
  shares?: number;
  price?: number;
  tradeId?: string;
};

type MonitorPaperAction = {
  kind: 'buy' | 'sell' | 'track';
  status: 'bought' | 'sold' | 'tracked' | 'skipped' | 'error';
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

const REFRESH_INTERVAL_MS = 30 * 1000;

const THEME_NEWS_PREVIEW = 5;

const RECOMMENDATION_RANK: Record<MonitorPaperRecommendation['level'], number> = {
  auto_buy: 0,
  watch: 1,
  info: 2,
};

const RECOMMENDATION_STATUS_RANK: Record<
  MonitorPaperRecommendation['status'],
  number
> = {
  bought: 0,
  tracked: 1,
  recommended: 2,
  skipped: 3,
  error: 4,
};

function dedupeRecommendationsBySymbol(
  items: MonitorPaperRecommendation[],
): MonitorPaperRecommendation[] {
  const bySymbol = new Map<string, MonitorPaperRecommendation>();
  for (const item of items) {
    if (!item.symbol) continue;
    const existing = bySymbol.get(item.symbol);
    if (!existing) {
      bySymbol.set(item.symbol, item);
      continue;
    }
    const statusBetter =
      RECOMMENDATION_STATUS_RANK[item.status] <
      RECOMMENDATION_STATUS_RANK[existing.status];
    const levelBetter =
      RECOMMENDATION_STATUS_RANK[item.status] ===
        RECOMMENDATION_STATUS_RANK[existing.status] &&
      RECOMMENDATION_RANK[item.level] < RECOMMENDATION_RANK[existing.level];
    if (statusBetter || levelBetter) {
      bySymbol.set(item.symbol, item);
    }
  }
  return [...bySymbol.values()];
}

function buildAlertEventPoints(alert: MonitorAlert): string[] {
  const points: string[] = [];
  const typeLabel = ALERT_LABEL[alert.alertType];
  if (typeLabel) points.push(typeLabel);
  if (alert.severity === 'urgent') points.push('高优先级');
  if (alert.theme) points.push(`主线 ${alert.theme}`);
  if (alert.pctChg != null) {
    points.push(`当日 ${alert.pctChg > 0 ? '+' : ''}${alert.pctChg.toFixed(2)}%`);
  }
  if (alert.newsTitle) {
    const title = alert.newsTitle.replace(/【[^】]+】/g, '').trim();
    if (title) points.push(title.length > 32 ? `${title.slice(0, 32)}…` : title);
  }
  return [...new Set(points)];
}

function dedupeAlertsBySymbol(alerts: MonitorAlert[]): MonitorAlert[] {
  const bySymbol = new Map<string, MonitorAlert>();
  for (const alert of alerts) {
    if (!alert.symbol) continue;
    const existing = bySymbol.get(alert.symbol);
    if (!existing || alert.createdAt > existing.createdAt) {
      bySymbol.set(alert.symbol, alert);
    }
  }
  return [...bySymbol.values()];
}

function consolidateThemeAlerts(alerts: MonitorAlert[]): MonitorAlert[] {
  const byTheme = new Map<string, MonitorAlert>();
  for (const alert of alerts) {
    if (alert.alertType !== 'theme_ignite') continue;
    const key = alert.theme ?? alert.newsTitle ?? alert.id;
    const existing = byTheme.get(key);
    if (!existing || alert.createdAt > existing.createdAt) {
      byTheme.set(key, alert);
    }
  }
  return [...byTheme.values()].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
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

export default function MonitorPage() {
  const [status, setStatus] = useState<MonitorStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const [lastRecommendations, setLastRecommendations] = useState<
    MonitorPaperRecommendation[]
  >([]);
  const [lastPaperActions, setLastPaperActions] = useState<MonitorPaperAction[]>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const scanningRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/monitor');
      const data = (await res.json()) as MonitorStatus & { error?: string };
      if (!res.ok) throw new Error(data.error ?? '加载失败');
      setStatus(data);
      setLastRecommendations(data.recommendations ?? []);
      setLastPaperActions(data.paperActions ?? []);
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

  const alerts = status?.todayAlerts ?? [];
  const urgentAlerts = alerts.filter(
    (a) => a.severity === 'urgent' && !a.acknowledged,
  );
  const preMoveAlerts = dedupeAlertsBySymbol(
    alerts.filter((a) => a.alertType === 'pre_move'),
  );
  const themeAlerts = useMemo(
    () => consolidateThemeAlerts(alerts),
    [alerts],
  );
  const actionableRecommendations = dedupeRecommendationsBySymbol(
    lastRecommendations.filter((item) => item.symbol && item.level !== 'info'),
  );
  const alertTypeCounts = alerts.reduce<Record<string, number>>((acc, alert) => {
    acc[alert.alertType] = (acc[alert.alertType] ?? 0) + 1;
    return acc;
  }, {});
  const boughtActions = lastPaperActions.filter((item) => item.status === 'bought');
  const soldActions = lastPaperActions.filter((item) => item.status === 'sold');
  const skippedActions = lastPaperActions.filter(
    (item) => item.status === 'skipped',
  );
  const errorActions = lastPaperActions.filter((item) => item.status === 'error');
  const trackedCount = actionableRecommendations.filter(
    (item) => item.status === 'tracked',
  ).length;
  const noBuyReason =
    boughtActions.length > 0
      ? null
      : trackedCount > 0
        ? `已自动跟踪 ${trackedCount} 只，等待红钻+动量达标后买入模拟盘`
        : actionableRecommendations.length > 0
          ? '标的已识别，等待加入自选或触发买入条件'
          : alerts.length === 0
            ? '暂无提醒'
            : '本次暂无个股信号';

  return (
    <main className="page page--list">
      <PageHeader
        title="消息雷达"
        description="后台自动扫描资讯与行情：识别标的会加入自选跟踪，潜伏机会或动量达标后自动写入模拟盘。"
      />

      <div className="list-stack">
        <div className="list-stack-head">
          <div className="monitor-status-bar">
            <span
              className={`monitor-pill${status?.marketOpen ? ' monitor-pill--live' : ''}`}
            >
              {status?.marketOpen ? '● 交易中' : '○ 非交易时段'}
            </span>
            <span
              className={`monitor-pill${polling ? ' monitor-pill--scanning' : ' monitor-pill--auto'}`}
            >
              {polling ? '⟳ 手动扫描中' : '◉ 后台自动运行'}
            </span>
            <span className="monitor-meta">
              {status?.tradingHours ?? 'A 股交易时段 9:30–11:30、13:00–15:00'}
            </span>
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
              className="button"
              disabled={polling}
              onClick={() => void runPoll()}
            >
              {polling ? '扫描中…' : '立即扫描'}
            </button>
            <OpenWatchlistPanelButton className="button button-secondary">
              跟踪池
            </OpenWatchlistPanelButton>
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

          {!loading && (
            <section className="monitor-diagnostics" aria-label="分析诊断">
              <div className="monitor-diagnostics-head">
                <strong>分析诊断</strong>
                {status?.lastRun ? (
                  <span>上次扫描 {fmtTime(status.lastRun.createdAt)}</span>
                ) : (
                  <span>等待首次扫描</span>
                )}
              </div>
              <div className="monitor-diagnostics-grid">
                <div>
                  <span>新闻</span>
                  <strong>{status?.lastRun?.newsCount ?? 0}</strong>
                  <small>新资讯 {status?.lastRun?.newNewsCount ?? 0}</small>
                </div>
                <div>
                  <span>股票</span>
                  <strong>{status?.lastRun?.symbolsScanned ?? 0}</strong>
                  <small>有代码提醒 {alerts.filter((a) => a.symbol).length}</small>
                </div>
                <div>
                  <span>提醒</span>
                  <strong>{status?.lastRun?.alertCount ?? alerts.length}</strong>
                  <small>
                    潜伏 {alertTypeCounts.pre_move ?? 0} / 主线{' '}
                    {alertTypeCounts.theme_ignite ?? 0}
                  </small>
                </div>
                <div>
                  <span>交易</span>
                  <strong>{boughtActions.length + soldActions.length}</strong>
                  <small>
                    买 {boughtActions.length} / 卖 {soldActions.length}
                  </small>
                </div>
              </div>
              <p className="monitor-diagnostics-reason">
                {noBuyReason ? `未买入原因：${noBuyReason}` : '已触发自动买入。'}
                {skippedActions.length > 0
                  ? `；跳过 ${skippedActions.length} 条`
                  : ''}
                {errorActions.length > 0 ? `；失败 ${errorActions.length} 条` : ''}
              </p>
            </section>
          )}
        </div>

        {!loading && alerts.length === 0 && (
          <div className="empty-state">
            后台消息雷达正在自动扫描资讯与行情，有新提醒会出现在下方。也可以点击「立即扫描」手动触发一次。
          </div>
        )}

        {actionableRecommendations.length > 0 && (
          <section className="monitor-section">
            <h2 className="section-title">自动跟踪</h2>
            <p className="muted monitor-section-hint">
              已识别标的自动加入自选；红钻+动量达标或潜伏信号触发后自动买入模拟盘。
            </p>
            <div className="monitor-stock-grid">
              {actionableRecommendations.map((item) => (
                <RecommendationCard key={item.alertId} item={item} />
              ))}
            </div>
          </section>
        )}

        {lastPaperActions.length > 0 && (
          <section className="monitor-section">
            <h2 className="section-title">自动交易记录</h2>
            <div className="monitor-stock-grid">
              {lastPaperActions.map((item, index) => (
                <PaperActionCard key={`${item.kind}-${item.symbol}-${index}`} item={item} />
              ))}
            </div>
          </section>
        )}

        {preMoveAlerts.length > 0 && (
          <section className="monitor-section">
            <h2 className="section-title">潜伏机会</h2>
            <div className="monitor-stock-grid">
              {preMoveAlerts.map((alert) => (
                <AlertCard key={alert.id} alert={alert} />
              ))}
            </div>
          </section>
        )}

        {themeAlerts.length > 0 && (
          <ThemeNewsFeed alerts={themeAlerts} />
        )}
      </div>
    </main>
  );
}

function ThemeNewsFeed({ alerts }: { alerts: MonitorAlert[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? alerts : alerts.slice(0, THEME_NEWS_PREVIEW);
  const hiddenCount = Math.max(0, alerts.length - THEME_NEWS_PREVIEW);

  return (
    <section className="monitor-section">
      <div className="monitor-section-head">
        <h2 className="section-title">主线快讯</h2>
        <span className="muted monitor-section-count">{alerts.length} 条</span>
      </div>
      <p className="muted monitor-section-hint">
        仅展示各主线最新一条，当天保留、次日晚自动清理。
      </p>
      <ul className="monitor-news-feed">
        {visible.map((alert) => (
          <li key={alert.id} className="monitor-news-feed-item">
            <span className="monitor-news-feed-time">{fmtTime(alert.createdAt)}</span>
            {alert.theme ? (
              <span className="monitor-news-feed-theme">{alert.theme}</span>
            ) : null}
            {alert.newsUrl ? (
              <a
                href={alert.newsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="monitor-news-feed-title"
              >
                {alert.newsTitle ?? alert.summary}
              </a>
            ) : (
              <span className="monitor-news-feed-title">
                {alert.newsTitle ?? alert.summary}
              </span>
            )}
          </li>
        ))}
      </ul>
      {hiddenCount > 0 && (
        <button
          type="button"
          className="button button-secondary monitor-news-feed-toggle"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? '收起' : `展开其余 ${hiddenCount} 条`}
        </button>
      )}
    </section>
  );
}

function recommendationLabel(level: MonitorPaperRecommendation['level']) {
  if (level === 'auto_buy') return '潜伏买入';
  if (level === 'watch') return '自动跟踪';
  return '消息记录';
}

function statusLabel(status: MonitorPaperRecommendation['status']) {
  if (status === 'bought') return '已买入';
  if (status === 'tracked') return '跟踪中';
  if (status === 'skipped') return '已跳过';
  if (status === 'error') return '执行失败';
  return '处理中';
}

function RecommendationCard({ item }: { item: MonitorPaperRecommendation }) {
  const { setOpen } = useWatchlistPanel();
  const statusNote = item.error ?? (item.status === 'tracked' ? item.reason : item.skipReason);

  return (
    <article className={`monitor-stock-card monitor-stock-card--compact monitor-recommendation monitor-recommendation--${item.level}`}>
      <div className="monitor-stock-card-head">
        <span className={`monitor-type monitor-recommendation-type--${item.level}`}>
          {recommendationLabel(item.level)}
        </span>
        <span className="history-card-time">{statusLabel(item.status)}</span>
      </div>

      {item.symbol ? (
        <MonitorStockInsight
          symbol={item.symbol}
          fallbackName={item.name}
          theme={item.theme}
          pctChg={item.pctChg}
          ret20dPct={item.ret20dPct}
          eventPoints={item.eventPoints ?? []}
          compact
        />
      ) : (
        <strong>{item.name ?? '未识别标的'}</strong>
      )}

      {statusNote ? (
        <p className="monitor-summary monitor-summary--compact monitor-summary--status">
          {statusNote}
        </p>
      ) : null}

      {(item.shares || item.price) && (
        <div className="history-card-meta">
          {item.shares ? <span>股数 {item.shares}</span> : null}
          {item.price ? <span>价格 {item.price.toFixed(2)}</span> : null}
        </div>
      )}

      <div className="monitor-card-actions monitor-card-actions--compact">
        {item.status === 'bought' && (
          <Link href="/paper" className="saved-link">
            查看模拟盘
          </Link>
        )}
        {item.status === 'tracked' && (
          <button
            type="button"
            className="saved-link"
            onClick={() => setOpen(true)}
          >
            查看跟踪池
          </button>
        )}
        {item.symbol && (
          <Link href={`/research?symbol=${item.symbol}`} className="saved-link">
            生成研报
          </Link>
        )}
      </div>
    </article>
  );
}

function paperActionLabel(item: MonitorPaperAction) {
  if (item.kind === 'track') return '加入自选';
  if (item.status === 'bought') return '自动买入';
  if (item.status === 'sold') return '自动卖出';
  if (item.status === 'tracked') return '跟踪中';
  if (item.status === 'skipped') return '跳过';
  return '失败';
}

function PaperActionCard({ item }: { item: MonitorPaperAction }) {
  return (
    <article className={`monitor-stock-card monitor-stock-card--compact monitor-card monitor-card--${item.status === 'error' ? 'urgent' : 'watch'}`}>
      <div className="monitor-stock-card-head">
        <span className="monitor-type monitor-recommendation-type--auto_buy">
          {paperActionLabel(item)}
        </span>
        <span className="history-card-time">
          {item.kind === 'buy' ? '买入检查' : '卖出检查'}
        </span>
      </div>

      <MonitorStockInsight
        symbol={item.symbol}
        fallbackName={item.name}
        eventPoints={[item.kind === 'buy' ? '自动买入' : '自动卖出']}
        compact
      />

      <p className="monitor-summary monitor-summary--compact">{item.error ?? item.reason}</p>
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
      className={`monitor-stock-card monitor-stock-card--compact monitor-card monitor-card--${alert.severity}${alert.acknowledged ? ' monitor-card--read' : ''}`}
    >
      <div className="monitor-stock-card-head">
        <span className={`monitor-type monitor-type--${alert.alertType}`}>
          {typeLabel}
        </span>
        <span className="history-card-time">{fmtTime(alert.createdAt)}</span>
      </div>

      {alert.symbol ? (
        <MonitorStockInsight
          symbol={alert.symbol}
          fallbackName={alert.name}
          theme={alert.theme}
          pctChg={alert.pctChg}
          ret20dPct={alert.ret20dPct}
          eventPoints={buildAlertEventPoints(alert)}
          compact
        />
      ) : (
        <strong>{alert.title}</strong>
      )}

      {!alert.symbol && (
        <p className="monitor-summary monitor-summary--compact">{alert.summary}</p>
      )}

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

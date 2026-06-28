'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { MonitorStockInsight } from '@/components/monitor/MonitorStockInsight';
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
  autoTrack?: {
    mode: string;
    modeLabel: string;
    watchlistCount: number;
    watchlistLimit: number;
  };
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
  summary?: string;
  skipped?: boolean;
  recommendations?: MonitorPaperRecommendation[];
  paperActions?: MonitorPaperAction[];
  error?: string;
};

type RadarStockStatus = 'attention' | 'bought' | 'sold' | 'tracked' | 'watch' | 'error';

type RadarStockItem = {
  key: string;
  status: RadarStockStatus;
  symbol: string;
  name: string | null;
  theme: string | null;
  pctChg: number | null;
  ret20dPct: number | null;
  eventPoints: string[];
  reason: string;
  time?: string;
  shares?: number;
  price?: number;
  actionTarget?: 'paper' | 'watchlist' | 'research';
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

const RADAR_STOCK_STATUS_RANK: Record<RadarStockStatus, number> = {
  attention: 0,
  bought: 1,
  sold: 1,
  tracked: 2,
  watch: 3,
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

function statusFromRecommendation(
  item: MonitorPaperRecommendation,
): RadarStockStatus {
  if (item.status === 'bought') return 'bought';
  if (item.status === 'tracked') return 'tracked';
  if (item.status === 'error') return 'error';
  return 'watch';
}

function statusFromPaperAction(item: MonitorPaperAction): RadarStockStatus {
  if (item.status === 'bought') return 'bought';
  if (item.status === 'sold') return 'sold';
  if (item.status === 'error') return 'error';
  if (item.status === 'tracked') return 'tracked';
  return 'watch';
}

function mergeRadarStocks(
  alerts: MonitorAlert[],
  recommendations: MonitorPaperRecommendation[],
  actions: MonitorPaperAction[],
): RadarStockItem[] {
  const bySymbol = new Map<string, RadarStockItem>();

  const put = (item: RadarStockItem) => {
    const existing = bySymbol.get(item.symbol);
    if (!existing) {
      bySymbol.set(item.symbol, item);
      return;
    }

    const currentRank = RADAR_STOCK_STATUS_RANK[item.status];
    const existingRank = RADAR_STOCK_STATUS_RANK[existing.status];
    if (
      currentRank < existingRank ||
      (currentRank === existingRank && (item.time ?? '') > (existing.time ?? ''))
    ) {
      bySymbol.set(item.symbol, item);
    }
  };

  for (const alert of alerts) {
    if (!alert.symbol) continue;
    put({
      key: `alert:${alert.id}`,
      status: 'attention',
      symbol: alert.symbol,
      name: alert.name,
      theme: alert.theme,
      pctChg: alert.pctChg,
      ret20dPct: alert.ret20dPct,
      eventPoints: buildAlertEventPoints(alert),
      reason: alert.newsTitle ?? alert.summary,
      time: alert.createdAt,
      actionTarget: 'research',
    });
  }

  for (const item of recommendations) {
    if (!item.symbol) continue;
    put({
      key: `recommendation:${item.alertId}`,
      status: statusFromRecommendation(item),
      symbol: item.symbol,
      name: item.name,
      theme: item.theme,
      pctChg: item.pctChg,
      ret20dPct: item.ret20dPct,
      eventPoints: item.eventPoints ?? [],
      reason: item.error ?? item.skipReason ?? item.reason,
      shares: item.shares,
      price: item.price,
      actionTarget:
        item.status === 'bought'
          ? 'paper'
          : item.status === 'tracked'
            ? 'watchlist'
            : 'research',
    });
  }

  for (const item of actions) {
    put({
      key: `action:${item.kind}:${item.symbol}`,
      status: statusFromPaperAction(item),
      symbol: item.symbol,
      name: item.name,
      theme: null,
      pctChg: null,
      ret20dPct: null,
      eventPoints: [paperActionLabel(item)],
      reason: item.error ?? item.reason,
      shares: item.shares,
      price: item.price,
      actionTarget: 'paper',
    });
  }

  return [...bySymbol.values()].sort((a, b) => {
    const rankDiff =
      RADAR_STOCK_STATUS_RANK[a.status] - RADAR_STOCK_STATUS_RANK[b.status];
    if (rankDiff !== 0) return rankDiff;
    return (b.time ?? '').localeCompare(a.time ?? '');
  });
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

function filterPaperActionsForDisplay(
  actions: MonitorPaperAction[],
): MonitorPaperAction[] {
  const tradeOnly = actions.filter(
    (item) =>
      item.kind !== 'track' &&
      item.status !== 'skipped' &&
      (item.status === 'bought' ||
        item.status === 'sold' ||
        item.status === 'error'),
  );
  const byKey = new Map<string, MonitorPaperAction>();
  for (const item of tradeOnly) {
    const key = `${item.kind}:${item.symbol}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, item);
      continue;
    }
    const rank = (status: MonitorPaperAction['status']) =>
      status === 'bought' || status === 'sold' ? 0 : 1;
    if (rank(item.status) < rank(existing.status)) {
      byKey.set(key, item);
    }
  }
  return [...byKey.values()];
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

function fmtDuration(ms: number | undefined) {
  if (!ms || ms < 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${Math.round(ms / 1000)}s`;
}

const FORBIDDEN_MESSAGES: Record<string, string> = {
  backtest: '回测为高级功能，当前账号暂无权限。如需开通请联系管理员。',
  admin: '后台管理仅管理员可访问。如需开通请联系管理员。',
};

function ForbiddenNotice() {
  const searchParams = useSearchParams();
  const message = FORBIDDEN_MESSAGES[searchParams.get('forbidden') ?? ''] ?? null;
  if (!message) return null;
  return (
    <div className="notice notice--warn" role="status">
      {message}
    </div>
  );
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
  const [scanMessage, setScanMessage] = useState<string | null>(null);
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
          body: JSON.stringify({ action: 'force' }),
        });
        const data = (await res.json()) as MonitorPollResponse;
        if (!res.ok) throw new Error(data.error ?? '扫描失败');
        setLastRecommendations(data.recommendations ?? []);
        setLastPaperActions(data.paperActions ?? []);
        setScanMessage(data.summary ? `本次扫描：${data.summary}` : '本次扫描已完成');
        setError(null);
        await load();
      } catch (err) {
        if (!options?.silent) {
          setError(err instanceof Error ? err.message : '扫描失败');
          setScanMessage(null);
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
  const priorityAlerts = dedupeAlertsBySymbol(
    alerts.filter(
      (a) => a.symbol && a.severity === 'urgent' && !a.acknowledged,
    ),
  );
  const themeAlerts = useMemo(
    () => consolidateThemeAlerts(alerts),
    [alerts],
  );
  const actionableRecommendations = dedupeRecommendationsBySymbol(
    lastRecommendations.filter((item) => item.symbol && item.level !== 'info'),
  );
  const displayPaperActions = useMemo(
    () => filterPaperActionsForDisplay(lastPaperActions),
    [lastPaperActions],
  );
  const boughtActions = displayPaperActions.filter((item) => item.status === 'bought');
  const soldActions = displayPaperActions.filter((item) => item.status === 'sold');
  const radarStocks = useMemo(
    () =>
      mergeRadarStocks(
        priorityAlerts,
        actionableRecommendations,
        displayPaperActions,
      ),
    [priorityAlerts, actionableRecommendations, displayPaperActions],
  );
  const attentionCount = radarStocks.filter((item) => item.status === 'attention').length;
  const trackedCount = radarStocks.filter(
    (item) => item.status === 'tracked',
  ).length;
  const alertSymbolsCount = alerts.filter((a) => a.symbol).length;
  const verdictTitle = loading
    ? '正在读取雷达状态'
    : attentionCount > 0
      ? `${attentionCount} 只需要优先查看`
    : boughtActions.length + soldActions.length > 0
        ? '模拟盘已有自动动作'
        : trackedCount > 0
          ? `${trackedCount} 只已进入自动跟踪`
          : radarStocks.length > 0
            ? `${radarStocks.length} 只股票进入雷达`
            : alerts.length > 0
              ? '只有资讯提醒，暂无个股动作'
              : '当前没有待处理标的';
  const verdictDetail = loading
    ? '正在同步后台扫描结果。'
    : attentionCount > 0
      ? '先看这些标的的催化、涨幅和主题，再决定是否继续跟踪或生成研报。'
      : boughtActions.length + soldActions.length > 0
        ? '自动交易结果已写入模拟盘，下方保留本次成交记录。'
        : trackedCount > 0
          ? '雷达已把标的放入跟踪流程，后续等待红钻、动量或买入条件确认。'
          : radarStocks.length > 0
            ? '已有标的被识别，状态会直接显示在股票卡片上。'
            : alerts.length > 0
              ? '主线或资讯有更新，但当前没有需要立刻处理的个股卡片。'
              : '雷达会持续扫描最近智能选股候选、跟踪池和主线快讯；有信号时会在下方列出。';

  return (
    <main className="page page--list">
      <PageHeader
        title="消息雷达"
        description="盯住候选池、跟踪池和主线快讯，只把需要处理的个股信号推到你面前。"
      />

      <Suspense fallback={null}>
        <ForbiddenNotice />
      </Suspense>

      <div className="list-stack">
        <div className="list-stack-head">
          <section className="monitor-console" aria-label="雷达控制台">
            <div className="monitor-console-main">
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
              </div>

              <div className="monitor-verdict">
                <span className="monitor-verdict-label">当前结论</span>
                <h2>{verdictTitle}</h2>
                <p>{verdictDetail}</p>
              </div>

              <dl className="monitor-scope-list" aria-label="扫描范围与结果">
                <div>
                  <dt>监控来源</dt>
                  <dd>智能选股候选 · 跟踪池 · 主线快讯</dd>
                </div>
                <div>
                  <dt>本轮扫描</dt>
                  <dd>
                    {status?.lastRun
                      ? `${status.lastRun.symbolsScanned} 只股票 · ${status.lastRun.newsCount} 条资讯`
                      : '等待首次扫描'}
                  </dd>
                </div>
                <div>
                  <dt>命中结果</dt>
                  <dd>
                    {alertSymbolsCount} 只有代码提醒 · {themeAlerts.length} 条主线快讯
                  </dd>
                </div>
                <div>
                  <dt>自动策略</dt>
                  <dd>
                    {status?.autoTrack
                      ? `${status.autoTrack.modeLabel} · ${status.autoTrack.watchlistCount}/${status.autoTrack.watchlistLimit}`
                      : '读取中'}
                  </dd>
                </div>
              </dl>

              {status?.lastRun && (
                <p className="monitor-last-run">
                  上次 {fmtTime(status.lastRun.createdAt)} · 耗时{' '}
                  {fmtDuration(status.lastRun.elapsedMs)} · {status.lastRun.summary}
                </p>
              )}
            </div>

            <div className="monitor-console-side">
              <button
                type="button"
                className="button"
                disabled={polling}
                onClick={() => void runPoll()}
              >
                {polling ? '扫描中…' : '立即扫描'}
              </button>
              <Link href="/monitor/settings" className="button button-secondary">
                雷达设置
              </Link>
              <div className="monitor-side-metrics" aria-label="关键计数">
                <span>
                  <strong>{radarStocks.length}</strong>
                  股票
                </span>
                <span>
                  <strong>{attentionCount}</strong>
                  待看
                </span>
                <span>
                  <strong>{boughtActions.length + soldActions.length}</strong>
                  交易
                </span>
              </div>
            </div>
          </section>

          {loading && <div className="list-loading">加载监控…</div>}
          {error && <div className="error">{error}</div>}
          {scanMessage && !error && (
            <div className="notice" role="status">
              {scanMessage}
            </div>
          )}
        </div>

        {!loading && radarStocks.length === 0 && (
          <div className="empty-state empty-state--monitor">
            <strong>当前没有雷达识别股票</strong>
            <span>
              {alerts.length > 0
                ? '下方仍保留主线快讯作为背景信息；识别到具体股票后会在这里出现。'
                : '雷达会继续盯候选池、跟踪池和资讯流；有信号时会在这里变成卡片。'}
            </span>
          </div>
        )}

        {radarStocks.length > 0 && (
          <section className="monitor-section">
            <div className="monitor-section-head">
              <h2 className="section-title">雷达识别股票</h2>
              <span className="muted monitor-section-count">
                {radarStocks.length} 只
              </span>
            </div>
            <p className="muted monitor-section-hint">
              只保留雷达识别到的具体股票；卡片标签表示当前状态。
            </p>
            <div className="monitor-stock-grid">
              {radarStocks.map((item) => (
                <RadarStockCard key={item.key} item={item} />
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

function radarStockStatusLabel(status: RadarStockStatus) {
  if (status === 'attention') return '待看';
  if (status === 'bought') return '已买入';
  if (status === 'sold') return '已卖出';
  if (status === 'tracked') return '跟踪中';
  if (status === 'error') return '执行失败';
  return '观察';
}

function RadarStockCard({ item }: { item: RadarStockItem }) {
  const { setOpen } = useWatchlistPanel();

  return (
    <article className={`monitor-stock-card monitor-stock-card--compact monitor-card monitor-card--${item.status}`}>
      <div className="monitor-stock-card-head">
        <span className={`monitor-type monitor-status-type--${item.status}`}>
          {radarStockStatusLabel(item.status)}
        </span>
        {item.time ? (
          <span className="history-card-time">{fmtTime(item.time)}</span>
        ) : null}
      </div>

      <MonitorStockInsight
        symbol={item.symbol}
        fallbackName={item.name}
        theme={item.theme}
        pctChg={item.pctChg}
        ret20dPct={item.ret20dPct}
        eventPoints={item.eventPoints}
        compact
      />

      {item.reason ? (
        <p className="monitor-summary monitor-summary--compact monitor-summary--status">
          {item.reason}
        </p>
      ) : null}

      {(item.shares || item.price) && (
        <div className="history-card-meta">
          {item.shares ? <span>股数 {item.shares}</span> : null}
          {item.price ? <span>价格 {item.price.toFixed(2)}</span> : null}
        </div>
      )}

      <div className="monitor-card-actions monitor-card-actions--compact">
        {item.actionTarget === 'paper' && (
          <Link href="/paper" className="saved-link">
            查看模拟盘
          </Link>
        )}
        {item.actionTarget === 'watchlist' && (
          <button
            type="button"
            className="saved-link"
            onClick={() => setOpen(true)}
          >
            查看跟踪池
          </button>
        )}
        {item.actionTarget === 'research' && (
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

'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { useAuthUser } from '@/hooks/useAuthUser';
import { canUseScheduledTasks } from '@/lib/scheduled-tasks-shared';
import styles from './scheduled-tasks.module.css';

type ScheduledTaskStatus = {
  id: string;
  label: string;
  scheduleText: string;
};

type ScheduledTaskLogEntry = {
  taskId: string;
  label: string;
  tradeDate: string;
  ranAt: string;
  ranAtBeijing: string;
  status: 'completed' | 'skipped' | 'failed' | 'disabled';
  reason?: string;
  summary?: string;
  elapsedMs?: number;
};

type StockUpdateItem = {
  symbol: string;
  name: string;
  attempts: number;
  addedRows: number;
  updatedRows: number;
  latestDate: string | null;
  error?: string;
};

type StockUpdateProgress = {
  running: boolean;
  total: number;
  processed: number;
  pending: number;
  round: number;
  retryRounds: number;
  addedRows: number;
  updatedRows: number;
  errors: number;
  current?: string;
  message: string;
};

type StockUpdateResult = {
  items?: StockUpdateItem[];
  addedRows?: number;
  updatedRows?: number;
  errors?: number;
  tradeDate?: string;
};

type StockUpdateStreamEvent = {
  type: string;
  total?: number;
  processed?: number;
  pending?: number;
  round?: number;
  retryRounds?: number;
  message?: string;
  final?: boolean;
  item?: StockUpdateItem;
  result?: StockUpdateResult | {
    result?: StockUpdateResult;
    summary?: string;
  };
};

const STATUS_LABEL: Record<ScheduledTaskLogEntry['status'], string> = {
  completed: '已完成',
  skipped: '已跳过',
  failed: '失败',
  disabled: '已关闭',
};

function formatTradeDateLabel(tradeDate: string): string {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  const yesterdayDate = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }),
  );
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(yesterdayDate);

  if (tradeDate === today) return '今天';
  if (tradeDate === yesterday) return '昨天';
  return tradeDate;
}

function formatElapsed(ms?: number): string | null {
  if (ms == null) return null;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function getSseData(chunk: string): StockUpdateStreamEvent | null {
  const data = chunk
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (!data) return null;
  try {
    return JSON.parse(data) as StockUpdateStreamEvent;
  } catch {
    return null;
  }
}

function isStockUpdateRunResult(
  value: StockUpdateStreamEvent['result'],
): value is { result?: StockUpdateResult; summary?: string } {
  return Boolean(value && 'result' in value);
}

function extractDoneResult(event: StockUpdateStreamEvent): StockUpdateResult | null {
  if (!event.result) return null;
  if (isStockUpdateRunResult(event.result)) return event.result.result ?? null;
  return event.result;
}

export default function ScheduledTasksPage() {
  const { user, loading: authLoading } = useAuthUser();
  const canAccess = canUseScheduledTasks(user ?? undefined);

  const [logs, setLogs] = useState<ScheduledTaskLogEntry[]>([]);
  const [tasks, setTasks] = useState<ScheduledTaskStatus[]>([]);
  const [tradeDates, setTradeDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>('all');
  const [selectedTaskId, setSelectedTaskId] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [stockUpdate, setStockUpdate] = useState<StockUpdateProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '500' });
      if (selectedDate !== 'all') params.set('tradeDate', selectedDate);
      if (selectedTaskId !== 'all') params.set('taskId', selectedTaskId);

      const res = await fetch(`/api/scheduled-tasks/logs?${params.toString()}`);
      const data = (await res.json()) as {
        logs?: ScheduledTaskLogEntry[];
        tradeDates?: string[];
        tasks?: ScheduledTaskStatus[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? '加载失败');

      setLogs(data.logs ?? []);
      setTradeDates(data.tradeDates ?? []);
      setTasks(data.tasks ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setLoading(false);
    }
  }, [selectedDate, selectedTaskId]);

  useEffect(() => {
    if (!canAccess) {
      setLoading(false);
      return;
    }
    void load();
  }, [canAccess, load]);

  const clearLogs = useCallback(async () => {
    if (logs.length === 0 || clearing) return;
    const confirmed = window.confirm(
      '确认清空最近 3 天的定时任务日志吗？此操作不会影响任务开关。',
    );
    if (!confirmed) return;

    setClearing(true);
    setError(null);
    try {
      const res = await fetch('/api/scheduled-tasks/logs', { method: 'DELETE' });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? '清空失败');
      setLogs([]);
      setTradeDates([]);
      setSelectedDate('all');
      setSelectedTaskId('all');
    } catch (err) {
      setError(err instanceof Error ? err.message : '清空失败');
    } finally {
      setClearing(false);
    }
  }, [clearing, logs.length]);

  const handleStockUpdateEvent = useCallback((event: StockUpdateStreamEvent) => {
    if (event.type === 'start') {
      setStockUpdate({
        running: true,
        total: event.total ?? 0,
        processed: 0,
        pending: event.total ?? 0,
        round: 1,
        retryRounds: event.retryRounds ?? 1,
        addedRows: 0,
        updatedRows: 0,
        errors: 0,
        message: '准备更新',
      });
      return;
    }

    if (event.type === 'round') {
      setStockUpdate((prev) => ({
        running: true,
        total: event.total ?? prev?.total ?? 0,
        processed: event.processed ?? prev?.processed ?? 0,
        pending: event.pending ?? prev?.pending ?? 0,
        round: event.round ?? prev?.round ?? 1,
        retryRounds: event.retryRounds ?? prev?.retryRounds ?? 1,
        addedRows: prev?.addedRows ?? 0,
        updatedRows: prev?.updatedRows ?? 0,
        errors: prev?.errors ?? 0,
        current: prev?.current,
        message: `第 ${event.round ?? 1}/${event.retryRounds ?? 1} 轮`,
      }));
      return;
    }

    if (event.type === 'item' && event.item) {
      const item = event.item;
      setStockUpdate((prev) => {
        const final = event.final ?? true;
        return {
          running: true,
          total: event.total ?? prev?.total ?? 0,
          processed: event.processed ?? prev?.processed ?? 0,
          pending: event.pending ?? prev?.pending ?? 0,
          round: event.round ?? prev?.round ?? 1,
          retryRounds: event.retryRounds ?? prev?.retryRounds ?? 1,
          addedRows: (prev?.addedRows ?? 0) + (final ? item.addedRows : 0),
          updatedRows:
            (prev?.updatedRows ?? 0) + (final ? item.updatedRows : 0),
          errors: (prev?.errors ?? 0) + (final && item.error ? 1 : 0),
          current: `${item.symbol} ${item.name}`,
          message: item.error
            ? final
              ? item.error
              : '等待重试'
            : `最新 ${item.latestDate ?? '-'}`,
        };
      });
      return;
    }

    if (event.type === 'done' || event.type === 'complete') {
      const result = extractDoneResult(event);
      setStockUpdate((prev) => ({
        running: false,
        total: result?.items?.length ?? event.total ?? prev?.total ?? 0,
        processed:
          result?.items?.length ??
          event.processed ??
          prev?.processed ??
          prev?.total ??
          0,
        pending: 0,
        round: prev?.round ?? 1,
        retryRounds: prev?.retryRounds ?? 1,
        addedRows: result?.addedRows ?? prev?.addedRows ?? 0,
        updatedRows: result?.updatedRows ?? prev?.updatedRows ?? 0,
        errors: result?.errors ?? prev?.errors ?? 0,
        current: prev?.current,
        message: event.type === 'complete' ? '更新完成' : '收尾中',
      }));
      return;
    }

    if (event.type === 'error') {
      setStockUpdate((prev) => ({
        running: false,
        total: prev?.total ?? 0,
        processed: prev?.processed ?? 0,
        pending: prev?.pending ?? 0,
        round: prev?.round ?? 1,
        retryRounds: prev?.retryRounds ?? 1,
        addedRows: prev?.addedRows ?? 0,
        updatedRows: prev?.updatedRows ?? 0,
        errors: prev?.errors ?? 0,
        current: prev?.current,
        message: event.message ?? '更新失败',
      }));
    }
  }, []);

  const runStockUpdate = useCallback(async () => {
    if (stockUpdate?.running) return;
    setError(null);
    setStockUpdate({
      running: true,
      total: 0,
      processed: 0,
      pending: 0,
      round: 1,
      retryRounds: 1,
      addedRows: 0,
      updatedRows: 0,
      errors: 0,
      message: '启动中',
    });

    try {
      const res = await fetch('/api/scheduled-tasks/stock-daily-csv-update/stream', {
        method: 'POST',
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? '启动失败');
      }
      if (!res.body) throw new Error('没有收到进度流');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          const chunk = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const event = getSseData(chunk);
          if (event) handleStockUpdateEvent(event);
          boundary = buffer.indexOf('\n\n');
        }
      }

      void load();
    } catch (err) {
      const message = err instanceof Error ? err.message : '更新失败';
      setStockUpdate((prev) => ({
        running: false,
        total: prev?.total ?? 0,
        processed: prev?.processed ?? 0,
        pending: prev?.pending ?? 0,
        round: prev?.round ?? 1,
        retryRounds: prev?.retryRounds ?? 1,
        addedRows: prev?.addedRows ?? 0,
        updatedRows: prev?.updatedRows ?? 0,
        errors: prev?.errors ?? 0,
        current: prev?.current,
        message,
      }));
      setError(message);
    }
  }, [handleStockUpdateEvent, load, stockUpdate?.running]);

  const groupedLogs = useMemo(() => {
    const groups = new Map<string, ScheduledTaskLogEntry[]>();
    for (const entry of logs) {
      const bucket = groups.get(entry.tradeDate) ?? [];
      bucket.push(entry);
      groups.set(entry.tradeDate, bucket);
    }
    return [...groups.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [logs]);

  const stats = useMemo(() => {
    const completed = logs.filter((entry) => entry.status === 'completed').length;
    const failed = logs.filter((entry) => entry.status === 'failed').length;
    return { total: logs.length, completed, failed };
  }, [logs]);

  const stockUpdatePercent =
    stockUpdate && stockUpdate.total > 0
      ? Math.min(100, Math.round((stockUpdate.processed / stockUpdate.total) * 100))
      : 0;

  if (authLoading) {
    return (
      <main className="page page--list">
        <PageHeader title="任务日志" description="加载中…" />
      </main>
    );
  }

  if (!canAccess) {
    return (
      <main className="page page--list">
        <PageHeader
          title="任务日志"
          description="查看 agent-core 后台定时任务的实际执行情况。"
        />
        <section className="pane-card">
          <p className="error">定时任务日志仅 Pro 及以上账号可用。</p>
          <p className="muted">
            可在 <Link href="/settings#scheduled-tasks">设置 → 定时任务</Link> 中管理任务开关。
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="page page--list scheduled-tasks-page">
      <PageHeader
        title="任务日志"
        description="记录后台 worker 的实际执行情况，仅保留最近 3 天，便于回溯确认任务是否已跑。"
      />

      <div className={styles.pageActions}>
        <Link href="/settings#scheduled-tasks" className="monitor-scan-status-link">
          任务开关
        </Link>
        <button
          type="button"
          className="monitor-scan-status-link"
          disabled={loading || clearing}
          onClick={() => void load()}
        >
          {loading ? '刷新中…' : '刷新'}
        </button>
        <button
          type="button"
          className={`${styles.clearButton} monitor-scan-status-link`}
          disabled={loading || clearing || logs.length === 0}
          onClick={() => void clearLogs()}
        >
          {clearing ? '清空中…' : '清空日志'}
        </button>
      </div>

      {error ? <div className="error">{error}</div> : null}

      <section className={`pane-card ${styles.stockUpdatePanel}`}>
        <div className={styles.stockUpdateHeader}>
          <div>
            <h2 className="section-title">股票日线更新</h2>
            <p className="muted">逐只补齐本地 A 股前复权日线 CSV。</p>
          </div>
          <button
            type="button"
            className="button button-primary"
            disabled={stockUpdate?.running}
            onClick={() => void runStockUpdate()}
          >
            {stockUpdate?.running ? '更新中…' : '更新股票日线'}
          </button>
        </div>

        {stockUpdate ? (
          <div className={styles.stockUpdateProgress}>
            <div className={styles.progressTrack}>
              <div
                className={styles.progressFill}
                style={{ width: `${stockUpdatePercent}%` }}
              />
            </div>
            <div className={styles.progressMeta}>
              <span>
                {stockUpdate.processed}/{stockUpdate.total || '-'} · {stockUpdatePercent}%
              </span>
              <span>
                第 {stockUpdate.round}/{stockUpdate.retryRounds} 轮
              </span>
              <span>新增 {stockUpdate.addedRows}</span>
              <span>修正 {stockUpdate.updatedRows}</span>
              <span>失败 {stockUpdate.errors}</span>
            </div>
            <p className={`${styles.logDetail} muted`}>
              {stockUpdate.current ? `${stockUpdate.current} · ` : ''}
              {stockUpdate.message}
            </p>
          </div>
        ) : null}
      </section>

      <section className={`pane-card ${styles.toolbar}`}>
        <div className={styles.filters}>
          <label className={styles.filter}>
            <span>交易日</span>
            <select
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value)}
            >
              <option value="all">全部（近 3 天）</option>
              {tradeDates.map((tradeDate) => (
                <option key={tradeDate} value={tradeDate}>
                  {formatTradeDateLabel(tradeDate)} ({tradeDate})
                </option>
              ))}
            </select>
          </label>

          <label className={styles.filter}>
            <span>任务</span>
            <select
              value={selectedTaskId}
              onChange={(event) => setSelectedTaskId(event.target.value)}
            >
              <option value="all">全部任务</option>
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className={`${styles.stats} muted`}>
          共 {stats.total} 条 · 完成 {stats.completed} · 失败 {stats.failed}
        </div>
      </section>

      {loading && logs.length === 0 ? (
        <section className="pane-card">
          <p className="muted">加载中…</p>
        </section>
      ) : null}

      {!loading && logs.length === 0 ? (
        <section className="pane-card">
          <p className="muted">
            暂无执行记录。请确认 agent-core 服务正在运行，且相关任务已开启。
          </p>
        </section>
      ) : null}

      {groupedLogs.map(([tradeDate, entries]) => (
        <section key={tradeDate} className="pane-card">
          <h2 className="section-title">
            {formatTradeDateLabel(tradeDate)}
            <span className={`muted ${styles.groupDate}`}>{tradeDate}</span>
          </h2>

          <div className={styles.logList}>
            {entries.map((entry) => (
              <article
                key={`${entry.taskId}-${entry.ranAt}`}
                className={`${styles.logRow}${entry.status === 'failed' ? ` ${styles.logRowFailed}` : ''}`}
              >
                <div className={styles.logMain}>
                  <strong>{entry.label}</strong>
                  <span
                    className={`${styles.status} ${
                      entry.status === 'completed'
                        ? styles.statusCompleted
                        : entry.status === 'failed'
                          ? styles.statusFailed
                          : entry.status === 'disabled'
                            ? styles.statusDisabled
                            : styles.statusSkipped
                    }`}
                  >
                    {STATUS_LABEL[entry.status]}
                  </span>
                </div>
                <div className={`${styles.logMeta} muted`}>
                  <span>{entry.ranAtBeijing}</span>
                  {formatElapsed(entry.elapsedMs) ? (
                    <span>{formatElapsed(entry.elapsedMs)}</span>
                  ) : null}
                </div>
                {(entry.summary || entry.reason) && (
                  <p className={`${styles.logDetail} muted`}>
                    {entry.summary ?? entry.reason}
                    {entry.summary && entry.reason ? ` · ${entry.reason}` : ''}
                  </p>
                )}
              </article>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}

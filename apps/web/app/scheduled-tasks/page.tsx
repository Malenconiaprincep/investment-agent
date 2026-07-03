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

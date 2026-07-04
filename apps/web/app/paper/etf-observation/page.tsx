'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import styles from './etf-observation.module.css';

type ObservationStatus = 'pass' | 'warn' | 'fail' | 'pending';

type ObservationCheck = {
  id: 'data' | 'autoTrade' | 'drawdown' | 'behavior' | 'roughMarket';
  label: string;
  status: ObservationStatus;
  score: number;
  message: string;
  details: string[];
  metrics?: Record<string, number | string | null>;
};

type ObservationSnapshot = {
  id: string;
  tradeDate: string;
  generatedAt: string;
  score: number;
  overallStatus: ObservationStatus;
  checks: ObservationCheck[];
  metrics: {
    returnPct: number;
    totalValue: number;
    maxDrawdownPct: number | null;
    downDays: number;
    observationDays: number;
  };
};

type ObservationReport = {
  generatedAt: string;
  observationStartDate: string | null;
  targetEndDate: string | null;
  elapsedDays: number;
  remainingDays: number | null;
  loggedDays: number;
  latest: ObservationSnapshot;
  history: ObservationSnapshot[];
};

const STATUS_LABEL: Record<ObservationStatus, string> = {
  pass: '达标',
  warn: '观察',
  fail: '异常',
  pending: '等待样本',
};

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtMoney(value: number) {
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
}

function fmtPct(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function statusClass(status: ObservationStatus) {
  return `${styles.statusPill} ${styles[`status-${status}`]}`;
}

export default function EtfObservationPage() {
  const [report, setReport] = useState<ObservationReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const response = await fetch('/api/paper/etf-observation', {
        cache: 'no-store',
      });
      const payload = (await response.json()) as ObservationReport & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? '加载失败');
      setReport(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load({ silent: true }), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function saveSnapshot() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/paper/etf-observation', { method: 'POST' });
      const payload = (await response.json()) as ObservationReport & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? '写入失败');
      setReport(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setSaving(false);
    }
  }

  const progressPct = useMemo(() => {
    if (!report) return 0;
    return Math.max(0, Math.min(100, (report.elapsedDays / 56) * 100));
  }, [report]);

  const latest = report?.latest;

  return (
    <main className="page page--list">
      <PageHeader
        eyebrow="ETF 模拟盘"
        title="实盘前观察面板"
        description="按数据、自动交易、回撤、策略行为和不顺行情 5 个条件持续记录 8 周观察期。"
      />

      <nav className="page-toolbar" aria-label="ETF 观察操作">
        <button type="button" className="button" onClick={saveSnapshot} disabled={saving}>
          {saving ? '记录中…' : '记录今日快照'}
        </button>
        <button type="button" className="button button-secondary" onClick={() => load()}>
          刷新
        </button>
        <Link href="/paper?bucket=etf" className="button button-secondary">
          返回 ETF 仓
        </Link>
      </nav>

      {loading && <div className="list-loading">加载 ETF 观察报告…</div>}
      {error && <div className="error">{error}</div>}

      {latest && report && (
        <>
          <section className={styles.hero}>
            <div className={styles.heroMain}>
              <span className={statusClass(latest.overallStatus)}>
                {STATUS_LABEL[latest.overallStatus]}
              </span>
              <strong>{latest.score}</strong>
              <span className="muted">观察总分</span>
            </div>
            <div className={styles.heroStats}>
              <div>
                <span className="muted">累计收益</span>
                <strong className={latest.metrics.returnPct >= 0 ? 'return-up' : 'return-down'}>
                  {fmtPct(latest.metrics.returnPct)}
                </strong>
              </div>
              <div>
                <span className="muted">总资产</span>
                <strong>{fmtMoney(latest.metrics.totalValue)}</strong>
              </div>
              <div>
                <span className="muted">最大回撤</span>
                <strong>{fmtPct(latest.metrics.maxDrawdownPct)}</strong>
              </div>
              <div>
                <span className="muted">观察进度</span>
                <strong>{report.elapsedDays}/56 天</strong>
              </div>
            </div>
            <div className={styles.progressTrack} aria-label="8 周观察进度">
              <span style={{ width: `${progressPct}%` }} />
            </div>
            <div className={styles.heroFoot}>
              <span>
                起始 {report.observationStartDate ?? '—'} · 目标结束{' '}
                {report.targetEndDate ?? '—'}
              </span>
              <span>
                已记录 {report.loggedDays} 天 · 最近更新 {fmtTime(report.generatedAt)}
              </span>
            </div>
          </section>

          <section className={styles.checkGrid} aria-label="观察条件">
            {latest.checks.map((check) => (
              <article key={check.id} className={styles.checkCard}>
                <div className={styles.checkHead}>
                  <span className={statusClass(check.status)}>
                    {STATUS_LABEL[check.status]}
                  </span>
                  <strong>{check.label}</strong>
                  <span className={styles.checkScore}>{check.score}</span>
                </div>
                <p>{check.message}</p>
                <ul>
                  {check.details.map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
              </article>
            ))}
          </section>

          <section className={styles.timelineSection}>
            <div className={styles.sectionHead}>
              <h2>观察日志</h2>
              <span className="muted">保留最近 8 周快照</span>
            </div>
            <div className={styles.timeline}>
              {report.history.slice().reverse().map((item) => (
                <div key={`${item.tradeDate}-${item.generatedAt}`} className={styles.timelineRow}>
                  <div>
                    <strong>{item.tradeDate}</strong>
                    <span className="muted">{fmtTime(item.generatedAt)}</span>
                  </div>
                  <span className={statusClass(item.overallStatus)}>
                    {STATUS_LABEL[item.overallStatus]}
                  </span>
                  <span>分数 {item.score}</span>
                  <span>收益 {fmtPct(item.metrics.returnPct)}</span>
                  <span>回撤 {fmtPct(item.metrics.maxDrawdownPct)}</span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  );
}

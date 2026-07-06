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

type NewRuleExecutionObservation = {
  tradeDate: string;
  effectiveDate: string;
  status: ObservationStatus;
  message: string;
  details: string[];
  recommendations: Array<{
    symbol: string;
    name: string;
    status: 'passed' | 'near_pass' | 'failed';
    signalPrice: number;
    buyZoneLow: number;
    buyZoneHigh: number;
    closePrice: number | null;
    signalToClosePct: number | null;
    note: string;
  }>;
  trades: Array<{
    symbol: string;
    name: string;
    side: 'buy' | 'sell';
    shares: number;
    tradePrice: number;
    closePrice: number | null;
    tradeToClosePct: number | null;
    note: string | null;
  }>;
  metrics: {
    recommendationCount: number;
    tradeCount: number;
    maxSignalToCloseAbsPct: number | null;
    maxTradeToCloseAbsPct: number | null;
  };
};

type ObservationSnapshot = {
  id: string;
  tradeDate: string;
  generatedAt: string;
  score: number;
  overallStatus: ObservationStatus;
  checks: ObservationCheck[];
  newRuleExecution?: NewRuleExecutionObservation;
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

function fmtPrice(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toFixed(3);
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

          {latest.newRuleExecution && (
            <section className={styles.ruleSection}>
              <div className={styles.sectionHead}>
                <div>
                  <h2>新规后尾盘执行观察</h2>
                  <span className="muted">
                    自 {latest.newRuleExecution.effectiveDate} 起记录尾盘信号、收盘价和模拟成交偏离
                  </span>
                </div>
                <span className={statusClass(latest.newRuleExecution.status)}>
                  {STATUS_LABEL[latest.newRuleExecution.status]}
                </span>
              </div>
              <div className={styles.ruleSummary}>
                <p>{latest.newRuleExecution.message}</p>
                <div>
                  <span className="muted">信号最大偏离</span>
                  <strong>{fmtPct(latest.newRuleExecution.metrics.maxSignalToCloseAbsPct)}</strong>
                </div>
                <div>
                  <span className="muted">成交最大偏离</span>
                  <strong>{fmtPct(latest.newRuleExecution.metrics.maxTradeToCloseAbsPct)}</strong>
                </div>
                <div>
                  <span className="muted">记录样本</span>
                  <strong>
                    {latest.newRuleExecution.metrics.recommendationCount} 信号 /{' '}
                    {latest.newRuleExecution.metrics.tradeCount} 成交
                  </strong>
                </div>
              </div>
              <ul className={styles.ruleDetails}>
                {latest.newRuleExecution.details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>

              {latest.newRuleExecution.recommendations.length > 0 && (
                <div className={styles.compactTableWrap}>
                  <h3>尾盘信号偏离</h3>
                  <table className={styles.compactTable}>
                    <thead>
                      <tr>
                        <th>代码</th>
                        <th>名称</th>
                        <th>信号价</th>
                        <th>买入区</th>
                        <th>收盘价</th>
                        <th>偏离</th>
                      </tr>
                    </thead>
                    <tbody>
                      {latest.newRuleExecution.recommendations.map((item) => (
                        <tr key={`${item.symbol}-${item.signalPrice}`}>
                          <td>{item.symbol}</td>
                          <td>{item.name}</td>
                          <td>{fmtPrice(item.signalPrice)}</td>
                          <td>
                            {fmtPrice(item.buyZoneLow)}–{fmtPrice(item.buyZoneHigh)}
                          </td>
                          <td>{fmtPrice(item.closePrice)}</td>
                          <td className={item.signalToClosePct && Math.abs(item.signalToClosePct) > 1 ? 'return-down' : undefined}>
                            {fmtPct(item.signalToClosePct)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {latest.newRuleExecution.trades.length > 0 && (
                <div className={styles.compactTableWrap}>
                  <h3>模拟成交偏离</h3>
                  <table className={styles.compactTable}>
                    <thead>
                      <tr>
                        <th>代码</th>
                        <th>方向</th>
                        <th>数量</th>
                        <th>成交价</th>
                        <th>收盘价</th>
                        <th>偏离</th>
                      </tr>
                    </thead>
                    <tbody>
                      {latest.newRuleExecution.trades.map((item) => (
                        <tr key={`${item.symbol}-${item.side}-${item.shares}-${item.tradePrice}`}>
                          <td>{item.symbol}</td>
                          <td>{item.side === 'buy' ? '买入' : '卖出'}</td>
                          <td>{item.shares}</td>
                          <td>{fmtPrice(item.tradePrice)}</td>
                          <td>{fmtPrice(item.closePrice)}</td>
                          <td className={item.tradeToClosePct && Math.abs(item.tradeToClosePct) > 1 ? 'return-down' : undefined}>
                            {fmtPct(item.tradeToClosePct)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

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
                  <span>
                    新规偏离{' '}
                    {fmtPct(item.newRuleExecution?.metrics.maxSignalToCloseAbsPct)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  );
}

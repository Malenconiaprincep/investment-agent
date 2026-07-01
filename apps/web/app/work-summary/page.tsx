'use client';

import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';

type SourceStatus = 'good' | 'stale' | 'empty';
type HealthStatus = 'strong' | 'watch' | 'weak' | 'empty';

type BacktestRun = {
  id: string;
  strategy: string;
  assetType: 'stock' | 'etf' | 'mixed';
  finalReturnPct: number | null;
  tradeCount: number;
  createdAt: string;
};

type WorkSummaryReport = {
  generatedAt: string;
  conclusion: string;
  score: {
    overall: number;
    grade: 'A' | 'B' | 'C' | 'D';
    components: Array<{
      key: string;
      label: string;
      score: number;
      detail: string;
    }>;
  };
  coverage: {
    score: number;
    sources: Array<{
      key: string;
      label: string;
      count: number;
      latestAt: string | null;
      status: SourceStatus;
    }>;
  };
  performance: {
    paperReturnPct: number | null;
    paperTotalValue: number | null;
    paperInitialCash: number | null;
    equityTrend: 'up' | 'down' | 'flat' | 'unknown';
    backtestAvgReturnPct: number | null;
    profitableBacktestCount: number;
    backtestCount: number;
    bestBacktest: BacktestRun | null;
    worstBacktest: BacktestRun | null;
  };
  risk: {
    score: number;
    openPositionCount: number;
    unacknowledgedAlerts: number;
    urgentAlerts: number;
    worstWatchlistReturnPct: number | null;
    exposurePct: number | null;
  };
  loop: Array<{
    key: string;
    label: string;
    score: number;
    status: HealthStatus;
    headline: string;
    detail: string;
  }>;
  strategyHealth: Array<{
    key: string;
    label: string;
    score: number;
    status: HealthStatus;
    evidence: string;
    suggestion: string;
  }>;
  optimizationQueue: string[];
  dailyFocus: string[];
  weeklyFocus: string[];
  monthlyFocus: string[];
  evalReport: {
    ranAt: string;
    passRate: number;
    failures: Array<{ suite: string; id: string; detail: string }>;
  } | null;
};

type WorkSummaryRunSummary = {
  id: string;
  generatedAt: string;
  createdAt: string;
  overallScore: number;
  grade: 'A' | 'B' | 'C' | 'D';
  paperReturnPct: number | null;
  backtestAvgReturnPct: number | null;
  riskScore: number;
  coverageScore: number;
  validationScore: number;
  iterationScore: number;
  urgentAlerts: number;
  unacknowledgedAlerts: number;
};

type WorkSummaryComparison = {
  previous: WorkSummaryRunSummary | null;
  scoreDelta: number | null;
  paperReturnDeltaPct: number | null;
  riskScoreDelta: number | null;
  coverageScoreDelta: number | null;
  verdict: 'improved' | 'worse' | 'flat' | 'unknown';
};

type WorkSummaryPayload = {
  report: WorkSummaryReport;
  current: WorkSummaryRunSummary;
  history: WorkSummaryRunSummary[];
  comparison: WorkSummaryComparison;
};

function fmtPct(value: number | null) {
  if (value == null) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function fmtMoney(value: number | null) {
  if (value == null) return '—';
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
}

function fmtTime(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function sourceStatusLabel(status: SourceStatus) {
  if (status === 'good') return '有效';
  if (status === 'stale') return '需更新';
  return '缺失';
}

function healthLabel(status: HealthStatus) {
  if (status === 'strong') return '强';
  if (status === 'watch') return '观察';
  if (status === 'weak') return '弱';
  return '缺失';
}

function trendLabel(value: WorkSummaryReport['performance']['equityTrend']) {
  if (value === 'up') return '改善';
  if (value === 'down') return '走弱';
  if (value === 'flat') return '横盘';
  return '未知';
}

function verdictLabel(value: WorkSummaryComparison['verdict']) {
  if (value === 'improved') return '变好';
  if (value === 'worse') return '变差';
  if (value === 'flat') return '持平';
  return '首次记录';
}

function fmtDelta(value: number | null, suffix = '') {
  if (value == null) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}${suffix}`;
}

export default function WorkSummaryPage() {
  const [report, setReport] = useState<WorkSummaryReport | null>(null);
  const [current, setCurrent] = useState<WorkSummaryRunSummary | null>(null);
  const [history, setHistory] = useState<WorkSummaryRunSummary[]>([]);
  const [comparison, setComparison] = useState<WorkSummaryComparison | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(options?: { silent?: boolean }) {
    if (options?.silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const res = await fetch('/api/work-summary');
      const data = (await res.json()) as WorkSummaryPayload & { error?: string };
      if (!res.ok) throw new Error(data.error ?? '加载失败');
      setReport(data.report);
      setCurrent(data.current);
      setHistory(Array.isArray(data.history) ? data.history : []);
      setComparison(data.comparison ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const returnAmount = useMemo(() => {
    if (!report?.performance.paperTotalValue || !report.performance.paperInitialCash) {
      return null;
    }
    return report.performance.paperTotalValue - report.performance.paperInitialCash;
  }, [report]);

  return (
    <main className="page page--list work-summary-page">
      <PageHeader
        title="工作总结"
        description="统一复盘信号、监控、模拟盘、回测、研报、选股和 Eval 结果，跟踪系统是否真的变好。"
      />

      <div className="list-stack">
        <div className="list-stack-head">
          <nav className="page-toolbar">
            <button
              type="button"
              className="button"
              disabled={loading || refreshing}
              onClick={() => load({ silent: true })}
            >
              {refreshing ? '刷新中…' : '刷新总结'}
            </button>
          </nav>

          {loading && <div className="list-loading">加载工作总结…</div>}
          {error && <div className="error">{error}</div>}
        </div>

        {report && (
          <>
            <section className="work-summary-hero">
              <div className="work-summary-score">
                <span>系统评分</span>
                <strong>{report.score.overall}</strong>
                <em>{report.score.grade}</em>
              </div>
              <div className="work-summary-hero-main">
                <p>{report.conclusion}</p>
                <div className="work-summary-hero-metrics">
                  <span>
                    模拟收益 <strong className={report.performance.paperReturnPct != null && report.performance.paperReturnPct >= 0 ? 'return-up' : 'return-down'}>{fmtPct(report.performance.paperReturnPct)}</strong>
                  </span>
                  <span>
                    盈亏 <strong className={returnAmount != null && returnAmount >= 0 ? 'return-up' : 'return-down'}>{returnAmount == null ? '—' : `${returnAmount >= 0 ? '+' : ''}${fmtMoney(returnAmount)}`}</strong>
                  </span>
                  <span>
                    风险分 <strong>{report.risk.score}</strong>
                  </span>
                  <span>
                    数据覆盖 <strong>{report.coverage.score}</strong>
                  </span>
                  <span>
                    更新 <strong>{fmtTime(report.generatedAt)}</strong>
                  </span>
                  <span>
                    较上次 <strong className={comparison?.verdict === 'improved' ? 'return-up' : comparison?.verdict === 'worse' ? 'return-down' : ''}>{verdictLabel(comparison?.verdict ?? 'unknown')}</strong>
                  </span>
                </div>
              </div>
            </section>

            <section className="work-summary-grid work-summary-grid--two">
              <div className="work-summary-section">
                <div className="section-heading">
                  <h2 className="section-title">变化追踪</h2>
                </div>
                <div className="work-summary-change">
                  <div>
                    <span>总分变化</span>
                    <strong className={comparison?.scoreDelta != null && comparison.scoreDelta > 0 ? 'return-up' : comparison?.scoreDelta != null && comparison.scoreDelta < 0 ? 'return-down' : ''}>
                      {fmtDelta(comparison?.scoreDelta ?? null)}
                    </strong>
                  </div>
                  <div>
                    <span>模拟收益变化</span>
                    <strong className={comparison?.paperReturnDeltaPct != null && comparison.paperReturnDeltaPct > 0 ? 'return-up' : comparison?.paperReturnDeltaPct != null && comparison.paperReturnDeltaPct < 0 ? 'return-down' : ''}>
                      {fmtDelta(comparison?.paperReturnDeltaPct ?? null, '%')}
                    </strong>
                  </div>
                  <div>
                    <span>风险分变化</span>
                    <strong className={comparison?.riskScoreDelta != null && comparison.riskScoreDelta > 0 ? 'return-up' : comparison?.riskScoreDelta != null && comparison.riskScoreDelta < 0 ? 'return-down' : ''}>
                      {fmtDelta(comparison?.riskScoreDelta ?? null)}
                    </strong>
                  </div>
                  <div>
                    <span>数据覆盖变化</span>
                    <strong className={comparison?.coverageScoreDelta != null && comparison.coverageScoreDelta > 0 ? 'return-up' : comparison?.coverageScoreDelta != null && comparison.coverageScoreDelta < 0 ? 'return-down' : ''}>
                      {fmtDelta(comparison?.coverageScoreDelta ?? null)}
                    </strong>
                  </div>
                </div>
                <p className="work-summary-change-note">
                  {comparison?.previous
                    ? `对比 ${fmtTime(comparison.previous.createdAt)} 的快照，本轮系统状态判定为${verdictLabel(comparison.verdict)}。`
                    : '这是第一条工作总结快照，后续刷新会形成可对比的演进曲线。'}
                </p>
              </div>

              <div className="work-summary-section">
                <div className="section-heading">
                  <h2 className="section-title">最近快照</h2>
                </div>
                <div className="work-summary-history">
                  {history.slice(0, 6).map((run) => (
                    <div
                      key={run.id}
                      className={`work-summary-history-row${current?.id === run.id ? ' work-summary-history-row--current' : ''}`}
                    >
                      <span>{fmtTime(run.createdAt)}</span>
                      <strong>{run.overallScore}</strong>
                      <em>{run.grade}</em>
                      <small>收益 {fmtPct(run.paperReturnPct)} · 风险 {run.riskScore}</small>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="work-summary-grid work-summary-grid--four">
              {report.score.components.map((component) => (
                <article key={component.key} className="work-summary-panel">
                  <div className="work-summary-panel-head">
                    <span>{component.label}</span>
                    <strong>{component.score}</strong>
                  </div>
                  <p>{component.detail}</p>
                </article>
              ))}
            </section>

            <section className="work-summary-section">
              <div className="section-heading">
                <h2 className="section-title">闭环状态</h2>
              </div>
              <div className="work-summary-loop">
                {report.loop.map((step, index) => (
                  <article key={step.key} className={`work-summary-step work-summary-step--${step.status}`}>
                    <span className="work-summary-step-index">{index + 1}</span>
                    <div>
                      <div className="work-summary-row">
                        <strong>{step.label}</strong>
                        <span>{healthLabel(step.status)} · {step.score}</span>
                      </div>
                      <p>{step.headline}</p>
                      <small>{step.detail}</small>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="work-summary-grid work-summary-grid--two">
              <div className="work-summary-section">
                <div className="section-heading">
                  <h2 className="section-title">收益与风险</h2>
                </div>
                <div className="work-summary-facts">
                  <div>
                    <span>模拟盘总资产</span>
                    <strong>{fmtMoney(report.performance.paperTotalValue)}</strong>
                  </div>
                  <div>
                    <span>权益趋势</span>
                    <strong>{trendLabel(report.performance.equityTrend)}</strong>
                  </div>
                  <div>
                    <span>回测均值</span>
                    <strong>{fmtPct(report.performance.backtestAvgReturnPct)}</strong>
                  </div>
                  <div>
                    <span>正收益回测</span>
                    <strong>{report.performance.profitableBacktestCount}/{report.performance.backtestCount}</strong>
                  </div>
                  <div>
                    <span>持仓数量</span>
                    <strong>{report.risk.openPositionCount}</strong>
                  </div>
                  <div>
                    <span>仓位</span>
                    <strong>{fmtPct(report.risk.exposurePct)}</strong>
                  </div>
                  <div>
                    <span>未确认告警</span>
                    <strong>{report.risk.unacknowledgedAlerts}</strong>
                  </div>
                  <div>
                    <span>最差跟踪收益</span>
                    <strong>{fmtPct(report.risk.worstWatchlistReturnPct)}</strong>
                  </div>
                </div>
              </div>

              <div className="work-summary-section">
                <div className="section-heading">
                  <h2 className="section-title">优化队列</h2>
                </div>
                <ol className="work-summary-action-list">
                  {report.optimizationQueue.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ol>
              </div>
            </section>

            <section className="work-summary-section">
              <div className="section-heading">
                <h2 className="section-title">策略健康度</h2>
              </div>
              <div className="work-summary-strategies">
                {report.strategyHealth.map((strategy) => (
                  <article key={strategy.key} className={`work-summary-strategy work-summary-strategy--${strategy.status}`}>
                    <div className="work-summary-row">
                      <strong>{strategy.label}</strong>
                      <span>{healthLabel(strategy.status)} · {strategy.score}</span>
                    </div>
                    <p>{strategy.evidence}</p>
                    <small>{strategy.suggestion}</small>
                  </article>
                ))}
              </div>
            </section>

            <section className="work-summary-grid work-summary-grid--three">
              <FocusList title="今日关注" items={report.dailyFocus} />
              <FocusList title="本周优化" items={report.weeklyFocus} />
              <FocusList title="本月取舍" items={report.monthlyFocus} />
            </section>

            <section className="work-summary-section">
              <div className="section-heading">
                <h2 className="section-title">数据源</h2>
              </div>
              <div className="work-summary-sources">
                {report.coverage.sources.map((source) => (
                  <div key={source.key} className={`work-summary-source work-summary-source--${source.status}`}>
                    <span>{source.label}</span>
                    <strong>{source.count}</strong>
                    <small>{sourceStatusLabel(source.status)} · {fmtTime(source.latestAt)}</small>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function FocusList({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="work-summary-section">
      <div className="section-heading">
        <h2 className="section-title">{title}</h2>
      </div>
      <ul className="work-summary-focus-list">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

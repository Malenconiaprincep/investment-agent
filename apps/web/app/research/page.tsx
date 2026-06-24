'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { ReportSummary } from '@/app/api/reports/route';
import { ReportMarkdown } from '@/components/ReportMarkdown';
import { PageHeader } from '@/components/ui/PageHeader';
import {
  formatMissingHint,
  QualityBadge,
} from '@/components/ui/QualityBadge';
import { WorkflowStatus } from '@/components/ui/WorkflowStatus';
import { FeedbackButtons } from '@/components/ui/FeedbackButtons';
import { AddToWatchlistButton } from '@/components/ui/AddToWatchlistButton';
import { readSSEStream } from '@/lib/sse';

type ResearchResult = {
  report: string;
  passed: boolean;
  missingSections: string[];
  missingKeywords: string[];
  symbol: string;
  name: string;
  workflowCompletedAt: string;
  elapsedMs: number;
  reportId?: string;
};

type ArchiveReport = ResearchResult & {
  reportId: string;
  feedback?: {
    up: number;
    down: number;
    latest: { rating: 1 | -1 } | null;
  };
};

type StreamEvent =
  | { type: 'step'; step: string; label: string }
  | { type: 'meta'; symbol: string; name: string }
  | { type: 'token'; text: string }
  | {
      type: 'done';
      report: string;
      passed: boolean;
      missingSections: string[];
      missingKeywords: string[];
      symbol: string;
      name: string;
      workflowCompletedAt: string;
      elapsedMs: number;
      reportId: string;
    }
  | { type: 'error'; message: string };

const EXAMPLES = [
  { label: '贵州茅台', symbol: '600519' },
  { label: '宁德时代', symbol: '300750' },
  { label: '平安银行', symbol: '000001' },
];

const STEP_ORDER = [
  '确认标的',
  '识别代码',
  '获取行情',
  '检索资料',
  '整理要点',
  '撰写研报',
  '核对报告',
];

function parseStreamEvent(data: string): StreamEvent {
  return JSON.parse(data) as StreamEvent;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ResearchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const archiveId = searchParams.get('id');
  const symbolFromUrl = searchParams.get('symbol');

  const [symbol, setSymbol] = useState('600519');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [streamingReport, setStreamingReport] = useState('');
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [archiveReport, setArchiveReport] = useState<ArchiveReport | null>(null);
  const [archiveLoading, setArchiveLoading] = useState(false);

  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [filterSymbol, setFilterSymbol] = useState('');

  const loadReports = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const query = filterSymbol.trim();
      const url =
        query && /^\d{6}$/.test(query)
          ? `/api/reports?symbol=${query}`
          : '/api/reports';
      const response = await fetch(url);
      const data: unknown = await response.json();
      if (!response.ok) {
        throw new Error((data as { error?: string }).error ?? '加载失败');
      }
      setReports((data as { reports: ReportSummary[] }).reports);
    } catch (err) {
      setListError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setListLoading(false);
    }
  }, [filterSymbol]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  useEffect(() => {
    if (symbolFromUrl && /^\d{6}$/.test(symbolFromUrl)) {
      setSymbol(symbolFromUrl);
    }
  }, [symbolFromUrl]);

  useEffect(() => {
    if (!archiveId) {
      setArchiveReport(null);
      return;
    }

    let cancelled = false;
    setArchiveLoading(true);
    setError(null);

    void (async () => {
      try {
        const response = await fetch(`/api/reports/${archiveId}`);
        const data: unknown = await response.json();
        if (!response.ok) {
          throw new Error((data as { error?: string }).error ?? '加载失败');
        }
        if (cancelled) return;
        const detail = data as ArchiveReport & {
          report: string;
          id: string;
          createdAt: string;
        };
        setArchiveReport({
          report: detail.report,
          passed: detail.passed,
          missingSections: detail.missingSections,
          missingKeywords: detail.missingKeywords,
          symbol: detail.symbol,
          name: detail.name,
          workflowCompletedAt: detail.createdAt,
          elapsedMs: detail.elapsedMs ?? 0,
          reportId: detail.id,
          feedback: detail.feedback,
        });
        setResult(null);
        setStreamingReport('');
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载失败');
        }
      } finally {
        if (!cancelled) setArchiveLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [archiveId]);

  function openArchive(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('id', id);
    params.delete('symbol');
    router.push(`/research?${params.toString()}`);
  }

  function startNewResearch() {
    setArchiveReport(null);
    setResult(null);
    setStreamingReport('');
    setError(null);
    const params = new URLSearchParams();
    if (symbol.trim()) params.set('symbol', symbol.trim().replace(/\D/g, '').slice(0, 6));
    const qs = params.toString();
    router.push(qs ? `/research?${qs}` : '/research');
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    setArchiveReport(null);
    setCurrentStep(null);
    setStreamingReport('');

    const params = new URLSearchParams();
    params.set('symbol', symbol.trim().replace(/\D/g, '').slice(0, 6));
    router.replace(`/research?${params.toString()}`);

    try {
      const code = symbol.trim().replace(/\D/g, '').slice(0, 6);
      if (!/^\d{6}$/.test(code)) {
        throw new Error('请输入 6 位 A 股代码');
      }

      const response = await fetch('/api/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: code }),
      });

      if (!response.ok) {
        const data: unknown = await response.json();
        throw new Error((data as { error?: string }).error ?? `请求失败 (${response.status})`);
      }

      let report = '';
      let metaSymbol = code;
      let metaName = code;
      let finalResult: ResearchResult | null = null;
      let streamError: Error | null = null;

      await readSSEStream(response, (_eventName, data) => {
        const event = parseStreamEvent(data);
        if (event.type === 'step') setCurrentStep(event.label);
        if (event.type === 'meta') {
          metaSymbol = event.symbol;
          metaName = event.name;
        }
        if (event.type === 'token') {
          report += event.text;
          setStreamingReport(report);
        }
        if (event.type === 'error') {
          streamError = new Error(event.message);
          return;
        }
        if (event.type === 'done') {
          finalResult = {
            report: event.report,
            passed: event.passed,
            missingSections: event.missingSections,
            missingKeywords: event.missingKeywords,
            symbol: event.symbol || metaSymbol,
            name: event.name || metaName,
            workflowCompletedAt: event.workflowCompletedAt,
            elapsedMs: event.elapsedMs,
            reportId: event.reportId,
          };
          setResult(finalResult);
          setStreamingReport(event.report);
          setLoading(false);
          setCurrentStep(null);
          router.replace(`/research?id=${event.reportId}`);
        }
      });

      if (streamError) throw streamError;

      if (!finalResult && report) {
        setResult({
          report,
          passed: true,
          missingSections: [],
          missingKeywords: [],
          symbol: metaSymbol,
          name: metaName,
          workflowCompletedAt: new Date().toISOString(),
          elapsedMs: 0,
        });
      }

      void loadReports();
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setLoading(false);
      setCurrentStep(null);
    }
  }

  const activeMeta = archiveReport ?? result;
  const activeReportId = archiveReport?.reportId ?? result?.reportId;
  const displayReport =
    streamingReport || result?.report || archiveReport?.report || '';
  const showReport = Boolean(displayReport) || archiveLoading;
  const viewingArchive = Boolean(archiveId && archiveReport);

  return (
    <main className="page page--workspace">
      <PageHeader
        title="研究"
        description="生成单股研报并回看历史档案；选股记录与每周复盘也可从此进入。"
      />

      <div className="page-workspace">
        <aside className="page-pane page-pane--sidebar page-pane--scroll">
          <nav className="page-toolbar page-toolbar--compact" aria-label="研究相关">
            <button
              type="button"
              className="button button-secondary"
              onClick={startNewResearch}
            >
              新建研报
            </button>
            <Link href="/screen/history" className="button button-secondary">
              选股记录
            </Link>
            <Link href="/reviews" className="button button-secondary">
              每周复盘
            </Link>
          </nav>

          <section id="research" className="section">
            <h2 className="section-title">生成研报</h2>
            <div className="action-panel">
              <form
                className="action-panel-row action-panel-row--primary"
                onSubmit={handleSubmit}
              >
                <input
                  className="input"
                  value={symbol}
                  onChange={(event) => setSymbol(event.target.value)}
                  placeholder="6 位代码，如 600519"
                  maxLength={6}
                  disabled={loading}
                  aria-label="股票代码"
                />
                <button className="button" type="submit" disabled={loading}>
                  {loading ? '生成中…' : '生成'}
                </button>
              </form>

              <div className="examples">
                {EXAMPLES.map((item) => (
                  <button
                    key={item.symbol}
                    type="button"
                    className="chip"
                    disabled={loading}
                    onClick={() => setSymbol(item.symbol)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {loading && (
                <WorkflowStatus
                  label="正在生成研报"
                  steps={STEP_ORDER}
                  currentStep={currentStep}
                  horizontal
                />
              )}
            </div>
          </section>

          {error && <div className="error">{error}</div>}

          {activeMeta && (
            <div className="result-toolbar result-toolbar--stack">
              <span>
                <strong>{activeMeta.name}</strong>{' '}
                <span className="muted">({activeMeta.symbol})</span>
              </span>
              <QualityBadge passed={activeMeta.passed} kind="report" />
            </div>
          )}

          {activeReportId && (
            <FeedbackButtons
              targetType="report"
              targetId={activeReportId}
              initial={
                viewingArchive ? archiveReport?.feedback : undefined
              }
            />
          )}

          {activeMeta && (
            <AddToWatchlistButton
              symbol={activeMeta.symbol}
              name={activeMeta.name}
              reason="研报后加入自选"
              sourceType="report"
              sourceId={activeReportId}
            />
          )}

          {activeMeta && !activeMeta.passed && (
            <div className="notice notice--warn">
              {formatMissingHint(
                activeMeta.missingSections,
                activeMeta.missingKeywords,
              )}
            </div>
          )}

          <section className="section research-archive">
            <h2 className="section-title">研报档案</h2>
            <div className="filter-bar filter-bar--compact">
              <input
                className="input"
                value={filterSymbol}
                onChange={(event) => setFilterSymbol(event.target.value)}
                placeholder="按代码筛选"
                maxLength={6}
                aria-label="按股票代码筛选"
              />
            </div>
            {listLoading && <div className="list-loading">加载档案…</div>}
            {listError && <div className="error">{listError}</div>}
            {!listLoading && !listError && reports.length === 0 && (
              <p className="muted research-archive-empty">暂无已存研报</p>
            )}
            {!listLoading && reports.length > 0 && (
              <div className="history-list history-list--sidebar">
                {reports.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`history-card history-card--button${
                      archiveId === item.id ? ' history-card--selected' : ''
                    }`}
                    onClick={() => openArchive(item.id)}
                  >
                    <div className="history-card-main">
                      <strong>
                        {item.name} ({item.symbol})
                      </strong>
                      <span className="history-card-time">
                        {formatTime(item.createdAt)}
                      </span>
                    </div>
                    <div className="history-card-meta">
                      <QualityBadge passed={item.passed} kind="report" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>

          <p className="disclaimer disclaimer--pane">
            仅供学习研究，不构成投资建议。
          </p>
        </aside>

        <section className="page-pane page-pane--main">
          {archiveLoading ? (
            <div className="empty-state pane-empty">加载研报…</div>
          ) : showReport && displayReport ? (
            <article className="report report--pane">
              <ReportMarkdown source={displayReport} />
            </article>
          ) : (
            <div className="empty-state pane-empty">
              输入代码生成研报，或从左侧档案中选择一篇回看
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

'use client';

import Link from 'next/link';
import { useState } from 'react';
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

export default function HomePage() {
  const [symbol, setSymbol] = useState('600519');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [streamingReport, setStreamingReport] = useState('');
  const [result, setResult] = useState<ResearchResult | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    setCurrentStep(null);
    setStreamingReport('');

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
        const err = data as { error?: string };
        throw new Error(err.error ?? `请求失败 (${response.status})`);
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
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setLoading(false);
      setCurrentStep(null);
    }
  }

  const displayReport = result?.report ?? streamingReport;
  const showReport = Boolean(displayReport);

  return (
    <main className="page">
      <PageHeader
        title="投研助手"
        description="输入股票代码生成研报，或从热点新闻一键选股，再对候选股做深度分析。"
      />

      <div className="dashboard-grid dashboard-grid--compact">
        <Link href="/screen" className="dashboard-tile">
          <h2 className="dashboard-tile-title">智能选股</h2>
          <p className="dashboard-tile-desc">
            扫描今日热点与强势板块，自动筛出候选股。
          </p>
        </Link>
        <Link href="/watchlist" className="dashboard-tile">
          <h2 className="dashboard-tile-title">我的自选</h2>
          <p className="dashboard-tile-desc">
            加入关注后每日跟踪，出现买卖信号会提醒。
          </p>
        </Link>
        <Link href="/history" className="dashboard-tile">
          <h2 className="dashboard-tile-title">我的研报</h2>
          <p className="dashboard-tile-desc">已生成的研报自动保存，随时回看。</p>
        </Link>
      </div>

      <section id="research" className="section">
        <h2 className="section-title">单股研报</h2>

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
            <button className="button button-lg" type="submit" disabled={loading}>
              {loading ? '生成中…' : '生成研报'}
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
                {item.label} {item.symbol}
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

      {result && (
        <div className="result-toolbar">
          <span>
            <strong>{result.name}</strong>{' '}
            <span className="muted">({result.symbol})</span>
          </span>
          <QualityBadge passed={result.passed} kind="report" />
          {result.reportId && (
            <Link href={`/history/${result.reportId}`} className="saved-link">
              已保存 · 查看
            </Link>
          )}
        </div>
      )}

      {result?.reportId && (
        <FeedbackButtons targetType="report" targetId={result.reportId} />
      )}

      {result && (
        <AddToWatchlistButton
          symbol={result.symbol}
          name={result.name}
          reason="首页生成研报"
          sourceType="report"
          sourceId={result.reportId}
        />
      )}

      {result && !result.passed && (
        <div className="notice notice--warn">
          {formatMissingHint(result.missingSections, result.missingKeywords)}
        </div>
      )}

      {showReport && (
        <article className="report">
          <ReportMarkdown source={displayReport} />
        </article>
      )}

      <p className="disclaimer">
        仅供学习研究，不构成投资建议。数据来自公开行情接口与研究笔记。
      </p>
    </main>
  );
}

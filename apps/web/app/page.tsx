'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ReportMarkdown } from '@/components/ReportMarkdown';
import { PageHeader } from '@/components/ui/PageHeader';
import { WorkflowStatus } from '@/components/ui/WorkflowStatus';
import { FeedbackButtons } from '@/components/ui/FeedbackButtons';
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
  '提取代码',
  '并行采数',
  '笔记检索',
  '组装 Prompt',
  '撰写研报',
  '质量检查',
];

function parseStreamEvent(data: string): StreamEvent {
  return JSON.parse(data) as StreamEvent;
}

type EvalReport = {
  ranAt: string;
  passRate: number;
  elapsedMs: number;
  suites: Array<{
    name: string;
    total: number;
    passed: number;
    failed: number;
    skipped?: number;
  }>;
  failures: Array<{ suite: string; id: string; detail: string }>;
};

export default function HomePage() {
  const [symbol, setSymbol] = useState('600519');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [streamingReport, setStreamingReport] = useState('');
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [evalReport, setEvalReport] = useState<EvalReport | null>(null);

  useEffect(() => {
    async function loadEval() {
      try {
        const response = await fetch('/api/eval');
        const data: unknown = await response.json();
        if (!response.ok) return;
        const payload = data as { report: EvalReport | null };
        setEvalReport(payload.report);
      } catch {
        // ignore — eval report is optional
      }
    }

    void loadEval();
  }, []);

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
        eyebrow="工作台"
        title="A 股投研"
        description="单股研报、热点选股、投委会分析 — 三条 Workflow 统一在此入口。"
      />

      <div className="dashboard-grid">
        <Link href="/#research" className="dashboard-tile">
          <h2 className="dashboard-tile-title">生成研报</h2>
          <p className="dashboard-tile-desc">
            输入 6 位代码，Research Workflow 流式输出 Markdown 研报。
          </p>
          <span className="dashboard-tile-tag">当前页</span>
        </Link>
        <Link href="/screen" className="dashboard-tile">
          <h2 className="dashboard-tile-title">自动选股</h2>
          <p className="dashboard-tile-desc">
            扫描热点新闻与强势板块，无需手动输入主题。
          </p>
          <span className="dashboard-tile-tag">一键启动</span>
        </Link>
        <Link href="/history" className="dashboard-tile">
          <h2 className="dashboard-tile-title">历史研报</h2>
          <p className="dashboard-tile-desc">本地 LibSQL 持久化，按代码筛选回看。</p>
        </Link>
      </div>

      {evalReport && (
        <section className="eval-card">
          <div className="eval-card-header">
            <h2 className="eval-card-title">Eval 摘要</h2>
            <span className="muted">
              {new Date(evalReport.ranAt).toLocaleString('zh-CN')}
            </span>
          </div>
          <p className="eval-card-rate">
            通过率 <strong>{evalReport.passRate}%</strong>
            <span className="muted">
              {' '}
              · {(evalReport.elapsedMs / 1000).toFixed(1)}s
            </span>
          </p>
          <div className="eval-suite-grid">
            {evalReport.suites.map((suite) => (
              <div key={suite.name} className="eval-suite">
                <span className="eval-suite-name">{suite.name}</span>
                <span>
                  {suite.passed}/{suite.total}
                  {suite.skipped ? ` (${suite.skipped} 跳过)` : ''}
                </span>
              </div>
            ))}
          </div>
          {evalReport.failures.length > 0 && (
            <p className="muted eval-failures">
              失败 {evalReport.failures.length} 项 · 运行{' '}
              <code>pnpm eval:all</code> 更新
            </p>
          )}
        </section>
      )}

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
              label="Research Workflow 执行中"
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
          <span className={`badge ${result.passed ? 'pass' : 'fail'}`}>
            质检 {result.passed ? 'PASS' : 'FAIL'}
          </span>
          <span className="muted">{(result.elapsedMs / 1000).toFixed(1)}s</span>
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

      {result && !result.passed && (
        <div className="error" style={{ marginBottom: '1rem' }}>
          缺少章节: {result.missingSections.join(', ') || '无'}
          {result.missingKeywords.length > 0 &&
            ` · 缺少关键词: ${result.missingKeywords.join(', ')}`}
        </div>
      )}

      {showReport && (
        <article className="report">
          <ReportMarkdown source={displayReport} />
        </article>
      )}

      <p className="disclaimer">
        仅供学习研究，不构成投资建议。数据来自东方财富/腾讯公开接口与个人笔记库。
      </p>
    </main>
  );
}

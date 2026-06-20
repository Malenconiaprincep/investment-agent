'use client';

import { useState } from 'react';
import { ReportMarkdown } from '@/components/ReportMarkdown';
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
    }
  | { type: 'error'; message: string };

const EXAMPLES = [
  { label: '贵州茅台 600519', symbol: '600519' },
  { label: '宁德时代 300750', symbol: '300750' },
  { label: '平安银行 000001', symbol: '000001' },
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

        if (event.type === 'step') {
          setCurrentStep(event.label);
        }

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
          };
          setResult(finalResult);
          setStreamingReport(event.report);
        }
      });

      if (streamError) {
        throw streamError;
      }

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
      <header className="header">
        <h1>A股投研助手</h1>
        <p>
          输入股票代码，触发 Research Workflow，通过 SSE 流式生成 Markdown 研报。
        </p>
      </header>

      <form className="form" onSubmit={handleSubmit}>
        <input
          className="input"
          value={symbol}
          onChange={(event) => setSymbol(event.target.value)}
          placeholder="6 位代码，如 600519"
          maxLength={6}
          disabled={loading}
        />
        <button className="button" type="submit" disabled={loading}>
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
            {item.label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="loading">
          <div>Workflow 执行中（SSE）…</div>
          <div className="step-progress">
            {STEP_ORDER.map((label) => (
              <span
                key={label}
                className={`step-item ${
                  currentStep === label
                    ? 'active'
                    : STEP_ORDER.indexOf(label) <
                        STEP_ORDER.indexOf(currentStep ?? '')
                      ? 'done'
                      : ''
                }`}
              >
                {label}
              </span>
            ))}
          </div>
        </div>
      )}

      {error && <div className="error">{error}</div>}

      {result && (
        <div className="status-bar">
          <span>
            <strong>{result.name}</strong> ({result.symbol})
          </span>
          <span className={`badge ${result.passed ? 'pass' : 'fail'}`}>
            质检 {result.passed ? 'PASS' : 'FAIL'}
          </span>
          <span>耗时 {(result.elapsedMs / 1000).toFixed(1)}s</span>
        </div>
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

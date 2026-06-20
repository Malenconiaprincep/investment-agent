'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';

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

const EXAMPLES = [
  { label: '贵州茅台 600519', symbol: '600519' },
  { label: '宁德时代 300750', symbol: '300750' },
  { label: '平安银行 000001', symbol: '000001' },
];

export default function HomePage() {
  const [symbol, setSymbol] = useState('600519');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResearchResult | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

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

      const data: unknown = await response.json();

      if (!response.ok) {
        const err = data as { error?: string };
        throw new Error(err.error ?? `请求失败 (${response.status})`);
      }

      setResult(data as ResearchResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page">
      <header className="header">
        <h1>A股投研助手</h1>
        <p>
          输入股票代码，触发 Phase 3 Research Workflow，生成结构化 Markdown 研报。
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
          Workflow 执行中（标的确认 → 采数 → RAG → 撰写 → 质检），约 20–40 秒…
        </div>
      )}

      {error && <div className="error">{error}</div>}

      {result && (
        <>
          <div className="status-bar">
            <span>
              <strong>{result.name}</strong> ({result.symbol})
            </span>
            <span
              className={`badge ${result.passed ? 'pass' : 'fail'}`}
            >
              质检 {result.passed ? 'PASS' : 'FAIL'}
            </span>
            <span>耗时 {(result.elapsedMs / 1000).toFixed(1)}s</span>
          </div>

          {!result.passed && (
            <div className="error" style={{ marginBottom: '1rem' }}>
              缺少章节: {result.missingSections.join(', ') || '无'}
              {result.missingKeywords.length > 0 &&
                ` · 缺少关键词: ${result.missingKeywords.join(', ')}`}
            </div>
          )}

          <article className="report">
            <ReactMarkdown>{result.report}</ReactMarkdown>
          </article>
        </>
      )}

      <p className="disclaimer">
        仅供学习研究，不构成投资建议。数据来自东方财富/腾讯公开接口与个人笔记库。
      </p>
    </main>
  );
}

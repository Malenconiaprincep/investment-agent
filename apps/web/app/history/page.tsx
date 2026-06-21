'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ReportSummary } from '@/app/api/reports/route';
import { PageHeader } from '@/components/ui/PageHeader';

function formatTime(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function HistoryPage() {
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterSymbol, setFilterSymbol] = useState('');

  useEffect(() => {
    async function loadReports() {
      setLoading(true);
      setError(null);

      try {
        const query = filterSymbol.trim();
        const url =
          query && /^\d{6}$/.test(query)
            ? `/api/reports?symbol=${query}`
            : '/api/reports';

        const response = await fetch(url);
        const data: unknown = await response.json();

        if (!response.ok) {
          const err = data as { error?: string };
          throw new Error(err.error ?? '加载失败');
        }

        const payload = data as { reports: ReportSummary[] };
        setReports(payload.reports);
      } catch (err) {
        setError(err instanceof Error ? err.message : '未知错误');
      } finally {
        setLoading(false);
      }
    }

    void loadReports();
  }, [filterSymbol]);

  return (
    <main className="page">
      <PageHeader
        eyebrow="归档"
        title="历史研报"
        description="Workflow 生成的研报自动保存到本地 LibSQL，可按代码筛选回看。"
      />

      <div className="form history-filter">
        <Link href="/" className="button button-secondary">
          返回工作台
        </Link>
        <Link href="/screen/history" className="button button-secondary">
          选股历史
        </Link>
      </div>

      <div className="form history-filter">
        <input
          className="input"
          value={filterSymbol}
          onChange={(event) => setFilterSymbol(event.target.value)}
          placeholder="按代码筛选，如 600519"
          maxLength={6}
        />
        <button
          className="button button-secondary"
          type="button"
          onClick={() => setFilterSymbol('')}
        >
          清除筛选
        </button>
      </div>

      {loading && <div className="loading-block">加载中…</div>}
      {error && <div className="error">{error}</div>}

      {!loading && !error && reports.length === 0 && (
        <div className="empty-state">
          暂无历史研报。去
          <Link href="/">生成研报</Link>
          页面试试。
        </div>
      )}

      {!loading && reports.length > 0 && (
        <div className="history-list">
          {reports.map((item) => (
            <Link key={item.id} href={`/history/${item.id}`} className="history-card">
              <div className="history-card-main">
                <strong>
                  {item.name} ({item.symbol})
                </strong>
                <span className="history-card-time">{formatTime(item.createdAt)}</span>
              </div>
              <div className="history-card-meta">
                <span className={`badge ${item.passed ? 'pass' : 'fail'}`}>
                  质检 {item.passed ? 'PASS' : 'FAIL'}
                </span>
                {item.elapsedMs !== null && (
                  <span>耗时 {(item.elapsedMs / 1000).toFixed(1)}s</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}

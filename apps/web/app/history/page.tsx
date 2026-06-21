'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ReportSummary } from '@/app/api/reports/route';
import { PageHeader } from '@/components/ui/PageHeader';
import {
  formatMissingHint,
  QualityBadge,
} from '@/components/ui/QualityBadge';

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
        title="我的研报"
        description="已生成的研报会自动保存，可按股票代码筛选回看。"
      />

      <nav className="page-toolbar" aria-label="页面导航">
        <Link href="/" className="button button-secondary">
          返回首页
        </Link>
        <Link href="/screen/history" className="button button-secondary">
          选股记录
        </Link>
      </nav>

      <div className="filter-bar">
        <input
          className="input"
          value={filterSymbol}
          onChange={(event) => setFilterSymbol(event.target.value)}
          placeholder="按代码筛选，如 600519"
          maxLength={6}
          aria-label="按股票代码筛选"
        />
        <button
          className="button button-secondary"
          type="button"
          onClick={() => setFilterSymbol('')}
          disabled={!filterSymbol}
        >
          清除筛选
        </button>
      </div>

      {loading && <div className="list-loading">加载历史研报…</div>}
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
                <QualityBadge passed={item.passed} kind="report" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}

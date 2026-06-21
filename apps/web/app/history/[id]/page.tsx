'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ReportMarkdown } from '@/components/ReportMarkdown';
import { FeedbackButtons } from '@/components/ui/FeedbackButtons';
import {
  formatMissingHint,
  QualityBadge,
} from '@/components/ui/QualityBadge';

type ReportDetail = {
  id: string;
  symbol: string;
  name: string;
  report: string;
  passed: boolean;
  missingSections: string[];
  missingKeywords: string[];
  elapsedMs: number | null;
  createdAt: string;
  feedback?: {
    up: number;
    down: number;
    latest: { rating: 1 | -1 } | null;
  };
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function HistoryDetailPage() {
  const params = useParams<{ id: string }>();
  const [report, setReport] = useState<ReportDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadReport() {
      if (!params.id) {
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/reports/${params.id}`);
        const data: unknown = await response.json();

        if (!response.ok) {
          const err = data as { error?: string };
          throw new Error(err.error ?? '加载失败');
        }

        setReport(data as ReportDetail);
      } catch (err) {
        setError(err instanceof Error ? err.message : '未知错误');
      } finally {
        setLoading(false);
      }
    }

    void loadReport();
  }, [params.id]);

  return (
    <main className="page">
      <div className="breadcrumb">
        <Link href="/history">← 我的研报</Link>
      </div>

      {loading && <div className="loading">加载中…</div>}
      {error && <div className="error">{error}</div>}

      {report && (
        <>
          <header className="header">
            <h1>
              {report.name} ({report.symbol})
            </h1>
            <p>生成于 {formatTime(report.createdAt)}</p>
          </header>

          <div className="status-bar">
            <QualityBadge passed={report.passed} kind="report" />
          </div>

          {!report.passed && (
            <div className="notice notice--warn">
              {formatMissingHint(report.missingSections, report.missingKeywords)}
            </div>
          )}

          <FeedbackButtons
            targetType="report"
            targetId={report.id}
            initial={report.feedback}
          />

          <article className="report">
            <ReportMarkdown source={report.report} />
          </article>
        </>
      )}
    </main>
  );
}

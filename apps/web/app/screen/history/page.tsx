'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ScreeningSummary } from '@/app/api/screenings/route';
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

export default function ScreeningHistoryPage() {
  const [sessions, setSessions] = useState<ScreeningSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadSessions() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch('/api/screenings');
        const data: unknown = await response.json();

        if (!response.ok) {
          const err = data as { error?: string };
          throw new Error(err.error ?? '加载失败');
        }

        const payload = data as { sessions: ScreeningSummary[] };
        setSessions(payload.sessions);
      } catch (err) {
        setError(err instanceof Error ? err.message : '未知错误');
      } finally {
        setLoading(false);
      }
    }

    void loadSessions();
  }, []);

  return (
    <main className="page">
      <PageHeader
        eyebrow="归档"
        title="选股历史"
        description="每次自动选股 Workflow 完成后会写入本地 LibSQL，可在此回看板块、候选池与摘要。"
      />

      <div className="form">
        <Link href="/screen" className="button">
          新建选股
        </Link>
        <Link href="/history" className="button button-secondary">
          研报历史
        </Link>
      </div>

      {loading && <div className="loading-block">加载中…</div>}
      {error && <div className="error">{error}</div>}

      {!loading && !error && sessions.length === 0 && (
        <div className="empty-state">
          暂无选股记录。去
          <Link href="/screen">自动选股</Link>
          页面试试。
        </div>
      )}

      {!loading && sessions.length > 0 && (
        <div className="history-list">
          {sessions.map((item) => (
            <Link
              key={item.id}
              href={`/screen/history/${item.id}`}
              className="history-card"
            >
              <div className="history-card-main">
                <strong>{item.query}</strong>
                <span className="history-card-time">
                  {formatTime(item.createdAt)}
                </span>
              </div>
              <div className="history-card-meta">
                <span className={`badge ${item.passed ? 'pass' : 'fail'}`}>
                  选股 {item.passed ? 'PASS' : 'FAIL'}
                </span>
                <span>
                  {item.mode === 'auto' ? '自动' : '指定主题'}
                </span>
                <span>
                  板块 {item.sectorCount} · 候选 {item.candidateCount}
                </span>
                {item.elapsedMs !== null && (
                  <span>{(item.elapsedMs / 1000).toFixed(1)}s</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}

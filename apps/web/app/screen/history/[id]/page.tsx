'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ReportMarkdown } from '@/components/ReportMarkdown';

type ScreeningDetail = {
  id: string;
  query: string;
  sectors: Array<{ name: string; reason: string; dataSource: string }>;
  candidates: Array<{
    symbol: string;
    name: string;
    thesis: string;
    dataSource: string;
  }>;
  rotationSummary: string;
  hotNews: Array<{ title: string; datetime: string; url: string | null }>;
  hotThemes: string[];
  mode: 'auto' | 'manual';
  passed: boolean;
  elapsedMs: number | null;
  createdAt: string;
  committee: {
    id: string;
    memo: string;
    passed: boolean;
    elapsedMs: number | null;
    createdAt: string;
  } | null;
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

export default function ScreeningHistoryDetailPage() {
  const params = useParams<{ id: string }>();
  const [session, setSession] = useState<ScreeningDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadSession() {
      if (!params.id) return;

      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/screenings/${params.id}`);
        const data: unknown = await response.json();

        if (!response.ok) {
          const err = data as { error?: string };
          throw new Error(err.error ?? '加载失败');
        }

        setSession(data as ScreeningDetail);
      } catch (err) {
        setError(err instanceof Error ? err.message : '未知错误');
      } finally {
        setLoading(false);
      }
    }

    void loadSession();
  }, [params.id]);

  return (
    <main className="page">
      <p className="breadcrumb">
        <Link href="/screen/history">← 选股历史</Link>
      </p>

      {loading && <div className="loading-block">加载中…</div>}
      {error && <div className="error">{error}</div>}

      {session && (
        <>
          <header className="page-header">
            <p className="page-eyebrow">
              {session.mode === 'auto' ? '自动选股' : '指定主题'}
            </p>
            <h1 className="page-title">{session.query}</h1>
            <p className="page-description">{formatTime(session.createdAt)}</p>
          </header>

          <div className="status-bar">
            <span className={`badge ${session.passed ? 'pass' : 'fail'}`}>
              选股 {session.passed ? 'PASS' : 'FAIL'}
            </span>
            {session.elapsedMs !== null && (
              <span className="muted">
                {(session.elapsedMs / 1000).toFixed(1)}s
              </span>
            )}
          </div>

          {session.hotNews.length > 0 && (
            <section className="section">
              <h2 className="section-title">热点新闻</h2>
              <ul className="sector-list">
                {session.hotNews.map((item) => (
                  <li key={item.title}>
                    {item.url ? (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {item.title}
                      </a>
                    ) : (
                      item.title
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {session.sectors.length > 0 && (
            <section className="section">
              <h2 className="section-title">热门板块</h2>
              <ul className="sector-list">
                {session.sectors.map((s) => (
                  <li key={s.name}>
                    <strong>{s.name}</strong>
                    <span className="muted"> — {s.reason}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {session.candidates.length > 0 && (
            <section className="section">
              <h2 className="section-title">候选池</h2>
              <table className="candidate-table">
                <thead>
                  <tr>
                    <th>代码</th>
                    <th>名称</th>
                    <th>入选理由</th>
                  </tr>
                </thead>
                <tbody>
                  {session.candidates.map((c) => (
                    <tr key={c.symbol}>
                      <td>{c.symbol}</td>
                      <td>{c.name}</td>
                      <td>{c.thesis.slice(0, 100)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {session.rotationSummary && (
            <section className="section">
              <h2 className="section-title">板块轮动摘要</h2>
              <article className="report">
                <ReportMarkdown source={session.rotationSummary} />
              </article>
            </section>
          )}

          {session.committee && (
            <section className="section">
              <h2 className="section-title">投委会纪要</h2>
              <div className="status-bar">
                <span
                  className={`badge ${session.committee.passed ? 'pass' : 'fail'}`}
                >
                  投委会 {session.committee.passed ? 'PASS' : 'FAIL'}
                </span>
              </div>
              <article className="report">
                <ReportMarkdown source={session.committee.memo} />
              </article>
            </section>
          )}
        </>
      )}
    </main>
  );
}

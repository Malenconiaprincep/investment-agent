'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ScreeningSummary } from '@/app/api/screenings/route';
import { PageHeader } from '@/components/ui/PageHeader';
import { QualityBadge } from '@/components/ui/QualityBadge';

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
  const router = useRouter();
  const [sessions, setSessions] = useState<ScreeningSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

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

  function toggleSelect(id: string) {
    setSelected((prev) => {
      if (prev.includes(id)) {
        return prev.filter((item) => item !== id);
      }
      if (prev.length >= 2) {
        return [prev[1], id];
      }
      return [...prev, id];
    });
  }

  function startCompare() {
    if (selected.length !== 2) return;
    const [base, target] = selected;
    router.push(
      `/screen/history/compare?base=${encodeURIComponent(base)}&target=${encodeURIComponent(target)}`,
    );
  }

  return (
    <main className="page">
      <PageHeader
        title="选股记录"
        description="从今天起的每次智能选股都会保存在这里。点进某条记录可查看当时新闻、候选股，以及「入选至今」涨跌幅。"
      />

      <nav className="page-toolbar" aria-label="页面导航">
        <Link href="/screen" className="button">
          新建选股
        </Link>
        <Link href="/history" className="button button-secondary">
          我的研报
        </Link>
        <button
          type="button"
          className={`button button-secondary ${compareMode ? 'button--active' : ''}`}
          onClick={() => {
            setCompareMode((value) => !value);
            setSelected([]);
          }}
        >
          {compareMode ? '取消对比' : '对比两次结果'}
        </button>
        {compareMode && selected.length === 2 && (
          <button type="button" className="button" onClick={startCompare}>
            查看差异
          </button>
        )}
      </nav>

      {compareMode && (
        <p className="compare-hint muted">
          已选 {selected.length}/2 条。先选较早的一次，再选较新的一次。
        </p>
      )}

      {loading && <div className="list-loading">加载选股记录…</div>}
      {error && <div className="error">{error}</div>}

      {!loading && !error && sessions.length === 0 && (
        <div className="empty-state">
          暂无选股记录。去
          <Link href="/screen">智能选股</Link>
          页面试试。
        </div>
      )}

      {!loading && sessions.length > 0 && (
        <div className="history-list">
          {sessions.map((item) => {
            const isSelected = selected.includes(item.id);

            if (compareMode) {
              return (
                <div
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleSelect(item.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      toggleSelect(item.id);
                    }
                  }}
                  className={`history-card ${isSelected ? 'history-card--selected' : ''}`}
                >
                  <div className="history-card-main">
                    <span
                      className={`compare-check ${isSelected ? 'compare-check--on' : ''}`}
                      aria-hidden
                    />
                    <strong>{item.query}</strong>
                    <span className="history-card-time">
                      {formatTime(item.createdAt)}
                    </span>
                  </div>
                  <div className="history-card-meta">
                    <QualityBadge passed={item.passed} kind="screen" />
                    <span>{item.mode === 'auto' ? '智能选股' : '主题选股'}</span>
                    <span>
                      板块 {item.sectorCount} · 候选 {item.candidateCount}
                    </span>
                  </div>
                </div>
              );
            }

            return (
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
                  <QualityBadge passed={item.passed} kind="screen" />
                  <span>{item.mode === 'auto' ? '智能选股' : '主题选股'}</span>
                  <span>
                    板块 {item.sectorCount} · 候选 {item.candidateCount}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}

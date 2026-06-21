'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { ReportMarkdown } from '@/components/ReportMarkdown';

type Review = {
  id: string;
  weekStart: string;
  weekEnd: string;
  title: string;
  content: string;
  createdAt: string;
};

export default function ReviewsPage() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/reviews');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? '加载失败');
        setReviews(data.reviews ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : '未知错误');
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  async function generateNow() {
    setGenerating(true);
    try {
      const res = await fetch('/api/cron/weekly-review');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? '生成失败');
      setReviews((prev) => [data as Review, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <main className="page">
      <PageHeader
        title="每周复盘"
        description="汇总监控池涨跌、钻石信号与模拟账户表现，帮你回顾一周得失。"
      />

      <nav className="page-toolbar">
        <button
          type="button"
          className="button"
          disabled={generating}
          onClick={generateNow}
        >
          {generating ? '生成中…' : '生成本周复盘'}
        </button>
        <Link href="/watchlist" className="button button-secondary">
          我的监控
        </Link>
      </nav>

      {loading && <div className="list-loading">加载复盘…</div>}
      {error && <div className="error">{error}</div>}

      {!loading && reviews.length === 0 && (
        <div className="empty-state">
          暂无周报。加入监控并积累快照后，点击「生成本周复盘」。
        </div>
      )}

      <div className="history-list">
        {reviews.map((r) => (
          <Link key={r.id} href={`/reviews/${r.id}`} className="history-card">
            <div className="history-card-main">
              <strong>{r.title}</strong>
              <span className="history-card-time">
                {r.weekStart} ~ {r.weekEnd}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}

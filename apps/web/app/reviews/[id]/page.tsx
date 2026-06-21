'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ReportMarkdown } from '@/components/ReportMarkdown';

type Review = {
  id: string;
  title: string;
  content: string;
  weekStart: string;
  weekEnd: string;
};

export default function ReviewDetailPage() {
  const params = useParams<{ id: string }>();
  const [review, setReview] = useState<Review | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      if (!params.id) return;
      try {
        const res = await fetch(`/api/reviews/${params.id}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? '加载失败');
        setReview(data as Review);
      } catch (err) {
        setError(err instanceof Error ? err.message : '未知错误');
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [params.id]);

  return (
    <main className="page">
      <p className="breadcrumb">
        <Link href="/reviews">← 每周复盘</Link>
      </p>

      {loading && <div className="list-loading">加载中…</div>}
      {error && <div className="error">{error}</div>}

      {review && (
        <>
          <header className="page-header">
            <h1 className="page-title">{review.title}</h1>
            <p className="page-description">
              {review.weekStart} ~ {review.weekEnd}
            </p>
          </header>
          <article className="report">
            <ReportMarkdown source={review.content} />
          </article>
        </>
      )}
    </main>
  );
}

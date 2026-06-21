'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

type CompareResult = {
  base: { id: string; query: string; createdAt: string };
  target: { id: string; query: string; createdAt: string };
  sectors: {
    added: Array<{ name: string; reason: string }>;
    removed: Array<{ name: string; reason: string }>;
    kept: Array<{ name: string; reason: string }>;
  };
  candidates: {
    added: Array<{ symbol: string; name: string; thesis: string }>;
    removed: Array<{ symbol: string; name: string; thesis: string }>;
    kept: Array<{ symbol: string; name: string; thesis: string }>;
  };
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function CompareContent() {
  const searchParams = useSearchParams();
  const base = searchParams.get('base');
  const target = searchParams.get('target');
  const [data, setData] = useState<CompareResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadCompare() {
      if (!base || !target) {
        setError('缺少对比参数');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/screenings/compare?base=${encodeURIComponent(base)}&target=${encodeURIComponent(target)}`,
        );
        const payload: unknown = await response.json();

        if (!response.ok) {
          throw new Error((payload as { error?: string }).error ?? '加载失败');
        }

        setData(payload as CompareResult);
      } catch (err) {
        setError(err instanceof Error ? err.message : '未知错误');
      } finally {
        setLoading(false);
      }
    }

    void loadCompare();
  }, [base, target]);

  return (
    <main className="page">
      <p className="breadcrumb">
        <Link href="/screen/history">← 选股历史</Link>
      </p>

      <header className="page-header">
        <p className="page-eyebrow">对比</p>
        <h1 className="page-title">两次选股差异</h1>
        <p className="page-description">
          基准 → 目标：板块与候选池的增减变化。
        </p>
      </header>

      {loading && <div className="list-loading">计算差异…</div>}
      {error && <div className="error">{error}</div>}

      {data && (
        <>
          <div className="compare-header">
            <div className="compare-side">
              <span className="muted">基准</span>
              <strong>{data.base.query}</strong>
              <span className="muted">{formatTime(data.base.createdAt)}</span>
              <Link href={`/screen/history/${data.base.id}`} className="saved-link">
                查看详情
              </Link>
            </div>
            <span className="compare-arrow" aria-hidden>
              →
            </span>
            <div className="compare-side">
              <span className="muted">目标</span>
              <strong>{data.target.query}</strong>
              <span className="muted">{formatTime(data.target.createdAt)}</span>
              <Link
                href={`/screen/history/${data.target.id}`}
                className="saved-link"
              >
                查看详情
              </Link>
            </div>
          </div>

          <section className="section">
            <h2 className="section-title">板块变化</h2>
            <div className="compare-grid">
              <CompareList
                title="新增"
                tone="added"
                items={data.sectors.added.map((s) => s.name)}
              />
              <CompareList
                title="移除"
                tone="removed"
                items={data.sectors.removed.map((s) => s.name)}
              />
              <CompareList
                title="保留"
                tone="kept"
                items={data.sectors.kept.map((s) => s.name)}
              />
            </div>
          </section>

          <section className="section">
            <h2 className="section-title">候选池变化</h2>
            <div className="compare-grid">
              <CompareList
                title="新增"
                tone="added"
                items={data.candidates.added.map(
                  (c) => `${c.name} (${c.symbol})`,
                )}
              />
              <CompareList
                title="移除"
                tone="removed"
                items={data.candidates.removed.map(
                  (c) => `${c.name} (${c.symbol})`,
                )}
              />
              <CompareList
                title="保留"
                tone="kept"
                items={data.candidates.kept.map(
                  (c) => `${c.name} (${c.symbol})`,
                )}
              />
            </div>
          </section>
        </>
      )}
    </main>
  );
}

function CompareList({
  title,
  tone,
  items,
}: {
  title: string;
  tone: 'added' | 'removed' | 'kept';
  items: string[];
}) {
  return (
    <div className={`compare-block compare-block--${tone}`}>
      <h3>
        {title}
        <span className="muted"> ({items.length})</span>
      </h3>
      {items.length === 0 ? (
        <p className="muted">无</p>
      ) : (
        <ul className="sector-list">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ScreeningComparePage() {
  return (
    <Suspense fallback={<div className="list-loading">加载对比…</div>}>
      <CompareContent />
    </Suspense>
  );
}

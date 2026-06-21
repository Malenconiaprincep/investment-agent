'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';

type WatchlistItem = {
  id: string;
  symbol: string;
  name: string;
  reason: string | null;
  entryPrice: number | null;
  entryDate: string | null;
  latest?: {
    close: number;
    pctChg: number | null;
    vsEntryPct: number | null;
    diamondStrength: 'red' | 'blue' | null;
  } | null;
};

function fmtPct(v: number | null | undefined) {
  if (v == null) return '—';
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
}

export default function WatchlistPage() {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/watchlist');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? '加载失败');
        setItems(data.items ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : '未知错误');
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  return (
    <main className="page">
      <PageHeader
        title="我的监控"
        description="分析后加入监控池，按日 K 收盘记录行情，出现钻石信号时提示。"
      />

      <nav className="page-toolbar">
        <Link href="/signals" className="button button-secondary">
          钻石信号
        </Link>
        <Link href="/reviews" className="button button-secondary">
          每周复盘
        </Link>
        <Link href="/paper" className="button button-secondary">
          模拟操盘
        </Link>
      </nav>

      {loading && <div className="list-loading">加载监控池…</div>}
      {error && <div className="error">{error}</div>}

      {!loading && items.length === 0 && (
        <div className="empty-state">
          暂无监控股票。在
          <Link href="/">研报</Link>
          或
          <Link href="/screen">选股</Link>
          结果页点击「加入监控」。
        </div>
      )}

      {items.length > 0 && (
        <div className="history-list">
          {items.map((item) => (
            <Link
              key={item.id}
              href={`/watchlist/${item.id}`}
              className="history-card"
            >
              <div className="history-card-main">
                <strong>
                  {item.name} ({item.symbol})
                </strong>
                {item.latest && (
                  <span className="history-card-time">
                    收盘 {item.latest.close.toFixed(2)}
                  </span>
                )}
              </div>
              <div className="history-card-meta">
                <span>今日 {fmtPct(item.latest?.pctChg)}</span>
                <span>自加入 {fmtPct(item.latest?.vsEntryPct)}</span>
                {item.latest?.diamondStrength === 'red' && (
                  <span className="diamond-badge diamond-badge--red">红钻</span>
                )}
                {item.latest?.diamondStrength === 'blue' && (
                  <span className="diamond-badge diamond-badge--blue">蓝钻</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}

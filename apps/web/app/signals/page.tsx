'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';

type Signal = {
  id: string;
  symbol: string;
  name: string;
  strength: 'red' | 'blue';
  score: number;
  tradeDate: string;
  close: number;
  reasons: string[];
  createdAt: string;
};

export default function SignalsPage() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/signals');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? '加载失败');
      setSignals(data.signals ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function runScan(mode: 'watchlist' | 'latest-screening') {
    setScanning(true);
    setError(null);
    try {
      const res = await fetch('/api/signals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? '扫描失败');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '扫描失败');
    } finally {
      setScanning(false);
    }
  }

  return (
    <main className="page">
      <PageHeader
        title="钻石信号"
        description="基于日 K 收盘：趋势 + 放量 + MACD + 突破 共振时出现。红钻偏强，蓝钻偏温和。"
      />

      <div className="signal-legend">
        <span className="diamond-badge diamond-badge--red">红钻 · 强势启动</span>
        <span className="diamond-badge diamond-badge--blue">蓝钻 · 温和关注</span>
      </div>

      <nav className="page-toolbar">
        <button
          type="button"
          className="button"
          disabled={scanning}
          onClick={() => runScan('watchlist')}
        >
          {scanning ? '扫描中…' : '扫描监控池'}
        </button>
        <button
          type="button"
          className="button button-secondary"
          disabled={scanning}
          onClick={() => runScan('latest-screening')}
        >
          扫描最近选股
        </button>
        <Link href="/watchlist" className="button button-secondary">
          我的监控
        </Link>
      </nav>

      {loading && <div className="list-loading">加载信号…</div>}
      {error && <div className="error">{error}</div>}

      {!loading && signals.length === 0 && (
        <div className="empty-state">暂无钻石信号，点击上方按钮扫描。</div>
      )}

      <div className="history-list">
        {signals.map((s) => (
          <div
            key={s.id}
            className={`history-card diamond-card diamond-card--${s.strength}`}
          >
            <div className="history-card-main">
              <strong>
                {s.name} ({s.symbol})
              </strong>
              <span className="history-card-time">{s.tradeDate}</span>
            </div>
            <div className="history-card-meta">
              <span className={`diamond-badge diamond-badge--${s.strength}`}>
                {s.strength === 'red' ? '红钻' : '蓝钻'}
              </span>
              <span>收盘 {s.close.toFixed(2)}</span>
              <span>评分 {s.score}</span>
            </div>
            <ul className="sector-list">
              {s.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </main>
  );
}

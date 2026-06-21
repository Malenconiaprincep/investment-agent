'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { KlineChart, type KlineBar } from '@/components/charts/KlineChart';
import { ReportMarkdown } from '@/components/ReportMarkdown';

type DetailPayload = {
  item: {
    id: string;
    symbol: string;
    name: string;
    reason: string | null;
    entryPrice: number | null;
    entryDate: string | null;
  };
  kline: { quotes: Array<{ tradeDate: string; open: number | null; high: number | null; low: number | null; close: number | null }> };
  diamondSignal: {
    strength: 'red' | 'blue';
    score: number;
    reasons: string[];
    tradeDate: string;
  } | null;
  snapshots: Array<{
    tradeDate: string;
    close: number;
    pctChg: number | null;
    vsEntryPct: number | null;
    diamondStrength: 'red' | 'blue' | null;
  }>;
};

export default function WatchlistDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<DetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paperLoading, setPaperLoading] = useState(false);

  useEffect(() => {
    async function load() {
      if (!params.id) return;
      try {
        const res = await fetch(`/api/watchlist/${params.id}`);
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.error ?? '加载失败');
        setData(payload as DetailPayload);
      } catch (err) {
        setError(err instanceof Error ? err.message : '未知错误');
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [params.id]);

  async function simulateBuy(shares = 100) {
    if (!data) return;
    setPaperLoading(true);
    try {
      const res = await fetch('/api/paper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          side: 'buy',
          symbol: data.item.symbol,
          name: data.item.name,
          shares,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? '下单失败');
      window.location.href = '/paper';
    } catch (err) {
      setError(err instanceof Error ? err.message : '下单失败');
    } finally {
      setPaperLoading(false);
    }
  }

  const bars: KlineBar[] =
    data?.kline.quotes
      .filter((q) => q.close != null && q.open != null && q.high != null && q.low != null)
      .map((q) => ({
        tradeDate: q.tradeDate,
        open: q.open!,
        high: q.high!,
        low: q.low!,
        close: q.close!,
      })) ?? [];

  const diamonds = data?.diamondSignal
    ? [{ tradeDate: data.diamondSignal.tradeDate, strength: data.diamondSignal.strength }]
    : [];

  return (
    <main className="page">
      <p className="breadcrumb">
        <Link href="/watchlist">← 我的监控</Link>
      </p>

      {loading && <div className="list-loading">加载中…</div>}
      {error && <div className="error">{error}</div>}

      {data && (
        <>
          <header className="page-header">
            <h1 className="page-title">
              {data.item.name} ({data.item.symbol})
            </h1>
            <p className="page-description">
              加入价 {data.item.entryPrice?.toFixed(2) ?? '—'} · {data.item.entryDate ?? '—'}
            </p>
          </header>

          {data.diamondSignal && (
            <div
              className={`diamond-card diamond-card--${data.diamondSignal.strength}`}
            >
              <strong>
                {data.diamondSignal.strength === 'red' ? '🔴 红钻信号' : '🔵 蓝钻信号'}
              </strong>
              <span className="muted"> 评分 {data.diamondSignal.score}</span>
              <ul className="sector-list">
                {data.diamondSignal.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          {data.item.reason && (
            <p className="muted">关注理由：{data.item.reason}</p>
          )}

          <section className="section">
            <h2 className="section-title">日 K 走势</h2>
            <p className="muted">前复权日 K，默认展示近 120 个交易日。</p>
            <KlineChart bars={bars} diamonds={diamonds} />
          </section>

          <div className="page-toolbar">
            <button
              type="button"
              className="button"
              disabled={paperLoading}
              onClick={() => simulateBuy(100)}
            >
              {paperLoading ? '下单中…' : '模拟买入 100 股'}
            </button>
            <Link href={`/?symbol=${data.item.symbol}`} className="button button-secondary">
              重新生成研报
            </Link>
          </div>

          {data.snapshots.length > 0 && (
            <section className="section">
              <h2 className="section-title">每日记录</h2>
              <table className="candidate-table">
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>收盘</th>
                    <th>涨跌</th>
                    <th>相对加入</th>
                    <th>信号</th>
                  </tr>
                </thead>
                <tbody>
                  {data.snapshots.map((s) => (
                    <tr key={s.tradeDate + String(s.close)}>
                      <td>{s.tradeDate}</td>
                      <td>{s.close.toFixed(2)}</td>
                      <td>{s.pctChg != null ? `${s.pctChg}%` : '—'}</td>
                      <td>{s.vsEntryPct != null ? `${s.vsEntryPct}%` : '—'}</td>
                      <td>
                        {s.diamondStrength === 'red'
                          ? '红钻'
                          : s.diamondStrength === 'blue'
                            ? '蓝钻'
                            : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </main>
  );
}

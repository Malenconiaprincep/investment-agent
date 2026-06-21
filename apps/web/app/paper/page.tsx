'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';

type PaperPayload = {
  account: { cash: number; initialCash: number };
  totalValue: number;
  returnPct: number;
  positions: Array<{
    symbol: string;
    name: string;
    shares: number;
    avgCost: number;
    latestPrice: number | null;
    marketValue: number | null;
    pnlPct: number | null;
  }>;
};

export default function PaperTradingPage() {
  const [data, setData] = useState<PaperPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/paper');
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.error ?? '加载失败');
        setData(payload as PaperPayload);
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
        title="模拟操盘"
        description="100 万虚拟资金，按最新价模拟买卖，用于验证策略与纪律。"
      />

      <nav className="page-toolbar">
        <Link href="/watchlist" className="button button-secondary">
          我的自选
        </Link>
        <Link href="/reviews" className="button button-secondary">
          每周复盘
        </Link>
      </nav>

      {loading && <div className="list-loading">加载账户…</div>}
      {error && <div className="error">{error}</div>}

      {data && (
        <>
          <div className="paper-summary">
            <div>
              <span className="muted">总资产</span>
              <strong>{data.totalValue.toFixed(0)}</strong>
            </div>
            <div>
              <span className="muted">可用现金</span>
              <strong>{data.account.cash.toFixed(0)}</strong>
            </div>
            <div>
              <span className="muted">累计收益</span>
              <strong className={data.returnPct >= 0 ? 'return-up' : 'return-down'}>
                {data.returnPct > 0 ? '+' : ''}
                {data.returnPct}%
              </strong>
            </div>
          </div>

          {data.positions.length === 0 ? (
            <div className="empty-state">
              暂无持仓。在
              <Link href="/watchlist">自选详情</Link>
              页可一键模拟买入。
            </div>
          ) : (
            <table className="candidate-table">
              <thead>
                <tr>
                  <th>代码</th>
                  <th>名称</th>
                  <th>持仓</th>
                  <th>成本</th>
                  <th>现价</th>
                  <th>盈亏</th>
                </tr>
              </thead>
              <tbody>
                {data.positions.map((p) => (
                  <tr key={p.symbol}>
                    <td>{p.symbol}</td>
                    <td>{p.name}</td>
                    <td>{p.shares}</td>
                    <td>{p.avgCost.toFixed(2)}</td>
                    <td>{p.latestPrice?.toFixed(2) ?? '—'}</td>
                    <td className={p.pnlPct != null && p.pnlPct >= 0 ? 'return-up' : 'return-down'}>
                      {p.pnlPct != null ? `${p.pnlPct}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      <p className="disclaimer">模拟交易仅供学习，不构成投资建议。</p>
    </main>
  );
}

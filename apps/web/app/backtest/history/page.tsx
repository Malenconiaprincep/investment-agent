'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';

type BacktestRunRecord = {
  id: string;
  strategy: string;
  assetType: 'stock' | 'etf' | 'mixed';
  generatedAt: string;
  createdAt: string;
  requestedDays: number;
  startDate: string | null;
  endDate: string | null;
  tradeCount: number;
  validTradeCount: number;
  finalReturnPct: number | null;
  initialCapital: number | null;
};

type AssetFilter = 'all' | 'stock' | 'etf' | 'mixed';

function formatTime(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDate(value: string | null) {
  if (!value) return '—';
  const key = value.replace(/-/g, '').slice(0, 8);
  if (key.length !== 8) return value;
  return `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
}

function formatPct(value: number | null) {
  if (value == null) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function formatMoney(value: number | null) {
  if (value == null) return '—';
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(value);
}

function strategyLabel(strategy: string) {
  if (strategy === 'red-diamond-momentum') return 'A 股动量启动';
  if (strategy === 'red-diamond') return '红钻信号统计';
  if (strategy === 'etf-momentum-rotation') return 'ETF 动量轮动';
  if (strategy === 'etf-tail-rules') return 'ETF 尾盘规则';
  return strategy;
}

function assetLabel(assetType: BacktestRunRecord['assetType']) {
  if (assetType === 'stock') return '股票';
  if (assetType === 'etf') return 'ETF';
  return '混合';
}

function returnClass(value: number | null) {
  if (value == null) return '';
  if (value > 0) return 'return-positive';
  if (value < 0) return 'return-negative';
  return '';
}

export default function BacktestHistoryPage() {
  const [runs, setRuns] = useState<BacktestRunRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assetFilter, setAssetFilter] = useState<AssetFilter>('all');

  useEffect(() => {
    async function loadRuns() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch('/api/backtest/history?limit=100');
        const data = (await response.json()) as { runs?: BacktestRunRecord[]; error?: string };
        if (!response.ok) throw new Error(data.error ?? '加载失败');
        setRuns(Array.isArray(data.runs) ? data.runs : []);
      } catch (err) {
        setError(err instanceof Error ? err.message : '未知错误');
      } finally {
        setLoading(false);
      }
    }

    void loadRuns();
  }, []);

  const filteredRuns = useMemo(
    () =>
      assetFilter === 'all'
        ? runs
        : runs.filter((run) => run.assetType === assetFilter),
    [assetFilter, runs],
  );
  const bestRun = useMemo(
    () =>
      [...runs]
        .filter((run) => run.finalReturnPct != null)
        .sort((a, b) => (b.finalReturnPct ?? -Infinity) - (a.finalReturnPct ?? -Infinity))[0],
    [runs],
  );
  const latestRun = runs[0] ?? null;

  return (
    <main className="page page--list">
      <PageHeader
        eyebrow="历史回测"
        title="回测记录池"
        description="每次从回测页发起的策略计算都会写入本地 backtests.db。这里集中查看历史区间、收益、交易次数和完整复盘。"
      />

      <nav className="page-toolbar" aria-label="页面导航">
        <Link href="/backtest" className="button">
          新建回测
        </Link>
        <button
          type="button"
          className={`button button-secondary ${assetFilter === 'all' ? 'button--active' : ''}`}
          onClick={() => setAssetFilter('all')}
        >
          全部
        </button>
        <button
          type="button"
          className={`button button-secondary ${assetFilter === 'stock' ? 'button--active' : ''}`}
          onClick={() => setAssetFilter('stock')}
        >
          股票
        </button>
        <button
          type="button"
          className={`button button-secondary ${assetFilter === 'etf' ? 'button--active' : ''}`}
          onClick={() => setAssetFilter('etf')}
        >
          ETF
        </button>
      </nav>

      <section className="section pane-card">
        <div className="overview-metric-grid overview-metric-grid--compact">
          <div className="overview-metric-card">
            <span className="muted">记录数</span>
            <strong>{runs.length}</strong>
          </div>
          <div className="overview-metric-card">
            <span className="muted">最新回测</span>
            <strong>{latestRun ? formatTime(latestRun.createdAt) : '—'}</strong>
          </div>
          <div className="overview-metric-card">
            <span className="muted">最佳收益</span>
            <strong className={returnClass(bestRun?.finalReturnPct ?? null)}>
              {formatPct(bestRun?.finalReturnPct ?? null)}
            </strong>
          </div>
          <div className="overview-metric-card">
            <span className="muted">当前筛选</span>
            <strong>{filteredRuns.length} 条</strong>
          </div>
        </div>
      </section>

      {loading && <div className="list-loading">加载回测记录…</div>}
      {error && <div className="error">{error}</div>}

      {!loading && !error && filteredRuns.length === 0 && (
        <div className="empty-state">
          暂无回测记录。去 <Link href="/backtest">策略回测</Link> 页面跑一次。
        </div>
      )}

      {!loading && filteredRuns.length > 0 && (
        <div className="history-list">
          {filteredRuns.map((run) => (
            <Link key={run.id} href={`/backtest/history/${run.id}`} className="history-card">
              <div className="history-card-main">
                <strong>{strategyLabel(run.strategy)}</strong>
                <span className="history-card-time">{formatTime(run.createdAt)}</span>
              </div>
              <div className="history-card-meta">
                <span>{assetLabel(run.assetType)}</span>
                <span>
                  {formatDate(run.startDate)} 至 {formatDate(run.endDate)}
                </span>
                <span className={returnClass(run.finalReturnPct)}>
                  收益 {formatPct(run.finalReturnPct)}
                </span>
                <span>
                  交易 {run.validTradeCount}/{run.tradeCount}
                </span>
                <span>资金 {formatMoney(run.initialCapital)} 元</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}

'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { KlineChart, type KlineBar } from '@/components/charts/KlineChart';
import { MomentumChecklist } from '@/components/MomentumChecklist';
import { OpenWatchlistPanelButton } from '@/components/OpenWatchlistPanelButton';
import { buildMomentumPriceLines } from '@/lib/momentum-price-lines';

type DiamondSignal = {
  tradeDate: string;
  close: number;
  strength: 'red' | 'blue';
  score: number;
  reasons: string[];
};

type DetailPayload = {
  item: {
    id: string;
    symbol: string;
    name: string;
    reason: string | null;
    entryPrice: number | null;
    entryDate: string | null;
  };
  kline: {
    quotes: Array<{
      tradeDate: string;
      open: number | null;
      high: number | null;
      low: number | null;
      close: number | null;
    }>;
  };
  diamondSignal: DiamondSignal | null;
  diamondHistory?: DiamondSignal[];
  momentum: {
    checklist: Array<{ id: string; label: string; passed: boolean; detail?: string }>;
    checklistScore: number;
    action: 'buy' | 'hold' | 'wait' | 'sell';
    entryMemo: string;
    stopLossPrice: number | null;
    trailingStopPrice?: number | null;
    highWaterMark?: number | null;
  } | null;
  snapshots: Array<{
    tradeDate: string;
    close: number;
    pctChg: number | null;
    vsEntryPct: number | null;
    diamondStrength: 'red' | 'blue' | null;
  }>;
};

function formatDate(tradeDate: string): string {
  if (tradeDate.includes('-')) return tradeDate;
  return `${tradeDate.slice(0, 4)}-${tradeDate.slice(4, 6)}-${tradeDate.slice(6, 8)}`;
}

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

  const diamondHistory =
    data?.diamondHistory ??
    (data?.diamondSignal ? [data.diamondSignal] : []);

  const diamonds = diamondHistory.map((signal) => ({
    tradeDate: signal.tradeDate,
    strength: signal.strength,
  }));

  const latestRed = diamondHistory.find((s) => s.strength === 'red');
  const highlightSignal = latestRed ?? data?.diamondSignal ?? null;

  return (
    <main className="page page--workspace">
      <p className="breadcrumb">
        <OpenWatchlistPanelButton className="button button-secondary">
          ← 跟踪池
        </OpenWatchlistPanelButton>
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
              {data.item.reason ? ` · ${data.item.reason}` : ''}
            </p>
          </header>

          <div className="signal-legend" style={{ marginBottom: '1rem' }}>
            <span className="diamond-badge diamond-badge--red">红钻 · 强买点</span>
            <span className="diamond-badge diamond-badge--blue">蓝钻 · 温和关注</span>
            <span className="muted">K 线下方标记为近 120 日历史钻石信号</span>
          </div>

          <div className="page-workspace page-workspace--chart">
            <div className="page-pane page-pane--chart-main">
              {highlightSignal && (
                <div
                  className={`diamond-card diamond-card--${highlightSignal.strength}`}
                >
                  <strong>
                    {highlightSignal.strength === 'red' ? '🔴 红钻信号' : '🔵 蓝钻信号'}
                  </strong>
                  <span className="muted">
                    {' '}
                    {formatDate(highlightSignal.tradeDate)} · 收盘{' '}
                    {highlightSignal.close.toFixed(2)} · 评分 {highlightSignal.score}
                  </span>
                  <ul className="sector-list">
                    {highlightSignal.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}

              <section className="section pane-card pane-chart-body">
                <h2 className="section-title">日 K 走势</h2>
                <p className="muted">前复权日 K，展示近 120 个交易日。</p>
                <div className="committee-trade-chart">
                  <KlineChart
                    bars={bars}
                    diamonds={diamonds}
                    priceLines={buildMomentumPriceLines({
                      latestRedClose: latestRed?.close ?? null,
                      stopLossPrice: data.momentum?.stopLossPrice ?? null,
                      trailingStopPrice: data.momentum?.trailingStopPrice ?? null,
                    })}
                    height={420}
                  />
                </div>
              </section>

              {data.momentum && (
                <MomentumChecklist
                  checklist={data.momentum.checklist}
                  score={data.momentum.checklistScore}
                  maxScore={data.momentum.checklist.length}
                  action={data.momentum.action}
                  entryMemo={data.momentum.entryMemo}
                  stopLossPrice={data.momentum.stopLossPrice}
                  trailingStopPrice={data.momentum.trailingStopPrice}
                  highWaterMark={data.momentum.highWaterMark}
                />
              )}

              {diamondHistory.length > 0 && (
                <section className="section pane-card">
                  <h2 className="section-title">历史钻石信号</h2>
                  <ul className="sector-list">
                    {diamondHistory.map((signal) => (
                      <li key={`${signal.tradeDate}-${signal.strength}`}>
                        <span
                          className={`diamond-badge diamond-badge--${signal.strength}`}
                        >
                          {signal.strength === 'red' ? '红钻' : '蓝钻'}
                        </span>{' '}
                        {formatDate(signal.tradeDate)} · 收盘 {signal.close.toFixed(2)} · 评分{' '}
                        {signal.score}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <div className="page-toolbar">
                <button
                  type="button"
                  className="button"
                  disabled={paperLoading}
                  onClick={() => simulateBuy(100)}
                >
                  {paperLoading ? '下单中…' : '模拟买入 100 股'}
                </button>
                <Link href={`/research?symbol=${data.item.symbol}`} className="button button-secondary">
                  重新生成研报
                </Link>
                <Link
                  href={`/demo/stock/${data.item.symbol}`}
                  className="button button-secondary"
                >
                  技术图表
                </Link>
              </div>
            </div>

            <aside className="page-pane page-pane--sidebar page-pane--scroll">
              {data.snapshots.length > 0 ? (
                <section className="section pane-card pane-card--fill">
                  <h2 className="section-title">每日记录</h2>
                  <div className="table-scroll-wrap">
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
                  </div>
                </section>
              ) : (
                <div className="empty-state pane-empty">暂无每日记录，等待收盘快照。</div>
              )}
            </aside>
          </div>
        </>
      )}
    </main>
  );
}

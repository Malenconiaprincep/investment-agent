'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { KlineChart, type KlineBar } from '@/components/charts/KlineChart';
import { MomentumChecklist } from '@/components/MomentumChecklist';
import { buildMomentumPriceLines } from '@/lib/momentum-price-lines';

type DiamondSignal = {
  tradeDate: string;
  close: number;
  strength: 'red' | 'blue';
  score: number;
  reasons: string[];
};

type ChartPayload = {
  symbol: string;
  name: string;
  kline: {
    quotes: Array<{
      tradeDate: string;
      open: number | null;
      high: number | null;
      low: number | null;
      close: number | null;
    }>;
    latestClose: number | null;
  };
  diamondHistory: DiamondSignal[];
  latestDiamond: DiamondSignal | null;
  momentum: {
    checklist: Array<{ id: string; label: string; passed: boolean; detail?: string }>;
    checklistScore: number;
    action: 'buy' | 'hold' | 'wait' | 'sell';
    entryMemo: string;
    stopLossPrice: number | null;
    trailingStopPrice?: number | null;
    highWaterMark?: number | null;
  } | null;
};

function formatDate(tradeDate: string): string {
  if (tradeDate.includes('-')) return tradeDate;
  return `${tradeDate.slice(0, 4)}-${tradeDate.slice(4, 6)}-${tradeDate.slice(6, 8)}`;
}

export default function StockDiamondChartPage() {
  const params = useParams<{ symbol: string }>();
  const [data, setData] = useState<ChartPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      if (!params.symbol) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/stock/${params.symbol}/chart?days=120`);
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.error ?? '加载失败');
        setData(payload as ChartPayload);
      } catch (err) {
        setError(err instanceof Error ? err.message : '未知错误');
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [params.symbol]);

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

  const diamonds =
    data?.diamondHistory.map((signal) => ({
      tradeDate: signal.tradeDate,
      strength: signal.strength,
    })) ?? [];

  const redSignals = data?.diamondHistory.filter((s) => s.strength === 'red') ?? [];
  const latestRed = redSignals[0] ?? null;
  const latestDiamond = data?.diamondHistory[0] ?? data?.latestDiamond ?? null;
  const stopLossPrice = data?.momentum?.stopLossPrice ?? null;
  const trailingStopPrice = data?.momentum?.trailingStopPrice ?? null;

  return (
    <main className="page page--workspace">
      <p className="breadcrumb">
        <Link href="/demo/diamond">← Mock 演示</Link>
        {' · '}
        <Link href="/">首页</Link>
      </p>

      {loading && <div className="list-loading">加载 K 线与红钻信号…</div>}
      {error && <div className="error">{error}</div>}

      {data && (
        <>
          <header className="page-header">
            <h1 className="page-title">
              {data.name} ({data.symbol})
            </h1>
            <p className="page-description">
              真实日 K · 近 120 交易日 · 最新收盘{' '}
              {data.kline.latestClose?.toFixed(2) ?? '—'}
              {redSignals.length > 0
                ? ` · 近 120 日红钻 ${redSignals.length} 次`
                : ' · 近 120 日无红钻'}
            </p>
          </header>

          <div className="signal-legend" style={{ marginBottom: '1rem' }}>
            <span className="diamond-badge diamond-badge--red">红钻 · 真实检测</span>
            <span className="diamond-badge diamond-badge--blue">蓝钻</span>
            <span className="muted">K 线下方标记 = 历史钻石买点（基于收盘后规则计算）</span>
          </div>

          <div className="page-workspace page-workspace--chart">
            <div className="page-pane page-pane--chart-main">
              {latestRed && (
                <div className="diamond-card diamond-card--red">
                  <strong>🔴 最近一次红钻</strong>
                  <span className="muted">
                    {' '}
                    {formatDate(latestRed.tradeDate)} · 收盘 {latestRed.close.toFixed(2)} · 评分{' '}
                    {latestRed.score}
                  </span>
                  <ul className="sector-list">
                    {latestRed.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </div>
              )}

              {!latestRed && data.latestDiamond && (
                <div className={`diamond-card diamond-card--${data.latestDiamond.strength}`}>
                  <strong>
                    {data.latestDiamond.strength === 'red' ? '🔴 红钻信号' : '🔵 蓝钻信号'}
                  </strong>
                  <span className="muted"> 评分 {data.latestDiamond.score}</span>
                  <ul className="sector-list">
                    {data.latestDiamond.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </div>
              )}

              {!latestRed && !data.latestDiamond && (
                <div className="pane-card muted">
                  近 120 日未检测到红钻/蓝钻；下方 K 线仍为真实行情，可对照走势理解信号规则。
                </div>
              )}

              <section className="section pane-card pane-chart-body">
                <h2 className="section-title">日 K 走势</h2>
                <p className="muted">前复权日 K；红/蓝标记为对应交易日触发的钻石信号。</p>
                <div className="committee-trade-chart">
                  <KlineChart
                    bars={bars}
                    diamonds={diamonds}
                    priceLines={buildMomentumPriceLines({
                      latestDiamondClose: latestDiamond?.close ?? null,
                      latestDiamondStrength: latestDiamond?.strength ?? null,
                      stopLossPrice,
                      trailingStopPrice,
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

              {data.diamondHistory.length > 0 && (
                <section className="section pane-card">
                  <h2 className="section-title">历史钻石信号</h2>
                  <ul className="sector-list">
                    {data.diamondHistory.map((signal) => (
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
            </div>
          </div>
        </>
      )}
    </main>
  );
}

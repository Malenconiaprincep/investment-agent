'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { KlineChart } from '@/components/charts/KlineChart';
import { MomentumChecklist } from '@/components/MomentumChecklist';
import { getDiamondDemoPayload } from '@/lib/mock/diamond-demo';

function formatDate(tradeDate: string): string {
  if (tradeDate.includes('-')) return tradeDate;
  return `${tradeDate.slice(0, 4)}-${tradeDate.slice(4, 6)}-${tradeDate.slice(6, 8)}`;
}

export default function DiamondDemoPage() {
  const demo = useMemo(() => getDiamondDemoPayload(), []);

  return (
    <main className="page page--workspace">
      <p className="breadcrumb">
        <Link href="/">← 返回首页</Link>
        {' · '}
        <Link href="/demo/stock/601138">工业富联真实 K 线 →</Link>
      </p>

      <header className="page-header">
        <h1 className="page-title">
          红钻信号演示 · {demo.name} ({demo.symbol})
        </h1>
        <p className="page-description">
          Mock 数据，模拟截图中的走势与红钻买点。最新收盘 {demo.latestSignal.close.toFixed(2)} ·{' '}
          {formatDate(demo.latestSignal.tradeDate)}
        </p>
      </header>

      <div className="signal-legend" style={{ marginBottom: '1rem' }}>
        <span className="diamond-badge diamond-badge--red">红钻 · 强势启动（mock）</span>
        <span className="muted">K 线下方红点 = 历史红钻买点 · 绿色箭头 = 最近 3 次买入参考</span>
      </div>

      <div className="page-workspace page-workspace--chart">
        <div className="page-pane page-pane--chart-main">
          <div className={`diamond-card diamond-card--${demo.latestSignal.strength}`}>
            <strong>🔴 红钻信号（演示）</strong>
            <span className="muted"> 评分 {demo.latestSignal.score}</span>
            <ul className="sector-list">
              {demo.latestSignal.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>

          <section className="section pane-card pane-chart-body">
            <h2 className="section-title">日 K 走势</h2>
            <p className="muted">前复权日 K，展示近 120 个交易日；下方红标为红钻买点位置。</p>
            <div className="committee-trade-chart">
              <KlineChart
                bars={demo.bars}
                diamonds={demo.diamonds}
                priceLines={[
                  {
                    price: demo.entryPrice,
                    color: '#5b9cf5',
                    title: '入场参考',
                  },
                  {
                    price: demo.stopLossPrice,
                    color: '#e07070',
                    title: '止损',
                  },
                ]}
                height={420}
              />
            </div>
          </section>

          <MomentumChecklist
            checklist={demo.momentum.checklist}
            score={demo.momentum.checklistScore}
            maxScore={demo.momentum.checklistMax}
            action={demo.momentum.action}
            entryMemo={demo.momentum.entryMemo}
            stopLossPrice={demo.momentum.stopLossPrice}
          />

          <section className="section pane-card">
            <h2 className="section-title">历史红钻买点</h2>
            <ul className="sector-list">
              {demo.diamondSignals
                .slice()
                .reverse()
                .map((signal) => (
                  <li key={signal.tradeDate}>
                    <span className="diamond-badge diamond-badge--red">红钻</span>{' '}
                    {formatDate(signal.tradeDate)} · 收盘 {signal.close.toFixed(2)}
                  </li>
                ))}
            </ul>
          </section>
        </div>
      </div>
    </main>
  );
}

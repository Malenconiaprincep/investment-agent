'use client';

import { useEffect, useState } from 'react';
import {
  KlineChart,
  type KlineBar,
  type PriceLineSpec,
  type TradeMarker,
} from '@/components/charts/KlineChart';

export type CommitteeTradePlanView = {
  symbol: string;
  name: string;
  action: 'buy' | 'hold' | 'wait' | 'sell';
  actionReason: string;
  latestClose: number;
  entryPrice: number | null;
  stopLossPrice: number;
  targetHint: string;
  signals: Array<{
    kind: 'buy' | 'sell';
    tradeDate: string;
    price: number;
    reason: string;
    strength?: 'red' | 'blue';
  }>;
  diamondStrength: 'red' | 'blue' | null;
  checklistScore: number;
  checklistMax: number;
};

const ACTION_LABEL: Record<CommitteeTradePlanView['action'], string> = {
  buy: '建议买入',
  hold: '持有观察',
  wait: '等待信号',
  sell: '建议卖出/回避',
};

const ACTION_CLASS: Record<CommitteeTradePlanView['action'], string> = {
  buy: 'momentum-action--buy',
  hold: 'momentum-action--hold',
  wait: 'momentum-action--wait',
  sell: 'momentum-action--sell',
};

function TradePlanCard({ plan }: { plan: CommitteeTradePlanView }) {
  const [bars, setBars] = useState<KlineBar[]>([]);
  const [diamonds, setDiamonds] = useState<Array<{ tradeDate: string; strength: 'red' | 'blue' }>>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/stock/${plan.symbol}/chart?days=120`);
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.error ?? 'K 线加载失败');
        const quotes = (payload.kline?.quotes ?? []) as Array<{
          tradeDate: string;
          open: number | null;
          high: number | null;
          low: number | null;
          close: number | null;
        }>;
        const next = quotes
          .filter(
            (q) =>
              q.close != null &&
              q.open != null &&
              q.high != null &&
              q.low != null,
          )
          .map((q) => ({
            tradeDate: q.tradeDate,
            open: q.open!,
            high: q.high!,
            low: q.low!,
            close: q.close!,
          }));
        const history = (payload.diamondHistory ?? []) as Array<{
          tradeDate: string;
          strength: 'red' | 'blue';
        }>;
        if (!cancelled) {
          setBars(next);
          setDiamonds(
            history.map((signal) => ({
              tradeDate: signal.tradeDate,
              strength: signal.strength,
            })),
          );
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'K 线加载失败');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [plan.symbol]);

  const tradeMarkers: TradeMarker[] = plan.signals.map((signal) => ({
    tradeDate: signal.tradeDate,
    kind: signal.kind,
    label: signal.kind === 'buy' ? '买' : '卖',
  }));

  const priceLines: PriceLineSpec[] = [
    {
      price: plan.stopLossPrice,
      color: '#e07070',
      title: '止损',
    },
  ];
  if (plan.entryPrice != null) {
    priceLines.unshift({
      price: plan.entryPrice,
      color: '#5b9cf5',
      title: '入场参考',
    });
  }

  return (
    <article className="pane-card committee-trade-card">
      <div className="committee-trade-head">
        <h3 className="committee-trade-title">
          {plan.name} <span className="candidate-card-code">{plan.symbol}</span>
        </h3>
        <span className={`momentum-action ${ACTION_CLASS[plan.action]}`}>
          {ACTION_LABEL[plan.action]}
        </span>
      </div>

      <p className="muted committee-trade-reason">{plan.actionReason}</p>

      <dl className="committee-trade-stats">
        <div>
          <dt>最新收盘</dt>
          <dd>{plan.latestClose.toFixed(2)}</dd>
        </div>
        <div>
          <dt>入场参考</dt>
          <dd>{plan.entryPrice?.toFixed(2) ?? '—'}</dd>
        </div>
        <div>
          <dt>建议止损</dt>
          <dd>{plan.stopLossPrice.toFixed(2)}</dd>
        </div>
        <div>
          <dt>Checklist</dt>
          <dd>
            {plan.checklistScore}/{plan.checklistMax}
          </dd>
        </div>
      </dl>

      <p className="muted committee-trade-hint">{plan.targetHint}</p>

      {plan.signals.length > 0 && (
        <ul className="sector-list sector-list--compact committee-signal-list">
          {plan.signals.map((signal) => (
            <li key={`${signal.tradeDate}-${signal.kind}-${signal.price}`}>
              <strong>{signal.kind === 'buy' ? '买入' : '卖出'}</strong>{' '}
              {signal.tradeDate.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')} @{' '}
              {signal.price.toFixed(2)}
              <span className="muted"> — {signal.reason}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="committee-trade-chart">
        {loading && <div className="chart-empty">加载 K 线…</div>}
        {error && <div className="chart-empty">{error}</div>}
        {!loading && !error && (
          <KlineChart
            bars={bars}
            diamonds={diamonds}
            tradeMarkers={tradeMarkers}
            priceLines={priceLines}
            height={280}
          />
        )}
      </div>
    </article>
  );
}

type CommitteeTradePanelProps = {
  tradePlans: CommitteeTradePlanView[];
};

export function CommitteeTradePanel({ tradePlans }: CommitteeTradePanelProps) {
  if (tradePlans.length === 0) return null;

  return (
    <section className="section">
      <h2 className="section-title">K 线交易信号</h2>
      <p className="muted">
        基于钻石信号与均线规则；绿箭头为历史买点，红箭头为卖出参考。长线视角：建议持有 2 月以上，破 MA60 再考虑减仓。
      </p>
      <div className="committee-trade-grid">
        {tradePlans.map((plan) => (
          <TradePlanCard key={plan.symbol} plan={plan} />
        ))}
      </div>
    </section>
  );
}

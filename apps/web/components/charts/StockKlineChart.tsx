'use client';

import { useEffect, useRef, useState } from 'react';
import {
  KlineChart,
  type KlineBar,
  type DiamondMarker,
} from '@/components/charts/KlineChart';
import { buildMomentumPriceLines } from '@/lib/momentum-price-lines';

type ChartPayload = {
  diamondHistory: Array<{
    tradeDate: string;
    strength: 'red' | 'blue';
    close: number;
  }>;
  momentum: { stopLossPrice: number | null; trailingStopPrice?: number | null } | null;
  kline: {
    quotes: Array<{
      tradeDate: string;
      open: number | null;
      high: number | null;
      low: number | null;
      close: number | null;
    }>;
  };
};

type StockKlineChartProps = {
  symbol: string;
  height?: number;
  lazy?: boolean;
  showPriceLines?: boolean;
  className?: string;
  placeholder?: string;
};

function toBars(quotes: ChartPayload['kline']['quotes']): KlineBar[] {
  return quotes
    .filter((q) => q.close != null && q.open != null && q.high != null && q.low != null)
    .map((q) => ({
      tradeDate: q.tradeDate,
      open: q.open!,
      high: q.high!,
      low: q.low!,
      close: q.close!,
    }));
}

export function StockKlineChart({
  symbol,
  height = 220,
  lazy = true,
  showPriceLines = false,
  className,
  placeholder = '滚动加载 K 线…',
}: StockKlineChartProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(!lazy);
  const [data, setData] = useState<ChartPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!lazy || !rootRef.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '160px' },
    );
    observer.observe(rootRef.current);
    return () => observer.disconnect();
  }, [lazy]);

  useEffect(() => {
    if (!visible) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/stock/${symbol}/chart?days=120`);
        const payload = (await res.json()) as ChartPayload & { error?: string };
        if (!res.ok) throw new Error(payload.error ?? 'K 线加载失败');
        if (!cancelled) setData(payload);
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
  }, [symbol, visible]);

  const diamonds: DiamondMarker[] =
    data?.diamondHistory.map((signal) => ({
      tradeDate: signal.tradeDate,
      strength: signal.strength,
    })) ?? [];

  const latestDiamond = data?.diamondHistory[0] ?? null;
  const priceLines = buildMomentumPriceLines({
    latestDiamondClose: showPriceLines ? (latestDiamond?.close ?? null) : null,
    latestDiamondStrength: showPriceLines ? (latestDiamond?.strength ?? null) : null,
    stopLossPrice: showPriceLines ? (data?.momentum?.stopLossPrice ?? null) : null,
    trailingStopPrice: showPriceLines ? (data?.momentum?.trailingStopPrice ?? null) : null,
  });

  return (
    <div ref={rootRef} className={className ?? 'stock-kline-chart'}>
      {!visible && <div className="chart-empty chart-empty--compact">{placeholder}</div>}
      {visible && loading && <div className="chart-empty chart-empty--compact">加载 K 线…</div>}
      {visible && error && <div className="chart-empty chart-empty--compact">{error}</div>}
      {visible && !loading && !error && data && (
        <KlineChart
          bars={toBars(data.kline.quotes)}
          diamonds={diamonds}
          priceLines={priceLines}
          height={height}
        />
      )}
    </div>
  );
}

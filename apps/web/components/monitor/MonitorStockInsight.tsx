'use client';

import { useEffect, useRef, useState } from 'react';
import {
  KlineChart,
  type DiamondMarker,
  type KlineBar,
} from '@/components/charts/KlineChart';

type ChartPayload = {
  symbol: string;
  name: string;
  industry: string | null;
  diamondHistory: Array<{
    tradeDate: string;
    strength: 'red' | 'blue';
    close: number;
  }>;
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

type MonitorStockInsightProps = {
  symbol: string;
  fallbackName?: string | null;
  theme?: string | null;
  pctChg?: number | null;
  ret20dPct?: number | null;
  height?: number;
};

function fmtPct(v: number | null | undefined) {
  if (v == null) return null;
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
}

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

function isUnresolvedName(name: string | null | undefined, symbol: string) {
  if (!name) return true;
  const trimmed = name.trim();
  return trimmed === symbol || /^\d{6}$/.test(trimmed);
}

export function MonitorStockInsight({
  symbol,
  fallbackName,
  theme,
  pctChg,
  ret20dPct,
  height = 180,
}: MonitorStockInsightProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [data, setData] = useState<ChartPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!rootRef.current) return;

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
  }, []);

  useEffect(() => {
    if (!visible) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/stock/${symbol}/chart?days=120`);
        const payload = (await res.json()) as ChartPayload & { error?: string };
        if (!res.ok) throw new Error(payload.error ?? '股票信息加载失败');
        if (!cancelled) setData(payload);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '股票信息加载失败');
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

  const displayName =
    data?.name && !isUnresolvedName(data.name, symbol)
      ? data.name
      : fallbackName && !isUnresolvedName(fallbackName, symbol)
        ? fallbackName
        : data?.name ?? fallbackName ?? symbol;
  const industry = data?.industry ?? null;
  const diamonds: DiamondMarker[] =
    data?.diamondHistory.map((signal) => ({
      tradeDate: signal.tradeDate,
      strength: signal.strength,
    })) ?? [];

  return (
    <div ref={rootRef} className="monitor-stock-insight">
      <div className="monitor-stock-insight-head">
        <div>
          <strong className="monitor-stock-insight-name">{displayName}</strong>
          <span className="monitor-stock-insight-code">{symbol}</span>
        </div>
        <div className="monitor-stock-insight-tags">
          {industry ? <span className="monitor-stock-tag">板块 {industry}</span> : null}
          {theme ? <span className="monitor-stock-tag monitor-stock-tag--theme">主线 {theme}</span> : null}
        </div>
      </div>

      {(pctChg != null || ret20dPct != null) && (
        <div className="monitor-stock-insight-stats">
          {pctChg != null ? <span>涨幅 {fmtPct(pctChg)}</span> : null}
          {ret20dPct != null ? <span>20日 {fmtPct(ret20dPct)}</span> : null}
        </div>
      )}

      {!visible && <div className="chart-empty chart-empty--compact">滚动加载 K 线…</div>}
      {visible && loading && <div className="chart-empty chart-empty--compact">加载 K 线…</div>}
      {visible && error && <div className="chart-empty chart-empty--compact">{error}</div>}
      {visible && !loading && !error && data && (
        <KlineChart bars={toBars(data.kline.quotes)} diamonds={diamonds} height={height} />
      )}
    </div>
  );
}

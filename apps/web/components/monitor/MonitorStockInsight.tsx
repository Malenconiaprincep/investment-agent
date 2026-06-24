'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
  latestDiamond: {
    strength: 'red' | 'blue';
    reasons: string[];
  } | null;
  momentum: {
    checklistScore: number;
    checklist: Array<{ label: string; passed: boolean }>;
  } | null;
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
  eventPoints?: string[];
  compact?: boolean;
  height?: number;
};

function fmtPct(v: number | null | undefined) {
  if (v == null) return null;
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function pctClass(v: number | null | undefined) {
  if (v == null) return '';
  if (v > 0) return 'monitor-stat--up';
  if (v < 0) return 'monitor-stat--down';
  return '';
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

function shortLabel(label: string): string {
  return label.split('（')[0]?.split('(')[0]?.trim() ?? label;
}

function buildChartEventPoints(data: ChartPayload): string[] {
  const points: string[] = [];

  if (data.latestDiamond?.strength === 'red') {
    points.push('红钻');
  } else if (data.latestDiamond?.strength === 'blue') {
    points.push('蓝钻');
  }

  const topReason = data.latestDiamond?.reasons[0];
  if (topReason) {
    points.push(shortLabel(topReason));
  }

  if (data.momentum && data.momentum.checklistScore >= 4) {
    points.push(`动量 ${data.momentum.checklistScore}/6`);
  }

  return [...new Set(points)].slice(0, 3);
}

function MonitorEventPoints({
  points,
  compact = false,
}: {
  points: string[];
  compact?: boolean;
}) {
  if (points.length === 0) return null;

  return (
    <ul
      className={`monitor-event-points${compact ? ' monitor-event-points--compact' : ''}`}
      aria-label="识别事件点"
    >
      {points.map((point) => (
        <li key={point} className="monitor-event-point">
          {point}
        </li>
      ))}
    </ul>
  );
}

export function MonitorStockInsight({
  symbol,
  fallbackName,
  theme,
  pctChg,
  ret20dPct,
  eventPoints = [],
  compact = false,
  height,
}: MonitorStockInsightProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [data, setData] = useState<ChartPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chartHeight = height ?? (compact ? 84 : 140);

  useEffect(() => {
    if (!rootRef.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '120px' },
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

  const mergedEventPoints = useMemo(() => {
    const chartPoints = data ? buildChartEventPoints(data) : [];
    return [...new Set([...eventPoints, ...chartPoints])].slice(0, compact ? 4 : 8);
  }, [compact, data, eventPoints]);

  const chartBlock = (
    <>
      {!visible && <div className="chart-empty chart-empty--monitor">K 线</div>}
      {visible && loading && <div className="chart-empty chart-empty--monitor">…</div>}
      {visible && error && <div className="chart-empty chart-empty--monitor">{error}</div>}
      {visible && !loading && !error && data && (
        <KlineChart bars={toBars(data.kline.quotes)} diamonds={diamonds} height={chartHeight} />
      )}
    </>
  );

  if (compact) {
    return (
      <div
        ref={rootRef}
        className="monitor-stock-insight monitor-stock-insight--compact"
      >
        <div className="monitor-stock-insight-title-row">
          <div className="monitor-stock-insight-identity">
            <strong className="monitor-stock-insight-name">{displayName}</strong>
            <span className="monitor-stock-insight-code">{symbol}</span>
          </div>
          <div className="monitor-stock-insight-inline-stats">
            {pctChg != null ? (
              <span className={`monitor-stat ${pctClass(pctChg)}`}>{fmtPct(pctChg)}</span>
            ) : null}
            {ret20dPct != null ? (
              <span className={`monitor-stat monitor-stat--muted ${pctClass(ret20dPct)}`}>
                20日 {fmtPct(ret20dPct)}
              </span>
            ) : null}
          </div>
        </div>

        <div className="monitor-stock-insight-tags">
          {industry ? <span className="monitor-stock-tag">{industry}</span> : null}
          {theme ? <span className="monitor-stock-tag monitor-stock-tag--theme">{theme}</span> : null}
        </div>

        <MonitorEventPoints points={mergedEventPoints} compact />
      </div>
    );
  }

  return (
    <div ref={rootRef} className="monitor-stock-insight">
      <div className="monitor-stock-insight-head">
        <div>
          <strong className="monitor-stock-insight-name">{displayName}</strong>
          <span className="monitor-stock-insight-code">{symbol}</span>
        </div>
        <div className="monitor-stock-insight-tags">
          {industry ? <span className="monitor-stock-tag">板块 {industry}</span> : null}
          {theme ? (
            <span className="monitor-stock-tag monitor-stock-tag--theme">主线 {theme}</span>
          ) : null}
        </div>
      </div>

      {(pctChg != null || ret20dPct != null) && (
        <div className="monitor-stock-insight-stats">
          {pctChg != null ? <span>涨幅 {fmtPct(pctChg)}</span> : null}
          {ret20dPct != null ? <span>20日 {fmtPct(ret20dPct)}</span> : null}
        </div>
      )}

      <MonitorEventPoints points={mergedEventPoints} />
      {chartBlock}
    </div>
  );
}

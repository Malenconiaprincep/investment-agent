'use client';

import { useEffect, useRef } from 'react';
import {
  ColorType,
  createChart,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';

export type EquityPoint = {
  tradeDate: string;
  totalValue: number;
  returnPct: number;
};

type EquityChartProps = {
  points: EquityPoint[];
  height?: number;
};

function normalizeTradeDate(value: string): string {
  const key = value.trim().replace(/-/g, '').slice(0, 8);
  if (key.length !== 8) return value.trim();
  return `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
}

function toUtcTimestamp(tradeDate: string): UTCTimestamp {
  const normalized = normalizeTradeDate(tradeDate);
  return Math.floor(new Date(`${normalized}T00:00:00Z`).getTime() / 1000) as UTCTimestamp;
}

function toSeriesData(points: EquityPoint[]) {
  const byTime = new Map<number, number>();
  for (const point of points) {
    const time = toUtcTimestamp(point.tradeDate);
    if (!Number.isFinite(time)) continue;
    byTime.set(time, point.totalValue);
  }
  return [...byTime.entries()]
    .sort(([a], [b]) => a - b)
    .map(([time, value]) => ({ time: time as UTCTimestamp, value }));
}

export function EquityChart({ points, height = 280 }: EquityChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      height,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#9aa3ad',
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.06)' },
        horzLines: { color: 'rgba(255,255,255,0.06)' },
      },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.12)' },
      timeScale: { borderColor: 'rgba(255,255,255,0.12)' },
    });

    const series = chart.addSeries(LineSeries, {
      color: '#6b9fd4',
      lineWidth: 2,
      priceFormat: { type: 'price', precision: 0, minMove: 1 },
    });

    chartRef.current = chart;
    seriesRef.current = series;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        chart.applyOptions({ width: entry.contentRect.width });
      }
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [height]);

  useEffect(() => {
    if (!seriesRef.current || points.length === 0) return;
    seriesRef.current.setData(toSeriesData(points));
    chartRef.current?.timeScale().fitContent();
  }, [points]);

  if (points.length === 0) {
    return (
      <div className="equity-chart-empty muted">
        暂无收益曲线数据，自动任务运行后会每日记录。
      </div>
    );
  }

  return <div ref={containerRef} className="equity-chart" />;
}

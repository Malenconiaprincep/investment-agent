'use client';

import { useEffect, useRef } from 'react';
import {
  CandlestickSeries,
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';

export type KlineBar = {
  tradeDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
  vol?: number | null;
};

export type DiamondMarker = {
  tradeDate: string;
  strength: 'red' | 'blue';
};

type KlineChartProps = {
  bars: KlineBar[];
  diamonds?: DiamondMarker[];
  height?: number;
};

function toUtcTimestamp(tradeDate: string): UTCTimestamp {
  const y = tradeDate.slice(0, 4);
  const m = tradeDate.slice(4, 6);
  const d = tradeDate.slice(6, 8);
  return Math.floor(
    new Date(`${y}-${m}-${d}T00:00:00Z`).getTime() / 1000,
  ) as UTCTimestamp;
}

export function KlineChart({ bars, diamonds = [], height = 360 }: KlineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);

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

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#5cb87a',
      downColor: '#e07070',
      borderVisible: false,
      wickUpColor: '#5cb87a',
      wickDownColor: '#e07070',
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
    if (!seriesRef.current || bars.length === 0) return;

    const chronological = [...bars].reverse();
    seriesRef.current.setData(
      chronological.map((bar) => ({
        time: toUtcTimestamp(bar.tradeDate),
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      })),
    );

    chartRef.current?.timeScale().fitContent();
  }, [bars]);

  if (bars.length === 0) {
    return <div className="chart-empty">暂无日 K 数据</div>;
  }

  return <div ref={containerRef} className="kline-chart" />;
}

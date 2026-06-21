'use client';

import { useEffect, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type SeriesMarker,
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

export type TradeMarker = {
  tradeDate: string;
  kind: 'buy' | 'sell';
  label?: string;
};

export type PriceLineSpec = {
  price: number;
  color: string;
  title: string;
};

type KlineChartProps = {
  bars: KlineBar[];
  diamonds?: DiamondMarker[];
  tradeMarkers?: TradeMarker[];
  priceLines?: PriceLineSpec[];
  height?: number;
  fill?: boolean;
};

function toUtcTimestamp(tradeDate: string): UTCTimestamp {
  const normalized = tradeDate.replace(/-/g, '');
  const y = normalized.slice(0, 4);
  const m = normalized.slice(4, 6);
  const d = normalized.slice(6, 8);
  return Math.floor(
    new Date(`${y}-${m}-${d}T00:00:00Z`).getTime() / 1000,
  ) as UTCTimestamp;
}

function buildMarkers(input: {
  diamonds: DiamondMarker[];
  tradeMarkers: TradeMarker[];
}): SeriesMarker<UTCTimestamp>[] {
  const markers: SeriesMarker<UTCTimestamp>[] = [];

  for (const diamond of input.diamonds) {
    markers.push({
      time: toUtcTimestamp(diamond.tradeDate),
      position: 'belowBar',
      color: diamond.strength === 'red' ? '#e85d5d' : '#5b9cf5',
      shape: 'circle',
      text: diamond.strength === 'red' ? '红钻' : '蓝钻',
    });
  }

  for (const trade of input.tradeMarkers) {
    markers.push({
      time: toUtcTimestamp(trade.tradeDate),
      position: trade.kind === 'buy' ? 'belowBar' : 'aboveBar',
      color: trade.kind === 'buy' ? '#5cb87a' : '#e07070',
      shape: trade.kind === 'buy' ? 'arrowUp' : 'arrowDown',
      text: trade.label ?? (trade.kind === 'buy' ? '买' : '卖'),
    });
  }

  return markers.sort((a, b) => Number(a.time) - Number(b.time));
}

export function KlineChart({
  bars,
  diamonds = [],
  tradeMarkers = [],
  priceLines = [],
  height = 360,
  fill = false,
}: KlineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const markersRef = useRef<{ setMarkers: (markers: SeriesMarker<UTCTimestamp>[]) => void } | null>(
    null,
  );
  const priceLineRefs = useRef<ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']>[]>([]);
  const [measuredHeight, setMeasuredHeight] = useState(height);

  useEffect(() => {
    if (!fill || !containerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry && entry.contentRect.height >= 200) {
        setMeasuredHeight(Math.floor(entry.contentRect.height));
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [fill]);

  const chartHeight = fill ? measuredHeight : height;

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      height: chartHeight,
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
    markersRef.current = createSeriesMarkers(series);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        chart.applyOptions({ width: entry.contentRect.width });
        if (fill && entry.contentRect.height >= 200) {
          chart.applyOptions({ height: Math.floor(entry.contentRect.height) });
        }
      }
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      markersRef.current = null;
      priceLineRefs.current = [];
    };
  }, [chartHeight, fill]);

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

    for (const line of priceLineRefs.current) {
      seriesRef.current.removePriceLine(line);
    }
    priceLineRefs.current = priceLines.map((spec) =>
      seriesRef.current!.createPriceLine({
        price: spec.price,
        color: spec.color,
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: spec.title,
      }),
    );

    const markerList = buildMarkers({ diamonds, tradeMarkers });
    markersRef.current?.setMarkers(markerList);

    chartRef.current?.timeScale().fitContent();
  }, [bars, diamonds, tradeMarkers, priceLines]);

  if (bars.length === 0) {
    return <div className="chart-empty">暂无日 K 数据</div>;
  }

  return (
    <div
      ref={containerRef}
      className={`kline-chart${fill ? ' kline-chart--fill' : ''}`}
    />
  );
}

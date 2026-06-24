'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ColorType,
  CrosshairMode,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type UTCTimestamp,
} from 'lightweight-charts';

export type BacktestChartPoint = {
  tradeDate: string;
  returnPct: number;
};

type BacktestEquityChartProps = {
  strategy: BacktestChartPoint[];
  benchmark?: {
    name: string;
    curve: BacktestChartPoint[];
    finalReturnPct: number | null;
  };
  height?: number;
};

type ChartTooltip = {
  x: number;
  y: number;
  date: string;
  strategy: number | null;
  benchmark: number | null;
};

function normalizeTradeDate(value: string): string {
  return value.trim().replace(/-/g, '').slice(0, 8);
}

function toUtcTimestamp(tradeDate: string): UTCTimestamp {
  const key = normalizeTradeDate(tradeDate);
  const y = key.slice(0, 4);
  const m = key.slice(4, 6);
  const d = key.slice(6, 8);
  return Math.floor(new Date(`${y}-${m}-${d}T00:00:00Z`).getTime() / 1000) as UTCTimestamp;
}

function fmtTradeDateFromTime(time: number): string {
  const date = new Date(time * 1000);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function fmtPct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function expandStrategyDaily(
  strategy: BacktestChartPoint[],
  timelineDates: string[],
): Array<{ time: UTCTimestamp; value: number }> {
  const sorted = [...strategy]
    .map((point) => ({
      tradeDate: normalizeTradeDate(point.tradeDate),
      returnPct: point.returnPct,
    }))
    .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));

  let index = 0;
  let current = 0;

  return timelineDates.map((tradeDate) => {
    const key = normalizeTradeDate(tradeDate);
    while (index < sorted.length && sorted[index].tradeDate <= key) {
      current = sorted[index].returnPct;
      index += 1;
    }
    return { time: toUtcTimestamp(key), value: current };
  });
}

function toSeriesData(points: BacktestChartPoint[]) {
  return points
    .map((point) => ({
      time: toUtcTimestamp(point.tradeDate),
      value: point.returnPct,
    }))
    .sort((a, b) => (a.time as number) - (b.time as number));
}

export function BacktestEquityChart({
  strategy,
  benchmark,
  height = 280,
}: BacktestEquityChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const strategySeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const benchmarkSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const benchmarkNameRef = useRef(benchmark?.name ?? '大盘');
  const [tooltip, setTooltip] = useState<ChartTooltip | null>(null);

  benchmarkNameRef.current = benchmark?.name ?? '大盘';

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      height,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#9aa3ad',
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.06)' },
        horzLines: { color: 'rgba(255,255,255,0.06)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: 'rgba(255,255,255,0.25)',
          width: 1,
          style: 2,
          labelVisible: false,
        },
        horzLine: {
          color: 'rgba(255,255,255,0.25)',
          width: 1,
          style: 2,
          labelVisible: false,
        },
      },
      rightPriceScale: {
        borderColor: 'rgba(255,255,255,0.12)',
      },
      timeScale: {
        borderColor: 'rgba(255,255,255,0.12)',
        timeVisible: true,
        secondsVisible: false,
      },
      localization: {
        priceFormatter: (price: number) => fmtPct(price),
      },
    });

    const strategySeries = chart.addSeries(LineSeries, {
      color: '#d4a017',
      lineWidth: 2,
      title: '策略',
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    const benchmarkSeries = chart.addSeries(LineSeries, {
      color: '#7da2ff',
      lineWidth: 2,
      title: benchmark?.name ?? '大盘',
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    const handleCrosshairMove = (param: MouseEventParams) => {
      if (
        !param.time ||
        !param.point ||
        param.point.x < 0 ||
        param.point.y < 0 ||
        param.point.x > containerRef.current!.clientWidth ||
        param.point.y > height
      ) {
        setTooltip(null);
        return;
      }

      const strategyData = param.seriesData.get(strategySeries) as
        | { value?: number }
        | undefined;
      const benchmarkData = param.seriesData.get(benchmarkSeries) as
        | { value?: number }
        | undefined;

      setTooltip({
        x: param.point.x,
        y: param.point.y,
        date: fmtTradeDateFromTime(param.time as number),
        strategy: strategyData?.value ?? null,
        benchmark: benchmarkData?.value ?? null,
      });
    };

    chart.subscribeCrosshairMove(handleCrosshairMove);

    chartRef.current = chart;
    strategySeriesRef.current = strategySeries;
    benchmarkSeriesRef.current = benchmarkSeries;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        chart.applyOptions({ width: entry.contentRect.width });
      }
    });
    observer.observe(containerRef.current);

    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      strategySeriesRef.current = null;
      benchmarkSeriesRef.current = null;
      setTooltip(null);
    };
  }, [benchmark?.name, height]);

  useEffect(() => {
    if (!strategySeriesRef.current || strategy.length === 0) return;

    const benchmarkDates = benchmark?.curve.map((point) => point.tradeDate) ?? [];
    const timeline =
      benchmarkDates.length > 0
        ? benchmarkDates
        : strategy.map((point) => point.tradeDate);

    const strategyData =
      benchmarkDates.length > 0
        ? expandStrategyDaily(strategy, timeline)
        : toSeriesData(strategy);

    strategySeriesRef.current.setData(strategyData);

    if (benchmarkSeriesRef.current && benchmark?.curve.length) {
      benchmarkSeriesRef.current.setData(toSeriesData(benchmark.curve));
      benchmarkSeriesRef.current.applyOptions({ visible: true, title: benchmark.name });
    } else {
      benchmarkSeriesRef.current?.setData([]);
      benchmarkSeriesRef.current?.applyOptions({ visible: false });
    }

    chartRef.current?.timeScale().fitContent();
  }, [benchmark, strategy]);

  if (strategy.length === 0) {
    return (
      <div className="chart-empty chart-empty--compact">暂无足够交易生成收益曲线</div>
    );
  }

  const strategyFinal = strategy.at(-1)?.returnPct ?? null;
  const benchmarkName = benchmark?.name ?? '大盘';

  return (
    <div className="backtest-equity-chart">
      <div ref={wrapRef} className="equity-chart-wrap">
        <div ref={containerRef} className="equity-chart" />
        {tooltip && (
          <div
            className="equity-chart-tooltip"
            style={{
              left: tooltip.x,
              top: tooltip.y,
            }}
          >
            <span className="equity-chart-tooltip-date">{tooltip.date}</span>
            <span className="equity-chart-tooltip-row equity-chart-tooltip-row--strategy">
              策略 {fmtPct(tooltip.strategy)}
            </span>
            {benchmark && (
              <span className="equity-chart-tooltip-row equity-chart-tooltip-row--benchmark">
                {benchmarkName} {fmtPct(tooltip.benchmark)}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="equity-chart-legend">
        <span className="equity-legend-item">
          <i className="equity-legend-swatch equity-legend-swatch--strategy" />
          策略 {fmtPct(strategyFinal)}
        </span>
        {benchmark ? (
          <span className="equity-legend-item">
            <i className="equity-legend-swatch equity-legend-swatch--benchmark" />
            {benchmark.name} {fmtPct(benchmark.finalReturnPct)}
          </span>
        ) : (
          <span className="equity-legend-item muted">
            大盘基准暂未返回（已尝试上证指数、沪深300ETF、上证50ETF）
          </span>
        )}
      </div>
      <p className="muted equity-chart-hint">鼠标移到曲线上，会在光标上方显示日期和两条线的累计收益。</p>
    </div>
  );
}

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

export type BacktestChartSeries = {
  name: string;
  curve: BacktestChartPoint[];
  finalReturnPct?: number | null;
  color?: string;
};

type BacktestEquityChartProps = {
  strategy: BacktestChartPoint[];
  strategyName?: string;
  strategySeries?: BacktestChartSeries[];
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
  series: Array<{
    name: string;
    color: string;
    value: number | null;
  }>;
  benchmark: number | null;
};

type SeriesRef = {
  name: string;
  color: string;
  series: ISeriesApi<'Line'>;
};

const DEFAULT_STRATEGY_COLOR = '#d4a017';
const BENCHMARK_COLOR = '#7da2ff';
const STRATEGY_COLORS = ['#d4a017', '#5cb87a', '#e07070', '#9b8cff', '#68c4d4'];

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

function buildTimeline(lines: BacktestChartSeries[], benchmark?: BacktestEquityChartProps['benchmark']) {
  const dates = new Set<string>();
  if (benchmark?.curve.length) {
    for (const point of benchmark.curve) dates.add(normalizeTradeDate(point.tradeDate));
  } else {
    for (const line of lines) {
      for (const point of line.curve) dates.add(normalizeTradeDate(point.tradeDate));
    }
  }
  return [...dates].sort((a, b) => a.localeCompare(b));
}

export function BacktestEquityChart({
  strategy,
  strategyName = '策略',
  strategySeries,
  benchmark,
  height = 280,
}: BacktestEquityChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const strategySeriesRefs = useRef<SeriesRef[]>([]);
  const benchmarkSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const benchmarkNameRef = useRef(benchmark?.name ?? '大盘');
  const [tooltip, setTooltip] = useState<ChartTooltip | null>(null);

  benchmarkNameRef.current = benchmark?.name ?? '大盘';
  const lines: BacktestChartSeries[] =
    strategySeries?.length
      ? strategySeries
      : [
          {
            name: strategyName,
            curve: strategy,
            finalReturnPct: strategy.at(-1)?.returnPct ?? null,
            color: DEFAULT_STRATEGY_COLOR,
          },
        ];

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

      const seriesValues = strategySeriesRefs.current.map((item) => {
        const data = param.seriesData.get(item.series) as
          | { value?: number }
          | undefined;
        return {
          name: item.name,
          color: item.color,
          value: data?.value ?? null,
        };
      });
      const benchmarkData = benchmarkSeriesRef.current
        ? (param.seriesData.get(benchmarkSeriesRef.current) as
        | { value?: number }
        | undefined)
        : undefined;

      setTooltip({
        x: param.point.x,
        y: param.point.y,
        date: fmtTradeDateFromTime(param.time as number),
        series: seriesValues,
        benchmark: benchmarkData?.value ?? null,
      });
    };

    chart.subscribeCrosshairMove(handleCrosshairMove);

    chartRef.current = chart;

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
      strategySeriesRefs.current = [];
      benchmarkSeriesRef.current = null;
      setTooltip(null);
    };
  }, [height]);

  useEffect(() => {
    if (!chartRef.current) return;

    for (const item of strategySeriesRefs.current) {
      chartRef.current.removeSeries(item.series);
    }
    strategySeriesRefs.current = [];
    if (benchmarkSeriesRef.current) {
      chartRef.current.removeSeries(benchmarkSeriesRef.current);
      benchmarkSeriesRef.current = null;
    }

    const visibleLines = lines.filter((line) => line.curve.length > 0);
    if (visibleLines.length === 0) return;
    const timeline = buildTimeline(visibleLines, benchmark);

    visibleLines.forEach((line, index) => {
      const color = line.color ?? STRATEGY_COLORS[index % STRATEGY_COLORS.length];
      const series = chartRef.current!.addSeries(LineSeries, {
        color,
        lineWidth: 2,
        title: line.name,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 4,
        crosshairMarkerBorderColor: color,
        crosshairMarkerBackgroundColor: color,
      });
      const data = timeline.length > 0 ? expandStrategyDaily(line.curve, timeline) : toSeriesData(line.curve);
      series.setData(data);
      strategySeriesRefs.current.push({ name: line.name, color, series });
    });

    if (benchmark?.curve.length) {
      const benchmarkSeries = chartRef.current.addSeries(LineSeries, {
        color: BENCHMARK_COLOR,
        lineWidth: 2,
        title: benchmark.name,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 4,
        crosshairMarkerBorderColor: BENCHMARK_COLOR,
        crosshairMarkerBackgroundColor: BENCHMARK_COLOR,
      });
      benchmarkSeries.setData(toSeriesData(benchmark.curve));
      benchmarkSeriesRef.current = benchmarkSeries;
    }

    chartRef.current?.timeScale().fitContent();
  }, [benchmark, lines]);

  if (lines.every((line) => line.curve.length === 0)) {
    return (
      <div className="chart-empty chart-empty--compact">暂无足够交易生成收益曲线</div>
    );
  }

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
            {tooltip.series.map((item) => (
              <span
                key={item.name}
                className="equity-chart-tooltip-row"
                style={{ color: item.color }}
              >
                {item.name} {fmtPct(item.value)}
              </span>
            ))}
            {benchmark && (
              <span className="equity-chart-tooltip-row equity-chart-tooltip-row--benchmark">
                {benchmarkName} {fmtPct(tooltip.benchmark)}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="equity-chart-legend">
        {lines.map((line, index) => (
          <span key={line.name} className="equity-legend-item">
            <i
              className="equity-legend-swatch"
              style={{ background: line.color ?? STRATEGY_COLORS[index % STRATEGY_COLORS.length] }}
            />
            {line.name} {fmtPct(line.finalReturnPct ?? line.curve.at(-1)?.returnPct ?? null)}
          </span>
        ))}
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
      <p className="muted equity-chart-hint">鼠标移到曲线上，会在光标上方显示日期和各条线的累计收益。</p>
    </div>
  );
}

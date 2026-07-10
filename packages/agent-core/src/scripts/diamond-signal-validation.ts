import '../config/load-env.js';

import { readFileSync } from 'node:fs';

import { isRetailTradableStock } from '../data/market/asset-type.js';
import {
  getLocalEtfDailyCsvPath,
  getLocalStockDailyCsvPath,
  listLocalStockDailyCsvSymbols,
  parseLocalDailyCsv,
} from '../data/market/local-csv/etf-daily.js';
import { scanDiamondSignalHistory } from '../data/market/diamond-signal.js';
import type { OhlcvBar } from '../data/market/indicators.js';

const START_DATE = '20180102';
const END_DATE = '20260709';
const WARMUP_BARS = 260;
const HORIZONS = [1, 3, 5, 10, 20] as const;
const ROUND_TRIP_COST_PCT = 0.2;

type Horizon = (typeof HORIZONS)[number];

type BenchmarkSnapshot = {
  close: number;
  ma20: number | null;
  momentum20Pct: number | null;
};

type SignalEvent = {
  symbol: string;
  tradeDate: string;
  strength: 'red' | 'blue';
  volumeRatio: number | null;
  ma20ExtensionPct: number | null;
  nextOpenGapPct: number | null;
  benchmark: BenchmarkSnapshot | null;
  signalCloseReturns: Partial<Record<Horizon, number>>;
  nextOpenReturns: Partial<Record<Horizon, number>>;
  excessReturns: Partial<Record<Horizon, number>>;
};

type Stats = {
  count: number;
  winRatePct: number | null;
  avgReturnPct: number | null;
  medianReturnPct: number | null;
  trimmedAvgReturnPct: number | null;
  avgExcessPct?: number | null;
  avgAfterCostPct?: number | null;
};

function round(value: number, digits = 3): number {
  return Number(value.toFixed(digits));
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function trimmedMean(values: number[], trimFraction = 0.01): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const trim = Math.floor(sorted.length * trimFraction);
  const kept = sorted.slice(trim, sorted.length - trim || undefined);
  return mean(kept);
}

function summarize(
  events: SignalEvent[],
  horizon: Horizon,
  priceField: 'signalCloseReturns' | 'nextOpenReturns',
): Stats {
  const usable = events.filter((event) => event[priceField][horizon] != null);
  const returns = usable.map((event) => event[priceField][horizon] as number);
  const excess = usable.flatMap((event) =>
    event.excessReturns[horizon] == null ? [] : [event.excessReturns[horizon] as number],
  );
  const avgReturn = mean(returns);
  return {
    count: returns.length,
    winRatePct:
      returns.length > 0
        ? round((returns.filter((value) => value > 0).length / returns.length) * 100)
        : null,
    avgReturnPct: avgReturn == null ? null : round(avgReturn),
    medianReturnPct: median(returns) == null ? null : round(median(returns) as number),
    trimmedAvgReturnPct:
      trimmedMean(returns) == null ? null : round(trimmedMean(returns) as number),
    ...(priceField === 'signalCloseReturns'
      ? { avgExcessPct: mean(excess) == null ? null : round(mean(excess) as number) }
      : {
          avgAfterCostPct:
            avgReturn == null ? null : round(avgReturn - ROUND_TRIP_COST_PCT),
        }),
  };
}

function dateInRange(tradeDate: string): boolean {
  const key = tradeDate.replace(/-/g, '');
  return key >= START_DATE && key <= END_DATE;
}

function scopeBars(bars: OhlcvBar[]): { bars: OhlcvBar[]; lookback: number } {
  const endIndex = bars.findIndex(
    (bar) => bar.tradeDate.replace(/-/g, '') <= END_DATE,
  );
  if (endIndex < 0) return { bars: [], lookback: 0 };
  const fromEnd = bars.slice(endIndex);
  const beforeStart = fromEnd.findIndex(
    (bar) => bar.tradeDate.replace(/-/g, '') < START_DATE,
  );
  const lookback = beforeStart < 0 ? fromEnd.length : beforeStart;
  const end = beforeStart < 0
    ? fromEnd.length
    : Math.min(fromEnd.length, beforeStart + WARMUP_BARS);
  return { bars: fromEnd.slice(0, end), lookback };
}

function buildBenchmark(): {
  barsByDate: Map<string, OhlcvBar>;
  snapshots: Map<string, BenchmarkSnapshot>;
} {
  const bars = parseLocalDailyCsv(
    readFileSync(getLocalEtfDailyCsvPath('510300'), 'utf-8'),
  ).filter((bar) => bar.close != null && bar.close > 0);
  const barsByDate = new Map(bars.map((bar) => [bar.tradeDate.replace(/-/g, ''), bar]));
  const snapshots = new Map<string, BenchmarkSnapshot>();
  for (let index = 0; index < bars.length; index += 1) {
    const close = bars[index].close as number;
    const ma20Values = bars
      .slice(index, index + 20)
      .flatMap((bar) => (bar.close != null && bar.close > 0 ? [bar.close] : []));
    const ma20 = ma20Values.length === 20 ? mean(ma20Values) : null;
    const prior20 = bars[index + 20]?.close;
    snapshots.set(bars[index].tradeDate.replace(/-/g, ''), {
      close,
      ma20,
      momentum20Pct:
        prior20 != null && prior20 > 0
          ? ((close - prior20) / prior20) * 100
          : null,
    });
  }
  return { barsByDate, snapshots };
}

function calcReturn(entry: number | null, exit: number | null): number | null {
  if (entry == null || exit == null || entry <= 0 || exit <= 0) return null;
  return ((exit - entry) / entry) * 100;
}

function splitName(event: SignalEvent): 'train-2018-2023' | 'test-2024-2026' {
  return event.tradeDate.replace(/-/g, '') < '20240101'
    ? 'train-2018-2023'
    : 'test-2024-2026';
}

const benchmark = buildBenchmark();
const symbols = listLocalStockDailyCsvSymbols().filter(isRetailTradableStock);
const events: SignalEvent[] = [];
const dataQuality = {
  csvFiles: symbols.length,
  parsedRows: 0,
  filesWithDuplicateDates: 0,
  duplicateDateRows: 0,
  nonPositiveCloseRows: 0,
  missingVolumeRows: 0,
  missingAmountRows: 0,
  filesWithLessThan30PositiveBars: 0,
  latestDateCounts: new Map<string, number>(),
};

for (let symbolIndex = 0; symbolIndex < symbols.length; symbolIndex += 1) {
  const symbol = symbols[symbolIndex];
  const rawBars = parseLocalDailyCsv(
    readFileSync(getLocalStockDailyCsvPath(symbol), 'utf-8'),
  );
  dataQuality.parsedRows += rawBars.length;
  const seenDates = new Set<string>();
  let duplicateRows = 0;
  for (const bar of rawBars) {
    const date = bar.tradeDate.replace(/-/g, '');
    if (seenDates.has(date)) duplicateRows += 1;
    seenDates.add(date);
    if (bar.close == null || bar.close <= 0) dataQuality.nonPositiveCloseRows += 1;
    if (bar.vol == null || bar.vol <= 0) dataQuality.missingVolumeRows += 1;
    if (bar.amount == null || bar.amount <= 0) dataQuality.missingAmountRows += 1;
  }
  if (duplicateRows > 0) {
    dataQuality.filesWithDuplicateDates += 1;
    dataQuality.duplicateDateRows += duplicateRows;
  }
  const latestDate = rawBars[0]?.tradeDate.replace(/-/g, '');
  if (latestDate) {
    dataQuality.latestDateCounts.set(
      latestDate,
      (dataQuality.latestDateCounts.get(latestDate) ?? 0) + 1,
    );
  }

  const positiveBars = rawBars.filter((bar) => bar.close != null && bar.close > 0);
  if (positiveBars.length < 30) {
    dataQuality.filesWithLessThan30PositiveBars += 1;
    continue;
  }
  const scoped = scopeBars(positiveBars);
  if (scoped.bars.length < 30 || scoped.lookback <= 0) continue;
  const indexByDate = new Map(
    scoped.bars.map((bar, index) => [bar.tradeDate.replace(/-/g, ''), index]),
  );
  const signals = scanDiamondSignalHistory(
    symbol,
    symbol,
    scoped.bars,
    scoped.lookback,
  ).filter((signal) => dateInRange(signal.tradeDate));

  for (const signal of signals) {
    const signalDate = signal.tradeDate.replace(/-/g, '');
    const signalIndex = indexByDate.get(signalDate);
    if (signalIndex == null) continue;
    const nextBar = scoped.bars[signalIndex - 1];
    const market = benchmark.snapshots.get(signalDate) ?? null;
    const event: SignalEvent = {
      symbol,
      tradeDate: signalDate,
      strength: signal.strength,
      volumeRatio: signal.volumeRatio,
      ma20ExtensionPct:
        signal.ma20 != null && signal.ma20 > 0
          ? ((signal.close - signal.ma20) / signal.ma20) * 100
          : null,
      nextOpenGapPct: calcReturn(signal.close, nextBar?.open ?? null),
      benchmark: market,
      signalCloseReturns: {},
      nextOpenReturns: {},
      excessReturns: {},
    };
    for (const horizon of HORIZONS) {
      const exit = scoped.bars[signalIndex - horizon];
      const signalCloseReturn = calcReturn(signal.close, exit?.close ?? null);
      const nextOpenReturn = calcReturn(nextBar?.open ?? null, exit?.close ?? null);
      if (signalCloseReturn != null) event.signalCloseReturns[horizon] = signalCloseReturn;
      if (nextOpenReturn != null) event.nextOpenReturns[horizon] = nextOpenReturn;
      const benchmarkExit = exit
        ? benchmark.barsByDate.get(exit.tradeDate.replace(/-/g, ''))
        : null;
      const benchmarkReturn = calcReturn(market?.close ?? null, benchmarkExit?.close ?? null);
      if (signalCloseReturn != null && benchmarkReturn != null) {
        event.excessReturns[horizon] = signalCloseReturn - benchmarkReturn;
      }
    }
    events.push(event);
  }

  if ((symbolIndex + 1) % 500 === 0) {
    process.stderr.write(`processed ${symbolIndex + 1}/${symbols.length}, signals ${events.length}\n`);
  }
}

const redEvents = events.filter((event) => event.strength === 'red');
const blueEvents = events.filter((event) => event.strength === 'blue');

const variants: Array<{
  name: string;
  filter: (event: SignalEvent) => boolean;
}> = [
  { name: 'baseline', filter: () => true },
  { name: 'volume>=1.8', filter: (event) => (event.volumeRatio ?? -Infinity) >= 1.8 },
  { name: 'volume>=2.0', filter: (event) => (event.volumeRatio ?? -Infinity) >= 2 },
  {
    name: 'MA20乖离<=8%',
    filter: (event) => (event.ma20ExtensionPct ?? Infinity) <= 8,
  },
  {
    name: 'MA20乖离<=10%',
    filter: (event) => (event.ma20ExtensionPct ?? Infinity) <= 10,
  },
  {
    name: '沪深300站上MA20且20日动量>=0%',
    filter: (event) =>
      event.benchmark?.ma20 != null &&
      event.benchmark.close > event.benchmark.ma20 &&
      (event.benchmark.momentum20Pct ?? -Infinity) >= 0,
  },
  {
    name: '沪深300站上MA20且20日动量>=3%',
    filter: (event) =>
      event.benchmark?.ma20 != null &&
      event.benchmark.close > event.benchmark.ma20 &&
      (event.benchmark.momentum20Pct ?? -Infinity) >= 3,
  },
  {
    name: '次日开盘跳空<=3%',
    filter: (event) => (event.nextOpenGapPct ?? Infinity) <= 3,
  },
  {
    name: '量比>=1.8+MA20乖离<=10%+大盘动量>=0%',
    filter: (event) =>
      (event.volumeRatio ?? -Infinity) >= 1.8 &&
      (event.ma20ExtensionPct ?? Infinity) <= 10 &&
      event.benchmark?.ma20 != null &&
      event.benchmark.close > event.benchmark.ma20 &&
      (event.benchmark.momentum20Pct ?? -Infinity) >= 0,
  },
];

const yearly = [...new Set(redEvents.map((event) => event.tradeDate.slice(0, 4)))]
  .sort()
  .map((year) => {
    const selected = redEvents.filter((event) => event.tradeDate.startsWith(year));
    return {
      year,
      nextOpen3d: summarize(selected, 3, 'nextOpenReturns'),
      nextOpen5d: summarize(selected, 5, 'nextOpenReturns'),
    };
  });

const variantResults = variants.flatMap((variant) =>
  (['train-2018-2023', 'test-2024-2026'] as const).map((split) => {
    const selected = redEvents.filter(
      (event) => splitName(event) === split && variant.filter(event),
    );
    return {
      variant: variant.name,
      split,
      nextOpen3d: summarize(selected, 3, 'nextOpenReturns'),
      nextOpen5d: summarize(selected, 5, 'nextOpenReturns'),
    };
  }),
);

process.stdout.write(
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      range: [START_DATE, END_DATE],
      assumptions: {
        executableEntry: '信号次一交易日开盘',
        roundTripCostPct: ROUND_TRIP_COST_PCT,
        benchmark: '510300 沪深300ETF，同信号日至退出日收盘收益',
        split: '2018-2023用于比较，2024-2026仅作后段验证（并非严格未见样本）',
      },
      dataQuality: {
        ...dataQuality,
        latestDateCounts: [...dataQuality.latestDateCounts.entries()]
          .sort((a, b) => b[0].localeCompare(a[0]))
          .slice(0, 10),
      },
      signalCounts: { all: events.length, red: redEvents.length, blue: blueEvents.length },
      red: Object.fromEntries(
        HORIZONS.map((horizon) => [
          `${horizon}d`,
          {
            signalClose: summarize(redEvents, horizon, 'signalCloseReturns'),
            nextOpen: summarize(redEvents, horizon, 'nextOpenReturns'),
          },
        ]),
      ),
      blue: Object.fromEntries(
        HORIZONS.map((horizon) => [
          `${horizon}d`,
          {
            signalClose: summarize(blueEvents, horizon, 'signalCloseReturns'),
            nextOpen: summarize(blueEvents, horizon, 'nextOpenReturns'),
          },
        ]),
      ),
      yearly,
      variants: variantResults,
    },
    null,
    2,
  ),
);

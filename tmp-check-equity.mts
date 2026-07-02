import { listEquitySnapshots } from './packages/agent-core/src/data/paper/store.ts';

const BUCKET_INITIAL_CASH = 100_000;

function normalizeEquityTradeDate(value: string): string {
  const key = value.trim().replace(/-/g, '').slice(0, 8);
  if (key.length !== 8) return value.trim();
  return `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
}

function pointInitialCash(point: { totalValue: number; returnPct: number }): number {
  const denominator = 1 + point.returnPct / 100;
  if (!Number.isFinite(denominator) || denominator <= 0) return point.totalValue;
  return point.totalValue / denominator;
}

function mergeEquityCurves(
  curves: Array<Array<{ tradeDate: string; totalValue: number; returnPct: number }>>,
) {
  const normalizedCurves = curves.map((points) =>
    [...points]
      .map((point) => ({
        tradeDate: normalizeEquityTradeDate(point.tradeDate),
        totalValue: point.totalValue,
        returnPct: point.returnPct,
      }))
      .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate)),
  );

  const allDates = new Set<string>();
  for (const points of normalizedCurves) {
    for (const point of points) allDates.add(point.tradeDate);
  }
  const timeline = [...allDates].sort();
  if (timeline.length === 0) return [];

  const indices = normalizedCurves.map(() => 0);
  const lastKnown = normalizedCurves.map<
    { tradeDate: string; totalValue: number; returnPct: number } | null
  >(() => null);

  return timeline.map((tradeDate) => {
    let totalValue = 0;
    let initialCash = 0;

    for (let i = 0; i < normalizedCurves.length; i++) {
      const points = normalizedCurves[i];
      while (indices[i] < points.length && points[indices[i]].tradeDate <= tradeDate) {
        lastKnown[i] = points[indices[i]];
        indices[i] += 1;
      }

      const point = lastKnown[i];
      if (point) {
        totalValue += point.totalValue;
        initialCash += pointInitialCash(point);
      } else {
        totalValue += BUCKET_INITIAL_CASH;
        initialCash += BUCKET_INITIAL_CASH;
      }
    }

    return {
      tradeDate,
      totalValue: Number(totalValue.toFixed(2)),
      returnPct:
        initialCash > 0
          ? Number((((totalValue - initialCash) / initialCash) * 100).toFixed(2))
          : 0,
    };
  });
}

const buckets = ['etf', 'stock', 'stock-backtest', 'stock-backtest-news'] as const;
const curves = [];
for (const b of buckets) {
  curves.push(await listEquitySnapshots(90, b));
}
console.log('stock snapshots after repair:');
for (const s of curves[1]) console.log(s.tradeDate, s.totalValue);
console.log('merged:');
for (const p of mergeEquityCurves(curves)) console.log(p.tradeDate, p.totalValue);

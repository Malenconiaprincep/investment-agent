export type OhlcvBar = {
  tradeDate: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  vol: number | null;
  amount?: number | null;
};

export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(0, period);
  return Number((slice.reduce((sum, v) => sum + v, 0) / period).toFixed(4));
}

/** values 按时间从旧到新 */
export function emaSeries(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const result: number[] = [];
  let prev = values[0];
  result.push(prev);
  for (let i = 1; i < values.length; i += 1) {
    prev = values[i] * k + prev * (1 - k);
    result.push(prev);
  }
  return result;
}

export function macd(
  closes: number[],
  fast = 12,
  slow = 26,
  signal = 9,
): {
  dif: number[];
  dea: number[];
  hist: number[];
} {
  const emaFast = emaSeries(closes, fast);
  const emaSlow = emaSeries(closes, slow);
  const dif = emaFast.map((f, i) => f - emaSlow[i]);
  const dea = emaSeries(dif, signal);
  const hist = dif.map((d, i) => d - dea[i]);
  return { dif, dea, hist };
}

/** bars: 最新在前 */
export function avgVolume(bars: OhlcvBar[], days: number): number | null {
  const vols = bars
    .slice(0, days)
    .map((b) => b.vol)
    .filter((v): v is number => v != null && v > 0);
  if (vols.length === 0) return null;
  return vols.reduce((sum, v) => sum + v, 0) / vols.length;
}

export function highestClose(bars: OhlcvBar[], days: number, skip = 0): number | null {
  const slice = bars.slice(skip, skip + days);
  const closes = slice
    .map((b) => b.close)
    .filter((c): c is number => c != null);
  if (closes.length === 0) return null;
  return Math.max(...closes);
}

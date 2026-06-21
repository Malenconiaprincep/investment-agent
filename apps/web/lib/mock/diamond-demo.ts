import type { KlineBar, TradeMarker } from '@/components/charts/KlineChart';

export type DemoDiamondSignal = {
  tradeDate: string;
  strength: 'red' | 'blue';
  score: number;
  reasons: string[];
  close: number;
};

export const DEMO_SYMBOL = 'MOCK001';
export const DEMO_NAME = '演示股份';

const RED_REASONS = [
  '收盘价站上 MA20，短期均线多头',
  '成交量放大 2.1x（5 日均量）',
  'MACD 金叉',
  '突破近 20 日高点',
];

/** 生成连续交易日（跳过周末），最新在前 */
function tradingDays(count: number, end = new Date('2026-06-18')): string[] {
  const days: string[] = [];
  const cursor = new Date(end);
  while (days.length < count) {
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) {
      const y = cursor.getFullYear();
      const m = String(cursor.getMonth() + 1).padStart(2, '0');
      const d = String(cursor.getDate()).padStart(2, '0');
      days.push(`${y}${m}${d}`);
    }
    cursor.setDate(cursor.getDate() - 1);
  }
  return days;
}

/** 贴近截图走势：4 元附近震荡 → 5.6 高点 → 回落到 4.2 */
function closeForDay(indexFromOldest: number, total: number): number {
  const t = indexFromOldest / total;
  const wave =
    4.05 +
    Math.sin(t * Math.PI * 2.4) * 0.35 +
    Math.sin(t * Math.PI * 5.2) * 0.18;
  const trend =
    t < 0.18
      ? 4.0 + t * 6
      : t < 0.38
        ? 5.05 - (t - 0.18) * 1.2
        : t < 0.52
          ? 4.35 + (t - 0.38) * 9
          : t < 0.68
            ? 5.55 - (t - 0.52) * 2.5
            : t < 0.82
              ? 4.15 + (t - 0.68) * 1.5
              : 4.55 - (t - 0.82) * 2.0;
  const blended = wave * 0.35 + trend * 0.65;
  return Number(Math.max(3.75, Math.min(6.05, blended)).toFixed(2));
}

function generateBars(): KlineBar[] {
  const dates = tradingDays(120);
  const oldestFirst = [...dates].reverse();
  return dates.map((tradeDate, i) => {
    const age = oldestFirst.length - 1 - i;
    const close = i === 0 ? 4.23 : closeForDay(age, oldestFirst.length);
    const prevClose = i === dates.length - 1 ? close : closeForDay(age - 1, oldestFirst.length);
    const drift = close >= prevClose ? 1 : -1;
    const open = Number((close - drift * 0.04).toFixed(2));
    const high = Number((Math.max(open, close) + 0.06).toFixed(2));
    const low = Number((Math.min(open, close) - 0.06).toFixed(2));
    return { tradeDate, open, high, low, close };
  });
}

/** 在 K 线序列上选取典型拐点作为红钻买点 */
function buildDiamondSignals(bars: KlineBar[]): DemoDiamondSignal[] {
  const indices = [118, 102, 88, 72, 58, 42, 28, 12, 0];
  return indices
    .filter((i) => i < bars.length)
    .map((i) => {
      const bar = bars[i];
      return {
        tradeDate: bar.tradeDate,
        strength: 'red' as const,
        score: 100,
        reasons: RED_REASONS,
        close: bar.close,
      };
    });
}

export const DEMO_MOMENTUM = {
  action: 'buy' as const,
  checklistScore: 5,
  checklistMax: 6,
  entryMemo: '红钻启动 · 趋势与量能配合，可考虑在 4.20–4.30 区间分批介入',
  stopLossPrice: 3.98,
  checklist: [
    { id: 'trend', label: '收盘价站上 MA20', passed: true, detail: '4.23 > 4.08' },
    { id: 'ma', label: 'MA5 高于 MA20', passed: true, detail: '短期均线多头' },
    { id: 'vol', label: '成交量明显放大', passed: true, detail: '2.1x 五日均量' },
    { id: 'macd', label: 'MACD 金叉或红钻确认', passed: true, detail: 'DIF 上穿 DEA' },
    { id: 'diamond', label: '红钻信号（动量启动）', passed: true, detail: '四要素齐发' },
    { id: 'breakout', label: '突破近 20 日高点', passed: false, detail: '尚未突破前高 4.35' },
  ],
};

export function getDiamondDemoPayload() {
  const bars = generateBars();
  const diamondSignals = buildDiamondSignals(bars);
  const diamonds = diamondSignals.map((signal) => ({
    tradeDate: signal.tradeDate,
    strength: signal.strength,
  }));
  const latestSignal = diamondSignals[diamondSignals.length - 1];
  const tradeMarkers: TradeMarker[] = diamondSignals.slice(-3).map((signal) => ({
    tradeDate: signal.tradeDate,
    kind: 'buy' as const,
    label: '买',
  }));

  return {
    symbol: DEMO_SYMBOL,
    name: DEMO_NAME,
    bars,
    diamonds,
    diamondSignals,
    tradeMarkers,
    latestSignal,
    momentum: DEMO_MOMENTUM,
    stopLossPrice: DEMO_MOMENTUM.stopLossPrice,
    entryPrice: latestSignal.close,
  };
}

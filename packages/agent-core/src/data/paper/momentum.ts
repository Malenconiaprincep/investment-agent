import {
  avgVolume,
  highestClose,
  macd,
  sma,
  type OhlcvBar,
} from '../market/indicators.js';
import type { DiamondSignalResult } from '../market/diamond-signal.js';

/** 动量派默认参数 */
export const MOMENTUM_STOP_LOSS_PCT = 0.08;
export const MOMENTUM_TRAILING_STOP_PCT = 0.12;
export const MOMENTUM_MIN_CHECKLIST = 4;

export type MomentumChecklistItem = {
  id: string;
  label: string;
  passed: boolean;
  detail?: string;
};

export type MomentumAnalysis = {
  close: number;
  ma5: number | null;
  ma20: number | null;
  trendUp: boolean;
  volumeRatio: number | null;
  breakout: boolean;
  checklist: MomentumChecklistItem[];
  checklistScore: number;
  action: 'buy' | 'hold' | 'wait' | 'sell';
  stopLossPrice: number | null;
  /** 持仓/观察期内最高收盘，用于移动止盈 */
  highWaterMark: number | null;
  /** 移动止盈触发参考价 = highWaterMark × (1 - 12%) */
  trailingStopPrice: number | null;
  entryMemo: string;
  diamondStrength: 'red' | 'blue' | null;
};

function barsFromQuotes(quotes: OhlcvBar[]): OhlcvBar[] {
  return quotes.filter((q) => q.close != null);
}

export function analyzeMomentum(
  symbol: string,
  name: string,
  bars: OhlcvBar[],
  diamond?: DiamondSignalResult | null,
): MomentumAnalysis | null {
  const filtered = barsFromQuotes(bars);
  if (filtered.length < 30) return null;

  const latest = filtered[0];
  const close = latest.close!;
  const closes = filtered.map((b) => b.close!).filter(Boolean);
  const ma5 = sma(closes, 5);
  const ma20 = sma(closes, 20);
  if (ma20 == null) return null;

  const volAvg5 = avgVolume(filtered, 5);
  const volumeRatio =
    volAvg5 && latest.vol
      ? Number((latest.vol / volAvg5).toFixed(2))
      : null;

  const priorHigh = highestClose(filtered, 20, 1);
  const breakout = priorHigh != null && close > priorHigh;
  const trendUp = close > ma20 && ma5 != null && ma5 > ma20;
  const volumeOk = volumeRatio != null && volumeRatio >= 1.2;

  const { dif, dea } = macd([...closes].reverse());
  const difLatest = dif[dif.length - 1];
  const deaLatest = dea[dea.length - 1];
  const difPrev = dif[dif.length - 2];
  const deaPrev = dea[dea.length - 2];
  const macdGolden = difPrev <= deaPrev && difLatest > deaLatest;

  const strength = diamond?.strength ?? null;

  const checklist: MomentumChecklistItem[] = [
    {
      id: 'trend',
      label: '趋势多头（收盘 > MA20，MA5 > MA20）',
      passed: trendUp,
      detail: ma5 != null ? `收盘 ${close.toFixed(2)} / MA20 ${ma20.toFixed(2)}` : undefined,
    },
    {
      id: 'volume',
      label: '量能配合（≥ 1.2× 5 日均量）',
      passed: volumeOk,
      detail: volumeRatio != null ? `${volumeRatio}x` : undefined,
    },
    {
      id: 'breakout',
      label: '突破或强势结构（近 20 日新高）',
      passed: breakout,
    },
    {
      id: 'macd',
      label: 'MACD 金叉或红钻确认',
      passed: macdGolden || strength === 'red',
    },
    {
      id: 'diamond',
      label: '红钻信号（动量启动）',
      passed: strength === 'red',
      detail: strength === 'blue' ? '当前为蓝钻，偏温和' : undefined,
    },
    {
      id: 'risk',
      label: '止损位已设定（成本 -8%）',
      passed: true,
      detail: `建议止损 ${(close * (1 - MOMENTUM_STOP_LOSS_PCT)).toFixed(2)}`,
    },
  ];

  const checklistScore = checklist.filter((c) => c.passed).length;

  let action: MomentumAnalysis['action'] = 'wait';
  if (close < ma20) {
    action = 'sell';
  } else if (strength === 'red' && checklistScore >= MOMENTUM_MIN_CHECKLIST) {
    action = 'buy';
  } else if (trendUp && (strength === 'blue' || strength === 'red')) {
    action = 'hold';
  }

  const entryMemo = [
    `【动量】${name}(${symbol})`,
    trendUp ? '趋势向上' : '趋势待确认',
    strength === 'red' ? '红钻启动' : strength === 'blue' ? '蓝钻关注' : '暂无钻石信号',
    breakout ? '突破20日高' : '',
    `止损 ${(close * (1 - MOMENTUM_STOP_LOSS_PCT)).toFixed(2)}（-8%）`,
    `移动止盈参考 ${calcTrailingStopPrice(Math.max(...closes.slice(0, 60))).toFixed(2)}（自高点 -12%）`,
  ]
    .filter(Boolean)
    .join(' · ');

  const highWaterMark = Math.max(...closes.slice(0, 60));

  return {
    close,
    ma5,
    ma20,
    trendUp,
    volumeRatio,
    breakout,
    checklist,
    checklistScore,
    action,
    stopLossPrice: Number((close * (1 - MOMENTUM_STOP_LOSS_PCT)).toFixed(2)),
    highWaterMark: Number(highWaterMark.toFixed(2)),
    trailingStopPrice: calcTrailingStopPrice(highWaterMark),
    entryMemo,
    diamondStrength: strength,
  };
}

export function evaluateMomentumExit(input: {
  avgCost: number;
  close: number;
  ma20: number | null;
  highWaterMark: number | null;
  diamondStrength: 'red' | 'blue' | null;
}): { reason: string } | null {
  const { avgCost, close, ma20, highWaterMark, diamondStrength } = input;

  if (avgCost > 0) {
    const lossPct = (close - avgCost) / avgCost;
    if (lossPct <= -MOMENTUM_STOP_LOSS_PCT) {
      return { reason: `硬止损（${(lossPct * 100).toFixed(1)}%）` };
    }
  }

  if (ma20 != null && close < ma20) {
    return { reason: '跌破 MA20' };
  }

  if (highWaterMark != null && highWaterMark > 0) {
    const drawdown = (highWaterMark - close) / highWaterMark;
    if (drawdown >= MOMENTUM_TRAILING_STOP_PCT && close > avgCost) {
      return { reason: `移动止盈（自高点回撤 ${(drawdown * 100).toFixed(1)}%）` };
    }
  }

  if (diamondStrength !== 'red' && diamondStrength !== 'blue') {
    return { reason: '动量信号消失' };
  }

  if (diamondStrength === 'blue') {
    return { reason: '仅余蓝钻，动量减弱' };
  }

  return null;
}

export function calcStopLoss(entryPrice: number): number {
  return Number((entryPrice * (1 - MOMENTUM_STOP_LOSS_PCT)).toFixed(2));
}

export function calcTrailingStopPrice(highWaterMark: number): number {
  if (!Number.isFinite(highWaterMark) || highWaterMark <= 0) return 0;
  return Number((highWaterMark * (1 - MOMENTUM_TRAILING_STOP_PCT)).toFixed(2));
}

import { sma, type OhlcvBar } from '../market/indicators.js';

export type EtfTailPickStatus = 'passed' | 'near_pass' | 'failed';

export type EtfRuleCheck = {
  id: string;
  label: string;
  passed: boolean;
  message: string;
};

export type EtfOperationPlan = {
  action: 'buy_zone' | 'wait_pullback' | 'watch_only' | 'avoid';
  actionLabel: string;
  buyPrice: number;
  buyZoneLow: number;
  buyZoneHigh: number;
  stopPrice: number;
  takeProfitPrice: number;
  riskPct: number;
  rewardPct: number;
  positionHint: string;
  note: string;
};

export type EtfTailPickCandidate = {
  symbol: string;
  exchangeCode: string;
  name: string;
  price: number;
  changePct: number;
  volumeRatio: number;
  dailyTurnover: number;
  rsi: number;
  ma5: number;
  ma20: number;
  ma30: number;
  stopPrice: number;
  distToStop: number;
  ruleChecks: EtfRuleCheck[];
  failCount: number;
  status: EtfTailPickStatus;
  operationPlan: EtfOperationPlan;
};

export type EtfMetricsInput = {
  symbol: string;
  exchangeCode: string;
  name: string;
  price: number;
  changePct: number;
  dailyTurnover: number;
  intradayVolume: number | null;
  bars: OhlcvBar[];
};

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function firstNumber(value: number | null | undefined, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function calcRsi(closesLatestFirst: number[], period = 14): number {
  if (closesLatestFirst.length < period + 1) return 50;

  const closes = closesLatestFirst.slice(0, period + 1).reverse();
  let gains = 0;
  let losses = 0;

  for (let i = 1; i < closes.length; i += 1) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  if (losses === 0) return 100;
  const rs = gains / losses;
  return round(100 - 100 / (1 + rs));
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function calcVolumeRatio(input: {
  latestVolume: number | null;
  bars: OhlcvBar[];
}): number {
  const latestVolume =
    input.latestVolume && input.latestVolume > 0
      ? input.latestVolume
      : firstNumber(input.bars[0]?.vol, 0);
  const base = avg(
    input.bars
      .slice(1, 21)
      .map((bar) => bar.vol)
      .filter((value): value is number => value != null && value > 0),
  );

  if (!latestVolume || !base) return 0;
  return round(latestVolume / base);
}

function calcTechnicalStop(bars: OhlcvBar[], ma30: number): number {
  const lows = bars
    .slice(0, 20)
    .map((bar) => bar.low)
    .filter((value): value is number => value != null && value > 0);
  const low20 = lows.length > 0 ? Math.min(...lows) : 0;
  const maStop = ma30 > 0 ? ma30 * 0.97 : 0;
  const stop = Math.max(low20, maStop);
  return round(stop, 4);
}

function makeCheck(
  id: string,
  label: string,
  passed: boolean,
  failMsg: string,
): EtfRuleCheck {
  return {
    id,
    label,
    passed,
    message: passed ? '通过' : failMsg,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function buildOperationPlan(input: {
  price: number;
  changePct: number;
  ma5: number;
  ma20: number;
  stopPrice: number;
  failCount: number;
}): EtfOperationPlan {
  const isPassed = input.failCount === 0;
  const isNearPass = input.failCount <= 2;
  const pullbackAnchor = Math.max(input.ma5, input.ma20);
  const buyPrice = isPassed
    ? input.price
    : pullbackAnchor > 0
      ? Math.min(input.price, pullbackAnchor)
      : input.price;
  const buyZoneLow = round(buyPrice * 0.995, 4);
  const buyZoneHigh = round(buyPrice * 1.005, 4);
  const riskPct =
    input.stopPrice > 0 ? round(((buyPrice - input.stopPrice) / buyPrice) * 100) : 0;
  const targetPct = clamp(Math.max(riskPct * 2, 6), 6, 15);
  const takeProfitPrice = round(buyPrice * (1 + targetPct / 100), 4);

  if (isPassed) {
    return {
      action: input.changePct > 1.5 ? 'wait_pullback' : 'buy_zone',
      actionLabel: input.changePct > 1.5 ? '等回踩' : '可关注买入区',
      buyPrice: round(buyPrice, 4),
      buyZoneLow,
      buyZoneHigh,
      stopPrice: input.stopPrice,
      takeProfitPrice,
      riskPct: round(Math.max(riskPct, 0)),
      rewardPct: round(targetPct),
      positionHint: input.changePct > 1.5 ? '不追高，回落到买入区再看' : '轻仓试探，确认后再加',
      note: '严格通过 8 条筛选；操作位仅生成待确认计划，不自动交易。',
    };
  }

  if (isNearPass) {
    return {
      action: 'watch_only',
      actionLabel: '观察，不当推荐',
      buyPrice: round(buyPrice, 4),
      buyZoneLow,
      buyZoneHigh,
      stopPrice: input.stopPrice,
      takeProfitPrice,
      riskPct: round(Math.max(riskPct, 0)),
      rewardPct: round(targetPct),
      positionHint: '仅近通过，缺口补齐后再考虑',
      note: '近通过只作为观察池，不能替代严格推荐。',
    };
  }

  return {
    action: 'avoid',
    actionLabel: '跳过',
    buyPrice: round(buyPrice, 4),
    buyZoneLow,
    buyZoneHigh,
    stopPrice: input.stopPrice,
    takeProfitPrice,
    riskPct: round(Math.max(riskPct, 0)),
    rewardPct: round(targetPct),
    positionHint: '规则缺口较多，等待重新入池',
    note: '未通过严格筛选，不生成买入建议。',
  };
}

export function buildEtfTailPickCandidate(
  input: EtfMetricsInput,
): EtfTailPickCandidate {
  const closes = input.bars
    .map((bar) => bar.close)
    .filter((value): value is number => value != null && value > 0);
  const ma5 = firstNumber(sma(closes, 5));
  const ma20 = firstNumber(sma(closes, 20));
  const ma30 = firstNumber(sma(closes, 30));
  const rsi = calcRsi(closes);
  const volumeRatio = calcVolumeRatio({
    latestVolume: input.intradayVolume,
    bars: input.bars,
  });
  const stopPrice = calcTechnicalStop(input.bars, ma30);
  const distToStop =
    stopPrice > 0 ? round(((input.price - stopPrice) / stopPrice) * 100) : -100;

  const ruleChecks: EtfRuleCheck[] = [
    makeCheck('R1_价格', '价格 < 100', input.price < 100, '价格 ≥ 100'),
    makeCheck('R2_止损', '距止损 > -10%', distToStop > -10, '距止损 ≤ -10%'),
    makeCheck('R3_RSI', '30 < RSI < 70', rsi > 30 && rsi < 70, 'RSI 极端'),
    makeCheck('R4_金叉', 'MA5 > MA20', ma5 > ma20, 'MA5 < MA20'),
    makeCheck('R5_量比', '量比 ≥ 0.8', volumeRatio >= 0.8, '量比 < 0.8'),
    makeCheck(
      'R6_涨跌',
      '-3% < 涨跌幅 < 2%',
      input.changePct > -3 && input.changePct < 2,
      '涨跌幅超阈值',
    ),
    makeCheck('R7_趋势', '价格 > MA30', input.price > ma30, '30日线下'),
    makeCheck(
      'R8_流动',
      '日成交 > 5亿',
      input.dailyTurnover > 5e8,
      '日成交 < 5亿',
    ),
  ];
  const failCount = ruleChecks.filter((rule) => !rule.passed).length;
  const operationPlan = buildOperationPlan({
    price: input.price,
    changePct: input.changePct,
    ma5,
    ma20,
    stopPrice,
    failCount,
  });

  return {
    symbol: input.symbol,
    exchangeCode: input.exchangeCode,
    name: input.name,
    price: round(input.price, 4),
    changePct: round(input.changePct),
    volumeRatio,
    dailyTurnover: Math.round(input.dailyTurnover),
    rsi,
    ma5: round(ma5, 4),
    ma20: round(ma20, 4),
    ma30: round(ma30, 4),
    stopPrice,
    distToStop,
    ruleChecks,
    failCount,
    status: failCount === 0 ? 'passed' : failCount <= 2 ? 'near_pass' : 'failed',
    operationPlan,
  };
}

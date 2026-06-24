import { sma, type OhlcvBar } from '../market/indicators.js';

export type EtfTailPickStatus = 'passed' | 'near_pass' | 'failed';

export type EtfRuleCheck = {
  id: string;
  label: string;
  passed: boolean;
  message: string;
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
  };
}

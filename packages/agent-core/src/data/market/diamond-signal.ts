import { getDailyQuote } from './services.js';
import {
  avgVolume,
  highestClose,
  macd,
  sma,
  type OhlcvBar,
} from './indicators.js';

export type DiamondStrength = 'red' | 'blue';

export type DiamondSignalResult = {
  symbol: string;
  name: string;
  tradeDate: string;
  close: number;
  strength: DiamondStrength;
  score: number;
  reasons: string[];
  ma5: number | null;
  ma20: number | null;
  volumeRatio: number | null;
  macdGoldenCross: boolean;
  breakout: boolean;
};

function barsFromQuote(quotes: OhlcvBar[]): OhlcvBar[] {
  return quotes.filter((q) => q.close != null);
}

/** 在「最新在前」K 线中找到 asOfDate 当日或之前最近一根 */
export function findBarIndexForAsOfDate(
  bars: OhlcvBar[],
  asOfDate: string,
): number {
  const target = asOfDate.replace(/-/g, '');
  let bestIndex = -1;
  let bestTradeDate = '';

  for (let i = 0; i < bars.length; i++) {
    const tradeDate = bars[i].tradeDate.replace(/-/g, '');
    if (tradeDate <= target && tradeDate > bestTradeDate) {
      bestTradeDate = tradeDate;
      bestIndex = i;
    }
  }

  return bestIndex;
}

export function detectDiamondSignalAtDate(
  symbol: string,
  name: string,
  bars: OhlcvBar[],
  asOfDate: string,
): DiamondSignalResult | null {
  const index = findBarIndexForAsOfDate(bars, asOfDate);
  if (index < 0) return null;
  return detectDiamondSignal(symbol, name, bars.slice(index));
}

/**
 * 钻石信号（无未来函数）：基于已收盘 K 线
 * 红钻：趋势 + 放量 + MACD 金叉 + 突破
 * 蓝钻：趋势 + 温和放量 + MACD 柱转正
 */
export function detectDiamondSignal(
  symbol: string,
  name: string,
  bars: OhlcvBar[],
): DiamondSignalResult | null {
  if (bars.length < 30) return null;

  const latest = bars[0];
  const close = latest.close;
  if (close == null) return null;

  const closes = bars.map((b) => b.close).filter((c): c is number => c != null);
  const ma5 = sma(closes, 5);
  const ma20 = sma(closes, 20);
  if (ma5 == null || ma20 == null) return null;

  const volAvg5 = avgVolume(bars, 5);
  const latestVol = latest.vol;
  const volumeRatio =
    volAvg5 && latestVol ? Number((latestVol / volAvg5).toFixed(2)) : null;

  const { dif, dea, hist } = macd([...closes].reverse());
  const difLatest = dif[dif.length - 1];
  const deaLatest = dea[dea.length - 1];
  const difPrev = dif[dif.length - 2];
  const deaPrev = dea[dea.length - 2];
  const histLatest = hist[hist.length - 1];
  const histPrev = hist[hist.length - 2];

  const macdGoldenCross =
    difPrev <= deaPrev && difLatest > deaLatest;
  const macdHistTurningPositive = histPrev <= 0 && histLatest > 0;

  const priorHigh = highestClose(bars, 20, 1);
  const breakout = priorHigh != null && close > priorHigh;

  const trendUp = close > ma20 && ma5 > ma20;
  const volumeStrong = volumeRatio != null && volumeRatio >= 1.5;
  const volumeMild = volumeRatio != null && volumeRatio >= 1.2;

  const reasons: string[] = [];
  let score = 0;

  if (trendUp) {
    reasons.push('收盘价站上 MA20，短期均线多头');
    score += 25;
  }
  if (volumeStrong) {
    reasons.push(`成交量放大 ${volumeRatio}x（5 日均量）`);
    score += 25;
  } else if (volumeMild) {
    reasons.push(`成交量温和放大 ${volumeRatio}x`);
    score += 12;
  }
  if (macdGoldenCross) {
    reasons.push('MACD 金叉');
    score += 25;
  } else if (macdHistTurningPositive) {
    reasons.push('MACD 柱由负转正');
    score += 12;
  }
  if (breakout) {
    reasons.push('突破近 20 日高点');
    score += 25;
  }

  const isRed =
    trendUp && volumeStrong && macdGoldenCross && breakout && score >= 75;
  const isBlue =
    !isRed && trendUp && volumeMild && (macdGoldenCross || macdHistTurningPositive) && score >= 45;

  if (!isRed && !isBlue) return null;

  return {
    symbol,
    name,
    tradeDate: latest.tradeDate,
    close,
    strength: isRed ? 'red' : 'blue',
    score,
    reasons,
    ma5,
    ma20,
    volumeRatio,
    macdGoldenCross,
    breakout,
  };
}

export async function scanDiamondSignal(
  symbol: string,
  name: string,
  klineDays = 60,
): Promise<DiamondSignalResult | null> {
  const data = await getDailyQuote(symbol, klineDays);
  return detectDiamondSignal(symbol, name, barsFromQuote(data.quotes));
}

/** asOfDate 为空则检测最新；否则检测该历史交易日是否触发钻石信号 */
export async function scanDiamondSignalAtDate(
  symbol: string,
  name: string,
  asOfDate?: string,
  klineDays = 90,
): Promise<DiamondSignalResult | null> {
  const data = await getDailyQuote(symbol, klineDays);
  const bars = barsFromQuote(data.quotes);
  if (!asOfDate) {
    return detectDiamondSignal(symbol, name, bars);
  }
  return detectDiamondSignalAtDate(symbol, name, bars, asOfDate);
}

/** 扫描近 lookback 根 K 线上的历史钻石信号（最新在前） */
export function scanDiamondSignalHistory(
  symbol: string,
  name: string,
  bars: OhlcvBar[],
  lookback = 120,
): DiamondSignalResult[] {
  const found: DiamondSignalResult[] = [];
  const limit = Math.min(bars.length, lookback);

  for (let i = 0; i < limit; i++) {
    if (bars.length - i < 30) break;
    const slice = bars.slice(i);
    const signal = detectDiamondSignal(symbol, name, slice);
    const bar = slice[0];
    if (!signal || !bar?.tradeDate || bar.close == null) continue;
    if (signal.tradeDate.replace(/-/g, '') !== bar.tradeDate.replace(/-/g, '')) {
      continue;
    }

    const prev = found[found.length - 1];
    if (prev && prev.tradeDate === bar.tradeDate) continue;

    found.push(signal);
  }

  return found;
}

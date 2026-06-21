import { highestClose, sma, type OhlcvBar } from '../market/indicators.js';
import { getDailyQuote } from '../market/services.js';
import type { ScreeningCandidateDiamond } from '../screening/diamond-scan.js';

/** 面向 2 个月及以上持有：重 MA60/120 与中期涨幅，轻短线噪声 */
export type FactorOutlook = 'long-bullish' | 'long-watch' | 'neutral' | 'weak';

export type FactorCheck = {
  id: string;
  label: string;
  passed: boolean;
  points: number;
  detail?: string;
};

export type CandidateFactorScore = {
  total: number;
  /** 2 月+ 趋势因子（主） */
  longTermScore: number;
  /** 结构健康：不极端追高、回撤可控 */
  stabilityScore: number;
  outlook: FactorOutlook;
  outlookLabel: string;
  factors: FactorCheck[];
  ret20dPct: number | null;
  ret60dPct: number | null;
  ret120dPct: number | null;
};

const OUTLOOK_LABEL: Record<FactorOutlook, string> = {
  'long-bullish': '长线趋势',
  'long-watch': '长线观察',
  neutral: '中性观望',
  weak: '因子偏弱',
};

function barsFromQuote(quotes: OhlcvBar[]): OhlcvBar[] {
  return quotes.filter((b) => b.close != null);
}

function pctBetween(bars: OhlcvBar[], days: number): number | null {
  if (bars.length <= days) return null;
  const latest = bars[0].close;
  const base = bars[days].close;
  if (latest == null || base == null || base === 0) return null;
  return Number((((latest - base) / base) * 100).toFixed(2));
}

function maSlopeUp(bars: OhlcvBar[], period: number, shift = 20): boolean {
  const closes = bars.map((b) => b.close).filter((c): c is number => c != null);
  if (closes.length < period + shift) return false;
  const maNow = sma(closes, period);
  const maPrev = sma(closes.slice(shift), period);
  return maNow != null && maPrev != null && maNow > maPrev;
}

function drawdownFromHigh(bars: OhlcvBar[], days: number): number | null {
  const high = highestClose(bars, days, 0);
  const close = bars[0]?.close;
  if (high == null || close == null || high === 0) return null;
  return Number((((high - close) / high) * 100).toFixed(2));
}

/** 长线因子打分（约 2–6 个月视角，规则非预测） */
export function scoreCandidateFactors(
  bars: OhlcvBar[],
  diamond?: ScreeningCandidateDiamond | null,
): CandidateFactorScore | null {
  const filtered = barsFromQuote(bars);
  if (filtered.length < 65) return null;

  const close = filtered[0].close!;
  const closes = filtered.map((b) => b.close!).filter(Boolean);
  const ma20 = sma(closes, 20);
  const ma60 = sma(closes, 60);
  const ma120 = sma(closes, 120);
  if (ma60 == null) return null;

  const ret20dPct = pctBetween(filtered, 20);
  const ret60dPct = pctBetween(filtered, 60);
  const ret120dPct = pctBetween(filtered, 120);
  const dd60d = drawdownFromHigh(filtered, 60);

  const maLongBull =
    ma20 != null &&
    ma120 != null &&
    close > ma60 &&
    ma20 > ma60 &&
    ma60 > ma120;
  const maMidBull = ma20 != null && close > ma60 && ma20 > ma60;
  const aboveMa60 = close > ma60;

  const ret60Healthy =
    ret60dPct != null && ret60dPct > 0 && ret60dPct < 80;
  const ret120Positive = ret120dPct != null && ret120dPct > 0;
  const notExtremeChase =
    ret20dPct == null || (ret20dPct > -5 && ret20dPct < 35);
  const pullbackOk = dd60d == null || dd60d <= 18;

  const factors: FactorCheck[] = [
    {
      id: 'above-ma60',
      label: '收盘站上 MA60',
      passed: aboveMa60,
      points: 16,
      detail: `MA60 ${ma60.toFixed(2)}`,
    },
    {
      id: 'ma-mid-bull',
      label: 'MA20>MA60 中期多头',
      passed: maMidBull,
      points: 14,
    },
    {
      id: 'ma-long-bull',
      label: 'MA60>MA120 长期多头',
      passed: maLongBull,
      points: 18,
    },
    {
      id: 'ma60-slope',
      label: 'MA60 上行（约 1 月）',
      passed: maSlopeUp(filtered, 60, 20),
      points: 14,
    },
    {
      id: 'ret60',
      label: '60 日涨幅为正且未过热',
      passed: ret60Healthy,
      points: 16,
      detail: ret60dPct != null ? `${ret60dPct}%` : undefined,
    },
    {
      id: 'ret120',
      label: '120 日趋势为正',
      passed: ret120Positive,
      points: 14,
      detail: ret120dPct != null ? `${ret120dPct}%` : undefined,
    },
    {
      id: 'pullback',
      label: '距 60 日高点回撤≤18%',
      passed: pullbackOk,
      points: 12,
      detail: dd60d != null ? `回撤 ${dd60d}%` : undefined,
    },
    {
      id: 'not-chase',
      label: '近 20 日未极端拉升',
      passed: notExtremeChase,
      points: 10,
      detail: ret20dPct != null ? `20日 ${ret20dPct}%` : undefined,
    },
    {
      id: 'diamond-red',
      label: '红钻（趋势加速，非必需）',
      passed: diamond?.strength === 'red',
      points: 6,
    },
    {
      id: 'diamond-blue',
      label: '蓝钻（温和，非必需）',
      passed: diamond?.strength === 'blue',
      points: 3,
    },
  ];

  const longIds = new Set([
    'above-ma60',
    'ma-mid-bull',
    'ma-long-bull',
    'ma60-slope',
    'ret60',
    'ret120',
    'diamond-red',
    'diamond-blue',
  ]);
  const stabilityIds = new Set(['pullback', 'not-chase']);

  let longRaw = 0;
  let longMax = 0;
  let stabilityRaw = 0;
  let stabilityMax = 0;

  for (const factor of factors) {
    if (longIds.has(factor.id)) longMax += factor.points;
    if (stabilityIds.has(factor.id)) stabilityMax += factor.points;
    if (!factor.passed) continue;
    if (longIds.has(factor.id)) longRaw += factor.points;
    if (stabilityIds.has(factor.id)) stabilityRaw += factor.points;
  }

  const longTermScore =
    longMax > 0 ? Math.round((longRaw / longMax) * 100) : 0;
  const stabilityScore =
    stabilityMax > 0 ? Math.round((stabilityRaw / stabilityMax) * 100) : 0;
  const total = Math.round(longTermScore * 0.82 + stabilityScore * 0.18);

  let outlook: FactorOutlook = 'neutral';
  if (total < 42) {
    outlook = 'weak';
  } else if (longTermScore >= 58 && aboveMa60 && ret60Healthy) {
    outlook = 'long-bullish';
  } else if (longTermScore >= 48 && aboveMa60) {
    outlook = 'long-watch';
  }

  return {
    total,
    longTermScore,
    stabilityScore,
    outlook,
    outlookLabel: OUTLOOK_LABEL[outlook],
    factors: factors.filter((f) => f.passed),
    ret20dPct,
    ret60dPct,
    ret120dPct,
  };
}

export async function scoreAndRankCandidates<
  T extends {
    symbol: string;
    name: string;
    diamond?: ScreeningCandidateDiamond | null;
  },
>(input: {
  candidates: T[];
  limit: number;
  minTotal?: number;
}): Promise<{
  candidates: Array<T & { factorScore: CandidateFactorScore }>;
  dropped: number;
}> {
  const minTotal = input.minTotal ?? 48;
  const scored: Array<T & { factorScore: CandidateFactorScore }> = [];

  for (const candidate of input.candidates) {
    try {
      const data = await getDailyQuote(candidate.symbol, 180);
      const factorScore = scoreCandidateFactors(
        barsFromQuote(data.quotes),
        candidate.diamond,
      );
      if (!factorScore) continue;
      scored.push({ ...candidate, factorScore });
    } catch {
      // 单票跳过
    }
  }

  scored.sort((a, b) => b.factorScore.total - a.factorScore.total);

  const filtered =
    scored.length > input.limit
      ? scored.filter((c) => c.factorScore.total >= minTotal)
      : scored;
  const pool = filtered.length >= Math.min(3, input.limit) ? filtered : scored;
  const top = pool.slice(0, input.limit);

  return {
    candidates: top,
    dropped: input.candidates.length - top.length,
  };
}

export function formatFactorThesis(
  factorScore: CandidateFactorScore,
): string {
  const hits = factorScore.factors
    .slice(0, 3)
    .map((f) => f.label)
    .join('、');
  return [
    `长线因子 ${factorScore.total} 分（趋势 ${factorScore.longTermScore}）`,
    factorScore.outlookLabel,
    hits,
    factorScore.ret60dPct != null ? `60日 ${factorScore.ret60dPct}%` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

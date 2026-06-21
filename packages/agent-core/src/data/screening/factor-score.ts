import {
  avgVolume,
  highestClose,
  macd,
  sma,
  type OhlcvBar,
} from '../market/indicators.js';
import { getDailyQuote } from '../market/services.js';
import type { ScreeningCandidateDiamond } from '../screening/diamond-scan.js';

export type FactorOutlook = 'short-bullish' | 'trend-bullish' | 'neutral' | 'weak';

export type FactorCheck = {
  id: string;
  label: string;
  passed: boolean;
  points: number;
  detail?: string;
};

export type CandidateFactorScore = {
  total: number;
  shortTermScore: number;
  trendScore: number;
  outlook: FactorOutlook;
  outlookLabel: string;
  factors: FactorCheck[];
  ret1dPct: number | null;
  ret5dPct: number | null;
  ret20dPct: number | null;
};

const OUTLOOK_LABEL: Record<FactorOutlook, string> = {
  'short-bullish': '隔日看涨',
  'trend-bullish': '趋势看涨',
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

function countConsecutiveUpDays(bars: OhlcvBar[], max = 5): number {
  let count = 0;
  for (let i = 0; i < Math.min(bars.length - 1, max); i++) {
    const cur = bars[i].close;
    const prev = bars[i + 1].close;
    if (cur == null || prev == null || cur <= prev) break;
    count += 1;
  }
  return count;
}

function ma20SlopeUp(bars: OhlcvBar[]): boolean {
  const closes = bars.map((b) => b.close).filter((c): c is number => c != null);
  const maNow = sma(closes, 20);
  const maPrev = sma(closes.slice(5), 20);
  return maNow != null && maPrev != null && maNow > maPrev;
}

/** 基于 K 线因子：隔日动量 + 中期趋势（非预测模型，为规则打分） */
export function scoreCandidateFactors(
  bars: OhlcvBar[],
  diamond?: ScreeningCandidateDiamond | null,
): CandidateFactorScore | null {
  const filtered = barsFromQuote(bars);
  if (filtered.length < 30) return null;

  const latest = filtered[0];
  const close = latest.close!;
  const closes = filtered.map((b) => b.close!).filter(Boolean);
  const ma5 = sma(closes, 5);
  const ma20 = sma(closes, 20);
  const ma60 = sma(closes, 60);
  if (ma20 == null) return null;

  const ret1dPct = pctBetween(filtered, 1);
  const ret5dPct = pctBetween(filtered, 5);
  const ret20dPct = pctBetween(filtered, 20);

  const volAvg5 = avgVolume(filtered, 5);
  const volumeRatio =
    volAvg5 && latest.vol
      ? Number((latest.vol / volAvg5).toFixed(2))
      : null;

  const { dif, dea, hist } = macd([...closes].reverse());
  const difLatest = dif[dif.length - 1];
  const deaLatest = dea[dea.length - 1];
  const difPrev = dif[dif.length - 2];
  const deaPrev = dea[dea.length - 2];
  const histLatest = hist[hist.length - 1];
  const macdGolden = difPrev <= deaPrev && difLatest > deaLatest;
  const macdHistPositive = histLatest > 0;

  const priorHigh = highestClose(filtered, 20, 1);
  const nearBreakout =
    priorHigh != null && close >= priorHigh * 0.97 && close <= priorHigh * 1.02;
  const breakout = priorHigh != null && close > priorHigh;

  const maBullSimple = ma5 != null && close > ma5 && ma5 > ma20;
  const upDays = countConsecutiveUpDays(filtered);
  const notChasingLimit = ret1dPct == null || ret1dPct < 7;

  const factors: FactorCheck[] = [
    {
      id: 'ma-trend',
      label: '均线多头（收盘>MA5>MA20）',
      passed: maBullSimple,
      points: 12,
      detail: ma5 != null ? `${close.toFixed(2)} / MA20 ${ma20.toFixed(2)}` : undefined,
    },
    {
      id: 'ma-long',
      label: '中长期多头（MA20>MA60）',
      passed: ma60 != null && ma20 > ma60 && close > ma20,
      points: 14,
    },
    {
      id: 'ma20-slope',
      label: 'MA20 上行',
      passed: ma20SlopeUp(filtered),
      points: 10,
    },
    {
      id: 'macd',
      label: 'MACD 金叉或柱线为正',
      passed: macdGolden || macdHistPositive,
      points: 12,
      detail: macdGolden ? '金叉' : macdHistPositive ? '柱>0' : undefined,
    },
    {
      id: 'volume',
      label: '量能配合（≥1.2×5日均量）',
      passed: volumeRatio != null && volumeRatio >= 1.2,
      points: 10,
      detail: volumeRatio != null ? `${volumeRatio}x` : undefined,
    },
    {
      id: 'momentum-5d',
      label: '5日涨幅为正且未过热',
      passed: ret5dPct != null && ret5dPct > 0 && ret5dPct < 25,
      points: 12,
      detail: ret5dPct != null ? `${ret5dPct}%` : undefined,
    },
    {
      id: 'not-chase',
      label: '今日涨幅<7%（避免追高）',
      passed: notChasingLimit,
      points: 8,
      detail: ret1dPct != null ? `${ret1dPct}%` : undefined,
    },
    {
      id: 'up-streak',
      label: '近3日至少2阳',
      passed: upDays >= 2,
      points: 8,
      detail: `连涨 ${upDays} 天`,
    },
    {
      id: 'breakout',
      label: '突破或贴近20日新高',
      passed: breakout || nearBreakout,
      points: 10,
    },
    {
      id: 'ret20d',
      label: '20日趋势为正',
      passed: ret20dPct != null && ret20dPct > 0,
      points: 10,
      detail: ret20dPct != null ? `${ret20dPct}%` : undefined,
    },
    {
      id: 'diamond-red',
      label: '红钻动量确认',
      passed: diamond?.strength === 'red',
      points: 12,
    },
    {
      id: 'diamond-blue',
      label: '蓝钻温和信号',
      passed: diamond?.strength === 'blue',
      points: 6,
    },
  ];

  let shortTermScore = 0;
  let trendScore = 0;
  let shortMax = 0;
  let trendMax = 0;

  const shortIds = new Set([
    'macd',
    'volume',
    'momentum-5d',
    'not-chase',
    'up-streak',
    'breakout',
    'diamond-red',
    'diamond-blue',
  ]);
  const trendIds = new Set([
    'ma-trend',
    'ma-long',
    'ma20-slope',
    'ret20d',
    'breakout',
    'diamond-red',
  ]);

  for (const factor of factors) {
    if (shortIds.has(factor.id)) shortMax += factor.points;
    if (trendIds.has(factor.id)) trendMax += factor.points;
    if (!factor.passed) continue;
    if (shortIds.has(factor.id)) shortTermScore += factor.points;
    if (trendIds.has(factor.id)) trendScore += factor.points;
  }

  const shortNorm = shortMax > 0 ? Math.round((shortTermScore / shortMax) * 100) : 0;
  const trendNorm = trendMax > 0 ? Math.round((trendScore / trendMax) * 100) : 0;
  const total = Math.round(shortNorm * 0.45 + trendNorm * 0.55);

  let outlook: FactorOutlook = 'neutral';
  if (total < 45) {
    outlook = 'weak';
  } else if (trendNorm >= 58 && shortNorm >= 50) {
    outlook = 'trend-bullish';
  } else if (shortNorm >= 55 && trendNorm >= 40) {
    outlook = 'short-bullish';
  } else if (trendNorm >= 55) {
    outlook = 'trend-bullish';
  } else if (shortNorm >= 50) {
    outlook = 'short-bullish';
  }

  return {
    total,
    shortTermScore: shortNorm,
    trendScore: trendNorm,
    outlook,
    outlookLabel: OUTLOOK_LABEL[outlook],
    factors: factors.filter((f) => f.passed),
    ret1dPct,
    ret5dPct,
    ret20dPct,
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
  const minTotal = input.minTotal ?? 42;
  const scored: Array<T & { factorScore: CandidateFactorScore }> = [];

  for (const candidate of input.candidates) {
    try {
      const data = await getDailyQuote(candidate.symbol, 90);
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
    .slice(0, 4)
    .map((f) => f.label)
    .join('、');
  return [
    `因子 ${factorScore.total} 分（隔日 ${factorScore.shortTermScore} / 趋势 ${factorScore.trendScore}）`,
    factorScore.outlookLabel,
    hits,
    factorScore.ret5dPct != null ? `5日 ${factorScore.ret5dPct}%` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

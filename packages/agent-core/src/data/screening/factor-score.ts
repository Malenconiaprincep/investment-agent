import { highestClose, sma, type OhlcvBar } from '../market/indicators.js';
import { getDailyQuote } from '../market/services.js';
import type { ScreeningCandidateDiamond } from '../screening/diamond-scan.js';

/** 主线 + 2 月+ 趋势性收益 */
export type FactorOutlook = 'mainline-trend' | 'long-watch' | 'neutral' | 'weak';

export type FactorCheck = {
  id: string;
  label: string;
  passed: boolean;
  points: number;
  detail?: string;
};

export type CandidateFactorScore = {
  total: number;
  /** 主线契合（热点主题/强势板块） */
  themeScore: number;
  /** K 线中期趋势 */
  longTermScore: number;
  /** 趋势性收益（60/120 日涨幅质量） */
  trendReturnScore: number;
  /** 结构健康 */
  stabilityScore: number;
  outlook: FactorOutlook;
  outlookLabel: string;
  matchedTheme: string | null;
  factors: FactorCheck[];
  ret20dPct: number | null;
  ret60dPct: number | null;
  ret120dPct: number | null;
};

export type MainlineScoreContext = {
  hotThemes?: string[];
  sectorNames?: string[];
  industry?: string | null;
  name?: string;
  thesis?: string;
};

const OUTLOOK_LABEL: Record<FactorOutlook, string> = {
  'mainline-trend': '主线趋势',
  'long-watch': '趋势观察',
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

function themeKeywords(themes: string[], sectors: string[]): string[] {
  const raw = [...themes, ...sectors];
  const keywords: string[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    const cleaned = item
      .replace(/概念|板块|行业|相关|主题/g, '')
      .trim()
      .slice(0, 16);
    if (cleaned.length < 2 || seen.has(cleaned)) continue;
    seen.add(cleaned);
    keywords.push(cleaned);
  }

  return keywords;
}

function scoreMainlineAlignment(
  context: MainlineScoreContext,
): { score: number; matched: string | null; checks: FactorCheck[] } {
  const keywords = themeKeywords(
    context.hotThemes ?? [],
    context.sectorNames ?? [],
  );
  const haystack = [
    context.name ?? '',
    context.industry ?? '',
    context.thesis ?? '',
  ]
    .join(' ')
    .toLowerCase();

  let matched: string | null = null;
  let matchCount = 0;

  for (const keyword of keywords) {
    if (keyword.length < 2) continue;
    if (haystack.includes(keyword.toLowerCase())) {
      matchCount += 1;
      matched ??= keyword;
    }
  }

  const sectorHit = (context.sectorNames ?? []).some((sector) =>
    haystack.includes(sector.replace(/概念|板块/g, '').toLowerCase()),
  );
  const leaderHint = /龙头|主线|人气|核心/.test(context.thesis ?? '');

  const checks: FactorCheck[] = [
    {
      id: 'theme-match',
      label: '契合当前热点主线',
      passed: matchCount > 0,
      points: 20,
      detail: matched ?? undefined,
    },
    {
      id: 'sector-match',
      label: '归属强势板块',
      passed: sectorHit,
      points: 14,
    },
    {
      id: 'leader-hint',
      label: '主线龙头/核心标的',
      passed: leaderHint,
      points: 10,
    },
  ];

  let raw = 0;
  let max = 0;
  for (const check of checks) {
    max += check.points;
    if (check.passed) raw += check.points;
  }

  const score = max > 0 ? Math.round((raw / max) * 100) : 0;
  return { score, matched, checks };
}

function scoreTrendReturn(ret60: number | null, ret120: number | null): {
  score: number;
  checks: FactorCheck[];
} {
  const ret60Strong = ret60 != null && ret60 >= 8;
  const ret60Positive = ret60 != null && ret60 > 0;
  const ret120Positive = ret120 != null && ret120 > 0;
  const ret120Strong = ret120 != null && ret120 >= 15;

  const checks: FactorCheck[] = [
    {
      id: 'ret60-strong',
      label: '60 日趋势性收益≥8%',
      passed: ret60Strong,
      points: 16,
      detail: ret60 != null ? `${ret60}%` : undefined,
    },
    {
      id: 'ret60-pos',
      label: '60 日收益为正',
      passed: ret60Positive,
      points: 10,
      detail: ret60 != null ? `${ret60}%` : undefined,
    },
    {
      id: 'ret120-strong',
      label: '120 日趋势性收益≥15%',
      passed: ret120Strong,
      points: 14,
      detail: ret120 != null ? `${ret120}%` : undefined,
    },
    {
      id: 'ret120-pos',
      label: '120 日收益为正',
      passed: ret120Positive,
      points: 8,
      detail: ret120 != null ? `${ret120}%` : undefined,
    },
  ];

  let raw = 0;
  let max = 0;
  for (const check of checks) {
    max += check.points;
    if (check.passed) raw += check.points;
  }

  return {
    score: max > 0 ? Math.round((raw / max) * 100) : 0,
    checks,
  };
}

/** 主线 + 趋势性收益因子（约 2–6 个月视角） */
export function scoreCandidateFactors(
  bars: OhlcvBar[],
  diamond?: ScreeningCandidateDiamond | null,
  context: MainlineScoreContext = {},
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
  const notExtremeChase =
    ret20dPct == null || (ret20dPct > -5 && ret20dPct < 35);
  const pullbackOk = dd60d == null || dd60d <= 18;

  const mainline = scoreMainlineAlignment(context);
  const trendReturn = scoreTrendReturn(ret60dPct, ret120dPct);

  const trendChecks: FactorCheck[] = [
    {
      id: 'above-ma60',
      label: '收盘站上 MA60',
      passed: aboveMa60,
      points: 14,
      detail: `MA60 ${ma60.toFixed(2)}`,
    },
    {
      id: 'ma-mid-bull',
      label: 'MA20>MA60 中期多头',
      passed: maMidBull,
      points: 12,
    },
    {
      id: 'ma-long-bull',
      label: 'MA60>MA120 长期多头',
      passed: maLongBull,
      points: 16,
    },
    {
      id: 'ma60-slope',
      label: 'MA60 上行',
      passed: maSlopeUp(filtered, 60, 20),
      points: 12,
    },
    {
      id: 'pullback',
      label: '距 60 日高点回撤≤18%',
      passed: pullbackOk,
      points: 10,
      detail: dd60d != null ? `回撤 ${dd60d}%` : undefined,
    },
    {
      id: 'not-chase',
      label: '近 20 日未极端拉升',
      passed: notExtremeChase,
      points: 8,
      detail: ret20dPct != null ? `20日 ${ret20dPct}%` : undefined,
    },
    {
      id: 'diamond-red',
      label: '红钻趋势加速',
      passed: diamond?.strength === 'red',
      points: 6,
    },
    {
      id: 'diamond-blue',
      label: '蓝钻温和趋势',
      passed: diamond?.strength === 'blue',
      points: 3,
    },
  ];

  let longRaw = 0;
  let longMax = 0;
  let stabilityRaw = 0;
  let stabilityMax = 0;

  for (const factor of trendChecks) {
    if (factor.id === 'pullback' || factor.id === 'not-chase') {
      stabilityMax += factor.points;
      if (factor.passed) stabilityRaw += factor.points;
    } else {
      longMax += factor.points;
      if (factor.passed) longRaw += factor.points;
    }
  }

  const longTermScore =
    longMax > 0 ? Math.round((longRaw / longMax) * 100) : 0;
  const stabilityScore =
    stabilityMax > 0 ? Math.round((stabilityRaw / stabilityMax) * 100) : 0;
  const themeScore = mainline.score;
  const trendReturnScore = trendReturn.score;

  const total = Math.round(
    themeScore * 0.28 +
      trendReturnScore * 0.22 +
      longTermScore * 0.38 +
      stabilityScore * 0.12,
  );

  let outlook: FactorOutlook = 'neutral';
  if (total < 42) {
    outlook = 'weak';
  } else if (
    themeScore >= 40 &&
    longTermScore >= 52 &&
    trendReturnScore >= 45 &&
    aboveMa60 &&
    ret60Healthy
  ) {
    outlook = 'mainline-trend';
  } else if (longTermScore >= 48 && aboveMa60) {
    outlook = 'long-watch';
  }

  const allFactors = [
    ...mainline.checks,
    ...trendReturn.checks,
    ...trendChecks,
  ].filter((f) => f.passed);

  return {
    total,
    themeScore,
    longTermScore,
    trendReturnScore,
    stabilityScore,
    outlook,
    outlookLabel: OUTLOOK_LABEL[outlook],
    matchedTheme: mainline.matched,
    factors: allFactors,
    ret20dPct,
    ret60dPct,
    ret120dPct,
  };
}

export async function scoreAndRankCandidates<
  T extends {
    symbol: string;
    name: string;
    industry?: string | null;
    thesis?: string;
    diamond?: ScreeningCandidateDiamond | null;
  },
>(input: {
  candidates: T[];
  limit: number;
  minTotal?: number;
  hotThemes?: string[];
  sectorNames?: string[];
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
        {
          hotThemes: input.hotThemes,
          sectorNames: input.sectorNames,
          industry: candidate.industry,
          name: candidate.name,
          thesis: candidate.thesis,
        },
      );
      if (!factorScore) continue;
      scored.push({ ...candidate, factorScore });
    } catch {
      // 单票跳过
    }
  }

  scored.sort((a, b) => {
    const totalDiff = b.factorScore.total - a.factorScore.total;
    if (totalDiff !== 0) return totalDiff;
    return b.factorScore.themeScore - a.factorScore.themeScore;
  });

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
    `主线因子 ${factorScore.total} 分`,
    factorScore.outlookLabel,
    factorScore.matchedTheme ? `主线:${factorScore.matchedTheme}` : '',
    hits,
    factorScore.ret60dPct != null ? `60日 ${factorScore.ret60dPct}%` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

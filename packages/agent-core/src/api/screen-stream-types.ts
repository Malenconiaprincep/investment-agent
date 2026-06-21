export type ScreeningCandidateDiamond = {
  strength: 'red' | 'blue';
  score: number;
  tradeDate: string;
  close: number;
  reasons: string[];
};

export type ScreeningCandidateFactor = {
  total: number;
  shortTermScore: number;
  trendScore: number;
  outlook: 'short-bullish' | 'trend-bullish' | 'neutral' | 'weak';
  outlookLabel: string;
  ret1dPct: number | null;
  ret5dPct: number | null;
  ret20dPct: number | null;
};

export type ScreeningStreamCandidate = {
  symbol: string;
  name: string;
  thesis: string;
  dataSource: string;
  diamond?: ScreeningCandidateDiamond | null;
  factorScore?: ScreeningCandidateFactor | null;
};

export type ScreenStreamEvent =
  | { type: 'step'; step: string; label: string }
  | { type: 'token'; text: string }
  | {
      type: 'hotNews';
      query: string;
      mode: 'auto' | 'manual';
      hotThemes: string[];
      hotNews: Array<{ title: string; datetime: string; url: string | null }>;
    }
  | {
      type: 'sectors';
      sectors: Array<{ name: string; reason: string; dataSource: string }>;
    }
  | {
      type: 'candidates';
      candidates: ScreeningStreamCandidate[];
      diamondPicks: ScreeningStreamCandidate[];
    }
  | {
      type: 'done';
      query: string;
      sectors: Array<{ name: string; reason: string; dataSource: string }>;
      candidates: ScreeningStreamCandidate[];
      diamondPicks: ScreeningStreamCandidate[];
      rotationSummary: string;
      hotNews: Array<{ title: string; datetime: string; url: string | null }>;
      hotThemes: string[];
      mode: 'auto' | 'manual';
      passed: boolean;
      missingSections: string[];
      missingKeywords: string[];
      screenedAt: string;
      elapsedMs: number;
      sessionId: string;
      asOfDate?: string;
      fetchErrors: string[];
    }
  | { type: 'error'; message: string };

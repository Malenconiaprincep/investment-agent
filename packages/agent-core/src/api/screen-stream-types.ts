export type ScreeningCandidateFactor = {
  total: number;
  themeScore: number;
  longTermScore: number;
  trendReturnScore: number;
  stabilityScore: number;
  outlook: 'mainline-trend' | 'long-watch' | 'neutral' | 'weak';
  outlookLabel: string;
  matchedTheme: string | null;
  ret20dPct: number | null;
  ret60dPct: number | null;
  ret120dPct: number | null;
};

export type ScreeningCandidateDiamond = {
  strength: 'red' | 'blue';
  score: number;
  tradeDate: string;
  close: number;
  reasons: string[];
};

export type ScreeningStreamCandidate = {
  symbol: string;
  name: string;
  thesis: string;
  dataSource: string;
  diamond?: ScreeningCandidateDiamond | null;
  factorScore?: ScreeningCandidateFactor | null;
};

export type TailEntryStockPickView = {
  symbol: string;
  name: string;
  pctChg: number;
  netInflowWan: number;
  tier: 'first' | 'second' | 'speculative';
  tierLabel: string;
  logic: string;
  riskNote?: string;
};

export type TailEntryOutlookView = {
  tradeDate: string;
  nextTradeDate: string;
  generatedAt: string;
  hotThemes: string[];
  sectorPicks: Array<{
    boardCode: string;
    name: string;
    pctChg: number;
    netInflowYi: number;
    priority: 'high' | 'medium' | 'low' | 'avoid';
    priorityStars: number;
    logic: string;
    leaders: TailEntryStockPickView[];
  }>;
  topInflowStocks: TailEntryStockPickView[];
  plans: Array<{
    id: 'conservative' | 'aggressive' | 'speculative';
    label: string;
    sectors: string[];
    symbols: string[];
    note: string;
  }>;
  watchSignals: string[];
  avoidSectors: Array<{ name: string; reason: string }>;
  dataSource: 'eastmoney' | 'iwencai';
};

export type TailEntryRunView = {
  status: 'success' | 'failed' | 'skipped' | 'empty';
  message: string;
  sectorCount: number;
  stockCount: number;
  nextTradeDate?: string;
  ranAt: string;
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
  | { type: 'tailEntryOutlook'; outlook: TailEntryOutlookView }
  | { type: 'tailEntryRun'; run: TailEntryRunView }
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
      tailEntryOutlook?: TailEntryOutlookView | null;
      tailEntryRun?: TailEntryRunView | null;
    }
  | { type: 'error'; message: string };

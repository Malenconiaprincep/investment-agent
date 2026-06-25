export type BacktestAssetType = 'stock' | 'etf';

export type BacktestStrategy =
  | 'red-diamond'
  | 'red-diamond-momentum'
  | 'etf-tail-rules'
  | 'etf-momentum-rotation';

export type BacktestSignal = {
  symbol: string;
  name: string;
  assetType: BacktestAssetType;
  strategy: BacktestStrategy;
  tradeDate: string;
  entryPrice: number;
  score?: number | null;
  metadata?: Record<string, unknown>;
};

export type BacktestExitReason =
  | 'fixed_hold'
  | 'benchmark_fill'
  | 'stop_loss'
  | 'take_profit'
  | 'ma20_break'
  | 'trailing_stop'
  | 'signal_lost'
  | 'signal_weakened'
  | 'max_hold'
  | 'end_of_data';

export type BacktestTrade = {
  symbol: string;
  name: string;
  assetType: BacktestAssetType;
  strategy: BacktestStrategy;
  entryDate: string;
  entryPrice: number;
  exitDate: string | null;
  exitPrice: number | null;
  holdDays: number;
  returnPct: number | null;
  exitReason: BacktestExitReason;
  signal: BacktestSignal;
};

export type BacktestMetrics = {
  tradeCount: number;
  validTradeCount: number;
  winRatePct: number | null;
  avgReturnPct: number | null;
  medianReturnPct: number | null;
  bestReturnPct: number | null;
  worstReturnPct: number | null;
  avgHoldDays: number | null;
  profitLossRatio: number | null;
};

export type BacktestGroup = BacktestMetrics & {
  key: string;
  label: string;
};

export type BacktestEquityPoint = {
  tradeDate: string;
  equity: number;
  returnPct: number;
  closedTrades: number;
};

export type BacktestBenchmark = {
  symbol: string;
  name: string;
  curve: BacktestEquityPoint[];
  finalReturnPct: number | null;
};

export type BacktestSymbolSummary = BacktestMetrics & {
  symbol: string;
  name: string;
  assetType: BacktestAssetType;
};

export type BacktestCurrentDecision = {
  symbol: string;
  name: string;
  assetType: BacktestAssetType;
  action: 'buy' | 'sell' | 'watch' | 'wait_pullback';
  actionLabel: string;
  price: number;
  changePct: number;
  failCount: number;
  passedRules: number;
  failedRules: string[];
  reason: string;
  dataSource: 'realtime' | 'daily';
  newsLabel?: '利好' | '利空' | '中性' | '无相关';
  newsNet?: number;
  newsHeadlines?: string[];
};

export type BacktestRunConfig = {
  entryMaxFailCount?: number;
  exitMaxFailCount?: number;
  maxConcurrentPositions?: number;
  noSymbolOverlap?: boolean;
  newsFilter?: 'off' | 'avoid_bearish' | 'require_bullish';
  newsLookbackDays?: number;
  rawSignalCount?: number;
  newsBlockedCount?: number;
  portfolioSkippedCount?: number;
  momentumDays?: number;
  rebalanceDays?: number;
  topN?: number;
  trendMaDays?: number;
  commissionRate?: number;
  slippageRate?: number;
  volTargetPct?: number;
  minVolExposure?: number;
  maxVolExposure?: number;
  bearRegimeMaxExposure?: number;
  weakRegimeMaxExposure?: number;
  bullBenchmarkSlotMomentumPct?: number;
  bullBenchmarkSlotCount?: number;
  stopLossPct?: number;
  stopCooldownDays?: number;
};

export type BacktestRunResult = {
  strategy: BacktestStrategy;
  generatedAt: string;
  requestedDays: number;
  startDate?: string;
  endDate?: string;
  holdDays: number[];
  symbols: Array<{
    symbol: string;
    name: string;
    assetType: BacktestAssetType;
    error?: string;
  }>;
  trades: BacktestTrade[];
  metrics: BacktestMetrics;
  groups: BacktestGroup[];
  equityCurve?: BacktestEquityPoint[];
  benchmark?: BacktestBenchmark;
  symbolSummaries?: BacktestSymbolSummary[];
  currentDecisions?: BacktestCurrentDecision[];
  config?: BacktestRunConfig;
  notes: string[];
};

export type BacktestAssetType = 'stock' | 'etf';

export type BacktestStrategy =
  | 'red-diamond'
  | 'red-diamond-momentum'
  | 'etf-tail-rules'
  | 'etf-momentum-rotation'
  | 'etf-stable-v2';

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
  maxDrawdownPct?: number | null;
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

export type BacktestPositionSnapshot = {
  symbol: string;
  name: string;
  assetType: BacktestAssetType;
  entryDate: string;
  entryPrice: number;
  shares: number;
  costAmount: number;
  marketValue: number;
  weightPct: number;
  returnPct: number | null;
  exitDate?: string | null;
};

export type BacktestPortfolioSnapshot = {
  tradeDate: string;
  cash: number;
  investedMarketValue: number;
  totalValue: number;
  returnPct: number;
  closedTrades: number;
  tPlusTrades?: Array<{
    symbol: string;
    name: string;
    buyPrice: number;
    sellPrice: number;
    shares: number;
    spent: number;
    proceeds: number;
    profit: number;
    profitPct: number | null;
  }>;
  positions: BacktestPositionSnapshot[];
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
  stockSignalVersion?: 'diamond-v1' | 'diamond-v2';
  entryMaxFailCount?: number;
  exitMaxFailCount?: number;
  maxConcurrentPositions?: number;
  noSymbolOverlap?: boolean;
  newsFilter?: 'off' | 'avoid_bearish' | 'require_bullish';
  newsLookbackDays?: number;
  rawSignalCount?: number;
  newsBlockedCount?: number;
  stockMarketFilter?: 'off' | 'avoid_bearish' | 'require_bullish';
  minBenchmarkMomentum20Pct?: number;
  defensiveBenchmarkMomentum20Pct?: number;
  marketBlockedCount?: number;
  qualityBlockedCount?: number;
  excludeRiskyStockNames?: boolean;
  minEntryPrice?: number;
  minAvgTurnoverAmount?: number;
  minSignalVolumeRatio?: number;
  maxNextOpenGapPct?: number | null;
  rankEntryCandidates?: boolean;
  signalQualityBlockedCount?: number;
  nextOpenGapBlockedCount?: number;
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
  cashFallbackInWeakRegime?: boolean;
  exitOnTrendBreak?: boolean;
  tPlusEnabled?: boolean;
  tPlusBuyDipPct?: number;
  tPlusMinProfitPct?: number;
  tPlusBudgetPct?: number;
  tPlusMaxTradesPerDay?: number;
  tPlusTradeCount?: number;
  tPlusTotalProfitPct?: number | null;
  netRebalance?: boolean;
  stopLossPct?: number;
  stopCooldownDays?: number;
  maxPerTheme?: number | null;
  strategyVersion?: string;
  signalExecution?: 'same_close' | 'next_open';
  momentumWindows?: number[];
  targetPortfolioVolPct?: number;
  maxTacticalWeightPct?: number;
  drawdownGuardPct?: number[];
  minimumCommission?: number;
  rebalanceDriftPct?: number;
  stockUniverse?: 'manual' | 'retail-stock';
  stockUniverseCount?: number;
  initialCapital?: number;
  takeProfitPct?: number;
  stockEntryDelayTradingDays?: number;
  stockEntryExecution?: 'confirmation_close' | 'next_open';
  entryExecutionSkippedCount?: number;
  delayedEntrySkippedCount?: number;
  minDelayedEntryDriftPct?: number;
  maxDelayedEntryDriftPct?: number;
  delayedEntryDriftFilterMaxBenchmarkMomentum20Pct?: number;
  delayedEntryDriftBlockedCount?: number;
  maxEntryMa20ExtensionPct?: number;
  entryMa20ExtensionBlockedCount?: number;
  maxEntryChecklistScore?: number;
  entryChecklistBlockedCount?: number;
  weakMomentumNoEntryMinBenchmarkMomentum20Pct?: number;
  weakMomentumNoEntryMaxBenchmarkMomentum20Pct?: number;
  weakMomentumNoEntryBlockedCount?: number;
  enrichedRiskNameBlockedCount?: number;
  momentumMaxHoldDays?: number;
  weakMomentumMaxHoldDays?: number;
  weakMomentumMaxHoldBenchmarkMomentum20Pct?: number;
  benchmarkTradeDays?: number;
  stockIdleDays?: number;
  stockIdleDayPct?: number | null;
  longestStockIdleDays?: number;
  longestStockIdleStartDate?: string;
  longestStockIdleEndDate?: string;
};

export type BacktestRunResult = {
  runId?: string;
  persistedAt?: string;
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
  portfolioSnapshots?: BacktestPortfolioSnapshot[];
  benchmark?: BacktestBenchmark;
  symbolSummaries?: BacktestSymbolSummary[];
  currentDecisions?: BacktestCurrentDecision[];
  config?: BacktestRunConfig;
  notes: string[];
};

export const PAPER_BUCKETS = [
  'etf',
  'etf-evergreen',
  'etf-t-plus',
  'stock',
  'stock-backtest',
  'stock-backtest-news',
] as const;

export type PaperBucket = (typeof PAPER_BUCKETS)[number];

export const BUCKET_LABELS: Record<PaperBucket, string> = {
  etf: 'ETF 仓',
  'etf-evergreen': '长青一号（V3影子）',
  'etf-t-plus': 'ETF 正T仓',
  stock: '股票仓',
  'stock-backtest': '股票仓（回测策略）',
  'stock-backtest-news': '股票仓（回测策略+新闻）',
};

/** 各分仓初始资金独立统计 */
export const BUCKET_INITIAL_CASH: Record<PaperBucket, number> = {
  etf: 100_000,
  'etf-evergreen': 100_000,
  'etf-t-plus': 100_000,
  stock: 100_000,
  'stock-backtest': 100_000,
  'stock-backtest-news': 100_000,
};

export const BUCKET_MAX_POSITIONS: Record<PaperBucket, number> = {
  etf: 4,
  'etf-evergreen': 4,
  'etf-t-plus': 4,
  stock: 5,
  'stock-backtest': 5,
  'stock-backtest-news': 5,
};

export const STOCK_BACKTEST_BUCKETS = [
  'stock-backtest',
  'stock-backtest-news',
] as const;

export type StockBacktestPaperBucket = (typeof STOCK_BACKTEST_BUCKETS)[number];

export function isStockBacktestPaperBucket(
  bucket: PaperBucket,
): bucket is StockBacktestPaperBucket {
  return bucket === 'stock-backtest' || bucket === 'stock-backtest-news';
}

/** 股票仓单票预算占比；ETF 仓按 TopN 等权，在 pipeline 里计算 */
export const STOCK_POSITION_BUDGET_PCT = 0.15;

export const ETF_MOMENTUM_TOP_N = 4;
/** Stable V2 uses a monthly-like cadence to reduce turnover and execution drag. */
export const ETF_MOMENTUM_REBALANCE_DAYS = 20;
export const ETF_MOMENTUM_STOP_LOSS_PCT = -12;
export const ETF_MOMENTUM_STOP_COOLDOWN_DAYS = 10;
export const ETF_T_PLUS_BUCKET = 'etf-t-plus' as const;
export const ETF_EVERGREEN_BUCKET = 'etf-evergreen' as const;
export const ETF_T_PLUS_BUY_DIP_PCT = 1.5;
export const ETF_T_PLUS_MIN_PROFIT_PCT = 0.6;
export const ETF_T_PLUS_BUDGET_PCT = 0.2;
export const ETF_T_PLUS_MAX_TRADES_PER_DAY = 2;

export function isEtfPaperBucket(bucket: PaperBucket): boolean {
  return bucket === 'etf' || bucket === ETF_EVERGREEN_BUCKET || bucket === ETF_T_PLUS_BUCKET;
}

export function parsePaperBucket(value: string | null | undefined): PaperBucket | null {
  if (
    value === 'etf' ||
    value === ETF_EVERGREEN_BUCKET ||
    value === ETF_T_PLUS_BUCKET ||
    value === 'stock' ||
    value === 'stock-backtest' ||
    value === 'stock-backtest-news'
  ) {
    return value;
  }
  return null;
}

export function resolvePaperBucket(value: string | null | undefined): PaperBucket {
  return parsePaperBucket(value) ?? 'stock';
}

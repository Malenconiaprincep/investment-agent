export const PAPER_BUCKETS = [
  'etf',
  'stock',
  'stock-backtest',
  'stock-backtest-news',
] as const;

export type PaperBucket = (typeof PAPER_BUCKETS)[number];

export const BUCKET_LABELS: Record<PaperBucket, string> = {
  etf: 'ETF 仓',
  stock: '股票仓',
  'stock-backtest': '股票仓（回测策略）',
  'stock-backtest-news': '股票仓（回测策略+新闻）',
};

/** 各分仓初始资金独立统计 */
export const BUCKET_INITIAL_CASH: Record<PaperBucket, number> = {
  etf: 100_000,
  stock: 100_000,
  'stock-backtest': 100_000,
  'stock-backtest-news': 100_000,
};

export const BUCKET_MAX_POSITIONS: Record<PaperBucket, number> = {
  etf: 4,
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
export const ETF_MOMENTUM_REBALANCE_DAYS = 10;
export const ETF_MOMENTUM_STOP_LOSS_PCT = -12;
export const ETF_MOMENTUM_STOP_COOLDOWN_DAYS = 10;

export function parsePaperBucket(value: string | null | undefined): PaperBucket | null {
  if (
    value === 'etf' ||
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

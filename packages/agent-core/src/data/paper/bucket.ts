export const PAPER_BUCKETS = ['etf', 'stock'] as const;

export type PaperBucket = (typeof PAPER_BUCKETS)[number];

export const BUCKET_LABELS: Record<PaperBucket, string> = {
  etf: 'ETF 仓',
  stock: '股票仓',
};

/** 双分仓初始资金：各 5 万，合计 10 万 */
export const BUCKET_INITIAL_CASH: Record<PaperBucket, number> = {
  etf: 50_000,
  stock: 50_000,
};

export const BUCKET_MAX_POSITIONS: Record<PaperBucket, number> = {
  etf: 4,
  stock: 5,
};

/** 股票仓单票预算占比；ETF 仓按 TopN 等权，在 pipeline 里计算 */
export const STOCK_POSITION_BUDGET_PCT = 0.15;

export const ETF_MOMENTUM_TOP_N = 4;
export const ETF_MOMENTUM_REBALANCE_DAYS = 10;
export const ETF_MOMENTUM_STOP_LOSS_PCT = -12;
export const ETF_MOMENTUM_STOP_COOLDOWN_DAYS = 10;

export function parsePaperBucket(value: string | null | undefined): PaperBucket | null {
  if (value === 'etf' || value === 'stock') return value;
  return null;
}

export function resolvePaperBucket(value: string | null | undefined): PaperBucket {
  return parsePaperBucket(value) ?? 'stock';
}

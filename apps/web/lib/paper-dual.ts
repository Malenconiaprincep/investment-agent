export type PaperBucketKey =
  | 'etf'
  | 'etf-t-plus'
  | 'stock'
  | 'stock-backtest'
  | 'stock-backtest-news';

export type BucketSummary = {
  bucket: PaperBucketKey;
  account: { cash: number; initialCash: number };
  totalValue: number;
  marketValue: number;
  returnPct: number;
  tradeDate: string;
  isTradingSession: boolean;
  lastRebalanceDate?: string | null;
  nextRebalanceDate?: string;
  nextTradeDate?: string;
  rebalanceDays?: number;
  positions: Array<{
    symbol: string;
    name: string;
    shares: number;
    avgCost: number;
    availableShares: number;
    frozenShares: number;
    latestPrice: number | null;
    markPriceSource?: 'intraday' | 'daily' | null;
    settlementRule?: 't0' | 't1' | 't2';
    marketValue: number | null;
    pnlPct: number | null;
    stopLoss: number | null;
    highWaterMark: number | null;
    entryMemo: string | null;
  }>;
};

export type DualPaperPayload = {
  etf: BucketSummary;
  etfTPlus: BucketSummary;
  stock: BucketSummary;
  stockBacktest: BucketSummary;
  stockBacktestNews: BucketSummary;
  combined: {
    totalValue: number;
    initialCash: number;
    returnPct: number;
    tradeDate: string;
    isTradingSession: boolean;
  };
};

const EMPTY_BUCKET = (bucket: PaperBucketKey): BucketSummary => ({
  bucket,
  account: { cash: 100_000, initialCash: 100_000 },
  totalValue: 100_000,
  marketValue: 0,
  returnPct: 0,
  tradeDate: '',
  isTradingSession: false,
  positions: [],
});

function isPaperBucketKey(value: unknown): value is PaperBucketKey {
  return (
    value === 'etf' ||
    value === 'etf-t-plus' ||
    value === 'stock' ||
    value === 'stock-backtest' ||
    value === 'stock-backtest-news'
  );
}

function isDualPaperPayload(raw: Record<string, unknown>): raw is DualPaperPayload {
  return (
    raw.etf != null &&
    typeof raw.etf === 'object' &&
    (raw.etfTPlus == null || typeof raw.etfTPlus === 'object') &&
    raw.stock != null &&
    typeof raw.stock === 'object' &&
    raw.combined != null &&
    typeof raw.combined === 'object'
  );
}

function normalizePositions(raw: unknown): BucketSummary['positions'] {
  if (!Array.isArray(raw)) return [];
  return raw as BucketSummary['positions'];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeBucketSummary(
  raw: Record<string, unknown>,
  fallbackBucket: PaperBucketKey,
): BucketSummary {
  const accountRaw = raw.account;
  const account =
    accountRaw && typeof accountRaw === 'object'
      ? (accountRaw as { cash: number; initialCash: number })
      : { cash: 0, initialCash: 100_000 };

  const bucket = isPaperBucketKey(raw.bucket) ? raw.bucket : fallbackBucket;

  return {
    bucket,
    account,
    totalValue: Number(raw.totalValue ?? account.cash),
    marketValue: Number(raw.marketValue ?? 0),
    returnPct: Number(raw.returnPct ?? 0),
    tradeDate: String(raw.tradeDate ?? ''),
    isTradingSession: Boolean(raw.isTradingSession),
    lastRebalanceDate:
      raw.lastRebalanceDate == null ? null : optionalString(raw.lastRebalanceDate),
    nextRebalanceDate: optionalString(raw.nextRebalanceDate),
    nextTradeDate: optionalString(raw.nextTradeDate),
    rebalanceDays: optionalNumber(raw.rebalanceDays),
    positions: normalizePositions(raw.positions),
  };
}

function buildCombined(buckets: BucketSummary[]): DualPaperPayload['combined'] {
  const totalInitial = buckets.reduce((sum, item) => sum + item.account.initialCash, 0);
  const totalValue = buckets.reduce((sum, item) => sum + item.totalValue, 0);
  const tradeDate = buckets.find((item) => item.tradeDate)?.tradeDate ?? '';
  const isTradingSession = buckets.some((item) => item.isTradingSession);
  return {
    totalValue: Number(totalValue.toFixed(2)),
    initialCash: totalInitial,
    returnPct:
      totalInitial > 0
        ? Number((((totalValue - totalInitial) / totalInitial) * 100).toFixed(2))
        : 0,
    tradeDate,
    isTradingSession,
  };
}

/** 兼容旧版 agent-core 返回的单账户 / 双分仓结构 */
export function normalizeDualPaperPayload(raw: unknown): DualPaperPayload {
  if (!raw || typeof raw !== 'object') {
    throw new Error('无效的模拟账户数据');
  }

  const data = raw as Record<string, unknown>;
  if (isDualPaperPayload(data)) {
    const etf = normalizeBucketSummary(data.etf as Record<string, unknown>, 'etf');
    const etfTPlus = normalizeBucketSummary(
      (data.etfTPlus as Record<string, unknown> | undefined) ??
        EMPTY_BUCKET('etf-t-plus'),
      'etf-t-plus',
    );
    const stock = normalizeBucketSummary(data.stock as Record<string, unknown>, 'stock');
    const stockBacktest = normalizeBucketSummary(
      (data.stockBacktest as Record<string, unknown> | undefined) ??
        EMPTY_BUCKET('stock-backtest'),
      'stock-backtest',
    );
    const stockBacktestNews = normalizeBucketSummary(
      (data.stockBacktestNews as Record<string, unknown> | undefined) ??
        EMPTY_BUCKET('stock-backtest-news'),
      'stock-backtest-news',
    );
    const combinedRaw = data.combined as Record<string, unknown>;
    const buckets = [etf, etfTPlus, stock, stockBacktest, stockBacktestNews];
    return {
      etf,
      etfTPlus,
      stock,
      stockBacktest,
      stockBacktestNews,
      combined: {
        totalValue: Number(combinedRaw.totalValue ?? buildCombined(buckets).totalValue),
        initialCash: Number(combinedRaw.initialCash ?? buildCombined(buckets).initialCash),
        returnPct: Number(combinedRaw.returnPct ?? buildCombined(buckets).returnPct),
        tradeDate: String(combinedRaw.tradeDate ?? etf.tradeDate),
        isTradingSession: Boolean(
          combinedRaw.isTradingSession ?? etf.isTradingSession,
        ),
      },
    };
  }

  if (!data.account || typeof data.account !== 'object') {
    throw new Error('模拟账户数据格式异常，请重启 agent-core 服务');
  }

  const stock = normalizeBucketSummary(data, 'stock');
  const etf = EMPTY_BUCKET('etf');
  const etfTPlus = EMPTY_BUCKET('etf-t-plus');
  etf.tradeDate = stock.tradeDate;
  etf.isTradingSession = stock.isTradingSession;
  etfTPlus.tradeDate = stock.tradeDate;
  etfTPlus.isTradingSession = stock.isTradingSession;

  return {
    etf,
    etfTPlus,
    stock,
    stockBacktest: EMPTY_BUCKET('stock-backtest'),
    stockBacktestNews: EMPTY_BUCKET('stock-backtest-news'),
    combined: buildCombined([etf, etfTPlus, stock]),
  };
}

export const PAPER_BUCKET_TABS: Array<{
  key: PaperBucketKey;
  label: string;
}> = [
  { key: 'etf', label: 'ETF 仓' },
  { key: 'etf-t-plus', label: 'ETF 正T仓' },
  { key: 'stock', label: '股票仓' },
  { key: 'stock-backtest', label: '股票仓（回测策略）' },
  { key: 'stock-backtest-news', label: '股票仓（回测+新闻）' },
];

export function resolvePaperView(
  dual: DualPaperPayload,
  bucket: 'combined' | PaperBucketKey,
): Omit<BucketSummary, 'bucket'> & { bucket: 'combined' | PaperBucketKey } {
  if (bucket === 'combined') {
    return {
      bucket: 'combined',
      account: {
        cash:
          dual.etf.account.cash +
          dual.etfTPlus.account.cash +
          dual.stock.account.cash +
          dual.stockBacktest.account.cash +
          dual.stockBacktestNews.account.cash,
        initialCash: dual.combined.initialCash,
      },
      totalValue: dual.combined.totalValue,
      marketValue:
        dual.etf.marketValue +
        dual.etfTPlus.marketValue +
        dual.stock.marketValue +
        dual.stockBacktest.marketValue +
        dual.stockBacktestNews.marketValue,
      returnPct: dual.combined.returnPct,
      tradeDate: dual.combined.tradeDate,
      isTradingSession: dual.combined.isTradingSession,
      positions: [
        ...dual.etf.positions,
        ...dual.etfTPlus.positions,
        ...dual.stock.positions,
        ...dual.stockBacktest.positions,
        ...dual.stockBacktestNews.positions,
      ],
    };
  }

  if (bucket === 'stock-backtest') return dual.stockBacktest;
  if (bucket === 'stock-backtest-news') return dual.stockBacktestNews;
  if (bucket === 'etf-t-plus') return dual.etfTPlus;
  if (bucket === 'etf') return dual.etf;
  return dual.stock;
}

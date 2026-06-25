export type BucketSummary = {
  bucket: 'etf' | 'stock';
  account: { cash: number; initialCash: number };
  totalValue: number;
  marketValue: number;
  returnPct: number;
  tradeDate: string;
  isTradingSession: boolean;
  positions: Array<{
    symbol: string;
    name: string;
    shares: number;
    avgCost: number;
    availableShares: number;
    frozenShares: number;
    latestPrice: number | null;
    markPriceSource?: 'intraday' | 'daily' | null;
    settlementRule?: 't0' | 't1';
    marketValue: number | null;
    pnlPct: number | null;
    stopLoss: number | null;
    highWaterMark: number | null;
    entryMemo: string | null;
  }>;
};

export type DualPaperPayload = {
  etf: BucketSummary;
  stock: BucketSummary;
  combined: {
    totalValue: number;
    initialCash: number;
    returnPct: number;
    tradeDate: string;
    isTradingSession: boolean;
  };
};

function isDualPaperPayload(raw: Record<string, unknown>): raw is DualPaperPayload {
  return (
    raw.etf != null &&
    typeof raw.etf === 'object' &&
    raw.stock != null &&
    typeof raw.stock === 'object' &&
    raw.combined != null &&
    typeof raw.combined === 'object'
  );
}

function normalizePositions(
  raw: unknown,
): BucketSummary['positions'] {
  if (!Array.isArray(raw)) return [];
  return raw as BucketSummary['positions'];
}

function normalizeBucketSummary(
  raw: Record<string, unknown>,
  fallbackBucket: 'etf' | 'stock',
): BucketSummary {
  const accountRaw = raw.account;
  const account =
    accountRaw && typeof accountRaw === 'object'
      ? (accountRaw as { cash: number; initialCash: number })
      : { cash: 0, initialCash: fallbackBucket === 'etf' ? 50000 : 0 };

  return {
    bucket: raw.bucket === 'etf' ? 'etf' : 'stock',
    account,
    totalValue: Number(raw.totalValue ?? account.cash),
    marketValue: Number(raw.marketValue ?? 0),
    returnPct: Number(raw.returnPct ?? 0),
    tradeDate: String(raw.tradeDate ?? ''),
    isTradingSession: Boolean(raw.isTradingSession),
    positions: normalizePositions(raw.positions),
  };
}

/** 兼容旧版 agent-core 返回的单账户结构（整仓视为股票仓） */
export function normalizeDualPaperPayload(raw: unknown): DualPaperPayload {
  if (!raw || typeof raw !== 'object') {
    throw new Error('无效的模拟账户数据');
  }

  const data = raw as Record<string, unknown>;
  if (isDualPaperPayload(data)) {
    const etf = normalizeBucketSummary(
      data.etf as Record<string, unknown>,
      'etf',
    );
    const stock = normalizeBucketSummary(
      data.stock as Record<string, unknown>,
      'stock',
    );
    const combinedRaw = data.combined as Record<string, unknown>;
    return {
      etf,
      stock,
      combined: {
        totalValue: Number(
          combinedRaw.totalValue ?? etf.totalValue + stock.totalValue,
        ),
        initialCash: Number(
          combinedRaw.initialCash ??
            etf.account.initialCash + stock.account.initialCash,
        ),
        returnPct: Number(combinedRaw.returnPct ?? 0),
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

  const etf: BucketSummary = {
    bucket: 'etf',
    account: { cash: 50000, initialCash: 50000 },
    totalValue: 50000,
    marketValue: 0,
    returnPct: 0,
    tradeDate: stock.tradeDate,
    isTradingSession: stock.isTradingSession,
    positions: [],
  };

  return {
    etf,
    stock,
    combined: {
      totalValue: stock.totalValue,
      initialCash: stock.account.initialCash,
      returnPct: stock.returnPct,
      tradeDate: stock.tradeDate,
      isTradingSession: stock.isTradingSession,
    },
  };
}

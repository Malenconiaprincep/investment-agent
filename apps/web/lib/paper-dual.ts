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

/** 兼容旧版 agent-core 返回的单账户结构（整仓视为股票仓） */
export function normalizeDualPaperPayload(raw: unknown): DualPaperPayload {
  if (!raw || typeof raw !== 'object') {
    throw new Error('无效的模拟账户数据');
  }

  const data = raw as Record<string, unknown>;
  if (isDualPaperPayload(data)) {
    return data;
  }

  if (!data.account || typeof data.account !== 'object') {
    throw new Error('模拟账户数据格式异常，请重启 agent-core 服务');
  }

  const account = data.account as { cash: number; initialCash: number };
  const stock: BucketSummary = {
    bucket: 'stock',
    account,
    totalValue: Number(data.totalValue ?? account.cash),
    marketValue: Number(data.marketValue ?? 0),
    returnPct: Number(data.returnPct ?? 0),
    tradeDate: String(data.tradeDate ?? ''),
    isTradingSession: Boolean(data.isTradingSession),
    positions: Array.isArray(data.positions)
      ? (data.positions as BucketSummary['positions'])
      : [],
  };

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

'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { BacktestEquityChart } from '@/components/charts/BacktestEquityChart';
import { StockKlineChart } from '@/components/charts/StockKlineChart';
import type { TradeMarker } from '@/components/charts/KlineChart';
import { PageHeader } from '@/components/ui/PageHeader';

type Strategy = 'stock' | 'diamond' | 'diamond-momentum' | 'etf' | 'etf-momentum';
type StockUniverseMode = 'retail-stock' | 'manual';
type StockMarketFilter = 'require_bullish' | 'avoid_bearish' | 'off';
type EtfMomentumVariant = 'baseline' | 'weak-cash' | 'active-risk' | 't-plus';

type BacktestMetrics = {
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

type BacktestGroup = BacktestMetrics & {
  key: string;
  label: string;
};

type BacktestEquityPoint = {
  tradeDate: string;
  equity: number;
  returnPct: number;
  closedTrades: number;
};

type BacktestPositionSnapshot = {
  symbol: string;
  name: string;
  assetType: 'stock' | 'etf';
  entryDate: string;
  entryPrice: number;
  shares: number;
  costAmount: number;
  marketValue: number;
  weightPct: number;
  returnPct: number | null;
  exitDate?: string | null;
};

type BacktestPortfolioSnapshot = {
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

type PortfolioSnapshotMode = 'list' | 'calendar';

type PortfolioSnapshotAction = {
  action: 'buy' | 'sell' | 'rebalance';
  symbol: string;
  name: string;
  assetType: 'stock' | 'etf';
  price: number | null;
  shares: number | null;
  amount: number | null;
  returnPct?: number | null;
  reason?: string;
  buyPrice?: number | null;
  sellPrice?: number | null;
  buyShares?: number | null;
  sellShares?: number | null;
  buyAmount?: number | null;
  sellAmount?: number | null;
  netShares?: number | null;
  rebalanceDirection?: 'increase' | 'decrease' | 'roll';
};

type PortfolioSnapshotView = BacktestPortfolioSnapshot & {
  dateKey: string;
  dailyReturnPct: number | null;
  actions: PortfolioSnapshotAction[];
  buyCount: number;
  sellCount: number;
};

type PortfolioCalendarCell = {
  day: number;
  dateKey: string;
  snapshot?: PortfolioSnapshotView;
};

type PortfolioCalendarMonth = {
  key: string;
  label: string;
  blanks: number;
  cells: PortfolioCalendarCell[];
  tradeDays: number;
  upDays: number;
  downDays: number;
};

type BacktestBenchmark = {
  symbol: string;
  name: string;
  curve: BacktestEquityPoint[];
  finalReturnPct: number | null;
};

type BacktestSymbolSummary = BacktestMetrics & {
  symbol: string;
  name: string;
  assetType: 'stock' | 'etf';
};

type BacktestCurrentDecision = {
  symbol: string;
  name: string;
  assetType: 'stock' | 'etf';
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

type BacktestRunConfig = {
  entryMaxFailCount?: number;
  exitMaxFailCount?: number;
  maxConcurrentPositions?: number;
  noSymbolOverlap?: boolean;
  newsFilter?: 'off' | 'avoid_bearish' | 'require_bullish';
  newsLookbackDays?: number;
  stockMarketFilter?: StockMarketFilter;
  minBenchmarkMomentum20Pct?: number;
  defensiveBenchmarkMomentum20Pct?: number;
  rawSignalCount?: number;
  newsBlockedCount?: number;
  portfolioSkippedCount?: number;
  momentumDays?: number;
  rebalanceDays?: number;
  topN?: number;
  trendMaDays?: number;
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
  stopCooldownDays?: number;
  stockUniverse?: 'manual' | 'retail-stock';
  stockUniverseCount?: number;
  initialCapital?: number;
  benchmarkTradeDays?: number;
  stockIdleDays?: number;
  stockIdleDayPct?: number | null;
  longestStockIdleDays?: number;
  longestStockIdleStartDate?: string;
  longestStockIdleEndDate?: string;
};

type BacktestTrade = {
  symbol: string;
  name: string;
  assetType: 'stock' | 'etf';
  strategy: string;
  entryDate: string;
  entryPrice: number;
  exitDate: string | null;
  exitPrice: number | null;
  holdDays: number;
  returnPct: number | null;
  exitReason: string;
  signal?: {
    metadata?: {
      newsLabel?: string;
      newsNet?: number;
    };
  };
};

type BacktestResult = {
  strategy: string;
  generatedAt: string;
  requestedDays: number;
  startDate?: string;
  endDate?: string;
  holdDays: number[];
  symbols: Array<{
    symbol: string;
    name: string;
    assetType: 'stock' | 'etf';
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

type EtfBacktestComparison = {
  variant: EtfMomentumVariant;
  label: string;
  color: string;
  result: BacktestResult;
};

type BacktestProgress = {
  stage: string;
  message: string;
  detail?: string;
  percent: number;
  elapsedMs: number;
};

type BacktestStreamEvent =
  | ({ type: 'progress' } & BacktestProgress)
  | { type: 'result'; result: BacktestResult }
  | { type: 'error'; message: string };

type BacktestPanel = 'overview' | 'current' | 'etfs' | 'holdings' | 'trades' | 'notes';
type StockBacktestPanel = 'overview' | 'chart' | 'groups' | 'holdings' | 'trades' | 'notes';

const STRATEGIES: Array<{ value: Strategy; label: string; help: string }> = [
  {
    value: 'stock',
    label: '股票策略',
    help: '全市场 A 股前复权日线选动量启动信号；默认过滤 ST/8 元以下/低成交额，并在沪深300中期不强时要求 20 日动量 ≥3%。',
  },
  {
    value: 'etf-momentum',
    label: 'ETF 动量轮动',
    help: '每 10 个交易日选 20 日动量最强且站上 MA20 的前 4 只 ETF，并按市场状态调节宽基和熊市仓位。',
  },
];

const ETF_MOMENTUM_VARIANTS: Array<{
  value: EtfMomentumVariant;
  label: string;
  badge: string;
  help: string;
  color: string;
  cashFallbackInWeakRegime?: boolean;
  exitOnTrendBreak?: boolean;
  tPlusEnabled?: boolean;
}> = [
  {
    value: 'baseline',
    label: '基准轮动',
    badge: '默认',
    color: '#d4a017',
    help: 'Top4 / 20 日动量 / 10 日调仓，弱市仍用沪深300补足空槽。',
  },
  {
    value: 'weak-cash',
    label: '弱市现金',
    badge: '防守',
    color: '#5cb87a',
    help: '弱市里动量标的不够时保留现金，少追宽基反弹，回撤更克制。',
    cashFallbackInWeakRegime: true,
  },
  {
    value: 'active-risk',
    label: '主动风控',
    badge: '保险',
    color: '#e07070',
    help: '弱市现金 + 跌破趋势线提前退出，适合先看风险、不追求满仓进攻。',
    cashFallbackInWeakRegime: true,
    exitOnTrendBreak: true,
  },
  {
    value: 't-plus',
    label: '正T叠加',
    badge: '观察',
    color: '#9b8cff',
    help: '主轮动不变，持仓 ETF 日内急跌后反弹时模拟做一次成本优化。',
    tPlusEnabled: true,
  },
];

const STOCK_SYMBOL_PRESETS = [
  { label: '茅台 + 平安', value: '600519:贵州茅台,000001:平安银行' },
  { label: '宁德 + 工业富联', value: '300750:宁德时代,601138:工业富联' },
  { label: '沪深样例', value: '600519:贵州茅台,000001:平安银行,300750:宁德时代' },
] as const;

const BACKTEST_RANGE_PRESETS = [
  { label: '3 个月', days: 90 },
  { label: '6 个月', days: 180 },
  { label: '1 年', days: 365 },
  { label: '2 年', days: 730 },
] as const;

function todayIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addCalendarDaysIso(iso: string, deltaDays: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + deltaDays);
  const ny = date.getFullYear();
  const nm = String(date.getMonth() + 1).padStart(2, '0');
  const nd = String(date.getDate()).padStart(2, '0');
  return `${ny}-${nm}-${nd}`;
}

function rangeFromPresetDays(days: number): { startDate: string; endDate: string } {
  const endDate = todayIsoDate();
  return { startDate: addCalendarDaysIso(endDate, -days), endDate };
}

function presetDaysForRange(startDate: string, endDate: string): number | null {
  for (const preset of BACKTEST_RANGE_PRESETS) {
    const range = rangeFromPresetDays(preset.days);
    if (range.startDate === startDate && range.endDate === endDate) return preset.days;
  }
  return null;
}

function fmtPct(value: number | null) {
  if (value == null) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function fmtNumber(value: number | null, digits = 2) {
  if (value == null) return '—';
  return value.toFixed(digits);
}

function fmtMoney(value: number | null, digits = 0) {
  if (value == null) return '—';
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function fmtPrice(value: number | null) {
  if (value == null) return '—';
  return value.toFixed(value >= 10 ? 2 : 3);
}

function tradeDateKey(value: string | null | undefined) {
  return value?.replace(/\D/g, '').slice(0, 8) ?? '';
}

function fmtTradeDate(value: string | null) {
  const key = tradeDateKey(value);
  if (key.length !== 8) return '—';
  return `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
}

function fmtTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtElapsed(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${rest}s`;
}

function returnClass(value: number | null) {
  if (value == null) return 'muted';
  if (value > 0) return 'text-up';
  if (value < 0) return 'text-down';
  return 'muted';
}

function isEtfStrategy(value: Strategy): boolean {
  return value === 'etf' || value === 'etf-momentum';
}

function displayStrategyName(value: string) {
  const labels: Record<string, string> = {
    stock: '股票策略',
    diamond: '股票策略',
    'red-diamond': '股票策略',
    'diamond-momentum': '股票策略',
    'red-diamond-momentum': '股票策略',
    etf: 'ETF 尾盘规则',
    'etf-tail-rules': 'ETF 尾盘规则',
    'etf-momentum': 'ETF 动量轮动',
    'etf-momentum-rotation': 'ETF 动量轮动',
  };
  return labels[value] ?? value;
}

function displayStockMarketFilter(value: StockMarketFilter | undefined) {
  const labels: Record<StockMarketFilter, string> = {
    require_bullish: '强势确认',
    avoid_bearish: '仅避开弱熊',
    off: '关闭',
  };
  return value ? labels[value] : '—';
}

function fmtExitReason(value: string) {
  const labels: Record<string, string> = {
    fixed_hold: '固定持有',
    stop_loss: '止损',
    take_profit: '止盈',
    ma20_break: '跌破 MA20',
    trailing_stop: '移动止盈',
    signal_lost: '信号消失',
    signal_weakened: '信号减弱',
    max_hold: '达到持有上限',
    end_of_data: '回测结束',
  };
  return labels[value] ?? value;
}

function displayTradeName(trade: Pick<BacktestTrade, 'name' | 'symbol'>) {
  return trade.name && trade.name !== trade.symbol
    ? `${trade.name} (${trade.symbol})`
    : trade.symbol;
}

function displayHoldingName(position: Pick<BacktestPositionSnapshot, 'name' | 'symbol'>) {
  return position.name && position.name !== position.symbol ? position.name : position.symbol;
}

function sortTradesOldestFirst(trades: BacktestTrade[]) {
  return [...trades].sort((a, b) => {
    const byEntryDate = a.entryDate.localeCompare(b.entryDate);
    if (byEntryDate !== 0) return byEntryDate;
    const bySymbol = a.symbol.localeCompare(b.symbol);
    if (bySymbol !== 0) return bySymbol;
    const byExitDate = (a.exitDate ?? '').localeCompare(b.exitDate ?? '');
    if (byExitDate !== 0) return byExitDate;
    return a.holdDays - b.holdDays;
  });
}

function finalPortfolioSnapshot(result: BacktestResult): BacktestPortfolioSnapshot | undefined {
  return result.portfolioSnapshots?.at(-1);
}

function finalEquityReturnPct(result: BacktestResult): number | null {
  return result.equityCurve?.at(-1)?.returnPct ?? null;
}

function fmtMoneyDiff(value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${fmtMoney(value, digits)} 元`;
}

function positionSnapshotKey(position: Pick<BacktestPositionSnapshot, 'symbol' | 'entryDate' | 'entryPrice'>) {
  return `${position.symbol}-${tradeDateKey(position.entryDate)}-${position.entryPrice}`;
}

function aggregateSharesBySymbol(snapshot: BacktestPortfolioSnapshot | undefined) {
  const map = new Map<string, { symbol: string; name: string; shares: number }>();
  for (const position of snapshot?.positions ?? []) {
    const current = map.get(position.symbol);
    if (current) current.shares += position.shares;
    else map.set(position.symbol, {
      symbol: position.symbol,
      name: position.name,
      shares: position.shares,
    });
  }
  return map;
}

function buildShareDiffSummary(
  baseline: BacktestPortfolioSnapshot | undefined,
  target: BacktestPortfolioSnapshot | undefined,
) {
  const baselineMap = aggregateSharesBySymbol(baseline);
  const targetMap = aggregateSharesBySymbol(target);
  return [...new Set([...baselineMap.keys(), ...targetMap.keys()])]
    .sort()
    .map((symbol) => {
      const base = baselineMap.get(symbol);
      const next = targetMap.get(symbol);
      const diff = (next?.shares ?? 0) - (base?.shares ?? 0);
      return {
        symbol,
        name: next?.name ?? base?.name ?? symbol,
        diff,
      };
    })
    .filter((item) => Math.abs(item.diff) >= 0.01);
}

function weightedActionPrice(actions: PortfolioSnapshotAction[]) {
  const amount = actions.reduce((sum, action) => sum + (action.amount ?? 0), 0);
  const shares = actions.reduce((sum, action) => sum + (action.shares ?? 0), 0);
  return shares > 0 && amount > 0 ? amount / shares : actions[0]?.price ?? null;
}

function mergeSameSymbolRebalanceActions(
  buys: PortfolioSnapshotAction[],
  sells: PortfolioSnapshotAction[],
): PortfolioSnapshotAction[] {
  const buysBySymbol = new Map<string, PortfolioSnapshotAction[]>();
  const sellsBySymbol = new Map<string, PortfolioSnapshotAction[]>();
  for (const action of buys) {
    const list = buysBySymbol.get(action.symbol) ?? [];
    list.push(action);
    buysBySymbol.set(action.symbol, list);
  }
  for (const action of sells) {
    const list = sellsBySymbol.get(action.symbol) ?? [];
    list.push(action);
    sellsBySymbol.set(action.symbol, list);
  }

  const merged: PortfolioSnapshotAction[] = [];
  const symbols = [...new Set([...buysBySymbol.keys(), ...sellsBySymbol.keys()])].sort();
  for (const symbol of symbols) {
    const symbolBuys = buysBySymbol.get(symbol) ?? [];
    const symbolSells = sellsBySymbol.get(symbol) ?? [];
    if (symbolBuys.length > 0 && symbolSells.length > 0) {
      const buyShares = symbolBuys.reduce((sum, action) => sum + (action.shares ?? 0), 0);
      const sellShares = symbolSells.reduce((sum, action) => sum + (action.shares ?? 0), 0);
      const buyAmount = symbolBuys.reduce((sum, action) => sum + (action.amount ?? 0), 0);
      const sellAmount = symbolSells.reduce((sum, action) => sum + (action.amount ?? 0), 0);
      const netShares = buyShares - sellShares;
      const reference = symbolBuys[0] ?? symbolSells[0];
      merged.push({
        action: 'rebalance',
        symbol,
        name: reference.name,
        assetType: reference.assetType,
        price: null,
        shares: Math.abs(netShares),
        amount: Math.abs(buyAmount - sellAmount),
        returnPct: symbolSells.find((action) => action.returnPct != null)?.returnPct ?? null,
        reason: symbolSells.find((action) => action.reason)?.reason,
        buyPrice: weightedActionPrice(symbolBuys),
        sellPrice: weightedActionPrice(symbolSells),
        buyShares,
        sellShares,
        buyAmount,
        sellAmount,
        netShares,
        rebalanceDirection:
          Math.abs(netShares) < 0.01
            ? 'roll'
            : netShares > 0
              ? 'increase'
              : 'decrease',
      });
      continue;
    }
    merged.push(...symbolBuys, ...symbolSells);
  }
  return merged;
}

type PortfolioTPlusDateEvent = {
  dateKey: string;
  label: string;
  color: string;
  tradeCount: number;
  profit: number;
  names: string[];
};

function buildPortfolioSnapshotViews(
  snapshots: BacktestPortfolioSnapshot[] | undefined,
  trades: BacktestTrade[],
): PortfolioSnapshotView[] {
  const sellsByDate = new Map<string, BacktestTrade[]>();
  for (const trade of trades) {
    const key = tradeDateKey(trade.exitDate);
    if (!key) continue;
    const list = sellsByDate.get(key) ?? [];
    list.push(trade);
    sellsByDate.set(key, list);
  }

  const ordered = [...(snapshots ?? [])].sort((a, b) =>
    tradeDateKey(a.tradeDate).localeCompare(tradeDateKey(b.tradeDate)),
  );

  return ordered.map((snapshot, index) => {
    const dateKey = tradeDateKey(snapshot.tradeDate);
    const previous = ordered[index - 1];
    const dailyReturnPct =
      previous && previous.totalValue > 0
        ? ((snapshot.totalValue - previous.totalValue) / previous.totalValue) * 100
        : 0;
    const buys: PortfolioSnapshotAction[] = snapshot.positions
      .filter((position) => tradeDateKey(position.entryDate) === dateKey)
      .map((position) => ({
        action: 'buy' as const,
        symbol: position.symbol,
        name: position.name,
        assetType: position.assetType,
        price: position.entryPrice,
        shares: position.shares,
        amount: position.costAmount,
      }));
    const currentPositionKeys = new Set(snapshot.positions.map(positionSnapshotKey));
    const sellTrades = sellsByDate.get(dateKey) ?? [];
    const sellTradeBySymbol = new Map(sellTrades.map((trade) => [trade.symbol, trade]));
    const inferredSells: PortfolioSnapshotAction[] =
      previous?.positions
        .filter((position) => !currentPositionKeys.has(positionSnapshotKey(position)))
        .map((position) => {
          const trade = sellTradeBySymbol.get(position.symbol);
          const price = trade?.exitPrice ?? null;
          const amount = price != null ? position.shares * price : position.marketValue;
          return {
            action: 'sell' as const,
            symbol: position.symbol,
            name: position.name,
            assetType: position.assetType,
            price,
            shares: position.shares,
            amount,
            returnPct: trade?.returnPct ?? position.returnPct,
            reason: trade?.exitReason,
          };
        }) ?? [];
    const inferredSellKeys = new Set(inferredSells.map((action) => action.symbol));
    const fallbackSells: PortfolioSnapshotAction[] = sellTrades
      .filter((trade) => !inferredSellKeys.has(trade.symbol))
      .map((trade) => ({
        action: 'sell' as const,
        symbol: trade.symbol,
        name: trade.name,
        assetType: trade.assetType,
        price: trade.exitPrice,
        shares: null,
        amount: null,
        returnPct: trade.returnPct,
        reason: trade.exitReason,
      }));
    const sells = [...inferredSells, ...fallbackSells];
    const actions = mergeSameSymbolRebalanceActions(buys, sells);

    return {
      ...snapshot,
      dateKey,
      dailyReturnPct,
      actions,
      buyCount: buys.length,
      sellCount: sells.length,
    };
  });
}

function monthKeyFromDateKey(dateKey: string) {
  return dateKey.slice(0, 6);
}

function buildDateKey(year: number, monthIndex: number, day: number) {
  return `${year}${String(monthIndex + 1).padStart(2, '0')}${String(day).padStart(2, '0')}`;
}

function monthLabel(monthKey: string) {
  if (monthKey.length !== 6) return monthKey;
  return `${monthKey.slice(0, 4)} 年 ${Number(monthKey.slice(4, 6))} 月`;
}

function mondayFirstWeekday(date: Date) {
  return (date.getDay() + 6) % 7;
}

function buildPortfolioCalendarMonths(views: PortfolioSnapshotView[]): PortfolioCalendarMonth[] {
  if (views.length === 0) return [];
  const byDate = new Map(views.map((view) => [view.dateKey, view]));
  const months: PortfolioCalendarMonth[] = [];
  const firstKey = monthKeyFromDateKey(views[0].dateKey);
  const lastKey = monthKeyFromDateKey(views[views.length - 1].dateKey);
  let year = Number(firstKey.slice(0, 4));
  let monthIndex = Number(firstKey.slice(4, 6)) - 1;
  const lastYear = Number(lastKey.slice(0, 4));
  const lastMonthIndex = Number(lastKey.slice(4, 6)) - 1;

  while (year < lastYear || (year === lastYear && monthIndex <= lastMonthIndex)) {
    const key = `${year}${String(monthIndex + 1).padStart(2, '0')}`;
    const dayCount = new Date(year, monthIndex + 1, 0).getDate();
    const blanks = mondayFirstWeekday(new Date(year, monthIndex, 1));
    const cells = Array.from({ length: dayCount }, (_, index) => {
      const day = index + 1;
      const dateKey = buildDateKey(year, monthIndex, day);
      return { day, dateKey, snapshot: byDate.get(dateKey) };
    });
    const monthSnapshots = cells
      .map((cell) => cell.snapshot)
      .filter((snapshot): snapshot is PortfolioSnapshotView => Boolean(snapshot));
    months.push({
      key,
      label: monthLabel(key),
      blanks,
      cells,
      tradeDays: monthSnapshots.length,
      upDays: monthSnapshots.filter((snapshot) => (snapshot.dailyReturnPct ?? 0) > 0).length,
      downDays: monthSnapshots.filter((snapshot) => (snapshot.dailyReturnPct ?? 0) < 0).length,
    });

    monthIndex += 1;
    if (monthIndex > 11) {
      monthIndex = 0;
      year += 1;
    }
  }

  return months;
}

function calcMaxDrawdownPct(points: BacktestEquityPoint[] | undefined): number | null {
  if (!points?.length) return null;
  let peak = points[0].equity;
  let maxDrawdown = 0;
  for (const point of points) {
    peak = Math.max(peak, point.equity);
    if (peak <= 0) continue;
    maxDrawdown = Math.min(maxDrawdown, ((point.equity - peak) / peak) * 100);
  }
  return Number(maxDrawdown.toFixed(2));
}

function parseEquityDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const key = value.replace(/-/g, '').slice(0, 8);
  if (key.length !== 8) return null;
  const date = new Date(
    Number(key.slice(0, 4)),
    Number(key.slice(4, 6)) - 1,
    Number(key.slice(6, 8)),
  );
  const time = date.getTime();
  return Number.isFinite(time) ? time : null;
}

function calcAnnualReturnPct(points: BacktestEquityPoint[] | undefined): number | null {
  if (!points?.length) return null;
  const finalReturn = points.at(-1)?.returnPct;
  if (finalReturn == null) return null;
  const startTime = parseEquityDate(points[0].tradeDate);
  const endTime = parseEquityDate(points.at(-1)?.tradeDate);
  if (startTime == null || endTime == null || endTime <= startTime) return finalReturn;
  const years = (endTime - startTime) / (365 * 24 * 60 * 60 * 1000);
  if (years <= 0) return finalReturn;
  return Number((((1 + finalReturn / 100) ** (1 / years) - 1) * 100).toFixed(2));
}

function calcSharpe(points: BacktestEquityPoint[] | undefined): number | null {
  if (!points || points.length < 3) return null;
  const returns: number[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1].equity;
    const current = points[index].equity;
    if (prev > 0) returns.push((current - prev) / prev);
  }
  if (returns.length < 2) return null;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance =
    returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (returns.length - 1);
  const std = Math.sqrt(variance);
  if (std === 0) return null;
  return Number(((mean / std) * Math.sqrt(252)).toFixed(3));
}

function equityDateKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const key = value.replace(/-/g, '').slice(0, 8);
  return key.length === 8 ? key : null;
}

function filterEquityThroughDate(
  points: BacktestEquityPoint[] | undefined,
  endDate: string | null,
): BacktestEquityPoint[] | undefined {
  if (!points || !endDate) return points;
  return points.filter((point) => {
    const key = equityDateKey(point.tradeDate);
    return key != null && key <= endDate;
  });
}

function lastEquityAtOrBefore(
  points: BacktestEquityPoint[] | undefined,
  endDate: string | null,
): BacktestEquityPoint | undefined {
  const filtered = filterEquityThroughDate(points, endDate);
  return filtered?.at(-1);
}

export default function BacktestPage() {
  const defaultRange = rangeFromPresetDays(365);
  const [strategy, setStrategy] = useState<Strategy>('stock');
  const [symbols, setSymbols] = useState('600519:贵州茅台,000001:平安银行');
  const [stockUniverse, setStockUniverse] = useState<StockUniverseMode>('retail-stock');
  const [startDate, setStartDate] = useState(defaultRange.startDate);
  const [endDate, setEndDate] = useState(defaultRange.endDate);
  const [includeWaitPullback, setIncludeWaitPullback] = useState(false);
  const [newsFilter, setNewsFilter] = useState<'avoid_bearish' | 'require_bullish' | 'off'>(
    'avoid_bearish',
  );
  const [stockMarketFilter, setStockMarketFilter] = useState<StockMarketFilter>('require_bullish');
  const [stockDefensiveBenchmarkMomentum, setStockDefensiveBenchmarkMomentum] = useState('3');
  const [selectedEtfMomentumVariants, setSelectedEtfMomentumVariants] =
    useState<EtfMomentumVariant[]>(['baseline']);
  const [exitMaxFail, setExitMaxFail] = useState('2');
  const [maxConcurrent, setMaxConcurrent] = useState('5');
  const [initialCapital, setInitialCapital] = useState('100000');
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [comparisonResults, setComparisonResults] = useState<EtfBacktestComparison[] | null>(null);
  const [activeComparisonVariant, setActiveComparisonVariant] =
    useState<EtfMomentumVariant | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<BacktestProgress | null>(null);
  const [progressLog, setProgressLog] = useState<BacktestProgress[]>([]);
  const [error, setError] = useState<string | null>(null);
  const today = todayIsoDate();
  const activePresetDays = presetDaysForRange(startDate, endDate);
  const usingEtfStrategy = isEtfStrategy(strategy);

  const activeStrategy = useMemo(
    () => STRATEGIES.find((item) => item.value === strategy) ?? STRATEGIES[0],
    [strategy],
  );
  const activeEtfMomentumVariants = useMemo(
    () =>
      selectedEtfMomentumVariants
        .map((value) => ETF_MOMENTUM_VARIANTS.find((item) => item.value === value))
        .filter((item): item is (typeof ETF_MOMENTUM_VARIANTS)[number] => Boolean(item)),
    [selectedEtfMomentumVariants],
  );
  const selectedEtfVariantLabels =
    activeEtfMomentumVariants.map((item) => item.label).join('、') || '基准轮动';
  const activeComparison = useMemo(() => {
    if (!comparisonResults?.length) return null;
    return (
      comparisonResults.find((item) => item.variant === activeComparisonVariant) ??
      comparisonResults[0]
    );
  }, [activeComparisonVariant, comparisonResults]);
  const displayedResult = activeComparison?.result ?? result;
  const resultSymbolCount =
    displayedResult?.config?.stockUniverseCount ?? displayedResult?.symbols.length ?? 0;

  function buildBacktestParams(etfVariantValue?: EtfMomentumVariant) {
    const params = new URLSearchParams({ strategy });
    const etfVariant =
      ETF_MOMENTUM_VARIANTS.find((item) => item.value === etfVariantValue) ??
      activeEtfMomentumVariants[0] ??
      ETF_MOMENTUM_VARIANTS[0];
    params.set('startDate', startDate);
    params.set('endDate', endDate);
    params.set('initialCapital', initialCapital || '100000');
    if (!usingEtfStrategy) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      const calendarDays = Math.max(
        1,
        Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1,
      );
      const klineDays = Math.ceil(calendarDays * 5 / 7) + 45;
      params.set('days', String(klineDays));
    }
    if (!usingEtfStrategy && stockUniverse === 'manual') {
      params.set('symbols', symbols);
    } else if (!usingEtfStrategy) {
      params.set('universe', 'retail-stock');
    }
    if (!usingEtfStrategy) {
      params.set('maxConcurrent', maxConcurrent);
      params.set('marketFilter', stockMarketFilter);
      if (stockMarketFilter === 'require_bullish') {
        params.set('defensiveBenchmarkMomentum', stockDefensiveBenchmarkMomentum || '3');
      }
    }
    if (strategy === 'etf' && includeWaitPullback) {
      params.set('includeWaitPullback', '1');
    }
    if (strategy === 'etf') {
      params.set('exitMaxFail', exitMaxFail);
      params.set('maxConcurrent', maxConcurrent);
      params.set('newsFilter', newsFilter);
    }
    if (strategy === 'etf-momentum') {
      if (etfVariant.cashFallbackInWeakRegime) {
        params.set('cashFallbackWeak', '1');
      }
      if (etfVariant.exitOnTrendBreak) {
        params.set('exitOnTrendBreak', '1');
      }
      if (etfVariant.tPlusEnabled) {
        params.set('tPlus', '1');
        params.set('tPlusBuyDip', '1.5');
        params.set('tPlusMinProfit', '0.6');
        params.set('tPlusBudgetPct', '20');
        params.set('tPlusMaxTradesPerDay', '2');
      }
    }
    return params;
  }

  function toggleEtfMomentumVariant(value: EtfMomentumVariant) {
    setSelectedEtfMomentumVariants((items) => {
      if (items.includes(value)) {
        return items.length > 1 ? items.filter((item) => item !== value) : items;
      }
      return ETF_MOMENTUM_VARIANTS
        .map((item) => item.value)
        .filter((item) => item === value || items.includes(item));
    });
  }

  function handleProgressEvent(event: BacktestProgress) {
    setProgress(event);
    setProgressLog((items) => {
      const prev = items[items.length - 1];
      const shouldReplace = prev?.stage === event.stage && prev?.message === event.message;
      const next = shouldReplace ? [...items.slice(0, -1), event] : [...items, event];
      return next.slice(-6);
    });
  }

  async function runBacktestFallback(params: URLSearchParams) {
    const payload = await fetchBacktestJson(params);
    setResult(payload);
  }

  async function fetchBacktestJson(params: URLSearchParams): Promise<BacktestResult> {
    const response = await fetch(`/api/backtest?${params.toString()}`);
    const payload = (await response.json()) as BacktestResult & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? '回测失败');
    return payload;
  }

  async function readBacktestStream(response: Response, params: URLSearchParams) {
    if (!response.ok || !response.body) {
      await runBacktestFallback(params);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let receivedResult = false;

    async function handleLine(line: string) {
      const trimmed = line.trim();
      if (!trimmed) return;
      const event = JSON.parse(trimmed) as BacktestStreamEvent;
      if (event.type === 'progress') {
        handleProgressEvent(event);
        return;
      }
      if (event.type === 'result') {
        setResult(event.result);
        receivedResult = true;
        return;
      }
      if (event.type === 'error') {
        throw new Error(event.message);
      }
    }

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        await handleLine(line);
      }
    }

    buffer += decoder.decode();
    if (buffer.trim()) await handleLine(buffer);
    if (!receivedResult) throw new Error('回测流提前结束');
  }

  async function runBacktest() {
    setLoading(true);
    setError(null);
    setResult(null);
    setComparisonResults(null);
    setActiveComparisonVariant(null);
    setProgress({
      stage: '开始回测',
      message: '正在提交任务。',
      percent: 1,
      elapsedMs: 0,
    });
    setProgressLog([]);
    try {
      const shouldCompare =
        strategy === 'etf-momentum' && activeEtfMomentumVariants.length > 1;
      if (shouldCompare) {
        const startedAt = Date.now();
        const runs: EtfBacktestComparison[] = [];
        for (let index = 0; index < activeEtfMomentumVariants.length; index += 1) {
          const variant = activeEtfMomentumVariants[index];
          setProgress({
            stage: '对比回测',
            message: `正在运行 ${variant.label}`,
            detail: `${index + 1}/${activeEtfMomentumVariants.length}`,
            percent: Math.max(5, Math.round((index / activeEtfMomentumVariants.length) * 86)),
            elapsedMs: Date.now() - startedAt,
          });
          const payload = await fetchBacktestJson(buildBacktestParams(variant.value));
          runs.push({
            variant: variant.value,
            label: variant.label,
            color: variant.color,
            result: payload,
          });
        }
        setProgress({
          stage: '生成报告',
          message: '多方案回测完成，正在合并收益曲线。',
          detail: `${runs.length} 条策略线`,
          percent: 100,
          elapsedMs: Date.now() - startedAt,
        });
        setComparisonResults(runs);
        setActiveComparisonVariant(runs[0]?.variant ?? null);
        setResult(runs[0]?.result ?? null);
      } else {
        const params = buildBacktestParams(activeEtfMomentumVariants[0]?.value);
        const response = await fetch(`/api/backtest/stream?${params.toString()}`);
        await readBacktestStream(response, params);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '回测失败');
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }

  return (
    <main className="page page--list">
      <PageHeader
        eyebrow="真实行情回测"
        title="策略回测"
        description="同一页回放 ETF 轮动和 A 股动量策略；A 股优先使用本地前复权 CSV，结果可直接对照逐笔交易。"
      />

      <nav className="page-toolbar" aria-label="页面导航">
        <Link href="/backtest/history" className="button button-secondary">
          回测记录池
        </Link>
      </nav>

      <section className="action-panel backtest-controls">
        <div className="backtest-control-block">
          <div className="backtest-control-head">
            <strong>选择策略</strong>
            <span className="muted">
              A 股策略读取本地前复权日线；ETF 默认使用动量轮动。
            </span>
          </div>
          <div className="backtest-strategy-grid">
            {STRATEGIES.map((item) => (
              <button
                key={item.value}
                type="button"
                className={`backtest-strategy-card${strategy === item.value ? ' backtest-strategy-card--active' : ''}`}
                onClick={() => setStrategy(item.value)}
              >
                <span>{item.label}</span>
                <small>{item.help}</small>
              </button>
            ))}
          </div>
        </div>

        {strategy === 'etf-momentum' && (
          <div className="backtest-control-block">
            <div className="backtest-control-head backtest-control-head--split">
              <div>
                <strong>ETF 方案</strong>
                <span className="muted">
                  可多选；正T仍是日线 OHLC 代理，先用于模拟观察。
                </span>
              </div>
              <div className="backtest-control-actions">
                <button
                  type="button"
                  className="backtest-inline-action"
                  onClick={() =>
                    setSelectedEtfMomentumVariants(
                      ETF_MOMENTUM_VARIANTS.map((item) => item.value),
                    )
                  }
                >
                  全选
                </button>
                <button
                  type="button"
                  className="backtest-inline-action"
                  onClick={() => setSelectedEtfMomentumVariants(['baseline'])}
                >
                  只看基准
                </button>
              </div>
            </div>
            <div className="backtest-variant-grid" aria-label="ETF 动量轮动方案">
              {ETF_MOMENTUM_VARIANTS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  role="checkbox"
                  aria-checked={selectedEtfMomentumVariants.includes(item.value)}
                  className={`backtest-variant-card${selectedEtfMomentumVariants.includes(item.value) ? ' backtest-variant-card--active' : ''}`}
                  onClick={() => toggleEtfMomentumVariant(item.value)}
                >
                  <span className="backtest-variant-card-head">
                    <span>
                      <i
                        className="backtest-variant-color"
                        style={{ background: item.color }}
                        aria-hidden="true"
                      />
                      <strong>{item.label}</strong>
                    </span>
                    <em>{item.badge}</em>
                  </span>
                  <small>{item.help}</small>
                </button>
              ))}
            </div>
            <div className="backtest-variant-summary">
              <span>调仓 10 日</span>
              <span>20 日动量</span>
              <span>Top 4</span>
              <span>已选 {activeEtfMomentumVariants.length} 个方案</span>
              <span>{selectedEtfVariantLabels}</span>
            </div>
          </div>
        )}

        <div className="backtest-control-block">
          <div className="backtest-control-head">
            <strong>回测区间</strong>
            <span className="muted">
              选择开始与结束日期；行情只能到最近交易日，结束日期不能晚于今天。
            </span>
          </div>
          <div className="backtest-days-row">
            <div className="backtest-preset-group" aria-label="回测区间快捷选择">
              {BACKTEST_RANGE_PRESETS.map((preset) => (
                <button
                  key={preset.days}
                  type="button"
                  className={`backtest-preset${activePresetDays === preset.days ? ' backtest-preset--active' : ''}`}
                  onClick={() => {
                    const range = rangeFromPresetDays(preset.days);
                    setStartDate(range.startDate);
                    setEndDate(range.endDate);
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div className="backtest-date-range">
              <label className="backtest-date-field">
                <span>开始</span>
                <input
                  className="input"
                  type="date"
                  value={startDate}
                  max={endDate}
                  onChange={(event) => setStartDate(event.target.value)}
                />
              </label>
              <span className="muted">至</span>
              <label className="backtest-date-field">
                <span>结束</span>
                <input
                  className="input"
                  type="date"
                  value={endDate}
                  min={startDate}
                  max={today}
                  onChange={(event) => setEndDate(event.target.value)}
                />
              </label>
            </div>
          </div>
          <div className="backtest-capital-row">
            <label className="backtest-date-field backtest-capital-field">
              <span>初始资金</span>
              <input
                className="input"
                type="number"
                min={1000}
                step={1000}
                value={initialCapital}
                onChange={(event) => setInitialCapital(event.target.value)}
              />
            </label>
            <span className="muted">
              用于换算每日持仓、股数/份额和账面金额，不改变信号收益率口径。
            </span>
          </div>
        </div>

        {!usingEtfStrategy && (
          <div
            className="backtest-stock-controls backtest-stock-controls--single"
          >
            <div className="backtest-universe-toggle" aria-label="A 股回测股票池模式">
              <button
                type="button"
                className={`backtest-preset${stockUniverse === 'retail-stock' ? ' backtest-preset--active' : ''}`}
                onClick={() => setStockUniverse('retail-stock')}
              >
                全市场 A 股
              </button>
              <button
                type="button"
                className={`backtest-preset${stockUniverse === 'manual' ? ' backtest-preset--active' : ''}`}
                onClick={() => setStockUniverse('manual')}
              >
                手动代码
              </button>
              <span className="muted">默认扫描本地 5891 个前复权 CSV，并排除 688/689 科创板。</span>
            </div>
            {stockUniverse === 'manual' ? (
              <label className="form-field">
                <span>股票池</span>
                <input
                  className="input"
                  value={symbols}
                  onChange={(event) => setSymbols(event.target.value)}
                  placeholder="600519,000001 或 600519:贵州茅台"
                />
                <small>
                  本次参与回测的股票代码列表；688/689 科创板会自动排除。
                </small>
              </label>
            ) : (
              <div className="backtest-universe-note">
                <strong>本地全市场 A 股</strong>
                <span>从 stock/qfq-daily 目录读取所有普通 A 股日线；动量启动信号作为入场候选，默认过滤 ST、8 元以下和近 5 日成交额低于 3000 万的票。</span>
              </div>
            )}
            <div className="backtest-etf-options">
              <label className="form-field">
                <span>大盘过滤</span>
                <select
                  className="input"
                  value={stockMarketFilter}
                  onChange={(event) => setStockMarketFilter(event.target.value as StockMarketFilter)}
                >
                  <option value="require_bullish">强势确认（稳健）</option>
                  <option value="avoid_bearish">仅避开弱熊（宽松）</option>
                  <option value="off">关闭过滤（最宽）</option>
                </select>
              </label>
              <label className="form-field">
                <span>防守动量阈值</span>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={10}
                  step={0.5}
                  value={stockDefensiveBenchmarkMomentum}
                  disabled={stockMarketFilter !== 'require_bullish'}
                  onChange={(event) => setStockDefensiveBenchmarkMomentum(event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>最大同时持仓</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={10}
                  value={maxConcurrent}
                  onChange={(event) => setMaxConcurrent(event.target.value)}
                />
              </label>
            </div>
            {stockUniverse === 'manual' && (
              <div className="backtest-symbol-presets" aria-label="股票池快捷选择">
                {STOCK_SYMBOL_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    className="backtest-preset"
                    onClick={() => setSymbols(preset.value)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {strategy === 'etf' && (
          <>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={includeWaitPullback}
                onChange={(event) => setIncludeWaitPullback(event.target.checked)}
              />
              纳入“等回踩”信号（仍按触发日收盘价模拟入场）
            </label>
            <div className="backtest-etf-options">
              <label className="form-field">
                <span>新闻过滤</span>
                <select
                  className="input"
                  value={newsFilter}
                  onChange={(event) =>
                    setNewsFilter(
                      event.target.value as 'avoid_bearish' | 'require_bullish' | 'off',
                    )
                  }
                >
                  <option value="avoid_bearish">拦截明显利空（默认）</option>
                  <option value="require_bullish">要求相关利好</option>
                  <option value="off">关闭新闻过滤</option>
                </select>
              </label>
              <label className="form-field">
                <span>失效出场容忍</span>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={4}
                  value={exitMaxFail}
                  onChange={(event) => setExitMaxFail(event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>最大同时持仓</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={10}
                  value={maxConcurrent}
                  onChange={(event) => setMaxConcurrent(event.target.value)}
                />
              </label>
            </div>
          </>
        )}

        <div className="page-toolbar">
          <button
            type="button"
            className="button"
            disabled={loading}
            onClick={runBacktest}
          >
            {loading ? '回测中…' : '开始回测'}
          </button>
          <span className="muted">
            {activeStrategy.help}
            {strategy === 'etf-momentum' ? ` 当前方案：${selectedEtfVariantLabels}。` : ' '}
            股票策略没有固定观察期；ETF 的 10 日是调仓周期，不是固定持有期。结果是规则验证，不是投资建议。
          </span>
        </div>
      </section>

      <section className="paper-hero">
        <div className="paper-hero-main">
          <span className="muted">数据口径</span>
          <strong>真实行情，不是 mock</strong>
          <span className="muted">
            A 股历史回测优先读取本地前复权 CSV（packages/agent-core/data/market-csv/stock/qfq-daily，当前 5891 个文件）；ETF 历史回测优先读本地 ETF CSV，没有本地文件时退回腾讯日 K。“当前尾盘动作”仍优先用东财实时行情。
          </span>
        </div>
      </section>

      {error && <div className="error">{error}</div>}

      {loading && (
        <BacktestProgressPanel
          progress={progress}
          events={progressLog}
          strategyName={activeStrategy.label}
        />
      )}

      {!result && !loading && !error && (
        <div className="empty-state">
          选择策略后点击“开始回测”。A 股默认扫描本地全市场普通股票，也可切到手动代码；ETF 回测直接使用 19 只内置 ETF 池。
        </div>
      )}

      {displayedResult && (
        <>
          <section className="paper-hero">
            <div className="paper-hero-main">
              <span className="muted">{fmtTime(displayedResult.generatedAt)}</span>
              <strong>{displayStrategyName(displayedResult.strategy)}</strong>
              <span className="muted">
                {displayedResult.startDate && displayedResult.endDate
                  ? `${displayedResult.startDate} 至 ${displayedResult.endDate}`
                  : `${startDate} 至 ${endDate}`}
                {' · '}
                覆盖 {resultSymbolCount} 个标的
              </span>
              {comparisonResults && comparisonResults.length > 1 ? (
                <ResultVariantTabs
                  comparisonResults={comparisonResults}
                  activeVariant={activeComparison?.variant ?? comparisonResults[0].variant}
                  onChange={setActiveComparisonVariant}
                />
              ) : null}
            </div>
            <div className="paper-hero-stats">
              <Metric label="交易数" value={String(displayedResult.metrics.tradeCount)} />
              <Metric label="有效交易" value={String(displayedResult.metrics.validTradeCount)} />
              <Metric label="胜率" value={fmtPct(displayedResult.metrics.winRatePct)} />
              <Metric label="平均收益" value={fmtPct(displayedResult.metrics.avgReturnPct)} />
              <Metric label="中位收益" value={fmtPct(displayedResult.metrics.medianReturnPct)} />
              <Metric
                label="策略累计"
                value={fmtPct(displayedResult.equityCurve?.at(-1)?.returnPct ?? null)}
              />
              <Metric label="盈亏比" value={fmtNumber(displayedResult.metrics.profitLossRatio)} />
            </div>
          </section>

          {displayedResult.strategy === 'etf-tail-rules' ||
          displayedResult.strategy === 'etf-momentum-rotation' ? (
            <EtfStrategyReport
              result={displayedResult}
              comparisonResults={comparisonResults ?? undefined}
              activeComparisonVariant={activeComparison?.variant ?? null}
              onComparisonVariantChange={setActiveComparisonVariant}
            />
          ) : (
            <StockStrategyReport result={displayedResult} />
          )}

          {displayedResult.symbols.some((item) => item.error) && (
            <section className="section pane-card">
              <h2 className="section-title">数据错误</h2>
              <ul className="sector-list">
                {displayedResult.symbols
                  .filter((item) => item.error)
                  .map((item) => (
                    <li key={item.symbol}>
                      {item.symbol} {item.name}: {item.error}
                    </li>
                  ))}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  );
}

function BacktestProgressPanel({
  progress,
  events,
  strategyName,
}: {
  progress: BacktestProgress | null;
  events: BacktestProgress[];
  strategyName: string;
}) {
  const percent = Math.min(100, Math.max(0, progress?.percent ?? 1));
  const displayEvents = events.length > 0 ? events : progress ? [progress] : [];

  return (
    <section className="section pane-card backtest-progress-panel" aria-live="polite">
      <div className="backtest-progress-head">
        <div>
          <span className="muted">动态回测</span>
          <h2 className="section-title">{strategyName}</h2>
        </div>
        <strong>{percent}%</strong>
      </div>
      <div className="backtest-progress-track" aria-hidden>
        <span style={{ width: `${percent}%` }} />
      </div>
      <div className="backtest-progress-current">
        <span className="backtest-progress-pulse" aria-hidden />
        <div>
          <strong>{progress?.stage ?? '准备中'}</strong>
          <span>{progress?.message ?? '正在启动回测任务。'}</span>
          {progress?.detail && <small>{progress.detail}</small>}
        </div>
        <time>{fmtElapsed(progress?.elapsedMs ?? 0)}</time>
      </div>
      <ol className="backtest-progress-log">
        {displayEvents.map((event, index) => (
          <li key={`${event.stage}-${event.percent}-${index}`}>
            <span>{event.stage}</span>
            <small>
              {event.detail ?? event.message} · {event.percent}%
            </small>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="muted">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ResultVariantTabs({
  comparisonResults,
  activeVariant,
  onChange,
}: {
  comparisonResults: EtfBacktestComparison[];
  activeVariant: EtfMomentumVariant;
  onChange: (variant: EtfMomentumVariant) => void;
}) {
  return (
    <div className="result-variant-tabs" role="tablist" aria-label="回测方案">
      {comparisonResults.map((item) => {
        const finalReturn = item.result.equityCurve?.at(-1)?.returnPct ?? null;
        const active = item.variant === activeVariant;
        return (
          <button
            key={item.variant}
            type="button"
            role="tab"
            aria-selected={active}
            className={`result-variant-tab${active ? ' result-variant-tab--active' : ''}`}
            onClick={() => onChange(item.variant)}
          >
            <span className="result-variant-tab-name">
              <i style={{ background: item.color }} aria-hidden="true" />
              {item.label}
            </span>
            <strong className={returnClass(finalReturn)}>{fmtPct(finalReturn)}</strong>
          </button>
        );
      })}
    </div>
  );
}

function GenericBacktestDetails({ result }: { result: BacktestResult }) {
  return (
    <>
      {result.notes.length > 0 && (
        <section className="section pane-card">
          <h2 className="section-title">说明</h2>
          <ul className="sector-list">
            {result.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="section pane-card">
        <h2 className="section-title">分组表现</h2>
        <PerformanceGroupTable groups={result.groups} />
      </section>

      <TradeDetailsSection trades={result.trades} />
    </>
  );
}

function tradeRowKey(trade: BacktestTrade, index: number) {
  return `${trade.symbol}-${trade.entryDate}-${trade.exitDate ?? 'open'}-${trade.holdDays}-${index}`;
}

function buildTradeMarkers(trade: BacktestTrade | undefined): TradeMarker[] {
  if (!trade) return [];
  const markers: TradeMarker[] = [
    {
      tradeDate: trade.entryDate,
      kind: 'buy',
      label: '买入',
    },
  ];
  if (trade.exitDate) {
    markers.push({
      tradeDate: trade.exitDate,
      kind: 'sell',
      label: '卖出',
    });
  }
  return markers;
}

function StockStrategyReport({ result }: { result: BacktestResult }) {
  const [activePanel, setActivePanel] = useState<StockBacktestPanel>('overview');
  const [selectedTradeKey, setSelectedTradeKey] = useState<string | null>(null);
  const sortedTrades = useMemo(() => sortTradesOldestFirst(result.trades), [result.trades]);
  const selectedTradeIndex = selectedTradeKey
    ? sortedTrades.findIndex((trade, index) => tradeRowKey(trade, index) === selectedTradeKey)
    : 0;
  const activeTradeIndex = selectedTradeIndex >= 0 ? selectedTradeIndex : 0;
  const selectedTrade = sortedTrades[activeTradeIndex];
  const activeTradeKey =
    selectedTrade != null ? tradeRowKey(selectedTrade, activeTradeIndex) : null;
  const strategyLastDate = equityDateKey(result.equityCurve?.at(-1)?.tradeDate);
  const benchmarkLastDate = equityDateKey(result.benchmark?.curve?.at(-1)?.tradeDate);
  const comparisonEndDate =
    strategyLastDate && benchmarkLastDate
      ? strategyLastDate <= benchmarkLastDate
        ? strategyLastDate
        : benchmarkLastDate
      : strategyLastDate ?? benchmarkLastDate;
  const alignedEquityCurve = filterEquityThroughDate(
    result.equityCurve,
    comparisonEndDate,
  );
  const alignedBenchmarkCurve = filterEquityThroughDate(
    result.benchmark?.curve,
    comparisonEndDate,
  );
  const latestStrategyReturn = result.equityCurve?.at(-1)?.returnPct ?? null;
  const finalReturn =
    lastEquityAtOrBefore(result.equityCurve, comparisonEndDate)?.returnPct ??
    latestStrategyReturn;
  const benchmarkReturn =
    lastEquityAtOrBefore(result.benchmark?.curve, comparisonEndDate)?.returnPct ??
    result.benchmark?.finalReturnPct ??
    null;
  const excessReturn =
    finalReturn != null && benchmarkReturn != null
      ? Number((finalReturn - benchmarkReturn).toFixed(2))
      : null;
  const annualReturn = calcAnnualReturnPct(alignedEquityCurve);
  const maxDrawdown = calcMaxDrawdownPct(alignedEquityCurve);
  const sharpe = calcSharpe(alignedEquityCurve);
  const hasDataCutoffMismatch =
    strategyLastDate != null &&
    benchmarkLastDate != null &&
    strategyLastDate !== benchmarkLastDate;
  const universeCount = result.config?.stockUniverseCount ?? result.symbols.length;
  const isMomentum =
    result.strategy === 'red-diamond-momentum' || result.strategy === 'diamond-momentum';
  const stockIdleDays =
    typeof result.config?.stockIdleDays === 'number' ? result.config.stockIdleDays : null;
  const benchmarkTradeDays =
    typeof result.config?.benchmarkTradeDays === 'number'
      ? result.config.benchmarkTradeDays
      : null;
  const stockIdleDayPct =
    typeof result.config?.stockIdleDayPct === 'number'
      ? result.config.stockIdleDayPct
      : null;
  const longestStockIdleDays =
    typeof result.config?.longestStockIdleDays === 'number'
      ? result.config.longestStockIdleDays
      : null;
  const stockFilterLabel = displayStockMarketFilter(result.config?.stockMarketFilter);
  const defensiveMomentum =
    typeof result.config?.defensiveBenchmarkMomentum20Pct === 'number'
      ? result.config.defensiveBenchmarkMomentum20Pct
      : null;
  const chartDays = Math.max(120, Math.min(520, result.requestedDays + 90));
  const panels: Array<{ id: StockBacktestPanel; label: string; hint: string }> = [
    { id: 'overview', label: '收益概述', hint: '收益曲线和核心指标' },
    { id: 'chart', label: 'K线复盘', hint: '单笔买卖点和红钻' },
    { id: 'groups', label: '分组表现', hint: '退出规则和持有天数' },
    { id: 'holdings', label: '每日持仓', hint: '现金、股数和市值' },
    { id: 'trades', label: '交易详情', hint: '逐笔买卖记录' },
    { id: 'notes', label: '日志说明', hint: '规则和数据口径' },
  ];

  return (
    <div className="layout-split backtest-report">
      <aside className="layout-split-aside backtest-sidebar">
        {panels.map((panel) => (
          <button
            key={panel.id}
            type="button"
            className={`backtest-menu-item${activePanel === panel.id ? ' backtest-menu-item--active' : ''}`}
            onClick={() => setActivePanel(panel.id)}
          >
            <span>{panel.label}</span>
            <small>{panel.hint}</small>
          </button>
        ))}
      </aside>

      <div className="backtest-report-main">
        {activePanel === 'overview' && (
          <section className="section pane-card">
            <div className="section-head">
              <div>
                <h2 className="section-title">收益概述</h2>
                <p className="muted">
                  {isMomentum
                    ? `区间 ${result.startDate ?? '—'} 至 ${result.endDate ?? '—'}。默认扫描本地 ${universeCount} 只普通 A 股前复权日 K，排除 688/689 科创板；动量启动信号叠加 checklist 入场，过滤 ST/8 元以下/低成交额；大盘过滤为${stockFilterLabel}${defensiveMomentum != null && defensiveMomentum > 0 ? `，中期不强时要求沪深300 20 日动量 ≥${defensiveMomentum}%` : ''}。`
                    : `区间 ${result.startDate ?? '—'} 至 ${result.endDate ?? '—'}。默认扫描本地 ${universeCount} 只普通 A 股前复权日 K，排除 688/689 科创板；入口统一为股票策略，历史信号统计仅作为内部验证口径。`}
                  {hasDataCutoffMismatch
                    ? ` 收益概述按策略和大盘共同数据截止日 ${fmtTradeDate(comparisonEndDate)} 对齐；策略最新收益 ${fmtPct(latestStrategyReturn)}。`
                    : ''}
                </p>
              </div>
              <strong className={returnClass(finalReturn)}>累计 {fmtPct(finalReturn)}</strong>
            </div>

            <div className="overview-metric-grid">
              <SummaryMetric label="策略累计收益" value={fmtPct(finalReturn)} tone={finalReturn} />
              <SummaryMetric label="初始资金" value={`${fmtMoney(result.config?.initialCapital ?? null)} 元`} />
              <SummaryMetric label="大盘累计收益" value={fmtPct(benchmarkReturn)} tone={benchmarkReturn} />
              <SummaryMetric label="超额收益" value={fmtPct(excessReturn)} tone={excessReturn} />
              <SummaryMetric label="股票池" value={`${universeCount} 只`} />
              <SummaryMetric label="最大持仓" value={`${result.config?.maxConcurrentPositions ?? 5} 只`} />
              <SummaryMetric label="大盘过滤" value={stockFilterLabel} />
              <SummaryMetric label="策略年化收益" value={fmtPct(annualReturn)} tone={annualReturn} />
              <SummaryMetric label="最大回撤" value={fmtPct(maxDrawdown)} tone={maxDrawdown} inverse />
              <SummaryMetric label="夏普比率" value={fmtNumber(sharpe, 3)} />
              <SummaryMetric label="胜率" value={fmtPct(result.metrics.winRatePct)} />
              <SummaryMetric label="交易次数" value={`${result.metrics.validTradeCount}/${result.metrics.tradeCount}`} />
              <SummaryMetric label="平均收益" value={fmtPct(result.metrics.avgReturnPct)} tone={result.metrics.avgReturnPct} />
              <SummaryMetric label="中位收益" value={fmtPct(result.metrics.medianReturnPct)} tone={result.metrics.medianReturnPct} />
              <SummaryMetric label="单笔最高" value={fmtPct(result.metrics.bestReturnPct)} tone={result.metrics.bestReturnPct} />
              <SummaryMetric label="单笔最低" value={fmtPct(result.metrics.worstReturnPct)} tone={result.metrics.worstReturnPct} />
              <SummaryMetric label="平均持有" value={`${fmtNumber(result.metrics.avgHoldDays, 1)} 日`} />
              {stockIdleDays != null && benchmarkTradeDays != null ? (
                <SummaryMetric
                  label="空仓交易日"
                  value={`${stockIdleDays}/${benchmarkTradeDays} 日${stockIdleDayPct != null ? ` · ${fmtNumber(stockIdleDayPct)}%` : ''}`}
                />
              ) : null}
              {longestStockIdleDays != null ? (
                <SummaryMetric
                  label="最长空仓"
                  value={`${longestStockIdleDays} 日`}
                />
              ) : null}
            </div>

            <BacktestEquityChart
              strategy={(alignedEquityCurve ?? []).map((point) => ({
                tradeDate: point.tradeDate,
                returnPct: point.returnPct,
              }))}
              benchmark={
                result.benchmark
                  ? {
                      name: result.benchmark.name,
                      curve: (alignedBenchmarkCurve ?? result.benchmark.curve).map((point) => ({
                        tradeDate: point.tradeDate,
                        returnPct: point.returnPct,
                      })),
                      finalReturnPct: benchmarkReturn,
                    }
                  : undefined
              }
            />
          </section>
        )}

        {activePanel === 'chart' && (
          <section className="section pane-card">
            <div className="section-head">
              <div>
                <h2 className="section-title">K线复盘</h2>
                <p className="muted">
                  点击右侧交易或交易详情中的行，可切换到对应股票的买入、卖出位置。
                </p>
              </div>
              {selectedTrade && (
                <strong className={returnClass(selectedTrade.returnPct)}>
                  {fmtPct(selectedTrade.returnPct)}
                </strong>
              )}
            </div>

            {selectedTrade ? (
              <div className="stock-backtest-chart-grid">
                <div className="stock-backtest-chart-main">
                  <div className="stock-backtest-selected">
                    <div>
                      <strong>
                        {displayTradeName(selectedTrade)}
                      </strong>
                      <span className="muted">
                        {fmtTradeDate(selectedTrade.entryDate)} 买入，{fmtTradeDate(selectedTrade.exitDate)} 卖出
                      </span>
                    </div>
                    <div className="stock-backtest-selected-meta">
                      <span>买入 {fmtPrice(selectedTrade.entryPrice)}</span>
                      <span>卖出 {fmtPrice(selectedTrade.exitPrice)}</span>
                      <span>{fmtExitReason(selectedTrade.exitReason)}</span>
                    </div>
                  </div>
                  <StockKlineChart
                    symbol={selectedTrade.symbol}
                    days={chartDays}
                    height={420}
                    lazy={false}
                    showPriceLines={isMomentum}
                    tradeMarkers={buildTradeMarkers(selectedTrade)}
                    className="stock-kline-chart stock-kline-chart--backtest"
                  />
                </div>

                <div className="stock-backtest-trade-list">
                  {sortedTrades.slice(0, 80).map((trade, index) => {
                    const key = tradeRowKey(trade, index);
                    return (
                      <button
                        key={key}
                        type="button"
                        className={`stock-backtest-trade-button${key === activeTradeKey ? ' stock-backtest-trade-button--active' : ''}`}
                        onClick={() => setSelectedTradeKey(key)}
                      >
                        <span>
                          {displayTradeName(trade)}
                        </span>
                        <strong className={returnClass(trade.returnPct)}>
                          {fmtPct(trade.returnPct)}
                        </strong>
                        <small>
                          {fmtTradeDate(trade.entryDate)} · {trade.holdDays} 日 · {fmtExitReason(trade.exitReason)}
                        </small>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="chart-empty">当前区间没有可复盘的交易。</div>
            )}
          </section>
        )}

        {activePanel === 'groups' && (
          <section className="section pane-card">
            <h2 className="section-title">分组表现</h2>
            <PerformanceGroupTable groups={result.groups} />
          </section>
        )}

        {activePanel === 'trades' && (
          <TradeDetailsSection
            trades={sortedTrades}
            selectedTradeKey={activeTradeKey ?? undefined}
            onSelectTrade={(trade, index) => {
              setSelectedTradeKey(tradeRowKey(trade, index));
              setActivePanel('chart');
            }}
          />
        )}

        {activePanel === 'holdings' && (
          <PortfolioHoldingsSection
            snapshots={result.portfolioSnapshots}
            trades={result.trades}
            initialCapital={result.config?.initialCapital}
          />
        )}

        {activePanel === 'notes' && (
          <section className="section pane-card">
            <h2 className="section-title">日志说明</h2>
            <ul className="sector-list">
              {result.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
              <li>A 股 K 线复盘使用本地前复权日线；图上的红/蓝钻来自同一套信号计算，买入/卖出箭头来自回测交易明细。</li>
              <li>股票策略默认最多持有 5 个交易日；持有期内只处理极端止损/止盈，到期再检查 MA20、移动止盈或信号变化。</li>
              <li>“信号消失”表示买入后红钻或动量条件不再满足；“回测结束”表示交易已经走到回测区间末尾，没有后续交易日继续模拟。</li>
              <li>当前结果是规则验证，不是投资建议；真实交易还要考虑滑点、涨跌停、停牌和仓位约束。</li>
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function EtfStrategyReport({
  result,
  comparisonResults,
  activeComparisonVariant,
  onComparisonVariantChange,
}: {
  result: BacktestResult;
  comparisonResults?: EtfBacktestComparison[];
  activeComparisonVariant?: EtfMomentumVariant | null;
  onComparisonVariantChange?: (variant: EtfMomentumVariant) => void;
}) {
  const [activePanel, setActivePanel] = useState<BacktestPanel>('overview');
  const buyList = result.currentDecisions?.filter((item) => item.action === 'buy') ?? [];
  const sellList = result.currentDecisions?.filter((item) => item.action === 'sell') ?? [];
  const watchList =
    result.currentDecisions?.filter(
      (item) => item.action === 'watch' || item.action === 'wait_pullback',
    ) ?? [];
  const finalReturn = result.equityCurve?.at(-1)?.returnPct ?? null;
  const benchmarkReturn = result.benchmark?.finalReturnPct ?? null;
  const excessReturn =
    finalReturn != null && benchmarkReturn != null
      ? Number((finalReturn - benchmarkReturn).toFixed(2))
      : null;
  const annualReturn = calcAnnualReturnPct(result.equityCurve);
  const maxDrawdown = calcMaxDrawdownPct(result.equityCurve);
  const sharpe = calcSharpe(result.equityCurve);
  const startDate = result.equityCurve?.[0]?.tradeDate ?? null;
  const endDate = result.equityCurve?.at(-1)?.tradeDate ?? null;
  const isMomentum = result.strategy === 'etf-momentum-rotation';
  const comparisonSeries =
    isMomentum && comparisonResults && comparisonResults.length > 1
      ? comparisonResults.map((item) => ({
          name: item.label,
          color: item.color,
          curve: (item.result.equityCurve ?? []).map((point) => ({
            tradeDate: point.tradeDate,
            returnPct: point.returnPct,
          })),
          finalReturnPct: item.result.equityCurve?.at(-1)?.returnPct ?? null,
        }))
      : undefined;
  const momentumModeLabel = !isMomentum
    ? null
    : result.config?.tPlusEnabled
      ? '正T叠加'
      : result.config?.exitOnTrendBreak
        ? '主动风控'
        : result.config?.cashFallbackInWeakRegime
          ? '弱市现金'
          : '基准轮动';
  const panels: Array<{ id: BacktestPanel; label: string; hint: string }> = [
    { id: 'overview', label: '收益概述', hint: '收益曲线和核心指标' },
    { id: 'current', label: '当前动作', hint: '今天尾盘买卖建议' },
    { id: 'etfs', label: 'ETF 表现', hint: '每只 ETF 的历史效果' },
    { id: 'holdings', label: '每日持仓', hint: '现金、份额和市值' },
    { id: 'trades', label: '交易详情', hint: '逐笔买卖记录' },
    { id: 'notes', label: '日志说明', hint: '规则和数据口径' },
  ];

  return (
    <div className="layout-split backtest-report">
      <aside className="layout-split-aside backtest-sidebar">
        {panels.map((panel) => (
          <button
            key={panel.id}
            type="button"
            className={`backtest-menu-item${activePanel === panel.id ? ' backtest-menu-item--active' : ''}`}
            onClick={() => setActivePanel(panel.id)}
          >
            <span>{panel.label}</span>
            <small>{panel.hint}</small>
          </button>
        ))}
      </aside>

      <div className="backtest-report-main">
        {activePanel === 'overview' && (
          <section className="section pane-card">
            <div className="section-head">
              <div>
                <h2 className="section-title">收益概述</h2>
                <p className="muted">
                  {isMomentum
                    ? `区间 ${fmtTradeDate(startDate)} 至 ${fmtTradeDate(endDate)}。规则：每 ${result.config?.rebalanceDays ?? 10} 个交易日调仓，选择 ${result.config?.momentumDays ?? 20} 日动量最强且站上 MA${result.config?.trendMaDays ?? 20} 的前 ${result.config?.topN ?? 4} 只 ETF 等权持有；不足时${result.config?.cashFallbackInWeakRegime ? '弱市留现金' : '用沪深300兜底'}，大盘站上 MA20 时放宽至 MA10，若沪深300 ${result.config?.momentumDays ?? 20} 日动量不低于 ${result.config?.bullBenchmarkSlotMomentumPct ?? 8}% 则保留 ${result.config?.bullBenchmarkSlotCount ?? 1} 个宽基槽位；跌破 MA20 或 ${result.config?.momentumDays ?? 20} 日动量为负时预防性仓位上限 ${Math.round((result.config?.weakRegimeMaxExposure ?? 0.7) * 100)}%，跌破 MA20 且动量为负时仓位上限 ${Math.round((result.config?.bearRegimeMaxExposure ?? 0.25) * 100)}%，单笔 -12% 止损后 ${result.config?.stopCooldownDays ?? 10} 日冷却${result.config?.exitOnTrendBreak ? '，弱市破趋势提前退出' : ''}${result.config?.tPlusEnabled ? '，并启用正T日线代理' : ''}，含交易成本与波动率目标仓位，权益按日线滚动。`
                    : `区间 ${fmtTradeDate(startDate)} 至 ${fmtTradeDate(endDate)}。规则：8 条 ETF 尾盘规则 + 买入前 ${result.config?.newsLookbackDays ?? 3} 日新闻过滤；最多同时持有 ${result.config?.maxConcurrentPositions ?? 5} 只；失效出场允许 ${result.config?.exitMaxFailCount ?? 2} 条规则失败；收益曲线按组合槽位复利。`}
                </p>
              </div>
              <strong className={returnClass(finalReturn)}>累计 {fmtPct(finalReturn)}</strong>
            </div>

            {comparisonResults && comparisonResults.length > 1 && activeComparisonVariant ? (
              <ResultVariantTabs
                comparisonResults={comparisonResults}
                activeVariant={activeComparisonVariant}
                onChange={onComparisonVariantChange ?? (() => undefined)}
              />
            ) : null}

            <div className="overview-metric-grid">
              <SummaryMetric label="策略累计收益" value={fmtPct(finalReturn)} tone={finalReturn} />
              <SummaryMetric label="初始资金" value={`${fmtMoney(result.config?.initialCapital ?? null)} 元`} />
              <SummaryMetric label="大盘累计收益" value={fmtPct(benchmarkReturn)} tone={benchmarkReturn} />
              <SummaryMetric label="超额收益" value={fmtPct(excessReturn)} tone={excessReturn} />
              <SummaryMetric label="策略年化收益" value={fmtPct(annualReturn)} tone={annualReturn} />
              <SummaryMetric label="最大回撤" value={fmtPct(maxDrawdown)} tone={maxDrawdown} inverse />
              <SummaryMetric label="夏普比率" value={fmtNumber(sharpe, 3)} />
              <SummaryMetric label="胜率" value={fmtPct(result.metrics.winRatePct)} />
              <SummaryMetric label="交易次数" value={`${result.metrics.validTradeCount}/${result.metrics.tradeCount}`} />
              <SummaryMetric label="单笔最高收益" value={fmtPct(result.metrics.bestReturnPct)} tone={result.metrics.bestReturnPct} />
              {isMomentum ? (
                <>
                  <SummaryMetric label="方案" value={momentumModeLabel ?? '基准轮动'} />
                  <SummaryMetric label="调仓周期" value={`${result.config?.rebalanceDays ?? 10} 日`} />
                  <SummaryMetric label="持仓数量" value={`Top ${result.config?.topN ?? 4}`} />
                  <SummaryMetric
                    label="弱市空槽"
                    value={result.config?.cashFallbackInWeakRegime ? '留现金' : '沪深300兜底'}
                  />
                  <SummaryMetric
                    label="趋势破位"
                    value={result.config?.exitOnTrendBreak ? '提前退出' : '不提前退出'}
                  />
                  {result.config?.tPlusEnabled ? (
                    <>
                      <SummaryMetric label="正T次数" value={`${result.config.tPlusTradeCount ?? 0} 次`} />
                      <SummaryMetric
                        label="正T贡献"
                        value={fmtPct(result.config.tPlusTotalProfitPct ?? null)}
                        tone={result.config.tPlusTotalProfitPct ?? null}
                      />
                    </>
                  ) : null}
                </>
              ) : (
                <>
                  <SummaryMetric label="新闻拦截" value={String(result.config?.newsBlockedCount ?? 0)} />
                  <SummaryMetric label="组合过滤" value={String(result.config?.portfolioSkippedCount ?? 0)} />
                </>
              )}
            </div>

            <BacktestEquityChart
              strategy={(result.equityCurve ?? []).map((point) => ({
                tradeDate: point.tradeDate,
                returnPct: point.returnPct,
              }))}
              strategyName={momentumModeLabel ?? '策略'}
              strategySeries={comparisonSeries}
              benchmark={
                result.benchmark
                  ? {
                      name: result.benchmark.name,
                      curve: result.benchmark.curve.map((point) => ({
                        tradeDate: point.tradeDate,
                        returnPct: point.returnPct,
                      })),
                      finalReturnPct: result.benchmark.finalReturnPct,
                    }
                  : undefined
              }
            />

            {comparisonResults && comparisonResults.length > 1 ? (
              <EtfComparisonDiffTable comparisonResults={comparisonResults} />
            ) : null}

            <div className="metric-help">
              <strong>怎么读：</strong>
              <span>
                “单笔最高/最低收益”是某一笔 ETF 交易的最高和最低收益，不代表某只 ETF 永远最好或最差。
                {comparisonResults && comparisonResults.length > 1
                  ? ` 多方案对比时，收益图展示 ${comparisonResults.length} 条策略线，顶部方案 tab 控制概览、持仓和交易明细。`
                  : ''}
              </span>
            </div>
          </section>
        )}

        {activePanel === 'current' && (
          <section className="section pane-card">
            <div className="section-head">
              <div>
                <h2 className="section-title">当前尾盘动作</h2>
                <p className="muted">
                  {isMomentum
                    ? '轮动持有 = 当前动量排名进入目标持仓；等待轮动 = 暂未进入前排或趋势过滤不足。'
                    : '买入 = 严格通过；观察/等回踩 = 条件接近但不能追；卖出/回避 = 若已持有则按规则退出或降仓。'}
                </p>
              </div>
            </div>
            <div className="decision-summary-grid">
              <Metric label="买入/持有" value={String(buyList.length)} />
              <Metric label="观察/等回踩" value={String(watchList.length)} />
              <Metric label="卖出/回避" value={String(sellList.length)} />
            </div>
            <CurrentDecisionTable decisions={result.currentDecisions ?? []} />
          </section>
        )}

        {activePanel === 'etfs' && (
          <section className="section pane-card">
            <h2 className="section-title">每只 ETF 的历史表现</h2>
            <EtfSummaryTable summaries={result.symbolSummaries ?? []} />
          </section>
        )}

        {activePanel === 'trades' && <TradeDetailsSection trades={result.trades} />}

        {activePanel === 'holdings' && (
          <PortfolioHoldingsSection
            snapshots={result.portfolioSnapshots}
            trades={result.trades}
            initialCapital={result.config?.initialCapital}
            comparisonResults={comparisonResults}
          />
        )}

        {activePanel === 'notes' && (
          <section className="section pane-card">
            <h2 className="section-title">日志说明</h2>
            <ul className="sector-list">
              {result.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
              <li>收益曲线基于已完成持有期的交易；尚未到卖出日的交易会保留在明细里，但不计入有效收益。</li>
              <li>T0/T1 是基金交易制度；当前回测只有日 K，不能严谨模拟 T0 盘中同日卖出，所以尾盘买入后一律按下一交易日收盘退出评估。</li>
              <li>当前动作是规则输出，不是投资建议；买卖前仍需结合仓位、风险和交易成本。</li>
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function CurrentDecisionTable({ decisions }: { decisions: BacktestCurrentDecision[] }) {
  return (
    <div className="table-scroll-wrap">
      <table className="candidate-table">
        <thead>
          <tr>
            <th>ETF</th>
            <th>动作</th>
            <th>价格</th>
            <th>涨跌</th>
            <th>通过</th>
            <th>失败项</th>
            <th>新闻</th>
            <th>数据</th>
            <th>理由</th>
          </tr>
        </thead>
        <tbody>
          {decisions.map((item) => (
            <tr key={item.symbol}>
              <td>
                {item.name} ({item.symbol})
              </td>
              <td>
                <DecisionBadge action={item.action} label={item.actionLabel} />
              </td>
              <td>{fmtPrice(item.price)}</td>
              <td className={returnClass(item.changePct)}>{fmtPct(item.changePct)}</td>
              <td>{item.passedRules}/8</td>
              <td>{item.failedRules.length > 0 ? item.failedRules.join('、') : '—'}</td>
              <td>
                {item.newsLabel ?? '—'}
                {item.newsNet != null ? ` (${item.newsNet > 0 ? '+' : ''}${item.newsNet})` : ''}
              </td>
              <td>{item.dataSource === 'realtime' ? '实时' : '日K'}</td>
              <td>{item.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EtfSummaryTable({ summaries }: { summaries: BacktestSymbolSummary[] }) {
  return (
    <div className="table-scroll-wrap">
      <table className="candidate-table">
        <thead>
          <tr>
            <th>ETF</th>
            <th>交易</th>
            <th>有效</th>
            <th>胜率</th>
            <th>平均收益</th>
            <th>中位收益</th>
            <th>单笔最高</th>
            <th>单笔最低</th>
          </tr>
        </thead>
        <tbody>
          {summaries.map((item) => (
            <tr key={item.symbol}>
              <td>
                {item.name} ({item.symbol})
              </td>
              <td>{item.tradeCount}</td>
              <td>{item.validTradeCount}</td>
              <td>{fmtPct(item.winRatePct)}</td>
              <td className={returnClass(item.avgReturnPct)}>
                {fmtPct(item.avgReturnPct)}
              </td>
              <td className={returnClass(item.medianReturnPct)}>
                {fmtPct(item.medianReturnPct)}
              </td>
              <td className={returnClass(item.bestReturnPct)}>
                {fmtPct(item.bestReturnPct)}
              </td>
              <td className={returnClass(item.worstReturnPct)}>
                {fmtPct(item.worstReturnPct)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PerformanceGroupTable({ groups }: { groups: BacktestGroup[] }) {
  return (
    <div className="table-scroll-wrap">
      <table className="candidate-table">
        <thead>
          <tr>
            <th>分组</th>
            <th>交易</th>
            <th>有效</th>
            <th>胜率</th>
            <th>平均收益</th>
            <th>中位收益</th>
            <th>单笔最高</th>
            <th>单笔最低</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <tr key={group.key}>
              <td>{group.label}</td>
              <td>{group.tradeCount}</td>
              <td>{group.validTradeCount}</td>
              <td>{fmtPct(group.winRatePct)}</td>
              <td className={returnClass(group.avgReturnPct)}>
                {fmtPct(group.avgReturnPct)}
              </td>
              <td className={returnClass(group.medianReturnPct)}>
                {fmtPct(group.medianReturnPct)}
              </td>
              <td className={returnClass(group.bestReturnPct)}>
                {fmtPct(group.bestReturnPct)}
              </td>
              <td className={returnClass(group.worstReturnPct)}>
                {fmtPct(group.worstReturnPct)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PortfolioHoldingsSection({
  snapshots,
  trades,
  initialCapital,
  comparisonResults,
}: {
  snapshots: BacktestPortfolioSnapshot[] | undefined;
  trades: BacktestTrade[];
  initialCapital?: number;
  comparisonResults?: EtfBacktestComparison[];
}) {
  const [page, setPage] = useState(0);
  const [mode, setMode] = useState<PortfolioSnapshotMode>('list');
  const [calendarMonthIndex, setCalendarMonthIndex] = useState(0);
  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(() => new Set());
  const pageSize = 100;
  const ordered = useMemo(
    () => buildPortfolioSnapshotViews(snapshots, trades),
    [snapshots, trades],
  );
  const comparisonSnapshotMaps = useMemo(
    () =>
      (comparisonResults ?? []).map((item) => ({
        item,
        snapshots: new Map(
          (item.result.portfolioSnapshots ?? []).map((snapshot) => [
            tradeDateKey(snapshot.tradeDate),
            snapshot,
          ]),
        ),
      })),
    [comparisonResults],
  );
  const listOrdered = useMemo(() => [...ordered].reverse(), [ordered]);
  const months = useMemo(() => buildPortfolioCalendarMonths(ordered), [ordered]);
  const tPlusDateEvents = useMemo<PortfolioTPlusDateEvent[]>(() => {
    const sources =
      comparisonSnapshotMaps.length > 0
        ? comparisonSnapshotMaps
        : [
            {
              item: {
                label: '当前方案',
                color: '#d4a017',
              },
              snapshots: new Map(
                (snapshots ?? []).map((snapshot) => [
                  tradeDateKey(snapshot.tradeDate),
                  snapshot,
                ]),
              ),
            },
          ];

    return sources
      .flatMap(({ item, snapshots: snapshotMap }) =>
        [...snapshotMap.entries()]
          .map(([dateKey, snapshot]) => {
            const trades = snapshot.tPlusTrades ?? [];
            if (trades.length === 0) return null;
            return {
              dateKey,
              label: item.label,
              color: item.color,
              tradeCount: trades.length,
              profit: trades.reduce((sum, trade) => sum + trade.profit, 0),
              names: [...new Set(trades.map((trade) => trade.name))],
            };
          })
          .filter((event): event is PortfolioTPlusDateEvent => Boolean(event)),
      )
      .sort((a, b) => b.dateKey.localeCompare(a.dateKey));
  }, [comparisonSnapshotMaps, snapshots]);
  const tPlusEventsByDate = useMemo(() => {
    const map = new Map<string, PortfolioTPlusDateEvent[]>();
    for (const event of tPlusDateEvents) {
      const items = map.get(event.dateKey) ?? [];
      items.push(event);
      map.set(event.dateKey, items);
    }
    return map;
  }, [tPlusDateEvents]);
  const latest = ordered[ordered.length - 1];
  const pageCount = Math.max(1, Math.ceil(listOrdered.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const pageStart = currentPage * pageSize;
  const pageEnd = Math.min(pageStart + pageSize, listOrdered.length);
  const visibleSnapshots = listOrdered.slice(pageStart, pageEnd);
  const currentMonthIndex = Math.min(calendarMonthIndex, Math.max(0, months.length - 1));
  const currentMonth = months[currentMonthIndex];

  useEffect(() => {
    setPage(0);
  }, [listOrdered]);

  useEffect(() => {
    setCalendarMonthIndex(Math.max(0, months.length - 1));
  }, [months.length]);

  function toggleSnapshot(dateKey: string) {
    setCollapsedDates((prev) => {
      const next = new Set(prev);
      if (next.has(dateKey)) next.delete(dateKey);
      else next.add(dateKey);
      return next;
    });
  }

  function jumpToDate(dateKey: string) {
    const index = listOrdered.findIndex((snapshot) => snapshot.dateKey === dateKey);
    if (index < 0) return;
    setPage(Math.floor(index / pageSize));
    setCollapsedDates((prev) => {
      const next = new Set(prev);
      next.delete(dateKey);
      return next;
    });
    setMode('list');
  }

  if (!latest) {
    return (
      <section className="section pane-card">
        <h2 className="section-title">每日持仓</h2>
        <div className="chart-empty">当前回测没有生成持仓快照。</div>
      </section>
    );
  }

  return (
    <section className="section pane-card">
      <div className="section-head">
        <div>
          <h2 className="section-title">每日持仓</h2>
          <p className="muted">
            买入/卖出按交易日标记；日收益按相邻交易日总资产变化计算，累计收益沿用回测净值；持仓收益率按当日收盘价相对买入价计算。
          </p>
        </div>
        <div className="portfolio-view-switch" aria-label="每日持仓视图">
          <button
            type="button"
            className={mode === 'list' ? 'portfolio-view-switch-button portfolio-view-switch-button--active' : 'portfolio-view-switch-button'}
            onClick={() => setMode('list')}
          >
            明细
          </button>
          <button
            type="button"
            className={mode === 'calendar' ? 'portfolio-view-switch-button portfolio-view-switch-button--active' : 'portfolio-view-switch-button'}
            onClick={() => setMode('calendar')}
          >
            日历
          </button>
        </div>
      </div>

      <div className="overview-metric-grid overview-metric-grid--compact">
        <SummaryMetric label="初始资金" value={`${fmtMoney(initialCapital ?? null)} 元`} />
        <SummaryMetric label="最新总资产" value={`${fmtMoney(latest.totalValue)} 元`} tone={latest.returnPct} />
        <SummaryMetric label="最新日收益" value={fmtPct(latest.dailyReturnPct)} tone={latest.dailyReturnPct} />
        <SummaryMetric label="累计收益" value={fmtPct(latest.returnPct)} tone={latest.returnPct} />
      </div>

      {tPlusDateEvents.length > 0 ? (
        <PortfolioTPlusTimeline events={tPlusDateEvents} onSelectDate={jumpToDate} />
      ) : null}

      {mode === 'calendar' && currentMonth && (
        <div className="portfolio-calendar">
          <div className="portfolio-calendar-head">
            <div>
              <strong>{currentMonth.label}</strong>
              <span>
                {currentMonth.tradeDays} 个交易日 · 上涨 {currentMonth.upDays} 天 · 下跌 {currentMonth.downDays} 天
              </span>
            </div>
            <div className="portfolio-snapshot-pagination" aria-label="收益日历月份分页">
              <button
                type="button"
                className="button button-secondary"
                disabled={currentMonthIndex === 0}
                onClick={() => setCalendarMonthIndex((value) => Math.max(0, value - 1))}
              >
                上月
              </button>
              <span>
                {currentMonthIndex + 1} / {months.length}
              </span>
              <button
                type="button"
                className="button button-secondary"
                disabled={currentMonthIndex >= months.length - 1}
                onClick={() => setCalendarMonthIndex((value) => Math.min(months.length - 1, value + 1))}
              >
                下月
              </button>
            </div>
          </div>
          <div className="portfolio-calendar-weekdays" aria-hidden="true">
            {['一', '二', '三', '四', '五', '六', '日'].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="portfolio-calendar-grid">
            {Array.from({ length: currentMonth.blanks }, (_, index) => (
              <div className="portfolio-calendar-blank" key={`blank-${currentMonth.key}-${index}`} />
            ))}
            {currentMonth.cells.map((cell) => {
              const tPlusEvents = tPlusEventsByDate.get(cell.dateKey) ?? [];
              return cell.snapshot ? (
                  <button
                    type="button"
                    className={`portfolio-calendar-day portfolio-calendar-day--trade ${returnClass(cell.snapshot.dailyReturnPct)}`}
                    key={cell.dateKey}
                    onClick={() => jumpToDate(cell.dateKey)}
                  >
                    <span className="portfolio-calendar-date">{cell.day}</span>
                    <strong>{fmtPct(cell.snapshot.dailyReturnPct)}</strong>
                    <small>累计 {fmtPct(cell.snapshot.returnPct)}</small>
                    <PortfolioActionSummary snapshot={cell.snapshot} compact />
                    <PortfolioTPlusDateBadge events={tPlusEvents} compact />
                  </button>
                ) : (
                  <div className="portfolio-calendar-day portfolio-calendar-day--empty" key={cell.dateKey}>
                    <span className="portfolio-calendar-date">{cell.day}</span>
                    <PortfolioTPlusDateBadge events={tPlusEvents} compact />
                  </div>
                );
            })}
          </div>
        </div>
      )}

      {mode === 'list' && (
        <>
          <div className="portfolio-snapshot-toolbar">
            <span>
              按日期从新到旧 · 显示第 {pageStart + 1}-{pageEnd} 天 / 共 {listOrdered.length} 天
            </span>
            <div className="portfolio-snapshot-pagination" aria-label="每日持仓分页">
              <button
                type="button"
                className="button button-secondary"
                disabled={currentPage === 0}
                onClick={() => setPage(0)}
              >
                首页
              </button>
              <button
                type="button"
                className="button button-secondary"
                disabled={currentPage === 0}
                onClick={() => setPage((value) => Math.max(0, value - 1))}
              >
                上一页
              </button>
              <span>
                {currentPage + 1} / {pageCount}
              </span>
              <button
                type="button"
                className="button button-secondary"
                disabled={currentPage >= pageCount - 1}
                onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
              >
                下一页
              </button>
              <button
                type="button"
                className="button button-secondary"
                disabled={currentPage >= pageCount - 1}
                onClick={() => setPage(pageCount - 1)}
              >
                末页
              </button>
            </div>
          </div>

          <div className="portfolio-snapshot-list">
            {visibleSnapshots.map((snapshot) => (
              <details
                className="portfolio-snapshot"
                key={snapshot.tradeDate}
                open={!collapsedDates.has(snapshot.dateKey)}
              >
                <summary
                  onClick={(event) => {
                    event.preventDefault();
                    toggleSnapshot(snapshot.dateKey);
                  }}
                >
                  <span>{fmtTradeDate(snapshot.tradeDate)}</span>
                  <span>总资产 {fmtMoney(snapshot.totalValue)} 元</span>
                  <strong className={returnClass(snapshot.dailyReturnPct)}>
                    日 {fmtPct(snapshot.dailyReturnPct)}
                  </strong>
                  <strong className={returnClass(snapshot.returnPct)}>
                    累计 {fmtPct(snapshot.returnPct)}
                  </strong>
                  <PortfolioActionSummary snapshot={snapshot} />
                  <PortfolioTPlusDateBadge events={tPlusEventsByDate.get(snapshot.dateKey) ?? []} />
                  <span>{snapshot.positions.length} 个持仓</span>
                </summary>
                <PortfolioPositionActivityTable snapshot={snapshot} />
                {comparisonSnapshotMaps.length > 1 ? (
                  <PortfolioComparisonSnapshotPanel
                    dateKey={snapshot.dateKey}
                    comparisonSnapshotMaps={comparisonSnapshotMaps}
                  />
                ) : null}
              </details>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function PortfolioTPlusTimeline({
  events,
  onSelectDate,
}: {
  events: PortfolioTPlusDateEvent[];
  onSelectDate: (dateKey: string) => void;
}) {
  const totalTrades = events.reduce((sum, event) => sum + event.tradeCount, 0);
  const totalProfit = events.reduce((sum, event) => sum + event.profit, 0);

  return (
    <div className="portfolio-tplus-timeline">
      <div className="portfolio-tplus-timeline-head">
        <strong>正T时间线</strong>
        <span className={returnClass(totalProfit)}>
          {events.length} 天 · {totalTrades} 笔 · {fmtMoneyDiff(totalProfit)}
        </span>
      </div>
      <div className="portfolio-tplus-timeline-list">
        {events.map((event) => (
          <button
            key={`${event.dateKey}-${event.label}`}
            type="button"
            className="portfolio-tplus-date-chip"
            onClick={() => onSelectDate(event.dateKey)}
          >
            <i style={{ background: event.color }} aria-hidden="true" />
            <strong>{fmtTradeDate(event.dateKey)}</strong>
            <span>{event.label}</span>
            <em>{event.tradeCount} 笔</em>
            <b className={returnClass(event.profit)}>{fmtMoneyDiff(event.profit)}</b>
            <small>{event.names.slice(0, 2).join('、')}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

function PortfolioTPlusDateBadge({
  events,
  compact = false,
}: {
  events: PortfolioTPlusDateEvent[];
  compact?: boolean;
}) {
  if (events.length === 0) return null;
  const tradeCount = events.reduce((sum, event) => sum + event.tradeCount, 0);
  const profit = events.reduce((sum, event) => sum + event.profit, 0);

  return (
    <span className={`portfolio-tplus-date-badge${compact ? ' portfolio-tplus-date-badge--compact' : ''}`}>
      T {tradeCount}
      {!compact ? <em className={returnClass(profit)}>{fmtMoneyDiff(profit)}</em> : null}
    </span>
  );
}

function PortfolioActionSummary({
  snapshot,
  compact = false,
}: {
  snapshot: Pick<PortfolioSnapshotView, 'buyCount' | 'sellCount'>;
  compact?: boolean;
}) {
  if (snapshot.buyCount === 0 && snapshot.sellCount === 0) {
    return compact ? <span className="portfolio-action-summary portfolio-action-summary--empty">无交易</span> : <span>无交易</span>;
  }

  return (
    <span className="portfolio-action-summary">
      {snapshot.buyCount > 0 && <span className="portfolio-action-pill portfolio-action-pill--buy">买 {snapshot.buyCount}</span>}
      {snapshot.sellCount > 0 && <span className="portfolio-action-pill portfolio-action-pill--sell">卖 {snapshot.sellCount}</span>}
    </span>
  );
}

function PortfolioPositionActivityTable({ snapshot }: { snapshot: PortfolioSnapshotView }) {
  const actionsBySymbol = new Map<string, PortfolioSnapshotAction[]>();
  for (const action of snapshot.actions) {
    const items = actionsBySymbol.get(action.symbol) ?? [];
    items.push(action);
    actionsBySymbol.set(action.symbol, items);
  }

  const tPlusBySymbol = new Map<string, NonNullable<BacktestPortfolioSnapshot['tPlusTrades']>>();
  for (const trade of snapshot.tPlusTrades ?? []) {
    const items = tPlusBySymbol.get(trade.symbol) ?? [];
    items.push(trade);
    tPlusBySymbol.set(trade.symbol, items);
  }

  const activeSymbols = new Set(snapshot.positions.map((position) => position.symbol));
  const soldOnlyActions = snapshot.actions.filter(
    (action) => action.action === 'sell' && !activeSymbols.has(action.symbol),
  );
  const rows: Array<
    | { kind: 'position'; key: string; position: BacktestPositionSnapshot }
    | { kind: 'sold'; key: string; action: PortfolioSnapshotAction }
  > = [
    ...snapshot.positions.map((position) => ({
      kind: 'position' as const,
      key: `${snapshot.tradeDate}-${position.symbol}-${position.entryDate}`,
      position,
    })),
    ...soldOnlyActions.map((action, index) => ({
      kind: 'sold' as const,
      key: `${snapshot.tradeDate}-sold-${action.symbol}-${index}`,
      action,
    })),
  ];

  if (rows.length === 0) {
    return <p className="muted portfolio-snapshot-empty">当日无持仓，资金全部为空仓现金。</p>;
  }

  return (
    <div className="table-scroll-wrap">
      <table className="candidate-table portfolio-position-table">
        <thead>
          <tr>
            <th>名称</th>
            <th>当日动作</th>
            <th>类型</th>
            <th>买入日</th>
            <th>买入/卖出价</th>
            <th>股数/份额</th>
            <th>成本/成交额</th>
            <th>市值/占用</th>
            <th>收益率</th>
            <th>权重</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            if (row.kind === 'sold') {
              const action = row.action;
              return (
                <tr key={row.key} className="portfolio-position-row--sold">
                  <td title={action.symbol}>{action.name}</td>
                  <td>
                    <PortfolioActivityCell actions={[action]} tPlusTrades={[]} />
                  </td>
                  <td>{action.assetType === 'etf' ? 'ETF' : '股票'}</td>
                  <td>—</td>
                  <td>{fmtPrice(action.price)}</td>
                  <td className="text-down">
                    {action.shares != null ? `-${fmtNumber(action.shares, 0)}` : '—'}
                  </td>
                  <td>{action.amount != null ? `${fmtMoney(action.amount)} 元` : '—'}</td>
                  <td>—</td>
                  <td className={returnClass(action.returnPct ?? null)}>
                    {fmtPct(action.returnPct ?? null)}
                  </td>
                  <td>0%</td>
                </tr>
              );
            }

            const position = row.position;
            const rowActions = actionsBySymbol.get(position.symbol) ?? [];
            const rowTPlusTrades = tPlusBySymbol.get(position.symbol) ?? [];
            return (
              <tr key={row.key}>
                <td title={position.symbol}>{displayHoldingName(position)}</td>
                <td>
                  <PortfolioActivityCell
                    actions={rowActions}
                    tPlusTrades={rowTPlusTrades}
                    fallback={rowActions.length > 0 || rowTPlusTrades.length > 0 ? undefined : '持有'}
                  />
                </td>
                <td>{position.assetType === 'etf' ? 'ETF' : '股票'}</td>
                <td>{fmtTradeDate(position.entryDate)}</td>
                <td>{fmtPrice(position.entryPrice)}</td>
                <td>{fmtNumber(position.shares, 2)}</td>
                <td>{fmtMoney(position.costAmount)} 元</td>
                <td>{fmtMoney(position.marketValue)} 元</td>
                <td className={returnClass(position.returnPct)}>
                  {fmtPct(position.returnPct)}
                </td>
                <td>{fmtNumber(position.weightPct)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PortfolioActivityCell({
  actions,
  tPlusTrades,
  fallback,
}: {
  actions: PortfolioSnapshotAction[];
  tPlusTrades: NonNullable<BacktestPortfolioSnapshot['tPlusTrades']>;
  fallback?: string;
}) {
  const tPlusProfit = tPlusTrades.reduce((sum, trade) => sum + trade.profit, 0);
  const tPlusShares = tPlusTrades.reduce((sum, trade) => sum + trade.shares, 0);

  return (
    <div className="portfolio-activity-cell">
      {actions.map((action, index) => {
        if (action.action === 'rebalance') {
          const label =
            action.rebalanceDirection === 'increase'
              ? '调仓加仓'
              : action.rebalanceDirection === 'decrease'
                ? '调仓减仓'
                : '调仓续持';
          const netPrefix =
            action.netShares == null || Math.abs(action.netShares) < 0.01
              ? ''
              : action.netShares > 0
                ? '+'
                : '-';
          return (
            <span
              key={`${action.action}-${action.symbol}-${index}`}
              className="portfolio-activity-badge portfolio-activity-badge--rebalance"
            >
              <strong>{label}</strong>
              <em>
                卖 {fmtNumber(action.sellShares ?? 0, 0)} / 买{' '}
                {fmtNumber(action.buyShares ?? 0, 0)} 份
              </em>
              <em>
                卖 {fmtPrice(action.sellPrice ?? null)} / 买 {fmtPrice(action.buyPrice ?? null)}
              </em>
              {action.netShares != null ? (
                <em>净 {netPrefix}{fmtNumber(Math.abs(action.netShares), 0)} 份</em>
              ) : null}
              <em>日线收盘模拟</em>
            </span>
          );
        }
        return (
          <span
            key={`${action.action}-${action.symbol}-${index}`}
            className={`portfolio-activity-badge portfolio-activity-badge--${action.action}`}
          >
            <strong>{action.action === 'buy' ? '买入' : '卖出'}</strong>
            {action.shares != null ? (
              <em>{action.action === 'sell' ? '-' : '+'}{fmtNumber(action.shares, 0)} 份</em>
            ) : null}
            {action.price != null ? <em>@ {fmtPrice(action.price)}</em> : null}
            {action.amount != null ? <em>{fmtMoney(action.amount)} 元</em> : null}
            {action.reason ? <em>{fmtExitReason(action.reason)}</em> : null}
          </span>
        );
      })}
      {tPlusTrades.length > 0 ? (
        <span className="portfolio-activity-badge portfolio-activity-badge--tplus">
          <strong>正T {tPlusTrades.length}笔</strong>
          <em>{fmtNumber(tPlusShares, 0)} 份</em>
          <em className={returnClass(tPlusProfit)}>{fmtMoneyDiff(tPlusProfit)}</em>
        </span>
      ) : null}
      {actions.length === 0 && tPlusTrades.length === 0 && fallback ? (
        <span className="portfolio-activity-badge portfolio-activity-badge--hold">
          {fallback}
        </span>
      ) : null}
    </div>
  );
}

function PortfolioActionChip({ action }: { action: PortfolioSnapshotAction }) {
  if (action.action === 'rebalance') {
    const label =
      action.rebalanceDirection === 'increase'
        ? '调仓加仓'
        : action.rebalanceDirection === 'decrease'
          ? '调仓减仓'
          : '调仓续持';
    return (
      <div className="portfolio-action-chip portfolio-action-chip--rebalance">
        <strong>{label}</strong>
        <span title={action.symbol}>
          {action.name && action.name !== action.symbol ? action.name : action.symbol}
        </span>
        <small>
          {action.assetType === 'etf' ? 'ETF' : '股票'} · 卖 {fmtNumber(action.sellShares ?? 0, 0)} 份 @{' '}
          {fmtPrice(action.sellPrice ?? null)} · 买 {fmtNumber(action.buyShares ?? 0, 0)} 份 @{' '}
          {fmtPrice(action.buyPrice ?? null)}
        </small>
      </div>
    );
  }
  return (
    <div className={`portfolio-action-chip portfolio-action-chip--${action.action}`}>
      <strong>{action.action === 'buy' ? '买入' : '卖出'}</strong>
      <span title={action.symbol}>
        {action.name && action.name !== action.symbol ? action.name : action.symbol}
      </span>
      <small>
        {action.assetType === 'etf' ? 'ETF' : '股票'} · {fmtPrice(action.price)}
        {action.shares != null ? ` · ${fmtNumber(action.shares, 0)} 份` : ''}
        {action.amount != null ? ` · ${fmtMoney(action.amount)} 元` : ''}
        {action.action === 'sell' && action.returnPct != null ? ` · ${fmtPct(action.returnPct)}` : ''}
        {action.reason ? ` · ${fmtExitReason(action.reason)}` : ''}
      </small>
    </div>
  );
}

function PortfolioTPlusPanel({
  trades,
}: {
  trades: NonNullable<BacktestPortfolioSnapshot['tPlusTrades']>;
}) {
  const totalProfit = trades.reduce((sum, trade) => sum + trade.profit, 0);
  return (
    <div className="portfolio-tplus-panel">
      <div className="portfolio-tplus-head">
        <h3>当日正T</h3>
        <span className={returnClass(totalProfit)}>
          {trades.length} 笔 · {fmtMoneyDiff(totalProfit)}
        </span>
      </div>
      <div className="portfolio-tplus-list">
        {trades.map((trade, index) => (
          <div className="portfolio-tplus-chip" key={`${trade.symbol}-${index}`}>
            <strong title={trade.symbol}>{trade.name}</strong>
            <span>
              买 {fmtPrice(trade.buyPrice)} / 卖 {fmtPrice(trade.sellPrice)}
            </span>
            <small>
              {fmtNumber(trade.shares, 0)} 份 · 成本 {fmtMoney(trade.spent)} 元 · 盈利{' '}
              <b className={returnClass(trade.profit)}>{fmtMoneyDiff(trade.profit)}</b>
              {trade.profitPct != null ? ` · ${fmtPct(trade.profitPct)}` : ''}
            </small>
          </div>
        ))}
      </div>
    </div>
  );
}

function PortfolioComparisonSnapshotPanel({
  dateKey,
  comparisonSnapshotMaps,
}: {
  dateKey: string;
  comparisonSnapshotMaps: Array<{
    item: EtfBacktestComparison;
    snapshots: Map<string, BacktestPortfolioSnapshot>;
  }>;
}) {
  const baseline = comparisonSnapshotMaps[0];
  const baselineSnapshot = baseline?.snapshots.get(dateKey);
  if (!baseline || !baselineSnapshot) return null;

  const rows = comparisonSnapshotMaps.map(({ item, snapshots }, index) => {
    const snapshot = snapshots.get(dateKey);
    const shareDiffs = buildShareDiffSummary(baselineSnapshot, snapshot);
    const tPlusTrades = snapshot?.tPlusTrades ?? [];
    const tPlusProfit = tPlusTrades.reduce((sum, trade) => sum + trade.profit, 0);
    return {
      item,
      snapshot,
      isBaseline: index === 0,
      totalDiff: snapshot ? snapshot.totalValue - baselineSnapshot.totalValue : null,
      cashDiff: snapshot ? snapshot.cash - baselineSnapshot.cash : null,
      marketDiff: snapshot ? snapshot.investedMarketValue - baselineSnapshot.investedMarketValue : null,
      returnDiff: snapshot ? snapshot.returnPct - baselineSnapshot.returnPct : null,
      shareDiffs,
      tPlusTrades,
      tPlusProfit,
    };
  });

  return (
    <div className="portfolio-comparison-panel">
      <div className="portfolio-comparison-head">
        <h3>方案差异</h3>
        <span>以 {baseline.item.label} 为基准，同一天对比现金、市值、份额和正T。</span>
      </div>
      <div className="table-scroll-wrap">
        <table className="candidate-table portfolio-comparison-table">
          <thead>
            <tr>
              <th>方案</th>
              <th>累计差</th>
              <th>总资产差</th>
              <th>现金差</th>
              <th>市值差</th>
              <th>份额差异</th>
              <th>当日正T</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.item.variant}>
                <td>
                  <span className="backtest-comparison-name">
                    <i style={{ background: row.item.color }} aria-hidden="true" />
                    {row.item.label}
                  </span>
                </td>
                <td className={returnClass(row.returnDiff)}>
                  {row.isBaseline ? '基准' : fmtPct(row.returnDiff)}
                </td>
                <td className={returnClass(row.totalDiff)}>
                  {row.isBaseline ? '—' : fmtMoneyDiff(row.totalDiff)}
                </td>
                <td className={returnClass(row.cashDiff)}>
                  {row.isBaseline ? '—' : fmtMoneyDiff(row.cashDiff)}
                </td>
                <td className={returnClass(row.marketDiff)}>
                  {row.isBaseline ? '—' : fmtMoneyDiff(row.marketDiff)}
                </td>
                <td>
                  {row.shareDiffs.length > 0 ? (
                    <span className="portfolio-share-diff-list">
                      {row.shareDiffs.slice(0, 4).map((diff) => (
                        <span key={diff.symbol} className={returnClass(diff.diff)}>
                          {diff.name} {diff.diff > 0 ? '+' : ''}{fmtNumber(diff.diff, 0)}
                        </span>
                      ))}
                      {row.shareDiffs.length > 4 ? <span>等 {row.shareDiffs.length} 项</span> : null}
                    </span>
                  ) : (
                    <span className="muted">无</span>
                  )}
                </td>
                <td>
                  {row.tPlusTrades.length > 0 ? (
                    <span className="portfolio-tplus-inline">
                      <strong className={returnClass(row.tPlusProfit)}>
                        {row.tPlusTrades.length} 笔 · {fmtMoneyDiff(row.tPlusProfit)}
                      </strong>
                      <small>
                        {row.tPlusTrades.map((trade) => trade.name).join('、')}
                      </small>
                    </span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TradeDetailsSection({
  trades,
  selectedTradeKey,
  onSelectTrade,
}: {
  trades: BacktestTrade[];
  selectedTradeKey?: string;
  onSelectTrade?: (trade: BacktestTrade, index: number) => void;
}) {
  const orderedTrades = useMemo(() => sortTradesOldestFirst(trades), [trades]);

  return (
    <section className="section pane-card">
      <h2 className="section-title">交易详情</h2>
      <div className="table-scroll-wrap">
        <table className="candidate-table">
          <thead>
            <tr>
              <th>股票名称</th>
              <th>类型</th>
              <th>买入日</th>
              <th>买入价</th>
              <th>卖出日</th>
              <th>卖出价</th>
              <th>持有天数</th>
              <th>收益</th>
              <th>新闻</th>
              <th>退出原因</th>
            </tr>
          </thead>
          <tbody>
            {orderedTrades.slice(0, 200).map((trade, index) => {
              const key = tradeRowKey(trade, index);
              return (
                <tr
                  key={key}
                  className={`${onSelectTrade ? 'candidate-table-row--clickable' : ''}${selectedTradeKey === key ? ' candidate-table-row--active' : ''}`}
                  onClick={() => onSelectTrade?.(trade, index)}
                >
                  <td>
                    {displayTradeName(trade)}
                  </td>
                  <td>{trade.assetType === 'etf' ? 'ETF' : '股票'}</td>
                  <td>{fmtTradeDate(trade.entryDate)}</td>
                  <td>{fmtPrice(trade.entryPrice)}</td>
                  <td>{fmtTradeDate(trade.exitDate)}</td>
                  <td>{fmtPrice(trade.exitPrice)}</td>
                  <td>{trade.holdDays}</td>
                  <td className={returnClass(trade.returnPct)}>
                    {fmtPct(trade.returnPct)}
                  </td>
                  <td>
                    {String(trade.signal?.metadata?.newsLabel ?? '—')}
                    {trade.signal?.metadata?.newsNet != null
                      ? ` (${trade.signal.metadata.newsNet > 0 ? '+' : ''}${trade.signal.metadata.newsNet})`
                      : ''}
                  </td>
                  <td>{fmtExitReason(trade.exitReason)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {orderedTrades.length > 200 && (
        <p className="muted">仅展示前 200 笔，完整明细可通过 `/api/backtest` 获取。</p>
      )}
    </section>
  );
}

function EtfComparisonDiffTable({
  comparisonResults,
}: {
  comparisonResults: EtfBacktestComparison[];
}) {
  if (comparisonResults.length <= 1) return null;

  const baseline = comparisonResults[0];
  const baselineSnapshot = finalPortfolioSnapshot(baseline.result);
  const baselineReturn = finalEquityReturnPct(baseline.result);
  if (!baselineSnapshot) return null;

  const rows = comparisonResults.map((item, index) => {
    const snapshot = finalPortfolioSnapshot(item.result);
    const returnPct = finalEquityReturnPct(item.result);
    const returnDiff =
      returnPct != null && baselineReturn != null
        ? Number((returnPct - baselineReturn).toFixed(2))
        : null;
    return {
      item,
      isBaseline: index === 0,
      snapshot,
      returnPct,
      returnDiff,
      totalDiff: snapshot ? snapshot.totalValue - baselineSnapshot.totalValue : null,
      cashDiff: snapshot ? snapshot.cash - baselineSnapshot.cash : null,
      marketDiff: snapshot
        ? snapshot.investedMarketValue - baselineSnapshot.investedMarketValue
        : null,
      tPlusTradeCount: item.result.config?.tPlusTradeCount ?? 0,
      tPlusTotalProfitPct: item.result.config?.tPlusTotalProfitPct ?? null,
    };
  });

  return (
    <div className="backtest-comparison-diff">
      <div className="backtest-comparison-diff-head">
        <strong>方案差异</strong>
        <span className="muted">以 {baseline.label} 为基准；金额按最终一个交易日的组合快照计算。</span>
      </div>
      <div className="table-scroll-wrap">
        <table className="candidate-table backtest-comparison-table">
          <thead>
            <tr>
              <th>方案</th>
              <th>最终收益</th>
              <th>收益差</th>
              <th>总资产差</th>
              <th>现金差</th>
              <th>市值差</th>
              <th>正T次数</th>
              <th>正T贡献</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.item.variant}>
                <td>
                  <span className="backtest-comparison-name">
                    <i style={{ background: row.item.color }} aria-hidden="true" />
                    {row.item.label}
                  </span>
                </td>
                <td className={returnClass(row.returnPct)}>{fmtPct(row.returnPct)}</td>
                <td className={returnClass(row.returnDiff)}>
                  {row.isBaseline ? '基准' : fmtPct(row.returnDiff)}
                </td>
                <td className={returnClass(row.totalDiff)}>
                  {row.isBaseline ? '—' : `${fmtMoney(row.totalDiff, 2)} 元`}
                </td>
                <td className={returnClass(row.cashDiff)}>
                  {row.isBaseline ? '—' : `${fmtMoney(row.cashDiff, 2)} 元`}
                </td>
                <td className={returnClass(row.marketDiff)}>
                  {row.isBaseline ? '—' : `${fmtMoney(row.marketDiff, 2)} 元`}
                </td>
                <td>{row.tPlusTradeCount > 0 ? `${row.tPlusTradeCount} 次` : '—'}</td>
                <td className={returnClass(row.tPlusTotalProfitPct)}>
                  {row.tPlusTotalProfitPct != null && row.tPlusTotalProfitPct !== 0
                    ? fmtPct(row.tPlusTotalProfitPct)
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SummaryMetric({
  label,
  value,
  tone,
  inverse = false,
}: {
  label: string;
  value: string;
  tone?: number | null;
  inverse?: boolean;
}) {
  const effectiveTone = inverse && tone != null ? -tone : tone;
  return (
    <div className="overview-metric-card">
      <span className="muted">{label}</span>
      <strong className={returnClass(effectiveTone ?? null)}>{value}</strong>
    </div>
  );
}

function DecisionBadge({
  action,
  label,
}: {
  action: BacktestCurrentDecision['action'];
  label: string;
}) {
  return <span className={`decision-badge decision-badge--${action}`}>{label}</span>;
}

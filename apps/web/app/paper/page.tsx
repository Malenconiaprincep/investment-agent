'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { EquityChart, type EquityPoint } from '@/components/charts/EquityChart';
import { OpenWatchlistPanelButton } from '@/components/OpenWatchlistPanelButton';
import { PageHeader } from '@/components/ui/PageHeader';
import {
  normalizeDualPaperPayload,
  PAPER_BUCKET_TABS,
  resolvePaperView,
  type DualPaperPayload,
  type PaperBucketKey,
} from '@/lib/paper-dual';
import { formatPaperTradeDisplayTime } from '@/lib/paper-trade-time';

type PaperBucket = PaperBucketKey;

type Trade = {
  id: string;
  bucket?: PaperBucketKey;
  symbol: string;
  name: string;
  side: 'buy' | 'sell';
  shares: number;
  price: number;
  amount: number;
  tradeDate: string;
  tradedAt: string;
  source: 'manual' | 'auto';
  note: string | null;
};

type StockBacktestManualCheckResult = {
  bucket: 'stock-backtest';
  tradeDate: string;
  skipped?: boolean;
  reason?: string;
  dataFreshness?: {
    expectedDataDate: string;
    latestDataDate: string | null;
    isFresh: boolean;
  };
  scan?: {
    scanned: number;
    rawSignals: number;
    candidates: number;
  };
  trades?: {
    buys: Array<{ symbol: string; name: string; shares: number; price: number; memo: string }>;
    sells: Array<{ symbol: string; name: string; shares: number; price: number; reason: string }>;
  };
  equity?: {
    totalValue: number;
    returnPct: number;
  };
  error?: string;
};

type StockBacktestManualCheckProgress = {
  type: 'progress';
  stage: string;
  message: string;
  detail?: string;
  percent: number;
  elapsedMs: number;
};

type StockBacktestManualCheckStreamEvent =
  | StockBacktestManualCheckProgress
  | { type: 'result'; result: StockBacktestManualCheckResult }
  | { type: 'error'; message: string };

type DailyEquityRow = {
  tradeDate: string;
  status: 'profit' | 'loss' | 'flat';
  dailyPnl: number;
  dailyPct: number;
  totalValue: number;
  totalReturnAmount: number;
  totalReturnPct: number;
};

type DailyTradeBucketKey = PaperBucketKey | 'unknown';

type DailyTradeBucketGroup = {
  bucket: DailyTradeBucketKey;
  label: string;
  trades: Trade[];
  buyAmount: number;
  sellAmount: number;
  netCashFlow: number;
};

type DailyTradeGroup = {
  tradeDate: string;
  trades: Trade[];
  bucketGroups: DailyTradeBucketGroup[];
  buyAmount: number;
  sellAmount: number;
  netCashFlow: number;
};

function fmtMoney(v: number) {
  return v.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
}

function fmtSignedMoney(v: number) {
  if (v === 0) return '0';
  return `${v > 0 ? '+' : ''}${fmtMoney(v)}`;
}

function fmtSignedPct(v: number) {
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return '0.00%';
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function returnClass(value: number) {
  if (value > 0) return 'return-up';
  if (value < 0) return 'return-down';
  return 'muted';
}

function isEtfSymbol(symbol: string) {
  return /^(51|56|58|15|16)\d{4}$/.test(symbol) || /^159\d{3}$/.test(symbol);
}

function fmtTradePrice(symbol: string, value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toFixed(isEtfSymbol(symbol) ? 3 : 2);
}

function fmtElapsed(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${rest}s`;
}

function formatTradeSource(trade: Trade) {
  if (trade.note?.includes('ETF 正T')) return 'ETF 正T';
  if (trade.note?.includes('ETF 动量')) return 'ETF 动量';
  if (trade.note?.startsWith('monitor-watchlist:')) return '消息雷达';
  if (trade.note?.startsWith('monitor:')) return '消息雷达';
  if (trade.note?.startsWith('monitor-exit:')) return '规则卖出';
  if (trade.note?.includes('回测策略')) return '回测策略';
  if (trade.note?.includes('动量派')) return '动量选股';
  return trade.source === 'auto' ? '自动' : '手动';
}

function formatTradeNote(note: string | null) {
  if (!note) return '—';
  if (note.startsWith('monitor-watchlist:')) return '自选跟踪动量达标自动买入';
  if (note.startsWith('monitor:')) return '消息雷达自动买入';
  if (note.startsWith('monitor-exit:')) {
    return `消息雷达卖出检查：${note.replace('monitor-exit:', '')}`;
  }
  return note;
}

function normalizeEquityTradeDate(value: string): string {
  const key = value.trim().replace(/-/g, '').slice(0, 8);
  if (key.length !== 8) return value.trim();
  return `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
}

function pointInitialCash(point: Pick<EquityPoint, 'totalValue' | 'returnPct'>): number {
  const denominator = 1 + point.returnPct / 100;
  if (!Number.isFinite(denominator) || denominator <= 0) return point.totalValue;
  return point.totalValue / denominator;
}

function buildDailyEquityRows(points: EquityPoint[]): DailyEquityRow[] {
  const byDate = new Map<string, EquityPoint>();
  for (const point of points) {
    byDate.set(normalizeEquityTradeDate(point.tradeDate), {
      ...point,
      tradeDate: normalizeEquityTradeDate(point.tradeDate),
    });
  }

  const sorted = [...byDate.values()].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  return sorted
    .map((point, index) => {
      const initialCash = pointInitialCash(point);
      const previousTotalValue =
        index > 0 ? sorted[index - 1].totalValue : initialCash;
      const dailyPnl = Number((point.totalValue - previousTotalValue).toFixed(2));
      const dailyPct =
        previousTotalValue > 0
          ? Number(((dailyPnl / previousTotalValue) * 100).toFixed(2))
          : 0;
      const totalReturnAmount = Number((point.totalValue - initialCash).toFixed(2));
      const status: DailyEquityRow['status'] =
        dailyPnl > 0 ? 'profit' : dailyPnl < 0 ? 'loss' : 'flat';

      return {
        tradeDate: point.tradeDate,
        status,
        dailyPnl,
        dailyPct,
        totalValue: point.totalValue,
        totalReturnAmount,
        totalReturnPct: point.returnPct,
      };
    })
    .reverse();
}

function formatTradeTimeOnly(trade: Trade): string {
  const display = formatPaperTradeDisplayTime(trade);
  return display.split(' ').pop() ?? display;
}

function addTradeToBucketGroup(
  buckets: Map<DailyTradeBucketKey, DailyTradeBucketGroup>,
  trade: Trade,
  fallbackBucket?: PaperBucketKey,
) {
  const bucket = trade.bucket ?? fallbackBucket ?? 'unknown';
  const label = bucket === 'unknown' ? '未分仓' : bucketShortLabel(bucket);
  const group =
    buckets.get(bucket) ??
    {
      bucket,
      label,
      trades: [],
      buyAmount: 0,
      sellAmount: 0,
      netCashFlow: 0,
    };

  group.trades.push(trade);
  if (trade.side === 'buy') group.buyAmount += trade.amount;
  else group.sellAmount += trade.amount;
  group.netCashFlow = group.sellAmount - group.buyAmount;
  buckets.set(bucket, group);
}

function finalizeTradeBucketGroup(group: DailyTradeBucketGroup): DailyTradeBucketGroup {
  return {
    ...group,
    buyAmount: Number(group.buyAmount.toFixed(2)),
    sellAmount: Number(group.sellAmount.toFixed(2)),
    netCashFlow: Number(group.netCashFlow.toFixed(2)),
    trades: [...group.trades].sort((a, b) => {
      const aTime = formatTradeTimeOnly(a);
      const bTime = formatTradeTimeOnly(b);
      return aTime.localeCompare(bTime) || a.id.localeCompare(b.id);
    }),
  };
}

function buildDailyTradeGroups(
  trades: Trade[],
  fallbackBucket?: PaperBucketKey,
): DailyTradeGroup[] {
  const groups = new Map<string, DailyTradeGroup>();
  for (const trade of trades) {
    const tradeDate = normalizeEquityTradeDate(trade.tradeDate);
    const group =
      groups.get(tradeDate) ??
      {
        tradeDate,
        trades: [],
        bucketGroups: [],
        buyAmount: 0,
        sellAmount: 0,
        netCashFlow: 0,
      };

    group.trades.push(trade);
    if (trade.side === 'buy') group.buyAmount += trade.amount;
    else group.sellAmount += trade.amount;
    group.netCashFlow = group.sellAmount - group.buyAmount;
    groups.set(tradeDate, group);
  }

  const bucketOrder: DailyTradeBucketKey[] = [
    'etf',
    'etf-t-plus',
    'stock',
    'stock-backtest',
    'stock-backtest-news',
    'unknown',
  ];

  return [...groups.values()]
    .map((group) => {
      const buckets = new Map<DailyTradeBucketKey, DailyTradeBucketGroup>();
      for (const trade of group.trades) {
        addTradeToBucketGroup(buckets, trade, fallbackBucket);
      }

      const bucketGroups = [...buckets.values()]
        .map(finalizeTradeBucketGroup)
        .sort(
          (a, b) =>
            bucketOrder.indexOf(a.bucket) - bucketOrder.indexOf(b.bucket) ||
            a.label.localeCompare(b.label),
        );

      return {
        ...group,
        bucketGroups,
        buyAmount: Number(group.buyAmount.toFixed(2)),
        sellAmount: Number(group.sellAmount.toFixed(2)),
        netCashFlow: Number(group.netCashFlow.toFixed(2)),
        trades: [...group.trades].sort((a, b) => {
          const aTime = formatTradeTimeOnly(a);
          const bTime = formatTradeTimeOnly(b);
          return aTime.localeCompare(bTime) || a.id.localeCompare(b.id);
        }),
      };
    })
    .sort((a, b) => b.tradeDate.localeCompare(a.tradeDate));
}

function bucketLabel(bucket: PaperBucket) {
  return PAPER_BUCKET_TABS.find((item) => item.key === bucket)?.label ?? bucket;
}

function bucketShortLabel(bucket: PaperBucketKey) {
  if (bucket === 'etf') return 'ETF';
  if (bucket === 'etf-t-plus') return '正T';
  if (bucket === 'stock') return '雷达股';
  if (bucket === 'stock-backtest') return '回测';
  return '回测+新闻';
}

function isPaperBucketKey(value: unknown): value is PaperBucketKey {
  return (
    value === 'etf' ||
    value === 'etf-t-plus' ||
    value === 'stock' ||
    value === 'stock-backtest' ||
    value === 'stock-backtest-news'
  );
}

function positionBucketLabel(position: unknown) {
  if (!position || typeof position !== 'object') return '—';
  const bucket = (position as { positionBucket?: unknown }).positionBucket;
  return isPaperBucketKey(bucket) ? bucketShortLabel(bucket) : '—';
}

function buildManualCheckMessage(result: StockBacktestManualCheckResult) {
  if (result.skipped) return result.reason ?? '本次检查已跳过';

  const buyCount = result.trades?.buys.length ?? 0;
  const sellCount = result.trades?.sells.length ?? 0;
  if (buyCount > 0 || sellCount > 0) {
    return `已按默认回测策略执行：买入 ${buyCount} 笔，卖出 ${sellCount} 笔。`;
  }
  return '当前没有适合的交易时机，已记录本次检查。';
}

export default function PaperTradingPage() {
  const [dual, setDual] = useState<DualPaperPayload | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [equity, setEquity] = useState<EquityPoint[]>([]);
  const [activeBucket, setActiveBucket] = useState<PaperBucket>('etf');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [manualCheckRunning, setManualCheckRunning] = useState(false);
  const [manualCheckResult, setManualCheckResult] =
    useState<StockBacktestManualCheckResult | null>(null);
  const [manualCheckError, setManualCheckError] = useState<string | null>(null);
  const [manualCheckProgress, setManualCheckProgress] =
    useState<StockBacktestManualCheckProgress | null>(null);
  const [manualCheckProgressEvents, setManualCheckProgressEvents] = useState<
    StockBacktestManualCheckProgress[]
  >([]);

  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const bucketQuery = `&bucket=${activeBucket}`;
      const [accountRes, tradesRes, equityRes] = await Promise.all([
        fetch('/api/paper', { cache: 'no-store' }),
        fetch(
          `/api/paper/trades?limit=200${bucketQuery}`,
          { cache: 'no-store' },
        ),
        fetch(`/api/paper/equity?limit=90${bucketQuery}`, {
          cache: 'no-store',
        }),
      ]);

      const accountJson = await accountRes.json();
      if (!accountRes.ok) throw new Error(accountJson.error ?? '加载失败');
      setDual(normalizeDualPaperPayload(accountJson));

      const equityJson = await equityRes.json();
      setEquity(
        (equityJson.snapshots ?? []).map(
          (s: { tradeDate: string; totalValue: number; returnPct: number }) => ({
            tradeDate: s.tradeDate,
            totalValue: s.totalValue,
            returnPct: s.returnPct,
          }),
        ),
      );

      const tradesJson = await tradesRes.json();
      setTrades(tradesJson.trades ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误');
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, [activeBucket]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!dual?.combined?.isTradingSession) return;
    const timer = setInterval(() => void load({ silent: true }), 60_000);
    return () => clearInterval(timer);
  }, [dual?.combined?.isTradingSession, load]);

  const runStockBacktestManualCheck = useCallback(async () => {
    setManualCheckRunning(true);
    setManualCheckError(null);
    setManualCheckResult(null);
    setManualCheckProgress(null);
    setManualCheckProgressEvents([]);
    try {
      const response = await fetch('/api/paper/stock-backtest-manual-check/stream', {
        method: 'POST',
      });
      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? '回测策略手动检查失败');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalResult: StockBacktestManualCheckResult | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as StockBacktestManualCheckStreamEvent;
          if (event.type === 'progress') {
            setManualCheckProgress(event);
            setManualCheckProgressEvents((prev) => [...prev.slice(-4), event]);
          } else if (event.type === 'result') {
            finalResult = event.result;
            setManualCheckResult(event.result);
          } else if (event.type === 'error') {
            throw new Error(event.message);
          }
        }
      }

      if (buffer.trim()) {
        const event = JSON.parse(buffer) as StockBacktestManualCheckStreamEvent;
        if (event.type === 'result') {
          finalResult = event.result;
          setManualCheckResult(event.result);
        } else if (event.type === 'error') {
          throw new Error(event.message);
        }
      }

      if (finalResult) await load({ silent: true });
    } catch (err) {
      setManualCheckError(err instanceof Error ? err.message : '回测策略手动检查失败');
    } finally {
      setManualCheckRunning(false);
    }
  }, [load]);

  const view = useMemo(() => {
    if (!dual?.etf || !dual?.etfTPlus || !dual?.stock || !dual?.combined) return null;
    return resolvePaperView(dual, activeBucket);
  }, [dual, activeBucket]);

  const returnAmount =
    view != null ? view.totalValue - view.account.initialCash : 0;
  const positionCount = view?.positions?.length ?? 0;
  const dailyEquityRows = useMemo(
    () => buildDailyEquityRows(equity ?? []),
    [equity],
  );
  const dailyTradeGroups = useMemo(
    () =>
      buildDailyTradeGroups(
        trades,
        activeBucket,
      ),
    [activeBucket, trades],
  );

  return (
    <main className="page page--list">
      <PageHeader
        title="模拟操盘"
        description="五个分仓独立统计：ETF 动量、ETF 正T、雷达股票、回测策略、回测策略+新闻。成交按真实盘口（买=卖一、卖=买一）。"
      />

      <div className="paper-bucket-tabs" role="tablist" aria-label="模拟分仓">
        {PAPER_BUCKET_TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={activeBucket === key}
            className={`paper-bucket-tab${activeBucket === key ? ' paper-bucket-tab--active' : ''}`}
            onClick={() => setActiveBucket(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {loading && <div className="list-loading">加载账户…</div>}
      {error && <div className="error">{error}</div>}

      {view && (
        <>
          <div className="paper-hero">
            <div className="paper-hero-main">
              <span className="muted">
                {`${bucketLabel(activeBucket)}收益率`}
              </span>
              <strong
                className={`paper-hero-return ${view.returnPct >= 0 ? 'return-up' : 'return-down'}`}
              >
                {view.returnPct > 0 ? '+' : ''}
                {view.returnPct}%
              </strong>
              <span
                className={`paper-hero-return-amt ${returnAmount >= 0 ? 'return-up' : 'return-down'}`}
              >
                {returnAmount >= 0 ? '+' : ''}
                {fmtMoney(returnAmount)} 元
              </span>
            </div>
            <div className="paper-hero-stats">
              <div>
                <span className="muted">总资产</span>
                <strong>{fmtMoney(view.totalValue)}</strong>
              </div>
              <div>
                <span className="muted">持仓</span>
                <strong>{positionCount} 只</strong>
              </div>
              <div>
                <span className="muted">持仓市值</span>
                <strong>{fmtMoney(view.marketValue)}</strong>
              </div>
              <div>
                <span className="muted">可用现金</span>
                <strong>{fmtMoney(view.account.cash)}</strong>
              </div>
            </div>
          </div>

          {activeBucket === 'stock-backtest' && (
            <section className="pane-card paper-manual-check">
              <div className="paper-manual-check-head">
                <div>
                  <h3 className="pane-card-title">手动选股交易</h3>
                  <p className="muted paper-manual-check-copy">
                    更新完日线后运行一次；同一交易日已成功检查过会自动跳过，不会重复下单。
                  </p>
                </div>
                <button
                  type="button"
                  className="button"
                  disabled={manualCheckRunning}
                  onClick={() => void runStockBacktestManualCheck()}
                >
                  {manualCheckRunning ? '检查中…' : '检查交易机会'}
                </button>
              </div>

              {manualCheckError && <div className="error">{manualCheckError}</div>}

              {(manualCheckRunning || manualCheckProgress) && (
                <div className="paper-manual-progress" aria-live="polite">
                  <div className="paper-manual-progress-head">
                    <strong>{manualCheckProgress?.stage ?? '准备中'}</strong>
                    <span>{Math.min(100, Math.max(0, manualCheckProgress?.percent ?? 1))}%</span>
                  </div>
                  <div className="backtest-progress-track" aria-hidden>
                    <span
                      style={{
                        width: `${Math.min(100, Math.max(0, manualCheckProgress?.percent ?? 1))}%`,
                      }}
                    />
                  </div>
                  <div className="paper-manual-progress-current">
                    <span className="backtest-progress-pulse" aria-hidden />
                    <div>
                      <span>{manualCheckProgress?.message ?? '正在启动手动检查。'}</span>
                      {manualCheckProgress?.detail && <small>{manualCheckProgress.detail}</small>}
                    </div>
                    <time>{fmtElapsed(manualCheckProgress?.elapsedMs ?? 0)}</time>
                  </div>
                  {manualCheckProgressEvents.length > 1 && (
                    <ol className="paper-manual-progress-log">
                      {manualCheckProgressEvents.map((event, index) => (
                        <li key={`${event.stage}-${event.percent}-${index}`}>
                          <span>{event.stage}</span>
                          <small>{event.detail ?? event.message}</small>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}

              {manualCheckResult && (
                <div
                  className={`paper-manual-check-result${
                    manualCheckResult.skipped ? ' paper-manual-check-result--muted' : ''
                  }`}
                >
                  <strong>{buildManualCheckMessage(manualCheckResult)}</strong>
                  <div className="paper-manual-check-stats">
                    <span>交易日 {manualCheckResult.tradeDate}</span>
                    {manualCheckResult.dataFreshness && (
                      <span>
                        日线 {manualCheckResult.dataFreshness.latestDataDate ?? '未知'}
                      </span>
                    )}
                    {manualCheckResult.scan && (
                      <>
                        <span>扫描 {manualCheckResult.scan.scanned} 只</span>
                        <span>原始信号 {manualCheckResult.scan.rawSignals}</span>
                        <span>候选 {manualCheckResult.scan.candidates}</span>
                      </>
                    )}
                    {manualCheckResult.trades && (
                      <>
                        <span>买入 {manualCheckResult.trades.buys.length}</span>
                        <span>卖出 {manualCheckResult.trades.sells.length}</span>
                      </>
                    )}
                  </div>
                  {manualCheckResult.trades &&
                    manualCheckResult.trades.buys.length > 0 && (
                      <div className="paper-manual-check-picks">
                        {manualCheckResult.trades.buys.map((item) => (
                          <span key={`${item.symbol}-${item.price}`}>
                            {item.name}({item.symbol}) {item.shares} 股 @{' '}
                            {fmtTradePrice(item.symbol, item.price)}
                          </span>
                        ))}
                      </div>
                    )}
                  {manualCheckResult.reason && !manualCheckResult.skipped && (
                    <p className="muted paper-manual-check-copy">
                      {manualCheckResult.reason}
                    </p>
                  )}
                </div>
              )}
            </section>
          )}

          <section className="pane-card">
            <h3 className="pane-card-title">
              {`${bucketLabel(activeBucket)}持仓`}
            </h3>
            {view.isTradingSession && (
              <p className="muted paper-price-hint">
                交易时段现价来自东财实时行情，约每 60 秒自动刷新；非交易时段显示最近收盘价。
              </p>
            )}
            {!(view.positions?.length) ? (
              <div className="empty-state">
                {activeBucket === 'etf'
                  ? 'ETF 仓暂无持仓。交易时段内每 30 分钟自动监听，条件满足即按动量轮动调仓。'
                  : activeBucket === 'etf-t-plus'
                    ? 'ETF 正T仓暂无持仓。先用 etf-t-plus-init 从 ETF 仓同步一次底仓，之后交易时段每 30 分钟观察自身持仓的正T机会。'
                  : activeBucket === 'stock'
                    ? '暂无持仓。消息雷达/跟踪池达标后会买入此仓，也可在'
                    : activeBucket === 'stock-backtest'
                      ? '暂无持仓。每个交易日 08:00 按回测策略扫描，次日交易用盘口价买入。'
                      : activeBucket === 'stock-backtest-news'
                        ? '暂无持仓。每个交易日 08:00 按回测策略 + 新闻过滤扫描，次日交易用盘口价买入。'
                        : '暂无持仓。'}
                {activeBucket === 'stock' && (
                  <>
                    <OpenWatchlistPanelButton className="saved-link">
                      跟踪池
                    </OpenWatchlistPanelButton>
                    查看详情。
                  </>
                )}
              </div>
            ) : (
              <div className="table-scroll-wrap">
                <table className="candidate-table">
                  <thead>
                    <tr>
                      <th>代码</th>
                      <th>名称</th>
                      <th>数量</th>
                      <th>可卖</th>
                      <th>成本</th>
                      <th>
                        现价
                        {view.isTradingSession ? (
                          <span className="paper-th-sub">实时</span>
                        ) : (
                          <span className="paper-th-sub">收盘</span>
                        )}
                      </th>
                      <th>市值</th>
                      <th>盈亏</th>
                      <th>止损</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(view.positions ?? []).map((p) => (
                        <tr key={`${positionBucketLabel(p)}-${p.symbol}`}>
                          <td>{p.symbol}</td>
                          <td>
                            {p.name}
                            {p.entryMemo && (
                              <span className="paper-position-memo" title={p.entryMemo}>
                                {' '}
                                ⓘ
                              </span>
                            )}
                          </td>
                          <td>{p.shares}</td>
                          <td>
                            {p.availableShares}
                            {'settlementRule' in p && p.settlementRule === 't0' && (
                              <span className="paper-settlement-tag">T+0</span>
                            )}
                            {'settlementRule' in p && p.settlementRule === 't2' && (
                              <span className="paper-settlement-tag paper-settlement-tag--t1">
                                T+2
                              </span>
                            )}
                            {'settlementRule' in p &&
                              (p.settlementRule === 't1' || p.settlementRule === 't2') &&
                              p.frozenShares > 0 && (
                                <span className="paper-settlement-tag paper-settlement-tag--t1">
                                  冻 {p.frozenShares}
                                </span>
                              )}
                          </td>
                          <td>{fmtTradePrice(p.symbol, p.avgCost)}</td>
                          <td>
                            {fmtTradePrice(p.symbol, p.latestPrice)}
                            {'markPriceSource' in p &&
                              p.markPriceSource === 'intraday' &&
                              view.isTradingSession && (
                                <span className="paper-live-tag">实时</span>
                              )}
                          </td>
                          <td>{p.marketValue != null ? fmtMoney(p.marketValue) : '—'}</td>
                          <td
                            className={
                              p.pnlPct != null && p.pnlPct >= 0 ? 'return-up' : 'return-down'
                            }
                          >
                            {p.pnlPct != null ? `${p.pnlPct > 0 ? '+' : ''}${p.pnlPct}%` : '—'}
                          </td>
                          <td>{fmtTradePrice(p.symbol, p.stopLoss)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="pane-card paper-equity-section">
            <h3 className="pane-card-title">收益曲线</h3>
            <EquityChart points={equity ?? []} />
            {dailyEquityRows.length > 0 && (
              <div className="paper-daily-equity">
                <div className="paper-daily-equity-head">
                  <h4>每日收益</h4>
                  <span className="muted">按交易日倒序</span>
                </div>
                <div className="table-scroll-wrap">
                  <table className="candidate-table paper-daily-equity-table">
                    <thead>
                      <tr>
                        <th>日期</th>
                        <th>结果</th>
                        <th>当日盈亏</th>
                        <th>当日涨跌</th>
                        <th>总资产</th>
                        <th>累计收益</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailyEquityRows.map((row) => (
                        <tr key={row.tradeDate}>
                          <td>{row.tradeDate}</td>
                          <td>
                            <span
                              className={`paper-daily-status paper-daily-status--${row.status}`}
                            >
                              {row.status === 'profit'
                                ? '赚'
                                : row.status === 'loss'
                                  ? '亏'
                                  : '平'}
                            </span>
                          </td>
                          <td className={returnClass(row.dailyPnl)}>
                            {fmtSignedMoney(row.dailyPnl)}
                          </td>
                          <td className={returnClass(row.dailyPct)}>
                            {fmtSignedPct(row.dailyPct)}
                          </td>
                          <td>{fmtMoney(row.totalValue)}</td>
                          <td className={returnClass(row.totalReturnAmount)}>
                            {fmtSignedMoney(row.totalReturnAmount)}
                            <span className="paper-daily-return-pct">
                              {fmtSignedPct(row.totalReturnPct)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <div className="paper-daily-trades">
              <div className="paper-daily-equity-head">
                <h4>每日交易明细</h4>
                <span className="muted">按交易日倒序 · 展示最近 {trades.length} 笔</span>
              </div>
              {dailyTradeGroups.length === 0 ? (
                <div className="empty-state">暂无成交记录。</div>
              ) : (
                <div className="paper-daily-trade-groups">
                  {dailyTradeGroups.map((group) => (
                    <div className="paper-daily-trade-group" key={group.tradeDate}>
                      <div className="paper-daily-trade-group-head">
                        <strong>{group.tradeDate}</strong>
                        <div className="paper-daily-trade-summary">
                          <span>买入 {fmtMoney(group.buyAmount)}</span>
                          <span>卖出 {fmtMoney(group.sellAmount)}</span>
                          <span className={returnClass(group.netCashFlow)}>
                            净现金流 {fmtSignedMoney(group.netCashFlow)}
                          </span>
                        </div>
                      </div>
                      <div className="paper-daily-trade-buckets">
                        {group.bucketGroups.map((bucketGroup) => (
                          <div
                            className={`paper-daily-trade-bucket paper-daily-trade-bucket--${bucketGroup.bucket}`}
                            key={`${group.tradeDate}-${bucketGroup.bucket}`}
                          >
                            <div className="paper-daily-trade-bucket-head">
                              <div>
                                <strong>{bucketGroup.label}</strong>
                                <span>{bucketGroup.trades.length} 笔</span>
                              </div>
                              <div className="paper-daily-trade-summary">
                                <span>买 {fmtMoney(bucketGroup.buyAmount)}</span>
                                <span>卖 {fmtMoney(bucketGroup.sellAmount)}</span>
                                <span className={returnClass(bucketGroup.netCashFlow)}>
                                  净 {fmtSignedMoney(bucketGroup.netCashFlow)}
                                </span>
                              </div>
                            </div>
                            <div className="table-scroll-wrap">
                              <table className="candidate-table paper-daily-trades-table">
                                <thead>
                                  <tr>
                                    <th>时间</th>
                                    <th>方向</th>
                                    <th>标的</th>
                                    <th className="paper-num">数量</th>
                                    <th className="paper-num">价格</th>
                                    <th className="paper-num">金额</th>
                                    <th>来源 / 备注</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {bucketGroup.trades.map((trade) => (
                                    <tr key={trade.id}>
                                      <td className="paper-trade-time">
                                        {formatTradeTimeOnly(trade)}
                                      </td>
                                      <td
                                        className={
                                          trade.side === 'buy' ? 'return-up' : 'return-down'
                                        }
                                      >
                                        {trade.side === 'buy' ? '买入' : '卖出'}
                                      </td>
                                      <td className="paper-trade-symbol">
                                        {trade.name}
                                        <span className="muted"> ({trade.symbol})</span>
                                      </td>
                                      <td className="paper-num">{trade.shares}</td>
                                      <td className="paper-num">
                                        {fmtTradePrice(trade.symbol, trade.price)}
                                      </td>
                                      <td className="paper-num">{fmtMoney(trade.amount)}</td>
                                      <td className="paper-trade-note">
                                        <span className="paper-trade-source">
                                          {formatTradeSource(trade)}
                                        </span>
                                        {formatTradeNote(trade.note)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </>
      )}

      <div className="paper-rules pane-card">
        <h3 className="pane-card-title">分仓规则</h3>
        <ul className="paper-rules-list">
          <li>
            <strong>成交定价：</strong>买入按卖一、卖出按买一；盘口缺失时退回最新价
          </li>
          <li>
            <strong>ETF 仓：</strong>交易时段每 30 分钟监听 · Top4 动量轮动 · 10 日调仓 · -12% 止损
          </li>
          <li>
            <strong>ETF 正T仓：</strong>初始化同步 ETF 仓一次 · 交易时段每 30 分钟监听自身持仓 · 条件满足才做正T增强
          </li>
          <li>
            <strong>股票仓（雷达）：</strong>消息雷达/跟踪池 · 红钻 + Checklist · 与回测策略仓隔离
          </li>
          <li>
            <strong>回测策略仓：</strong>08:00 按前一交易日数据扫描 · 可在日线更新后手动检查 · 交易时段自动监控出场
          </li>
          <li>
            <strong>回测+新闻仓：</strong>08:00 自动扫描并叠加新闻过滤 · 盘口价买入 · 交易时段自动监控出场
          </li>
          <li>
            <strong>交收规则：</strong>ETF 按标的 T+0/T+1 · 股票仓 T+1
          </li>
        </ul>
        {view && (
          <p className="muted paper-session-hint">
            今日 {view.tradeDate} · 初始 {fmtMoney(view.account.initialCash)} 元 ·{' '}
            {view.isTradingSession ? '当前在交易时段' : '当前非交易时段'}
          </p>
        )}
      </div>

      <nav className="page-toolbar">
        <button
          type="button"
          className="button button-secondary"
          onClick={() => void load()}
        >
          刷新行情
        </button>
        <OpenWatchlistPanelButton className="button button-secondary">
          跟踪池
        </OpenWatchlistPanelButton>
        <Link href="/signals" className="button button-secondary">
          信号提醒
        </Link>
        <Link href="/paper/etf-observation" className="button button-secondary">
          ETF 观察
        </Link>
        <Link href="/reviews" className="button button-secondary">
          每周复盘
        </Link>
      </nav>

      {view && (
        <section className="pane-card">
          <h3 className="pane-card-title">交易流水</h3>
          {trades.length === 0 ? (
            <div className="empty-state">暂无成交记录</div>
          ) : (
            <div className="table-scroll-wrap">
              <table className="candidate-table paper-trades-table">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>方向</th>
                    <th>标的</th>
                    <th>数量</th>
                    <th>价格</th>
                    <th>金额</th>
                    <th>来源</th>
                    <th>备注</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((t) => (
                    <tr key={t.id}>
                      <td className="paper-trade-time">{formatPaperTradeDisplayTime(t)}</td>
                      <td className={t.side === 'buy' ? 'return-up' : 'return-down'}>
                        {t.side === 'buy' ? '买入' : '卖出'}
                      </td>
                      <td>
                        {t.name}
                        <span className="muted"> ({t.symbol})</span>
                      </td>
                      <td>{t.shares}</td>
                      <td>{fmtTradePrice(t.symbol, t.price)}</td>
                      <td>{t.amount.toFixed(0)}</td>
                      <td>{formatTradeSource(t)}</td>
                      <td className="paper-trade-note">{formatTradeNote(t.note)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <p className="disclaimer">模拟交易仅供学习，不构成投资建议。</p>
    </main>
  );
}

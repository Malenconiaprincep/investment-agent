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

type PaperBucket = 'combined' | PaperBucketKey;

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

function fmtMoney(v: number) {
  return v.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
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

const BUCKET_INITIAL_CASH = 100_000;

function pointInitialCash(point: Pick<EquityPoint, 'totalValue' | 'returnPct'>): number {
  const denominator = 1 + point.returnPct / 100;
  if (!Number.isFinite(denominator) || denominator <= 0) return point.totalValue;
  return point.totalValue / denominator;
}

function mergeEquityCurves(curves: EquityPoint[][]): EquityPoint[] {
  const normalizedCurves = curves.map((points) =>
    [...points]
      .map((point) => ({
        tradeDate: normalizeEquityTradeDate(point.tradeDate),
        totalValue: point.totalValue,
        returnPct: point.returnPct,
      }))
      .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate)),
  );

  const allDates = new Set<string>();
  for (const points of normalizedCurves) {
    for (const point of points) allDates.add(point.tradeDate);
  }
  const timeline = [...allDates].sort();
  if (timeline.length === 0) return [];

  const indices = normalizedCurves.map(() => 0);
  const lastKnown = normalizedCurves.map<EquityPoint | null>(() => null);

  return timeline.map((tradeDate) => {
    let totalValue = 0;
    let initialCash = 0;

    for (let i = 0; i < normalizedCurves.length; i++) {
      const points = normalizedCurves[i];
      while (indices[i] < points.length && points[indices[i]].tradeDate <= tradeDate) {
        lastKnown[i] = points[indices[i]];
        indices[i] += 1;
      }

      const point = lastKnown[i];
      if (point) {
        totalValue += point.totalValue;
        initialCash += pointInitialCash(point);
      } else {
        totalValue += BUCKET_INITIAL_CASH;
        initialCash += BUCKET_INITIAL_CASH;
      }
    }

    return {
      tradeDate,
      totalValue: Number(totalValue.toFixed(2)),
      returnPct:
        initialCash > 0
          ? Number((((totalValue - initialCash) / initialCash) * 100).toFixed(2))
          : 0,
    };
  });
}

function bucketLabel(bucket: PaperBucket) {
  return PAPER_BUCKET_TABS.find((item) => item.key === bucket)?.label ?? bucket;
}

function bucketShortLabel(bucket: PaperBucketKey) {
  if (bucket === 'etf') return 'ETF';
  if (bucket === 'stock') return '雷达股';
  if (bucket === 'stock-backtest') return '回测';
  return '回测+新闻';
}

function isPaperBucketKey(value: unknown): value is PaperBucketKey {
  return (
    value === 'etf' ||
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
  const [activeBucket, setActiveBucket] = useState<PaperBucket>('combined');
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
      const bucketQuery =
        activeBucket === 'combined' ? '' : `&bucket=${activeBucket}`;
      const [accountRes, tradesRes, equityRes] = await Promise.all([
        fetch('/api/paper'),
        fetch(
          activeBucket === 'combined'
            ? '/api/paper/trades?limit=50'
            : `/api/paper/trades?limit=50${bucketQuery}`,
        ),
        activeBucket === 'combined'
          ? Promise.all(
              (['etf', 'stock', 'stock-backtest', 'stock-backtest-news'] as const).map(
                (bucket) => fetch(`/api/paper/equity?limit=90&bucket=${bucket}`),
              ),
            )
          : fetch(`/api/paper/equity?limit=90${bucketQuery}`),
      ]);

      const accountJson = await accountRes.json();
      if (!accountRes.ok) throw new Error(accountJson.error ?? '加载失败');
      setDual(normalizeDualPaperPayload(accountJson));

      if (activeBucket === 'combined' && Array.isArray(equityRes)) {
        const curves = await Promise.all(
          equityRes.map(async (res) => {
            const json = await res.json();
            return (json.snapshots ?? []).map(
              (s: { tradeDate: string; totalValue: number; returnPct: number }) => ({
                tradeDate: s.tradeDate,
                totalValue: s.totalValue,
                returnPct: s.returnPct,
              }),
            );
          }),
        );
        setEquity(mergeEquityCurves(curves));
      } else if (!Array.isArray(equityRes)) {
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
      }

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
    if (!dual?.etf || !dual?.stock || !dual?.combined) return null;
    const base = resolvePaperView(dual, activeBucket);
    if (activeBucket !== 'combined') return base;
    return {
      ...base,
      positions: [
        ...(dual.etf.positions ?? []).map((p) => ({ ...p, positionBucket: 'etf' as const })),
        ...(dual.stock.positions ?? []).map((p) => ({ ...p, positionBucket: 'stock' as const })),
        ...(dual.stockBacktest.positions ?? []).map((p) => ({
          ...p,
          positionBucket: 'stock-backtest' as const,
        })),
        ...(dual.stockBacktestNews.positions ?? []).map((p) => ({
          ...p,
          positionBucket: 'stock-backtest-news' as const,
        })),
      ],
    };
  }, [dual, activeBucket]);

  const returnAmount =
    view != null ? view.totalValue - view.account.initialCash : 0;
  const positionCount = view?.positions?.length ?? 0;

  return (
    <main className="page page--list">
      <PageHeader
        title="模拟操盘"
        description="四仓独立 10 万：ETF 动量、雷达股票、回测策略、回测策略+新闻。成交按真实盘口（买=卖一、卖=买一）。"
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
                {activeBucket === 'combined' ? '合并收益率' : `${bucketLabel(activeBucket)}收益率`}
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
              {activeBucket === 'combined' && dual && (
                <>
                  <div>
                    <span className="muted">ETF 仓</span>
                    <strong>{fmtMoney(dual.etf.totalValue)}</strong>
                  </div>
                  <div>
                    <span className="muted">股票仓</span>
                    <strong>{fmtMoney(dual.stock.totalValue)}</strong>
                  </div>
                  <div>
                    <span className="muted">回测策略</span>
                    <strong>{fmtMoney(dual.stockBacktest.totalValue)}</strong>
                  </div>
                  <div>
                    <span className="muted">回测+新闻</span>
                    <strong>{fmtMoney(dual.stockBacktestNews.totalValue)}</strong>
                  </div>
                </>
              )}
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
              {activeBucket === 'combined' ? '全部持仓' : `${bucketLabel(activeBucket)}持仓`}
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
                      {activeBucket === 'combined' && <th>分仓</th>}
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
                          {activeBucket === 'combined' && (
                            <td>{positionBucketLabel(p)}</td>
                          )}
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
          </section>
        </>
      )}

      <div className="paper-rules pane-card">
        <h3 className="pane-card-title">分仓规则</h3>
        <ul className="paper-rules-list">
          <li>
            <strong>总资金：</strong>40 万（ETF / 雷达股票 / 回测策略 / 回测+新闻 各 10 万）
          </li>
          <li>
            <strong>成交定价：</strong>买入按卖一、卖出按买一；盘口缺失时退回最新价
          </li>
          <li>
            <strong>ETF 仓：</strong>交易时段每 30 分钟监听 · Top4 动量轮动 · 10 日调仓 · -12% 止损
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
            <strong>交收规则：</strong>ETF 仓 T+0 · 股票仓 T+1
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
                    {activeBucket === 'combined' && <th>分仓</th>}
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
                      {activeBucket === 'combined' && (
                        <td>{t.bucket ? bucketShortLabel(t.bucket) : '—'}</td>
                      )}
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

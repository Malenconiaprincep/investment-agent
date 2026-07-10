'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { BacktestEquityChart } from '@/components/charts/BacktestEquityChart';
import { PageHeader } from '@/components/ui/PageHeader';

type BacktestEquityPoint = {
  tradeDate: string;
  equity: number;
  returnPct: number;
  closedTrades: number;
};

type BacktestMetrics = {
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

type BacktestRunConfig = {
  initialCapital?: number;
  stockUniverseCount?: number;
  maxConcurrentPositions?: number;
  stockMarketFilter?: 'off' | 'avoid_bearish' | 'require_bullish';
  newsFilter?: 'off' | 'avoid_bearish' | 'require_bullish';
  rawSignalCount?: number;
  marketBlockedCount?: number;
  portfolioSkippedCount?: number;
  stockIdleDays?: number;
  benchmarkTradeDays?: number;
  stockIdleDayPct?: number | null;
  longestStockIdleDays?: number;
  longestStockIdleStartDate?: string;
  longestStockIdleEndDate?: string;
};

type BacktestTrade = {
  symbol: string;
  name: string;
  assetType: 'stock' | 'etf';
  entryDate: string;
  entryPrice: number;
  exitDate: string | null;
  exitPrice: number | null;
  holdDays: number;
  returnPct: number | null;
  exitReason: string;
};

type BacktestResult = {
  runId?: string;
  persistedAt?: string;
  strategy: string;
  requestedDays: number;
  startDate?: string;
  endDate?: string;
  metrics: BacktestMetrics;
  config?: BacktestRunConfig;
  trades: BacktestTrade[];
  equityCurve?: BacktestEquityPoint[];
  benchmark?: {
    symbol: string;
    name: string;
    curve: BacktestEquityPoint[];
    finalReturnPct: number | null;
  };
  notes: string[];
};

type BacktestRunRecord = {
  id: string;
  strategy: string;
  assetType: 'stock' | 'etf' | 'mixed';
  createdAt: string;
  finalReturnPct: number | null;
};

type BacktestDetail = {
  record: BacktestRunRecord;
  result: BacktestResult;
};

function formatTime(iso: string | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const key = value.replace(/-/g, '').slice(0, 8);
  if (key.length !== 8) return value;
  return `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
}

function formatPct(value: number | null | undefined) {
  if (value == null) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function formatNumber(value: number | null | undefined, digits = 0) {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

function formatMoney(value: number | null | undefined) {
  if (value == null) return '—';
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(value);
}

function returnClass(value: number | null | undefined) {
  if (value == null) return '';
  if (value > 0) return 'return-positive';
  if (value < 0) return 'return-negative';
  return '';
}

function strategyLabel(strategy: string) {
  if (strategy === 'red-diamond-momentum') return 'A 股动量启动';
  if (strategy === 'red-diamond') return '红钻信号统计';
  if (strategy === 'etf-momentum-rotation') return 'ETF 动量轮动';
  if (strategy === 'etf-stable-v2') return 'ETF Stable V2';
  if (strategy === 'etf-tail-rules') return 'ETF 尾盘规则';
  return strategy;
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
      <strong className={returnClass(effectiveTone)}>{value}</strong>
    </div>
  );
}

export default function BacktestHistoryDetailPage() {
  const params = useParams<{ id: string }>();
  const [detail, setDetail] = useState<BacktestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadDetail() {
      if (!params.id) return;
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/backtest/history/${params.id}`);
        const data = (await response.json()) as BacktestDetail & { error?: string };
        if (!response.ok) throw new Error(data.error ?? '加载失败');
        setDetail(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : '未知错误');
      } finally {
        setLoading(false);
      }
    }

    void loadDetail();
  }, [params.id]);

  const result = detail?.result;
  const recentTrades = useMemo(
    () => [...(result?.trades ?? [])].sort((a, b) => b.entryDate.localeCompare(a.entryDate)).slice(0, 80),
    [result?.trades],
  );
  const finalReturn = result?.equityCurve?.at(-1)?.returnPct ?? detail?.record.finalReturnPct ?? null;
  const maxDrawdown = result?.metrics.maxDrawdownPct ?? calcMaxDrawdownPct(result?.equityCurve);
  const excessReturn =
    finalReturn != null && result?.benchmark?.finalReturnPct != null
      ? Number((finalReturn - result.benchmark.finalReturnPct).toFixed(2))
      : null;

  return (
    <main className="page page--list">
      <PageHeader
        eyebrow="历史回测"
        title={result ? strategyLabel(result.strategy) : '回测详情'}
        description={
          result
            ? `${formatDate(result.startDate)} 至 ${formatDate(result.endDate)} · 保存于 ${formatTime(result.persistedAt ?? detail?.record.createdAt)}`
            : '查看已保存的策略收益、交易和规则说明。'
        }
      />

      <nav className="page-toolbar" aria-label="页面导航">
        <Link href="/backtest/history" className="button button-secondary">
          返回记录池
        </Link>
        <Link href="/backtest" className="button">
          新建回测
        </Link>
      </nav>

      {loading && <div className="list-loading">加载回测详情…</div>}
      {error && <div className="error">{error}</div>}

      {!loading && !error && !result && (
        <div className="empty-state">没有找到这条回测记录。</div>
      )}

      {result && (
        <>
          <section className="section pane-card">
            <div className="section-head">
              <div>
                <h2 className="section-title">收益概览</h2>
                <p className="muted">
                  {result.benchmark
                    ? `基准：${result.benchmark.name}（${result.benchmark.symbol}）`
                    : '这条记录没有保存基准曲线。'}
                </p>
              </div>
              <strong className={returnClass(finalReturn)}>累计 {formatPct(finalReturn)}</strong>
            </div>
            <div className="overview-metric-grid">
              <SummaryMetric label="策略累计收益" value={formatPct(finalReturn)} tone={finalReturn} />
              <SummaryMetric label="大盘累计收益" value={formatPct(result.benchmark?.finalReturnPct)} tone={result.benchmark?.finalReturnPct} />
              <SummaryMetric label="超额收益" value={formatPct(excessReturn)} tone={excessReturn} />
              <SummaryMetric label="最大回撤" value={formatPct(maxDrawdown)} tone={maxDrawdown} inverse />
              <SummaryMetric label="胜率" value={formatPct(result.metrics.winRatePct)} />
              <SummaryMetric label="交易次数" value={`${result.metrics.validTradeCount}/${result.metrics.tradeCount}`} />
              <SummaryMetric label="平均收益" value={formatPct(result.metrics.avgReturnPct)} tone={result.metrics.avgReturnPct} />
              <SummaryMetric label="中位收益" value={formatPct(result.metrics.medianReturnPct)} tone={result.metrics.medianReturnPct} />
              <SummaryMetric label="平均持有" value={`${formatNumber(result.metrics.avgHoldDays, 1)} 日`} />
              <SummaryMetric label="初始资金" value={`${formatMoney(result.config?.initialCapital)} 元`} />
              {result.config?.stockIdleDays != null && result.config?.benchmarkTradeDays != null ? (
                <SummaryMetric
                  label="空仓交易日"
                  value={`${result.config.stockIdleDays}/${result.config.benchmarkTradeDays} 日`}
                />
              ) : null}
              {result.config?.longestStockIdleDays != null ? (
                <SummaryMetric label="最长空仓" value={`${result.config.longestStockIdleDays} 日`} />
              ) : null}
            </div>

            <BacktestEquityChart
              strategy={(result.equityCurve ?? []).map((point) => ({
                tradeDate: point.tradeDate,
                returnPct: point.returnPct,
              }))}
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
          </section>

          <section className="section pane-card">
            <div className="section-head">
              <div>
                <h2 className="section-title">规则快照</h2>
                <p className="muted">保存时的策略参数和过滤计数。</p>
              </div>
            </div>
            <div className="overview-metric-grid overview-metric-grid--compact">
              <SummaryMetric label="股票池" value={`${result.config?.stockUniverseCount ?? '—'} 只`} />
              <SummaryMetric label="最大持仓" value={`${result.config?.maxConcurrentPositions ?? '—'} 只`} />
              <SummaryMetric label="大盘过滤" value={result.config?.stockMarketFilter ?? '—'} />
              <SummaryMetric label="新闻过滤" value={result.config?.newsFilter ?? '—'} />
              <SummaryMetric label="原始信号" value={`${result.config?.rawSignalCount ?? '—'} 个`} />
              <SummaryMetric label="大盘拦截" value={`${result.config?.marketBlockedCount ?? '—'} 个`} />
              <SummaryMetric label="组合过滤" value={`${result.config?.portfolioSkippedCount ?? '—'} 笔`} />
            </div>
          </section>

          <section className="section pane-card">
            <div className="section-head">
              <div>
                <h2 className="section-title">最近交易</h2>
                <p className="muted">按买入日期倒序展示前 80 笔。</p>
              </div>
            </div>
            <div className="table-scroll-wrap">
              <table className="candidate-table">
                <thead>
                  <tr>
                    <th>标的</th>
                    <th>买入</th>
                    <th>卖出</th>
                    <th>持有</th>
                    <th>收益</th>
                    <th>退出</th>
                  </tr>
                </thead>
                <tbody>
                  {recentTrades.map((trade, index) => (
                    <tr key={`${trade.symbol}-${trade.entryDate}-${index}`}>
                      <td>
                        {trade.name}({trade.symbol})
                      </td>
                      <td>{formatDate(trade.entryDate)}</td>
                      <td>{formatDate(trade.exitDate)}</td>
                      <td>{trade.holdDays} 日</td>
                      <td className={returnClass(trade.returnPct)}>{formatPct(trade.returnPct)}</td>
                      <td>{trade.exitReason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="section pane-card">
            <div className="section-head">
              <div>
                <h2 className="section-title">日志说明</h2>
                <p className="muted">回测生成时保存的规则和数据口径。</p>
              </div>
            </div>
            <ul className="backtest-history-notes">
              {result.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}

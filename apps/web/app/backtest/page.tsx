'use client';

import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';

type Strategy = 'diamond' | 'diamond-momentum' | 'etf';

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
  symbolSummaries?: BacktestSymbolSummary[];
  currentDecisions?: BacktestCurrentDecision[];
  notes: string[];
};

type BacktestPanel = 'overview' | 'current' | 'etfs' | 'trades' | 'notes';

const STRATEGIES: Array<{ value: Strategy; label: string; help: string }> = [
  {
    value: 'diamond',
    label: '红钻固定持有',
    help: '用真实日 K 回放红钻信号，按固定持有期统计收益。',
  },
  {
    value: 'diamond-momentum',
    label: '红钻动量出场',
    help: '红钻 + 动量 checklist 买入，按止损/MA20/信号消失规则出场。',
  },
  {
    value: 'etf',
    label: 'ETF 尾盘规则',
    help: '回测 19 只 ETF 池的 8 条尾盘筛选规则。',
  },
];

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

function fmtPrice(value: number | null) {
  if (value == null) return '—';
  return value.toFixed(value >= 10 ? 2 : 3);
}

function fmtTradeDate(value: string | null) {
  if (!value || value.length < 8) return '—';
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
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

function returnClass(value: number | null) {
  if (value == null) return 'muted';
  if (value > 0) return 'text-up';
  if (value < 0) return 'text-down';
  return 'muted';
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

function calcAnnualReturnPct(points: BacktestEquityPoint[] | undefined): number | null {
  if (!points?.length) return null;
  const finalReturn = points.at(-1)?.returnPct;
  if (finalReturn == null) return null;
  const periods = Math.max(points.length, 1);
  return Number((((1 + finalReturn / 100) ** (252 / periods) - 1) * 100).toFixed(2));
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

export default function BacktestPage() {
  const defaultRange = rangeFromPresetDays(365);
  const [strategy, setStrategy] = useState<Strategy>('etf');
  const [symbols, setSymbols] = useState('600519,000001');
  const [startDate, setStartDate] = useState(defaultRange.startDate);
  const [endDate, setEndDate] = useState(defaultRange.endDate);
  const [holdDays] = useState('5');
  const [includeWaitPullback, setIncludeWaitPullback] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = todayIsoDate();
  const activePresetDays = presetDaysForRange(startDate, endDate);

  const activeStrategy = useMemo(
    () => STRATEGIES.find((item) => item.value === strategy) ?? STRATEGIES[0],
    [strategy],
  );

  async function runBacktest() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ strategy });
      if (strategy === 'etf') {
        params.set('startDate', startDate);
        params.set('endDate', endDate);
      } else {
        const start = new Date(startDate);
        const end = new Date(endDate);
        const calendarDays = Math.max(
          1,
          Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1,
        );
        const klineDays = Math.ceil(calendarDays * 5 / 7) + 45;
        params.set('days', String(klineDays));
      }
      if (strategy !== 'etf') {
        params.set('symbols', symbols);
      }
      if (holdDays.trim()) {
        params.set('holdDays', holdDays.trim());
      }
      if (strategy === 'etf' && includeWaitPullback) {
        params.set('includeWaitPullback', '1');
      }

      const response = await fetch(`/api/backtest?${params.toString()}`);
      const payload = (await response.json()) as BacktestResult & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? '回测失败');
      setResult(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : '回测失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page page--list">
      <PageHeader
        eyebrow="真实行情回测"
        title="ETF 策略回测"
        description="先看最近一年 ETF 规则是否赚钱，再看今天尾盘按同一套规则应该买入、观察还是卖出/回避。"
      />

      <section className="action-panel backtest-controls">
        <div className="backtest-control-block">
          <div className="backtest-control-head">
            <strong>选择策略</strong>
            <span className="muted">先用 ETF 尾盘规则看效果，其他策略保留作对比。</span>
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
        </div>

        {strategy !== 'etf' && (
          <label className="form-field">
            <span>股票池</span>
            <input
              className="input"
              value={symbols}
              onChange={(event) => setSymbols(event.target.value)}
              placeholder="600519,000001 或 600519:贵州茅台"
            />
          </label>
        )}

        {strategy === 'etf' && (
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={includeWaitPullback}
              onChange={(event) => setIncludeWaitPullback(event.target.checked)}
            />
            纳入“等回踩”信号（仍按触发日收盘价模拟入场）
          </label>
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
            {activeStrategy.help} 这里按日历天理解，默认买入后持有 5 个交易日。
          </span>
        </div>
      </section>

      <section className="paper-hero">
        <div className="paper-hero-main">
          <span className="muted">数据口径</span>
          <strong>真实行情，不是 mock</strong>
          <span className="muted">
            ETF 历史回测用腾讯前复权日 K；“当前尾盘决策”优先用东财实时行情，拿不到实时行情时退回最新日 K。这里的结果是规则验证，不是投资建议。
          </span>
        </div>
      </section>

      {error && <div className="error">{error}</div>}

      {!result && !loading && !error && (
        <div className="empty-state">
          选择策略后点击“开始回测”。ETF 回测会直接使用 19 只内置 ETF 池。
        </div>
      )}

      {result && (
        <>
          <section className="paper-hero">
            <div className="paper-hero-main">
              <span className="muted">{fmtTime(result.generatedAt)}</span>
              <strong>{result.strategy}</strong>
              <span className="muted">
                {result.startDate && result.endDate
                  ? `${result.startDate} 至 ${result.endDate}`
                  : `${startDate} 至 ${endDate}`}
                {' · '}
                覆盖 {result.symbols.length} 个标的
              </span>
            </div>
            <div className="paper-hero-stats">
              <Metric label="交易数" value={String(result.metrics.tradeCount)} />
              <Metric label="有效交易" value={String(result.metrics.validTradeCount)} />
              <Metric label="胜率" value={fmtPct(result.metrics.winRatePct)} />
              <Metric label="平均收益" value={fmtPct(result.metrics.avgReturnPct)} />
              <Metric label="中位收益" value={fmtPct(result.metrics.medianReturnPct)} />
              <Metric
                label="策略累计"
                value={fmtPct(result.equityCurve?.at(-1)?.returnPct ?? null)}
              />
              <Metric label="盈亏比" value={fmtNumber(result.metrics.profitLossRatio)} />
            </div>
          </section>

          {result.strategy === 'etf-tail-rules' ? (
            <EtfStrategyReport result={result} />
          ) : (
            <GenericBacktestDetails result={result} />
          )}

          {result.symbols.some((item) => item.error) && (
            <section className="section pane-card">
              <h2 className="section-title">数据错误</h2>
              <ul className="sector-list">
                {result.symbols
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="muted">{label}</span>
      <strong>{value}</strong>
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

function EtfStrategyReport({ result }: { result: BacktestResult }) {
  const [activePanel, setActivePanel] = useState<BacktestPanel>('overview');
  const buyList = result.currentDecisions?.filter((item) => item.action === 'buy') ?? [];
  const sellList = result.currentDecisions?.filter((item) => item.action === 'sell') ?? [];
  const watchList =
    result.currentDecisions?.filter(
      (item) => item.action === 'watch' || item.action === 'wait_pullback',
    ) ?? [];
  const finalReturn = result.equityCurve?.at(-1)?.returnPct ?? null;
  const annualReturn = calcAnnualReturnPct(result.equityCurve);
  const maxDrawdown = calcMaxDrawdownPct(result.equityCurve);
  const sharpe = calcSharpe(result.equityCurve);
  const startDate = result.equityCurve?.[0]?.tradeDate ?? null;
  const endDate = result.equityCurve?.at(-1)?.tradeDate ?? null;
  const panels: Array<{ id: BacktestPanel; label: string; hint: string }> = [
    { id: 'overview', label: '收益概述', hint: '收益曲线和核心指标' },
    { id: 'current', label: '当前动作', hint: '今天尾盘买卖建议' },
    { id: 'etfs', label: 'ETF 表现', hint: '每只 ETF 的历史效果' },
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
                  区间 {fmtTradeDate(startDate)} 至 {fmtTradeDate(endDate)}。规则：尾盘严格通过 8 条 ETF 规则则买入，默认持有 {result.holdDays.join('/')} 个交易日后卖出；多笔同日平仓按等权平均收益复利。
                </p>
              </div>
              <strong className={returnClass(finalReturn)}>累计 {fmtPct(finalReturn)}</strong>
            </div>

            <div className="overview-metric-grid">
              <SummaryMetric label="策略累计收益" value={fmtPct(finalReturn)} tone={finalReturn} />
              <SummaryMetric label="策略年化收益" value={fmtPct(annualReturn)} tone={annualReturn} />
              <SummaryMetric label="最大回撤" value={fmtPct(maxDrawdown)} tone={maxDrawdown} inverse />
              <SummaryMetric label="夏普比率" value={fmtNumber(sharpe, 3)} />
              <SummaryMetric label="胜率" value={fmtPct(result.metrics.winRatePct)} />
              <SummaryMetric label="交易次数" value={`${result.metrics.validTradeCount}/${result.metrics.tradeCount}`} />
              <SummaryMetric label="单笔最高收益" value={fmtPct(result.metrics.bestReturnPct)} tone={result.metrics.bestReturnPct} />
              <SummaryMetric label="单笔最低收益" value={fmtPct(result.metrics.worstReturnPct)} tone={result.metrics.worstReturnPct} />
            </div>

            <EquityCurveChart points={result.equityCurve ?? []} />

            <div className="metric-help">
              <strong>怎么读：</strong>
              <span>“单笔最高/最低收益”是某一笔 ETF 交易的最高和最低收益，不代表某只 ETF 永远最好或最差。</span>
            </div>
          </section>
        )}

        {activePanel === 'current' && (
          <section className="section pane-card">
            <div className="section-head">
              <div>
                <h2 className="section-title">当前尾盘动作</h2>
                <p className="muted">
                  买入 = 严格通过；观察/等回踩 = 条件接近但不能追；卖出/回避 = 若已持有则按规则退出或降仓。
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

        {activePanel === 'notes' && (
          <section className="section pane-card">
            <h2 className="section-title">日志说明</h2>
            <ul className="sector-list">
              {result.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
              <li>收益曲线基于已完成持有期的交易；尚未到卖出日的交易会保留在明细里，但不计入有效收益。</li>
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

function TradeDetailsSection({ trades }: { trades: BacktestTrade[] }) {
  return (
    <section className="section pane-card">
      <h2 className="section-title">交易详情</h2>
      <div className="table-scroll-wrap">
        <table className="candidate-table">
          <thead>
            <tr>
              <th>标的</th>
              <th>类型</th>
              <th>买入日</th>
              <th>买入价</th>
              <th>卖出日</th>
              <th>卖出价</th>
              <th>持有</th>
              <th>收益</th>
              <th>退出原因</th>
            </tr>
          </thead>
          <tbody>
            {trades.slice(0, 200).map((trade, index) => (
              <tr key={`${trade.symbol}-${trade.entryDate}-${trade.holdDays}-${index}`}>
                <td>
                  {trade.name} ({trade.symbol})
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
                <td>{trade.exitReason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {trades.length > 200 && (
        <p className="muted">仅展示前 200 笔，完整明细可通过 `/api/backtest` 获取。</p>
      )}
    </section>
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

function EquityCurveChart({ points }: { points: BacktestEquityPoint[] }) {
  if (points.length === 0) {
    return <div className="chart-empty chart-empty--compact">暂无足够交易生成收益曲线</div>;
  }

  const width = 720;
  const height = 240;
  const pad = 24;
  const returns = points.map((point) => point.returnPct);
  const min = Math.min(...returns, 0);
  const max = Math.max(...returns, 0);
  const span = max - min || 1;
  const xStep = points.length > 1 ? (width - pad * 2) / (points.length - 1) : 0;
  const y = (value: number) => height - pad - ((value - min) / span) * (height - pad * 2);
  const line = points
    .map((point, index) => `${pad + index * xStep},${y(point.returnPct)}`)
    .join(' ');
  const zeroY = y(0);

  return (
    <div className="equity-chart" role="img" aria-label="ETF 策略收益曲线">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <line x1={pad} y1={zeroY} x2={width - pad} y2={zeroY} className="equity-zero" />
        <polyline points={line} className="equity-line" />
      </svg>
      <div className="equity-chart-axis">
        <span>{fmtTradeDate(points[0]?.tradeDate ?? null)}</span>
        <span className={returnClass(points.at(-1)?.returnPct ?? null)}>
          {fmtPct(points.at(-1)?.returnPct ?? null)}
        </span>
        <span>{fmtTradeDate(points.at(-1)?.tradeDate ?? null)}</span>
      </div>
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

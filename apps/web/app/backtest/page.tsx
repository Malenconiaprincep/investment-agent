'use client';

import { useEffect, useMemo, useState } from 'react';
import { BacktestEquityChart } from '@/components/charts/BacktestEquityChart';
import { StockKlineChart } from '@/components/charts/StockKlineChart';
import type { TradeMarker } from '@/components/charts/KlineChart';
import { PageHeader } from '@/components/ui/PageHeader';

type Strategy = 'stock' | 'diamond' | 'diamond-momentum' | 'etf' | 'etf-momentum';
type StockUniverseMode = 'retail-stock' | 'manual';

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
  positions: BacktestPositionSnapshot[];
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
  stopCooldownDays?: number;
  stockUniverse?: 'manual' | 'retail-stock';
  stockUniverseCount?: number;
  initialCapital?: number;
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
    help: '全市场 A 股前复权日线选红钻 + 动量信号，默认 5 日确认，期间只处理极端风控，到期再看 MA20 和信号弱化。',
  },
  {
    value: 'etf-momentum',
    label: 'ETF 动量轮动',
    help: '每 10 个交易日选 20 日动量最强且站上 MA20 的前 4 只 ETF，并按市场状态调节宽基和熊市仓位。',
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
  const [exitMaxFail, setExitMaxFail] = useState('2');
  const [maxConcurrent, setMaxConcurrent] = useState('5');
  const [initialCapital, setInitialCapital] = useState('100000');
  const [result, setResult] = useState<BacktestResult | null>(null);
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
  const resultSymbolCount = result?.config?.stockUniverseCount ?? result?.symbols.length ?? 0;

  function buildBacktestParams() {
    const params = new URLSearchParams({ strategy });
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
    if (strategy === 'etf' && includeWaitPullback) {
      params.set('includeWaitPullback', '1');
    }
    if (strategy === 'etf') {
      params.set('exitMaxFail', exitMaxFail);
      params.set('maxConcurrent', maxConcurrent);
      params.set('newsFilter', newsFilter);
    }
    return params;
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
    const response = await fetch(`/api/backtest?${params.toString()}`);
    const payload = (await response.json()) as BacktestResult & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? '回测失败');
    setResult(payload);
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
    setProgress({
      stage: '开始回测',
      message: '正在提交任务。',
      percent: 1,
      elapsedMs: 0,
    });
    setProgressLog([]);
    const params = buildBacktestParams();
    try {
      const response = await fetch(`/api/backtest/stream?${params.toString()}`);
      await readBacktestStream(response, params);
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
        description="同一页回放 ETF 轮动和 A 股红钻策略；A 股优先使用本地前复权 CSV，结果可直接对照逐笔交易。"
      />

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
                <span>从 stock/qfq-daily 目录读取所有普通 A 股日线；红钻只是入场候选，默认最多持有 5 个交易日。</span>
              </div>
            )}
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
            {activeStrategy.help} 股票策略没有固定观察期；ETF 的 10 日是调仓周期，不是固定持有期。结果是规则验证，不是投资建议。
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

      {result && (
        <>
          <section className="paper-hero">
            <div className="paper-hero-main">
              <span className="muted">{fmtTime(result.generatedAt)}</span>
              <strong>{displayStrategyName(result.strategy)}</strong>
              <span className="muted">
                {result.startDate && result.endDate
                  ? `${result.startDate} 至 ${result.endDate}`
                  : `${startDate} 至 ${endDate}`}
                {' · '}
                覆盖 {resultSymbolCount} 个标的
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

          {result.strategy === 'etf-tail-rules' ||
          result.strategy === 'etf-momentum-rotation' ? (
            <EtfStrategyReport result={result} />
          ) : (
            <StockStrategyReport result={result} />
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
  const finalReturn = result.equityCurve?.at(-1)?.returnPct ?? null;
  const benchmarkReturn = result.benchmark?.finalReturnPct ?? null;
  const excessReturn =
    finalReturn != null && benchmarkReturn != null
      ? Number((finalReturn - benchmarkReturn).toFixed(2))
      : null;
  const annualReturn = calcAnnualReturnPct(result.equityCurve);
  const maxDrawdown = calcMaxDrawdownPct(result.equityCurve);
  const sharpe = calcSharpe(result.equityCurve);
  const universeCount = result.config?.stockUniverseCount ?? result.symbols.length;
  const isMomentum =
    result.strategy === 'red-diamond-momentum' || result.strategy === 'diamond-momentum';
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
                    ? `区间 ${result.startDate ?? '—'} 至 ${result.endDate ?? '—'}。默认扫描本地 ${universeCount} 只普通 A 股前复权日 K，排除 688/689 科创板；红钻叠加动量 checklist 入场，最多持有 5 个交易日，期间只处理极端止损/止盈，到期再看 MA20 和信号弱化。`
                    : `区间 ${result.startDate ?? '—'} 至 ${result.endDate ?? '—'}。默认扫描本地 ${universeCount} 只普通 A 股前复权日 K，排除 688/689 科创板；入口统一为股票策略，历史信号统计仅作为内部验证口径。`}
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

function EtfStrategyReport({ result }: { result: BacktestResult }) {
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
                    ? `区间 ${fmtTradeDate(startDate)} 至 ${fmtTradeDate(endDate)}。规则：每 ${result.config?.rebalanceDays ?? 10} 个交易日调仓，选择 ${result.config?.momentumDays ?? 20} 日动量最强且站上 MA${result.config?.trendMaDays ?? 20} 的前 ${result.config?.topN ?? 4} 只 ETF 等权持有；不足时用沪深300兜底，大盘站上 MA20 时放宽至 MA10，若沪深300 ${result.config?.momentumDays ?? 20} 日动量不低于 ${result.config?.bullBenchmarkSlotMomentumPct ?? 8}% 则保留 ${result.config?.bullBenchmarkSlotCount ?? 1} 个宽基槽位；跌破 MA20 或 ${result.config?.momentumDays ?? 20} 日动量为负时预防性仓位上限 ${Math.round((result.config?.weakRegimeMaxExposure ?? 0.7) * 100)}%，跌破 MA20 且动量为负时仓位上限 ${Math.round((result.config?.bearRegimeMaxExposure ?? 0.25) * 100)}%，单笔 -12% 止损后 ${result.config?.stopCooldownDays ?? 10} 日冷却，冷却挡掉的槽位只用沪深300兜底，含交易成本与波动率目标仓位，权益按日线滚动。`
                    : `区间 ${fmtTradeDate(startDate)} 至 ${fmtTradeDate(endDate)}。规则：8 条 ETF 尾盘规则 + 买入前 ${result.config?.newsLookbackDays ?? 3} 日新闻过滤；最多同时持有 ${result.config?.maxConcurrentPositions ?? 5} 只；失效出场允许 ${result.config?.exitMaxFailCount ?? 2} 条规则失败；收益曲线按组合槽位复利。`}
                </p>
              </div>
              <strong className={returnClass(finalReturn)}>累计 {fmtPct(finalReturn)}</strong>
            </div>

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
                  <SummaryMetric label="调仓周期" value={`${result.config?.rebalanceDays ?? 10} 日`} />
                  <SummaryMetric label="持仓数量" value={`Top ${result.config?.topN ?? 4}`} />
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
  initialCapital,
}: {
  snapshots: BacktestPortfolioSnapshot[] | undefined;
  initialCapital?: number;
}) {
  const [page, setPage] = useState(0);
  const pageSize = 30;
  const ordered = useMemo(
    () => [...(snapshots ?? [])].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate)),
    [snapshots],
  );
  const latest = ordered[ordered.length - 1];
  const pageCount = Math.max(1, Math.ceil(ordered.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const pageStart = currentPage * pageSize;
  const pageEnd = Math.min(pageStart + pageSize, ordered.length);
  const visibleSnapshots = ordered.slice(pageStart, pageEnd);

  useEffect(() => {
    setPage(0);
  }, [snapshots]);

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
            按初始资金 {fmtMoney(initialCapital ?? null)} 元换算股数/份额；日终卖出的仓位已转为现金，普通交易持仓期按占用资金展示。
          </p>
        </div>
        <strong className={returnClass(latest.returnPct)}>
          总资产 {fmtMoney(latest.totalValue)} 元
        </strong>
      </div>

      <div className="overview-metric-grid overview-metric-grid--compact">
        <SummaryMetric label="初始资金" value={`${fmtMoney(initialCapital ?? null)} 元`} />
        <SummaryMetric label="最新现金" value={`${fmtMoney(latest.cash)} 元`} />
        <SummaryMetric label="持仓市值" value={`${fmtMoney(latest.investedMarketValue)} 元`} />
        <SummaryMetric label="账面收益" value={fmtPct(latest.returnPct)} tone={latest.returnPct} />
      </div>

      <div className="portfolio-snapshot-toolbar">
        <span>
          按日期从旧到新 · 显示第 {pageStart + 1}-{pageEnd} 天 / 共 {ordered.length} 天
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
          <details className="portfolio-snapshot" key={snapshot.tradeDate}>
            <summary>
              <span>{fmtTradeDate(snapshot.tradeDate)}</span>
              <span>总资产 {fmtMoney(snapshot.totalValue)} 元</span>
              <span>现金 {fmtMoney(snapshot.cash)} 元</span>
              <strong className={returnClass(snapshot.returnPct)}>
                {fmtPct(snapshot.returnPct)}
              </strong>
              <span>{snapshot.positions.length} 个持仓</span>
            </summary>
            {snapshot.positions.length > 0 ? (
              <div className="table-scroll-wrap">
                <table className="candidate-table portfolio-position-table">
                  <thead>
                    <tr>
                      <th>名称</th>
                      <th>类型</th>
                      <th>买入日</th>
                      <th>买入价</th>
                      <th>股数/份额</th>
                      <th>成本</th>
                      <th>市值/占用</th>
                      <th>权重</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.positions.map((position) => (
                      <tr key={`${snapshot.tradeDate}-${position.symbol}-${position.entryDate}`}>
                        <td title={position.symbol}>{displayHoldingName(position)}</td>
                        <td>{position.assetType === 'etf' ? 'ETF' : '股票'}</td>
                        <td>{fmtTradeDate(position.entryDate)}</td>
                        <td>{fmtPrice(position.entryPrice)}</td>
                        <td>{fmtNumber(position.shares, 2)}</td>
                        <td>{fmtMoney(position.costAmount)} 元</td>
                        <td>{fmtMoney(position.marketValue)} 元</td>
                        <td>{fmtNumber(position.weightPct)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted portfolio-snapshot-empty">当日无持仓，资金全部为空仓现金。</p>
            )}
          </details>
        ))}
      </div>
    </section>
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

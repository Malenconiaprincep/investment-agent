import '../config/load-env.js';

import { runDiamondBacktest } from '../data/backtest/diamond.js';
import {
  buildPortfolioLedger,
  filterTradesByPortfolioRules,
} from '../data/backtest/portfolio.js';
import {
  calcMaxDrawdownPct,
  summarizeTrades,
} from '../data/backtest/engine.js';
import type { BacktestTrade } from '../data/backtest/types.js';

type Policy = {
  name: string;
  rank: boolean;
  filter: (trade: BacktestTrade) => boolean;
};

function numberMeta(trade: BacktestTrade, key: string): number | null {
  const value = trade.signal.metadata?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function riskyName(value: string | null | undefined): boolean {
  if (!value) return false;
  const normalized = value
    .normalize('NFKC')
    .trim()
    .toUpperCase()
    .replace(/[\s.*＊·]+/g, '');
  return normalized.includes('ST') || /退|风险警示/.test(normalized);
}

function shouldRejectPortfolioTrade(trade: BacktestTrade): boolean {
  if (riskyName(trade.name) || riskyName(trade.signal.name)) return true;
  const momentum = numberMeta(trade, 'benchmarkMomentum20Pct');
  return momentum != null && momentum >= 0 && momentum <= 2;
}

function applyPolicy(trades: BacktestTrade[], policy: Policy): BacktestTrade[] {
  return filterTradesByPortfolioRules(trades.filter(policy.filter), {
    maxConcurrent: 5,
    noSymbolOverlap: true,
    reserveRejectedSlots: true,
    rejectTrade: shouldRejectPortfolioTrade,
    priority: policy.rank
      ? (trade) => numberMeta(trade, 'selectionScore') ?? 0
      : undefined,
  });
}

function summarizePolicy(trades: BacktestTrade[], policy: Policy) {
  const selected = applyPolicy(trades, policy);
  const ledger = buildPortfolioLedger(selected, {
    slots: 5,
    initialCapital: 100_000,
  });
  const metrics = summarizeTrades(selected);
  const period = (from: string, to: string) => {
    const before = ledger.equityCurve
      .filter((point) => point.tradeDate.replace(/-/g, '') < from)
      .at(-1);
    const points = ledger.equityCurve.filter((point) => {
      const date = point.tradeDate.replace(/-/g, '');
      return date >= from && date <= to;
    });
    const base = before?.equity ?? 100;
    const last = points.at(-1)?.equity ?? base;
    let peak = base;
    let maxDrawdownPct = 0;
    for (const point of points) {
      peak = Math.max(peak, point.equity);
      maxDrawdownPct = Math.min(
        maxDrawdownPct,
        ((point.equity - peak) / peak) * 100,
      );
    }
    return {
      returnPct: Number((((last / base) - 1) * 100).toFixed(2)),
      maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
    };
  };
  return {
    policy: policy.name,
    returnPct: ledger.equityCurve.at(-1)?.returnPct ?? null,
    maxDrawdownPct: calcMaxDrawdownPct(ledger.equityCurve),
    trades: selected.length,
    winRatePct: metrics.winRatePct,
    avgReturnPct: metrics.avgReturnPct,
    medianReturnPct: metrics.medianReturnPct,
    train2018To2023: period('20180101', '20231231'),
    test2024To2026: period('20240101', '20260709'),
    annual: [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026].map(
      (year) => ({
        year,
        ...period(
          `${year}0101`,
          year === 2026 ? '20260709' : `${year}1231`,
        ),
      }),
    ),
  };
}

const pass = () => true;
const volume18 = (trade: BacktestTrade) =>
  (numberMeta(trade, 'volumeRatio') ?? -Infinity) >= 1.8;
const ma10 = (trade: BacktestTrade) =>
  (numberMeta(trade, 'entryMa20ExtensionPct') ?? Infinity) <= 10;
const gap3 = (trade: BacktestTrade) =>
  (numberMeta(trade, 'nextOpenGapPct') ?? Infinity) <= 3;
const amount30 = (trade: BacktestTrade) => {
  const amount = numberMeta(trade, 'avgTurnoverAmount5d');
  return amount == null || amount >= 30_000_000;
};
const benchmark3 = (trade: BacktestTrade) =>
  (numberMeta(trade, 'benchmarkMomentum20Pct') ?? -Infinity) >= 3;
const benchmark5 = (trade: BacktestTrade) =>
  (numberMeta(trade, 'benchmarkMomentum20Pct') ?? -Infinity) >= 5;
const combine = (...filters: Array<(trade: BacktestTrade) => boolean>) =>
  (trade: BacktestTrade) => filters.every((filter) => filter(trade));

const policies: Policy[] = [
  { name: 'baseline-code-order', rank: false, filter: pass },
  { name: 'rank-only', rank: true, filter: pass },
  { name: 'gap3-only', rank: false, filter: gap3 },
  { name: 'ma10-only', rank: false, filter: ma10 },
  { name: 'volume18-only', rank: false, filter: volume18 },
  { name: 'amount30-only', rank: false, filter: amount30 },
  { name: 'benchmark3-only', rank: false, filter: benchmark3 },
  { name: 'benchmark5-only', rank: false, filter: benchmark5 },
  { name: 'rank+gap3', rank: true, filter: gap3 },
  { name: 'rank+ma10', rank: true, filter: ma10 },
  { name: 'rank+volume18', rank: true, filter: volume18 },
  { name: 'rank+amount30', rank: true, filter: amount30 },
  { name: 'rank+benchmark3', rank: true, filter: benchmark3 },
  { name: 'rank+benchmark5', rank: true, filter: benchmark5 },
  {
    name: 'rank+gap3+benchmark3',
    rank: true,
    filter: combine(gap3, benchmark3),
  },
  {
    name: 'rank+gap3+benchmark5',
    rank: true,
    filter: combine(gap3, benchmark5),
  },
  {
    name: 'rank+gap3+ma10',
    rank: true,
    filter: combine(gap3, ma10),
  },
  {
    name: 'rank+gap3+volume18',
    rank: true,
    filter: combine(gap3, volume18),
  },
  {
    name: 'rank+gap3+ma10+amount30',
    rank: true,
    filter: combine(gap3, ma10, amount30),
  },
  {
    name: 'strict-v2',
    rank: true,
    filter: combine(gap3, ma10, volume18, amount30),
  },
];

const result = await runDiamondBacktest({
  symbols: [],
  universe: 'retail-stock',
  strategy: 'red-diamond-momentum',
  startDate: '2018-01-02',
  endDate: '2026-07-09',
  initialCapital: 100_000,
  maxConcurrentPositions: 5_000,
  noSymbolOverlap: false,
  entryExecution: 'next_open',
  minSignalVolumeRatio: 0,
  maxNextOpenGapPct: null,
  rankEntryCandidates: false,
  minAvgTurnoverAmount: 0,
  maxEntryMa20ExtensionPct: 0.12,
  excludeRiskyStockNames: false,
  weakMomentumNoEntryMinBenchmarkMomentum20Pct: 1,
  weakMomentumNoEntryMaxBenchmarkMomentum20Pct: 0,
});

process.stdout.write(
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      candidateTrades: result.trades.length,
      benchmarkPct: result.benchmark?.finalReturnPct ?? null,
      policies: policies.map((policy) => summarizePolicy(result.trades, policy)),
    },
    null,
    2,
  ),
);

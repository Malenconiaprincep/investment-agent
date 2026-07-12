import '../config/load-env.js';

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runEtfEvergreenV3Backtest } from '../data/backtest/etf-evergreen-v3.js';
import { runEtfMomentumT1Backtest } from '../data/backtest/etf-momentum-t1.js';
import { runEtfStableV2Backtest } from '../data/backtest/etf-stable-v2.js';
import type { BacktestEquityPoint, BacktestTrade } from '../data/backtest/types.js';
import { PACKAGE_ROOT } from '../mastra/config/paths.js';

function argValue(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function round(value: number, digits = 2) {
  return Number(value.toFixed(digits));
}

function maxDrawdown(points: BacktestEquityPoint[]) {
  let peak = points[0]!;
  let maxPeak = peak;
  let trough = peak;
  let maxDrawdownPct = 0;
  for (const point of points) {
    if (point.equity > peak.equity) peak = point;
    const drawdownPct = peak.equity > 0 ? (point.equity / peak.equity - 1) * 100 : 0;
    if (drawdownPct < maxDrawdownPct) {
      maxDrawdownPct = drawdownPct;
      maxPeak = peak;
      trough = point;
    }
  }
  const troughIndex = points.findIndex((point) => point.tradeDate === trough.tradeDate);
  const recovery = points
    .slice(Math.max(0, troughIndex + 1))
    .find((point) => point.equity >= maxPeak.equity) ?? null;
  return {
    peak: maxPeak,
    trough,
    recovery,
    maxDrawdownPct: round(maxDrawdownPct),
    underwaterTradingDays: recovery
      ? points.findIndex((point) => point.tradeDate === recovery.tradeDate)
        - points.findIndex((point) => point.tradeDate === maxPeak.tradeDate)
      : points.length - 1 - points.findIndex((point) => point.tradeDate === maxPeak.tradeDate),
  };
}

function pointOn(curve: BacktestEquityPoint[], tradeDate: string) {
  return curve.find((point) => point.tradeDate === tradeDate)
    ?? [...curve].reverse().find((point) => point.tradeDate <= tradeDate)
    ?? null;
}

function worstTrades(trades: BacktestTrade[], startDate: string, endDate: string) {
  return trades
    .filter((trade): trade is BacktestTrade & { exitDate: string } =>
      trade.exitDate != null && trade.entryDate <= endDate && trade.exitDate >= startDate,
    )
    .filter((trade): trade is BacktestTrade & { exitDate: string; returnPct: number } =>
      trade.returnPct != null,
    )
    .sort((a, b) => a.returnPct - b.returnPct)
    .slice(0, 10)
    .map((trade) => ({
      symbol: trade.symbol,
      name: trade.name,
      sleeve: trade.signal.metadata?.evergreenSleeve ?? 'unknown',
      entryDate: trade.entryDate,
      exitDate: trade.exitDate,
      returnPct: round(trade.returnPct),
      exitReason: trade.exitReason,
    }));
}

async function main() {
  const startDate = argValue('from') ?? '2014-01-02';
  const endDate = argValue('to') ?? '2026-07-10';
  const [evergreen, defensive, growth] = await Promise.all([
    runEtfEvergreenV3Backtest({ startDate, endDate, growthWeightPct: 0.6 }),
    runEtfStableV2Backtest({
      startDate,
      endDate,
      benchmarkCoreWeightPct: 0.5,
    }),
    runEtfMomentumT1Backtest({
      startDate,
      endDate,
      riskAdjustedMomentum: true,
      maxAssetVolPct: 40,
      stopLossPct: -6,
      stopCooldownDays: 20,
      cashFallbackInWeakRegime: true,
    }),
  ]);
  const curve = evergreen.equityCurve ?? [];
  if (curve.length === 0) throw new Error('长青 V3 没有净值曲线');
  const drawdown = maxDrawdown(curve);
  const defensiveCurve = defensive.equityCurve ?? [];
  const growthCurve = growth.equityCurve ?? [];
  const dPeak = pointOn(defensiveCurve, drawdown.peak.tradeDate)!;
  const dTrough = pointOn(defensiveCurve, drawdown.trough.tradeDate)!;
  const gPeak = pointOn(growthCurve, drawdown.peak.tradeDate)!;
  const gTrough = pointOn(growthCurve, drawdown.trough.tradeDate)!;
  const bPeak = pointOn(evergreen.benchmark?.curve ?? [], drawdown.peak.tradeDate);
  const bTrough = pointOn(evergreen.benchmark?.curve ?? [], drawdown.trough.tradeDate);
  const defensiveContribution = 0.4 * (dTrough.equity - dPeak.equity);
  const growthContribution = 0.6 * (gTrough.equity - gPeak.equity);
  const report = {
    generatedAt: new Date().toISOString(),
    startDate,
    endDate,
    maxDrawdown: {
      peakDate: drawdown.peak.tradeDate,
      peakEquity: round(drawdown.peak.equity),
      troughDate: drawdown.trough.tradeDate,
      troughEquity: round(drawdown.trough.equity),
      recoveryDate: drawdown.recovery?.tradeDate ?? null,
      maxDrawdownPct: drawdown.maxDrawdownPct,
      underwaterTradingDays: drawdown.underwaterTradingDays,
    },
    sleeves: {
      defensive: {
        weightPct: 40,
        peakToTroughReturnPct: round((dTrough.equity / dPeak.equity - 1) * 100),
        contributionPctOfPeak: round(defensiveContribution / drawdown.peak.equity * 100),
      },
      growth: {
        weightPct: 60,
        peakToTroughReturnPct: round((gTrough.equity / gPeak.equity - 1) * 100),
        contributionPctOfPeak: round(growthContribution / drawdown.peak.equity * 100),
      },
    },
    benchmarkPeakToTroughReturnPct: bPeak && bTrough
      ? round((bTrough.equity / bPeak.equity - 1) * 100)
      : null,
    worstTrades: worstTrades(
      evergreen.trades,
      drawdown.peak.tradeDate,
      drawdown.trough.tradeDate,
    ),
    conclusion: [
      '最大回撤按增长与防守袖套拆解，不用单笔亏损替代组合路径归因。',
      '改进候选必须针对主要贡献袖套，并重跑全部固定场景；禁止只优化这一段历史。',
    ],
  };
  const repoRoot = path.resolve(PACKAGE_ROOT, '../..');
  const outputDir = path.join(repoRoot, 'docs/backtests');
  mkdirSync(outputDir, { recursive: true });
  const suffix = endDate.replace(/-/g, '');
  const jsonPath = path.join(outputDir, `etf-evergreen-v3-drawdown-${suffix}.json`);
  const markdownPath = path.join(outputDir, `etf-evergreen-v3-drawdown-${suffix}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  writeFileSync(markdownPath, [
    `# 长青 V3 最大回撤归因（截至 ${endDate}）`,
    '',
    `- 峰值：${report.maxDrawdown.peakDate}，净值 ¥${report.maxDrawdown.peakEquity.toFixed(2)}`,
    `- 谷值：${report.maxDrawdown.troughDate}，净值 ¥${report.maxDrawdown.troughEquity.toFixed(2)}`,
    `- 最大回撤：${report.maxDrawdown.maxDrawdownPct.toFixed(2)}%`,
    `- 恢复日期：${report.maxDrawdown.recoveryDate ?? '截至样本末尚未恢复'}`,
    `- 水下交易日：${report.maxDrawdown.underwaterTradingDays}`,
    '',
    '## 袖套贡献',
    '',
    '| 袖套 | 权重 | 峰谷收益 | 对组合峰值的贡献 |',
    '| --- | ---: | ---: | ---: |',
    `| 防守 | 40% | ${report.sleeves.defensive.peakToTroughReturnPct.toFixed(2)}% | ${report.sleeves.defensive.contributionPctOfPeak.toFixed(2)}% |`,
    `| 增长 | 60% | ${report.sleeves.growth.peakToTroughReturnPct.toFixed(2)}% | ${report.sleeves.growth.contributionPctOfPeak.toFixed(2)}% |`,
    `| 沪深300ETF | — | ${report.benchmarkPeakToTroughReturnPct?.toFixed(2) ?? '—'}% | — |`,
    '',
    '## 区间最差交易',
    '',
    '| ETF | 袖套 | 入场 | 出场 | 收益 | 原因 |',
    '| --- | --- | --- | --- | ---: | --- |',
    ...report.worstTrades.map((trade) =>
      `| ${trade.symbol} ${trade.name} | ${trade.sleeve} | ${trade.entryDate} | ${trade.exitDate} | ${trade.returnPct.toFixed(2)}% | ${trade.exitReason} |`,
    ),
    '',
    '## 约束',
    '',
    ...report.conclusion.map((item) => `- ${item}`),
    '',
  ].join('\n'), 'utf-8');
  process.stdout.write(JSON.stringify({ ...report, jsonPath, markdownPath }, null, 2));
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});

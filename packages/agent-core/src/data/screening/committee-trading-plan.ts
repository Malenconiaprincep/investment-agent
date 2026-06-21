import {
  detectDiamondSignal,
  type DiamondSignalResult,
} from '../market/diamond-signal.js';
import { sma, type OhlcvBar } from '../market/indicators.js';
import { getDailyQuote } from '../market/services.js';
import {
  analyzeMomentum,
  MOMENTUM_STOP_LOSS_PCT,
  MOMENTUM_TRAILING_STOP_PCT,
  type MomentumAnalysis,
} from '../paper/momentum.js';

export type TradeSignalKind = 'buy' | 'sell';

export type TradeSignalPoint = {
  kind: TradeSignalKind;
  tradeDate: string;
  price: number;
  reason: string;
  strength?: 'red' | 'blue';
};

export type CommitteeTradePlan = {
  symbol: string;
  name: string;
  action: MomentumAnalysis['action'];
  actionReason: string;
  latestClose: number;
  entryPrice: number | null;
  stopLossPrice: number;
  targetHint: string;
  signals: TradeSignalPoint[];
  diamondStrength: 'red' | 'blue' | null;
  checklistScore: number;
  checklistMax: number;
};

function barsFromQuote(quotes: OhlcvBar[]): OhlcvBar[] {
  return quotes.filter((q) => q.close != null);
}

const ACTION_LABEL: Record<MomentumAnalysis['action'], string> = {
  buy: '建议买入',
  hold: '持有观察',
  wait: '等待信号',
  sell: '建议卖出/回避',
};

/** 扫描近 N 根 K 线上的钻石买入点（最多保留 recent 个） */
function scanDiamondBuySignals(
  symbol: string,
  name: string,
  bars: OhlcvBar[],
  lookback = 90,
  recent = 3,
): TradeSignalPoint[] {
  const found: TradeSignalPoint[] = [];
  const limit = Math.min(bars.length, lookback);

  for (let i = 0; i < limit; i++) {
    if (bars.length - i < 30) break;
    const slice = bars.slice(i);
    const signal = detectDiamondSignal(symbol, name, slice);
    const bar = slice[0];
    if (!signal || !bar?.tradeDate || bar.close == null) continue;
    if (signal.tradeDate.replace(/-/g, '') !== bar.tradeDate.replace(/-/g, '')) {
      continue;
    }

    const prev = found[found.length - 1];
    if (prev && prev.tradeDate === bar.tradeDate) continue;

    found.push({
      kind: 'buy',
      tradeDate: bar.tradeDate,
      price: bar.close,
      reason: `${signal.strength === 'red' ? '红钻' : '蓝钻'} · ${signal.reasons.slice(0, 2).join('、')}`,
      strength: signal.strength,
    });
  }

  return found.slice(0, recent);
}

/** 跌破 MA20 的卖出信号（近 lookback 根，最多 2 个） */
function scanMa20SellSignals(bars: OhlcvBar[], lookback = 60): TradeSignalPoint[] {
  const found: TradeSignalPoint[] = [];
  const limit = Math.min(bars.length - 20, lookback);

  for (let i = 0; i < limit; i++) {
    const slice = bars.slice(i);
    const bar = slice[0];
    if (!bar?.close || !bar.tradeDate) continue;

    const closes = slice.map((b) => b.close).filter((c): c is number => c != null);
    const ma20 = sma(closes, 20);
    const prevBar = slice[1];
    if (ma20 == null || !prevBar?.close) continue;

    const prevCloses = slice.slice(1).map((b) => b.close).filter((c): c is number => c != null);
    const prevMa20 = sma(prevCloses, 20);
    if (prevMa20 == null) continue;

    if (prevBar.close >= prevMa20 && bar.close < ma20) {
      found.push({
        kind: 'sell',
        tradeDate: bar.tradeDate,
        price: bar.close,
        reason: '收盘价跌破 MA20',
      });
    }
  }

  return found.slice(0, 2);
}

function buildActionReason(
  action: MomentumAnalysis['action'],
  momentum: MomentumAnalysis,
  diamond: DiamondSignalResult | null,
): string {
  const parts = [ACTION_LABEL[action]];
  if (diamond) {
    parts.push(`${diamond.strength === 'red' ? '红钻' : '蓝钻'}确认`);
  }
  parts.push(`Checklist ${momentum.checklistScore}/${momentum.checklist.length}`);
  if (action === 'buy') {
    parts.push('趋势与量能配合');
  } else if (action === 'sell') {
    parts.push('趋势转弱或跌破关键均线');
  } else if (action === 'wait') {
    parts.push('条件未齐备，宜观望');
  }
  return parts.join(' · ');
}

export async function buildCommitteeTradePlan(input: {
  symbol: string;
  name: string;
}): Promise<CommitteeTradePlan | null> {
  const data = await getDailyQuote(input.symbol, 120);
  const bars = barsFromQuote(data.quotes);
  if (bars.length < 30) return null;

  const latest = bars[0];
  const latestClose = latest.close!;
  const diamond = detectDiamondSignal(input.symbol, input.name, bars);
  const momentum = analyzeMomentum(input.symbol, input.name, bars, diamond);
  if (!momentum) return null;

  const buySignals = scanDiamondBuySignals(input.symbol, input.name, bars);
  const sellSignals = scanMa20SellSignals(bars);

  const signals = [...buySignals, ...sellSignals].sort((a, b) =>
    b.tradeDate.localeCompare(a.tradeDate),
  );

  if (momentum.action === 'sell' && signals[0]?.kind !== 'sell') {
    signals.unshift({
      kind: 'sell',
      tradeDate: latest.tradeDate,
      price: latestClose,
      reason: '当前趋势转弱，建议回避或减仓',
    });
  }

  const entryPrice =
    momentum.action === 'buy' || momentum.action === 'hold'
      ? diamond?.close ?? latestClose
      : null;

  const targetHint = `硬止损 -${MOMENTUM_STOP_LOSS_PCT * 100}% · 破 MA20 离场 · 移动止盈回撤 ${MOMENTUM_TRAILING_STOP_PCT * 100}%`;

  return {
    symbol: input.symbol,
    name: input.name,
    action: momentum.action,
    actionReason: buildActionReason(momentum.action, momentum, diamond),
    latestClose,
    entryPrice,
    stopLossPrice: momentum.stopLossPrice ?? latestClose * (1 - MOMENTUM_STOP_LOSS_PCT),
    targetHint,
    signals,
    diamondStrength: momentum.diamondStrength,
    checklistScore: momentum.checklistScore,
    checklistMax: momentum.checklist.length,
  };
}

export async function buildCommitteeTradePlans(
  candidates: Array<{ symbol: string; name: string }>,
): Promise<CommitteeTradePlan[]> {
  const plans: CommitteeTradePlan[] = [];

  for (const candidate of candidates) {
    try {
      const plan = await buildCommitteeTradePlan(candidate);
      if (plan) plans.push(plan);
    } catch {
      // 单票失败不阻断
    }
  }

  return plans;
}

/** 供主席 Agent 引用的结构化摘要 */
export function formatTradePlansForPrompt(plans: CommitteeTradePlan[]): string {
  if (plans.length === 0) return '（无可用 K 线交易计划）';

  return plans
    .map((plan) => {
      const signalLines = plan.signals
        .slice(0, 6)
        .map(
          (s) =>
            `  - ${s.kind === 'buy' ? '买入' : '卖出'} ${s.tradeDate} @ ${s.price.toFixed(2)}：${s.reason}`,
        )
        .join('\n');

      return `### ${plan.name}(${plan.symbol})
- 操作建议：${ACTION_LABEL[plan.action]}（${plan.actionReason}）
- 最新收盘：${plan.latestClose.toFixed(2)}
- 建议入场参考：${plan.entryPrice?.toFixed(2) ?? '—'}
- 建议止损：${plan.stopLossPrice.toFixed(2)}
- 出场规则：${plan.targetHint}
- K线信号点：
${signalLines || '  - 暂无历史信号'}`;
    })
    .join('\n\n');
}

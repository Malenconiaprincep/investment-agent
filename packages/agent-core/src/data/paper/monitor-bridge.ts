import type { MonitorAlert } from '../monitor/store.js';
import { scanDiamondSignal } from '../market/diamond-signal.js';
import { getDailyQuote } from '../market/services.js';
import {
  analyzeMomentum,
  evaluateMomentumExit,
} from './momentum.js';
import {
  calcAutoBuyShares,
  executePaperTrade,
  getPaperAccountSummary,
  getPositionMeta,
  listPaperPositions,
  listPaperTrades,
  updateHighWaterMark,
} from './store.js';

export type MonitorPaperRecommendation = {
  alertId: string;
  alertType: MonitorAlert['alertType'];
  level: 'auto_buy' | 'watch' | 'info';
  symbol: string | null;
  name: string | null;
  reason: string;
  status: 'recommended' | 'bought' | 'skipped' | 'error';
  skipReason?: string;
  error?: string;
  shares?: number;
  price?: number;
  tradeId?: string;
};

export type MonitorPaperAction = {
  kind: 'buy' | 'sell';
  status: 'bought' | 'sold' | 'skipped' | 'error';
  symbol: string;
  name: string;
  reason: string;
  alertId?: string;
  shares?: number;
  price?: number;
  tradeId?: string;
  error?: string;
};

export type MonitorPaperBridgeResult = {
  recommendations: MonitorPaperRecommendation[];
  paperActions: MonitorPaperAction[];
};

export function classifyMonitorAlert(
  alert: MonitorAlert,
): Pick<MonitorPaperRecommendation, 'level' | 'status' | 'reason'> {
  if (alert.alertType === 'pre_move' && alert.severity === 'urgent' && alert.symbol) {
    return {
      level: 'auto_buy',
      status: 'recommended',
      reason: '新闻催化且涨幅尚小，进入消息雷达自动买入候选',
    };
  }

  if (
    alert.symbol &&
    (alert.alertType === 'early_move' ||
      alert.alertType === 'news_catalyst' ||
      alert.alertType === 'watchlist_surge')
  ) {
    return {
      level: 'watch',
      status: 'recommended',
      reason: '值得跟踪，但未达到自动买入条件',
    };
  }

  return {
    level: 'info',
    status: 'recommended',
    reason: '消息记录，不触发自动交易',
  };
}

function buildRecommendation(alert: MonitorAlert): MonitorPaperRecommendation {
  const classified = classifyMonitorAlert(alert);
  return {
    alertId: alert.id,
    alertType: alert.alertType,
    symbol: alert.symbol,
    name: alert.name,
    ...classified,
  };
}

export function isMonitorBuyForAlert(note: string | null, alertId: string): boolean {
  return note?.startsWith(`monitor:${alertId}:`) ?? false;
}

export function isMonitorBuyForSymbolToday(input: {
  note: string | null;
  side: 'buy' | 'sell';
  source: 'manual' | 'auto';
  tradeDate: string;
  targetDate: string;
}): boolean {
  return (
    input.side === 'buy' &&
    input.source === 'auto' &&
    input.tradeDate === input.targetDate &&
    (input.note?.startsWith('monitor:') ?? false)
  );
}

async function maybeAutoBuy(input: {
  alert: MonitorAlert;
  recommendation: MonitorPaperRecommendation;
  tradeDate: string;
}): Promise<MonitorPaperAction | null> {
  const { alert, recommendation, tradeDate } = input;
  if (recommendation.level !== 'auto_buy') return null;
  if (!alert.symbol || !alert.name) {
    recommendation.status = 'skipped';
    recommendation.skipReason = '缺少股票代码或名称';
    return {
      kind: 'buy',
      status: 'skipped',
      symbol: alert.symbol ?? 'unknown',
      name: alert.name ?? 'unknown',
      alertId: alert.id,
      reason: recommendation.skipReason,
    };
  }

  try {
    const [summary, trades] = await Promise.all([
      getPaperAccountSummary(),
      listPaperTrades(500),
    ]);

    if (summary.positions.some((p) => p.symbol === alert.symbol)) {
      recommendation.status = 'skipped';
      recommendation.skipReason = '模拟盘已持有该股票';
      return {
        kind: 'buy',
        status: 'skipped',
        symbol: alert.symbol,
        name: alert.name,
        alertId: alert.id,
        reason: recommendation.skipReason,
      };
    }

    if (trades.some((trade) => isMonitorBuyForAlert(trade.note, alert.id))) {
      recommendation.status = 'skipped';
      recommendation.skipReason = '该告警已执行过自动买入';
      return {
        kind: 'buy',
        status: 'skipped',
        symbol: alert.symbol,
        name: alert.name,
        alertId: alert.id,
        reason: recommendation.skipReason,
      };
    }

    const duplicateSymbolToday = trades.some(
      (trade) =>
        trade.symbol === alert.symbol &&
        isMonitorBuyForSymbolToday({
          note: trade.note,
          side: trade.side,
          source: trade.source,
          tradeDate: trade.tradeDate,
          targetDate: tradeDate,
        }),
    );
    if (duplicateSymbolToday) {
      recommendation.status = 'skipped';
      recommendation.skipReason = '同一股票今日已有消息雷达自动买入';
      return {
        kind: 'buy',
        status: 'skipped',
        symbol: alert.symbol,
        name: alert.name,
        alertId: alert.id,
        reason: recommendation.skipReason,
      };
    }

    const quote = await getDailyQuote(alert.symbol, 2);
    const price = quote.latestClose;
    if (price == null) {
      recommendation.status = 'skipped';
      recommendation.skipReason = '无法获取最新价格';
      return {
        kind: 'buy',
        status: 'skipped',
        symbol: alert.symbol,
        name: alert.name,
        alertId: alert.id,
        reason: recommendation.skipReason,
      };
    }

    const shares = calcAutoBuyShares(summary.account.cash, price);
    if (shares < 100) {
      recommendation.status = 'skipped';
      recommendation.skipReason = '可用现金不足以按 100 股整数买入';
      return {
        kind: 'buy',
        status: 'skipped',
        symbol: alert.symbol,
        name: alert.name,
        alertId: alert.id,
        reason: recommendation.skipReason,
      };
    }

    const result = await executePaperTrade({
      symbol: alert.symbol,
      name: alert.name,
      side: 'buy',
      shares,
      price,
      tradeDate,
      source: 'auto',
      note: `monitor:${alert.id}:${alert.alertType}`,
      entryMemo: alert.summary,
      skipSessionCheck: true,
    });

    recommendation.status = 'bought';
    recommendation.shares = result.trade.shares;
    recommendation.price = result.trade.price;
    recommendation.tradeId = result.trade.id;
    return {
      kind: 'buy',
      status: 'bought',
      symbol: alert.symbol,
      name: alert.name,
      alertId: alert.id,
      shares: result.trade.shares,
      price: result.trade.price,
      tradeId: result.trade.id,
      reason: alert.summary,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recommendation.status = 'error';
    recommendation.error = message;
    return {
      kind: 'buy',
      status: 'error',
      symbol: alert.symbol,
      name: alert.name,
      alertId: alert.id,
      reason: recommendation.reason,
      error: message,
    };
  }
}

async function autoSellExitsFromMonitor(tradeDate: string): Promise<MonitorPaperAction[]> {
  const actions: MonitorPaperAction[] = [];
  const positions = await listPaperPositions();

  for (const pos of positions) {
    try {
      const kline = await getDailyQuote(pos.symbol, 60);
      const signal = await scanDiamondSignal(pos.symbol, pos.name, 60);
      const momentum = analyzeMomentum(pos.symbol, pos.name, kline.quotes, signal);
      const close = momentum?.close ?? kline.latestClose;
      if (close == null) {
        actions.push({
          kind: 'sell',
          status: 'skipped',
          symbol: pos.symbol,
          name: pos.name,
          reason: '无法获取最新价格',
        });
        continue;
      }

      await updateHighWaterMark(pos.symbol, close);
      const meta = await getPositionMeta(pos.symbol);
      const exit = evaluateMomentumExit({
        avgCost: pos.avgCost,
        close,
        ma20: momentum?.ma20 ?? null,
        highWaterMark: meta?.highWaterMark ?? close,
        diamondStrength: signal?.strength ?? null,
      });
      if (!exit) continue;

      const summary = await getPaperAccountSummary();
      const held = summary.positions.find((p) => p.symbol === pos.symbol);
      const available = held?.availableShares ?? 0;
      if (available < 100) {
        actions.push({
          kind: 'sell',
          status: 'skipped',
          symbol: pos.symbol,
          name: pos.name,
          price: close,
          reason: `触发${exit.reason}，但 T+1 可卖股数不足 100 股`,
        });
        continue;
      }

      const shares = Math.floor(available / 100) * 100;
      const result = await executePaperTrade({
        symbol: pos.symbol,
        name: pos.name,
        side: 'sell',
        shares,
        price: close,
        tradeDate,
        source: 'auto',
        note: `monitor-exit:${exit.reason}`,
        skipSessionCheck: true,
      });
      actions.push({
        kind: 'sell',
        status: 'sold',
        symbol: pos.symbol,
        name: pos.name,
        shares: result.trade.shares,
        price: result.trade.price,
        tradeId: result.trade.id,
        reason: exit.reason,
      });
    } catch (error) {
      actions.push({
        kind: 'sell',
        status: 'error',
        symbol: pos.symbol,
        name: pos.name,
        reason: '卖出检查失败',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return actions;
}

export async function runMonitorPaperBridge(input: {
  alerts: MonitorAlert[];
  tradeDate: string;
}): Promise<MonitorPaperBridgeResult> {
  const recommendations = input.alerts.map((alert) => buildRecommendation(alert));
  const paperActions: MonitorPaperAction[] = [];

  for (let i = 0; i < input.alerts.length; i++) {
    const action = await maybeAutoBuy({
      alert: input.alerts[i],
      recommendation: recommendations[i],
      tradeDate: input.tradeDate,
    });
    if (action) paperActions.push(action);
  }

  paperActions.push(...(await autoSellExitsFromMonitor(input.tradeDate)));

  return { recommendations, paperActions };
}

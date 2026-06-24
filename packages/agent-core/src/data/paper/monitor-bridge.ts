import type { MonitorAlert } from '../monitor/store.js';
import { scanDiamondSignal } from '../market/diamond-signal.js';
import { getDailyQuote } from '../market/services.js';
import { addWatchlistItem, listWatchlistItems } from '../watchlist/store.js';
import {
  analyzeMomentum,
  evaluateMomentumExit,
  MOMENTUM_MIN_CHECKLIST,
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
  theme: string | null;
  pctChg: number | null;
  ret20dPct: number | null;
  eventPoints: string[];
  reason: string;
  status: 'recommended' | 'tracked' | 'bought' | 'skipped' | 'error';
  skipReason?: string;
  error?: string;
  shares?: number;
  price?: number;
  tradeId?: string;
};

const ALERT_EVENT_LABEL: Record<MonitorAlert['alertType'], string> = {
  pre_move: '潜伏催化',
  news_catalyst: '新闻催化',
  early_move: '温和启动',
  watchlist_surge: '自选波动',
  theme_ignite: '主线资讯',
};

function fmtPctPoint(v: number): string {
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
}

export function buildMonitorEventPoints(alert: MonitorAlert): string[] {
  const points: string[] = [];
  const typeLabel = ALERT_EVENT_LABEL[alert.alertType];
  if (typeLabel) points.push(typeLabel);

  if (alert.severity === 'urgent' && alert.alertType !== 'theme_ignite') {
    points.push('高优先级');
  }

  if (alert.theme) points.push(`主线 ${alert.theme}`);

  if (alert.pctChg != null) {
    points.push(`当日 ${fmtPctPoint(alert.pctChg)}`);
  }

  if (alert.ret20dPct != null) {
    if (alert.ret20dPct >= 25) points.push(`20日强势 ${fmtPctPoint(alert.ret20dPct)}`);
    else if (alert.ret20dPct <= -10) points.push(`20日走弱 ${fmtPctPoint(alert.ret20dPct)}`);
  }

  if (alert.newsTitle) {
    const title = alert.newsTitle.replace(/【[^】]+】/g, '').trim();
    if (title) {
      points.push(title.length > 32 ? `${title.slice(0, 32)}…` : title);
    }
  }

  return [...new Set(points)];
}

export type MonitorPaperAction = {
  kind: 'buy' | 'sell' | 'track';
  status: 'bought' | 'sold' | 'tracked' | 'skipped' | 'error';
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
      reason: '消息雷达识别，将自动加入自选并等待买入信号',
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
    theme: alert.theme,
    pctChg: alert.pctChg,
    ret20dPct: alert.ret20dPct,
    eventPoints: buildMonitorEventPoints(alert),
    ...classified,
  };
}

export function buildMonitorRecommendations(
  alerts: MonitorAlert[],
): MonitorPaperRecommendation[] {
  return alerts.map((alert) => buildRecommendation(alert));
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
    ((input.note?.startsWith('monitor:') ?? false) ||
      isMonitorWatchlistBuyNote(input.note))
  );
}

export function isMonitorWatchlistBuyNote(note: string | null): boolean {
  return note?.startsWith('monitor-watchlist:') ?? false;
}

async function checkMomentumBuyReady(symbol: string, name: string) {
  const kline = await getDailyQuote(symbol, 60);
  const signal = await scanDiamondSignal(symbol, name, 60);
  const momentum = analyzeMomentum(symbol, name, kline.quotes, signal);
  const ready =
    momentum?.action === 'buy' &&
    momentum.checklistScore >= MOMENTUM_MIN_CHECKLIST &&
    signal?.strength === 'red';
  return {
    ready: !!ready,
    memo: momentum?.entryMemo ?? '',
    price: kline.latestClose,
  };
}

async function maybeAutoTrack(input: {
  alert: MonitorAlert;
  recommendation: MonitorPaperRecommendation;
}): Promise<MonitorPaperAction | null> {
  const { alert, recommendation } = input;
  if (!alert.symbol || !alert.name || recommendation.level === 'info') return null;

  try {
    const quote = await getDailyQuote(alert.symbol, 2).catch(() => null);
    await addWatchlistItem({
      symbol: alert.symbol,
      name: alert.name,
      reason: alert.summary.slice(0, 120),
      sourceType: 'signal',
      sourceId: alert.id,
      entryPrice: quote?.latestClose ?? undefined,
    });

    if (recommendation.status !== 'bought') {
      recommendation.status = 'tracked';
      recommendation.reason = '已加入自选，动量达标后自动买入模拟盘';
    }

    return {
      kind: 'track',
      status: 'tracked',
      symbol: alert.symbol,
      name: alert.name,
      alertId: alert.id,
      reason: '消息雷达自动加入自选',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (recommendation.status !== 'bought') {
      recommendation.status = 'skipped';
      recommendation.skipReason = message;
    }
    return {
      kind: 'track',
      status: 'skipped',
      symbol: alert.symbol,
      name: alert.name,
      alertId: alert.id,
      reason: message,
      error: message,
    };
  }
}

async function executeMonitorBuy(input: {
  alert: MonitorAlert;
  recommendation: MonitorPaperRecommendation;
  tradeDate: string;
  note: string;
  entryMemo: string;
  trades: Awaited<ReturnType<typeof listPaperTrades>>;
  summary: Awaited<ReturnType<typeof getPaperAccountSummary>>;
  price?: number | null;
}): Promise<MonitorPaperAction | null> {
  const { alert, recommendation, tradeDate, note, entryMemo, trades, summary } = input;
  if (!alert.symbol || !alert.name) return null;

  if (summary.positions.some((p) => p.symbol === alert.symbol)) {
    recommendation.status = 'tracked';
    recommendation.skipReason = '模拟盘已持有，继续跟踪';
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
    recommendation.status = 'tracked';
    recommendation.skipReason = '该提醒已执行过买入';
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
    recommendation.status = 'tracked';
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

  let price = input.price ?? null;
  if (price == null) {
    const quote = await getDailyQuote(alert.symbol, 2);
    price = quote.latestClose;
  }
  if (price == null) {
    recommendation.status = 'tracked';
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
    recommendation.status = 'tracked';
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
    note,
    entryMemo,
    skipSessionCheck: true,
  });

  recommendation.status = 'bought';
  recommendation.reason = '动量达标，已自动买入模拟盘';
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
    reason: entryMemo || alert.summary,
  };
}

async function maybeAutoBuy(input: {
  alert: MonitorAlert;
  recommendation: MonitorPaperRecommendation;
  tradeDate: string;
}): Promise<MonitorPaperAction | null> {
  const { alert, recommendation, tradeDate } = input;
  if (!alert.symbol || !alert.name || recommendation.level === 'info') return null;

  const isPreMoveFast = recommendation.level === 'auto_buy';
  let momentumReady = false;
  let momentumMemo = alert.summary;
  let momentumPrice: number | null = null;

  if (!isPreMoveFast) {
    try {
      const momentum = await checkMomentumBuyReady(alert.symbol, alert.name);
      momentumReady = momentum.ready;
      momentumMemo = momentum.memo || alert.summary;
      momentumPrice = momentum.price;
    } catch {
      return null;
    }
    if (!momentumReady) return null;
  }

  try {
    const [summary, trades] = await Promise.all([
      getPaperAccountSummary(),
      listPaperTrades(500),
    ]);

    return await executeMonitorBuy({
      alert,
      recommendation,
      tradeDate,
      note: isPreMoveFast
        ? `monitor:${alert.id}:${alert.alertType}`
        : `monitor:${alert.id}:momentum`,
      entryMemo: momentumMemo,
      trades,
      summary,
      price: momentumPrice,
    });
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

async function autoBuyMonitorWatchlist(tradeDate: string): Promise<MonitorPaperAction[]> {
  const actions: MonitorPaperAction[] = [];
  const watchlist = await listWatchlistItems();
  let summary = await getPaperAccountSummary();
  let trades = await listPaperTrades(500);

  const held = new Set(summary.positions.map((p) => p.symbol));
  const monitorItems = watchlist.filter((item) => item.sourceType === 'signal');

  for (const item of monitorItems) {
    if (held.has(item.symbol)) continue;
    if (
      trades.some(
        (trade) =>
          trade.symbol === item.symbol &&
          isMonitorBuyForSymbolToday({
            note: trade.note,
            side: trade.side,
            source: trade.source,
            tradeDate: trade.tradeDate,
            targetDate: tradeDate,
          }),
      )
    ) {
      continue;
    }

    try {
      const momentum = await checkMomentumBuyReady(item.symbol, item.name);
      if (!momentum.ready) continue;

      const pseudoAlert: MonitorAlert = {
        id: item.sourceId ?? item.id,
        alertType: 'news_catalyst',
        severity: 'watch',
        symbol: item.symbol,
        name: item.name,
        title: item.name,
        summary: item.reason ?? '自选跟踪',
        newsTitle: null,
        newsUrl: null,
        pctChg: null,
        ret20dPct: null,
        theme: null,
        tradeDate,
        createdAt: new Date().toISOString(),
        acknowledged: false,
      };
      const pseudoRecommendation = buildRecommendation(pseudoAlert);
      pseudoRecommendation.status = 'tracked';

      const action = await executeMonitorBuy({
        alert: pseudoAlert,
        recommendation: pseudoRecommendation,
        tradeDate,
        note: `monitor-watchlist:${item.symbol}`,
        entryMemo: momentum.memo,
        trades,
        summary,
        price: momentum.price,
      });
      if (action) {
        actions.push(action);
        if (action.status === 'bought') {
          held.add(item.symbol);
          summary = await getPaperAccountSummary();
          trades = await listPaperTrades(500);
        }
      }
    } catch {
      // skip per symbol
    }
  }

  return actions;
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
  includeSells?: boolean;
}): Promise<MonitorPaperBridgeResult> {
  const recommendations = buildMonitorRecommendations(input.alerts);
  const paperActions: MonitorPaperAction[] = [];

  for (let i = 0; i < input.alerts.length; i++) {
    const trackAction = await maybeAutoTrack({
      alert: input.alerts[i],
      recommendation: recommendations[i],
    });
    if (trackAction) paperActions.push(trackAction);

    const buyAction = await maybeAutoBuy({
      alert: input.alerts[i],
      recommendation: recommendations[i],
      tradeDate: input.tradeDate,
    });
    if (buyAction) paperActions.push(buyAction);
  }

  paperActions.push(...(await autoBuyMonitorWatchlist(input.tradeDate)));
  if (input.includeSells !== false) {
    paperActions.push(...(await autoSellExitsFromMonitor(input.tradeDate)));
  }

  return { recommendations, paperActions };
}

export async function listRecentMonitorPaperActions(
  limit = 20,
): Promise<MonitorPaperAction[]> {
  const trades = await listPaperTrades(limit);
  return trades
    .filter(
      (trade) =>
        trade.source === 'auto' &&
        (trade.note?.startsWith('monitor:') ||
          trade.note?.startsWith('monitor-watchlist:') ||
          trade.note?.startsWith('monitor-exit:')),
    )
    .map((trade) => {
      const isExit = trade.note?.startsWith('monitor-exit:') ?? false;
      return {
        kind: isExit ? 'sell' : 'buy',
        status: isExit ? 'sold' : 'bought',
        symbol: trade.symbol,
        name: trade.name,
        reason: isExit
          ? trade.note!.replace('monitor-exit:', '')
          : trade.note?.startsWith('monitor-watchlist:')
            ? '自选跟踪动量达标自动买入'
            : '消息雷达自动买入',
        alertId: !isExit ? trade.note?.split(':')[1] : undefined,
        shares: trade.shares,
        price: trade.price,
        tradeId: trade.id,
      };
    });
}

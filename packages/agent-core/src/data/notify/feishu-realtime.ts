import type { MonitorPollResult } from '../monitor/engine.js';
import type { MonitorPaperRecommendation } from '../paper/monitor-bridge.js';
import type { StockIntradayCandidate } from '../paper/stock-intraday-scan.js';
import { formatTradeDate, getBeijingNow } from '../paper/trading-calendar.js';
import {
  buildFeishuPushKey,
  shouldFeishuPushOnce,
} from './feishu-dedupe.js';
import { isFeishuNotifyEnabled, notifyFeishuPostSafe } from './feishu.js';

function beijingTimeLabel(): string {
  return new Date().toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
}

function isStockIntradayNotifyEnabled(): boolean {
  if (!isFeishuNotifyEnabled()) return false;
  return process.env.FEISHU_NOTIFY_STOCK_INTRADAY !== '0';
}

function isMonitorRealtimeNotifyEnabled(): boolean {
  if (!isFeishuNotifyEnabled()) return false;
  return process.env.FEISHU_NOTIFY_MONITOR !== '0';
}

function fmtPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

export function buildStockIntradayCandidateLines(
  candidates: StockIntradayCandidate[],
): string[] {
  const lines = [`时间：${beijingTimeLabel()}`];
  if (candidates.length === 0) {
    lines.push('当前无新的达标标的');
    return lines;
  }

  lines.push('', `共 ${candidates.length} 只达标（红钻 + 动量 checklist）：`);
  for (const item of candidates.slice(0, 8)) {
    lines.push(
      `· ${item.name}(${item.symbol}) 现价 ${item.price?.toFixed(2) ?? '—'} ${fmtPct(item.pctChg)} · 来源 ${item.source === 'watchlist' ? '自选' : '选股池'}`,
    );
    if (item.memo) lines.push(`  ${item.memo}`);
  }
  if (candidates.length > 8) {
    lines.push(`… 另有 ${candidates.length - 8} 只`);
  }
  return lines;
}

export function buildMonitorRealtimeLines(input: {
  result: MonitorPollResult;
  recommendations: MonitorPaperRecommendation[];
}): string[] {
  const lines = [
    `时间：${beijingTimeLabel()}`,
    `扫描：${input.result.summary}`,
  ];

  const actionable = input.recommendations.filter(
    (item) =>
      item.symbol &&
      (item.level === 'auto_buy' ||
        (item.level === 'watch' && item.status === 'bought')),
  );

  if (actionable.length === 0) {
    lines.push('本轮无新的自动买入级消息');
    return lines;
  }

  lines.push('', `消息雷达 ${actionable.length} 条：`);
  for (const item of actionable.slice(0, 6)) {
    lines.push(
      `· ${item.name ?? item.symbol}(${item.symbol}) ${fmtPct(item.pctChg)} · ${item.level === 'auto_buy' ? '自动买入候选' : '已触发买入'}`,
    );
    lines.push(`  ${item.reason}`);
  }
  return lines;
}

export async function notifyStockIntradayCandidates(input: {
  tradeDate: string;
  candidates: StockIntradayCandidate[];
}): Promise<number> {
  if (!isStockIntradayNotifyEnabled() || input.candidates.length === 0) {
    return 0;
  }

  const fresh = input.candidates.filter((item) =>
    shouldFeishuPushOnce(
      buildFeishuPushKey('stock-intraday', item.symbol, input.tradeDate),
    ),
  );
  if (fresh.length === 0) return 0;

  await notifyFeishuPostSafe(
    '🎯 股票实时信号',
    buildStockIntradayCandidateLines(fresh),
  );
  return fresh.length;
}

export async function notifyMonitorRealtime(input: {
  tradeDate: string;
  result: MonitorPollResult;
}): Promise<number> {
  if (!isMonitorRealtimeNotifyEnabled() || !input.result.marketOpen) return 0;

  const newAlertIds = new Set(input.result.alerts.map((alert) => alert.id));
  const freshRecommendations = input.result.recommendations.filter(
    (item) => item.alertId && newAlertIds.has(item.alertId),
  );

  const boughtActions = input.result.paperActions.filter(
    (action) => action.kind === 'buy' && action.status === 'bought' && action.symbol,
  );

  if (freshRecommendations.length === 0 && boughtActions.length === 0) {
    return 0;
  }

  let pushed = 0;

  for (const item of freshRecommendations) {
    if (!item.symbol) continue;
    if (item.level !== 'auto_buy') continue;
    if (
      !shouldFeishuPushOnce(
        buildFeishuPushKey(`monitor-${item.level}`, item.symbol, input.tradeDate),
      )
    ) {
      continue;
    }
    pushed += 1;
    await notifyFeishuPostSafe(
      '🚨 消息雷达·买入候选',
      buildMonitorRealtimeLines({
        result: input.result,
        recommendations: [item],
      }),
    );
  }

  for (const action of boughtActions) {
    if (
      !shouldFeishuPushOnce(
        buildFeishuPushKey('monitor-bought', action.symbol, input.tradeDate),
      )
    ) {
      continue;
    }
    pushed += 1;
    await notifyFeishuPostSafe('✅ 消息雷达·模拟盘买入', [
      `时间：${beijingTimeLabel()}`,
      `买入 ${action.name}(${action.symbol}) ${action.shares ?? 0} 股 @ ${action.price?.toFixed(2) ?? '—'}`,
      action.reason,
    ]);
  }

  return pushed;
}

export async function notifyStockIntradayScanNow(): Promise<void> {
  const tradeDate = formatTradeDate(getBeijingNow());
  const { runStockIntradayScan } = await import('../paper/stock-intraday-scan.js');
  const result = await runStockIntradayScan({
    tradeDate,
    force: true,
    marketOpen: true,
  });
  await notifyStockIntradayCandidates({
    tradeDate,
    candidates: result.candidates,
  });
}

import type { EtfTailPickResult } from '../etf/tail-picker.js';
import type { EtfMorningRadarResult } from '../etf/morning-radar.js';
import type { EtfPaperPipelineResult } from '../paper/etf-paper-pipeline.js';
import type { PaperAutoPipelineResult } from '../paper/auto-pipeline.js';
import { formatTradeDate, getBeijingNow } from '../paper/trading-calendar.js';
import { notifyFeishuPostSafe } from './feishu.js';

function beijingTimeLabel(): string {
  return new Date().toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
}

function formatTradeLines(
  trades: Array<{ symbol: string; name: string; shares: number; price: number }>,
  side: '买入' | '卖出' | '止损',
): string[] {
  if (!trades?.length) return [];
  return trades.map(
    (t) =>
      `${side} ${t.name}(${t.symbol}) ${t.shares} 股 @ ${t.price.toFixed(3)}`,
  );
}

export function buildEtfTailPickLines(result: EtfTailPickResult): string[] {
  const lines = [
    `时间：${beijingTimeLabel()}`,
    `交易日：${result.tradeDate}`,
    `摘要：${result.summary}`,
  ];

  const passed = result.strictPicks.slice(0, 5);
  if (passed.length > 0) {
    lines.push('', '✅ 严格通过：');
    for (const item of passed) {
      lines.push(
        `· ${item.name}(${item.symbol}) ${item.price.toFixed(3)} ${item.changePct >= 0 ? '+' : ''}${item.changePct.toFixed(2)}% · ${item.operationPlan.positionHint}`,
      );
    }
  } else {
    lines.push('', '今日无严格通过标的');
  }

  const near = result.nearPass.slice(0, 3);
  if (near.length > 0) {
    lines.push('', '近通过：');
    for (const item of near) {
      lines.push(`· ${item.name}(${item.symbol}) 差 ${item.failCount} 项`);
    }
  }

  if (result.errors.length > 0) {
    lines.push('', `采数异常 ${result.errors.length} 条（见日志）`);
  }

  return lines;
}

export function buildEtfMorningRadarLines(result: EtfMorningRadarResult): string[] {
  const lines = [
    `时间：${beijingTimeLabel()}`,
    `交易日：${result.tradeDate}`,
    `摘要：${result.summary}`,
  ];

  if (result.candidates.length === 0) {
    lines.push('当前没有达到异动阈值的 ETF。');
    return lines;
  }

  lines.push('', '异动池（提醒，不是买入推荐）：');
  for (const item of result.candidates.slice(0, 6)) {
    lines.push(
      `· ${item.name}(${item.symbol}) ${item.price.toFixed(3)} ${item.changePct >= 0 ? '+' : ''}${item.changePct.toFixed(2)}% · ${item.actionLabel}`,
    );
    lines.push(`  ${item.reasons.join('；')}`);
  }
  if (result.candidates.length > 6) {
    lines.push(`… 另有 ${result.candidates.length - 6} 只`);
  }
  lines.push('', '策略：早盘只发现机会，正式买入/调仓等 14:45 尾盘确认。');

  if (result.errors.length > 0) {
    lines.push('', `采数异常 ${result.errors.length} 条（见日志）`);
  }

  return lines;
}

export function buildStockPaperLines(result: PaperAutoPipelineResult): string[] {
  const lines = [
    `时间：${beijingTimeLabel()}`,
    `交易日：${result.tradeDate}`,
  ];

  if (result.skipped) {
    lines.push(`状态：跳过 — ${result.reason ?? '非执行窗口'}`);
    return lines;
  }

  if (result.error) {
    lines.push(`状态：失败 — ${result.error}`);
    return lines;
  }

  if (result.screening) {
    lines.push(
      `选股：${result.screening.passed ? '通过' : '未通过'}，候选 ${result.screening.candidateCount} 只`,
    );
  }

  if (result.signals) {
    lines.push(
      `信号：扫描 ${result.signals.scanned} · 红 ${result.signals.red} · 蓝 ${result.signals.blue} · 可买 ${result.signals.buyCandidates}`,
    );
  }

  const buys = result.trades?.buys ?? [];
  const sells = result.trades?.sells ?? [];
  if (buys.length === 0 && sells.length === 0) {
    lines.push('成交：无');
  } else {
    lines.push('', '成交：');
    lines.push(...formatTradeLines(buys, '买入'));
    lines.push(...formatTradeLines(sells, '卖出'));
  }

  if (result.equity) {
    lines.push(
      '',
      `股票仓市值：${result.equity.totalValue.toFixed(0)} 元 · 累计 ${result.equity.returnPct >= 0 ? '+' : ''}${result.equity.returnPct.toFixed(2)}%`,
    );
  }

  return lines;
}

export function buildEtfPaperMonitorLines(result: EtfPaperPipelineResult): string[] {
  const lines = [
    `时间：${beijingTimeLabel()}`,
    `交易日：${result.tradeDate}`,
  ];

  if (result.skipped) {
    lines.push(`状态：跳过 — ${result.reason ?? '非执行窗口'}`);
    return lines;
  }

  if (result.error) {
    lines.push(`状态：失败 — ${result.error}`);
    return lines;
  }

  const parts: string[] = [];
  if (result.isRebalanceDay) parts.push('调仓日');
  if (result.buys?.length) parts.push(`买入 ${result.buys.length} 笔`);
  if (result.sells?.length) parts.push(`卖出 ${result.sells.length} 笔`);
  if (result.stopLosses?.length) parts.push(`止损 ${result.stopLosses.length} 笔`);
  lines.push(`状态：${parts.length > 0 ? parts.join(' · ') : '监听完成，无成交'}`);

  if (result.reason) lines.push(`说明：${result.reason}`);

  const allTrades = [
    ...formatTradeLines(result.buys ?? [], '买入'),
    ...formatTradeLines(result.sells ?? [], '卖出'),
    ...formatTradeLines(result.stopLosses ?? [], '止损'),
  ];
  if (allTrades.length > 0) {
    lines.push('', '成交：', ...allTrades);
  }

  if (result.targets?.length) {
    lines.push(
      '',
      `目标池：${result.targets.map((t) => `${t.name}(${t.symbol})`).join('、')}`,
    );
  }

  if (result.equity) {
    lines.push(
      '',
      `ETF 仓市值：${result.equity.totalValue.toFixed(0)} 元 · 累计 ${result.equity.returnPct >= 0 ? '+' : ''}${result.equity.returnPct.toFixed(2)}%`,
    );
  }

  return lines;
}

export async function notifyEtfTailPick(result: EtfTailPickResult): Promise<void> {
  if (result.status === 'skipped') return;
  await notifyFeishuPostSafe(
    '📊 ETF 尾盘推荐',
    buildEtfTailPickLines(result),
  );
}

export async function notifyEtfMorningRadar(
  result: EtfMorningRadarResult,
): Promise<void> {
  if (result.candidates.length === 0) return;
  await notifyFeishuPostSafe(
    result.stage === 'open' ? '👀 ETF 早盘异动' : '🧭 ETF 承接确认',
    buildEtfMorningRadarLines(result),
  );
}

export async function notifyStockPaper(result: PaperAutoPipelineResult): Promise<void> {
  if (result.skipped) return;
  await notifyFeishuPostSafe('📈 股票模拟盘选股', buildStockPaperLines(result));
}

export async function notifyEtfPaperMonitor(result: EtfPaperPipelineResult): Promise<void> {
  if (result.skipped) return;

  const hasTrades =
    (result.buys?.length ?? 0) +
      (result.sells?.length ?? 0) +
      (result.stopLosses?.length ?? 0) >
    0;

  const notifyAll = process.env.FEISHU_NOTIFY_ETF_MONITOR === '1';
  if (!hasTrades && !notifyAll) return;

  await notifyFeishuPostSafe('🤖 ETF 模拟盘', buildEtfPaperMonitorLines(result));
}

export async function notifyDailyTaskFailure(
  label: string,
  error: string,
): Promise<void> {
  await notifyFeishuPostSafe(`⚠️ ${label} 失败`, [
    `时间：${beijingTimeLabel()}`,
    `交易日：${formatTradeDate(getBeijingNow())}`,
    `错误：${error}`,
  ]);
}

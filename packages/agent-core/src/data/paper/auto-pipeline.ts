import 'dotenv/config';

import { runSectorScreenStream } from '../../api/run-sector-screen-stream.js';
import { scanDiamondSignal } from '../market/diamond-signal.js';
import { getDailyQuote } from '../market/services.js';
import {
  analyzeMomentum,
  evaluateMomentumExit,
  MOMENTUM_MIN_CHECKLIST,
} from './momentum.js';
import {
  calcAutoBuyShares,
  executePaperTrade,
  finishAutoRun,
  getLatestAutoRun,
  getPaperAccountSummary,
  getPositionMeta,
  listPaperPositions,
  saveEquitySnapshot,
  startAutoRun,
  updateHighWaterMark,
} from './store.js';
import {
  AUTO_RUN_SCHEDULE_LABEL,
  formatTradeDate,
  getBeijingNow,
  isPostMarketWindow,
  isWeekday,
} from './trading-calendar.js';

export type PaperAutoPipelineResult = {
  tradeDate: string;
  skipped?: boolean;
  reason?: string;
  strategy?: string;
  screening?: {
    passed: boolean;
    sessionId?: string;
    candidateCount: number;
    query?: string;
  };
  signals?: {
    scanned: number;
    red: number;
    blue: number;
    buyCandidates: number;
  };
  trades?: {
    buys: Array<{ symbol: string; name: string; shares: number; price: number; memo: string }>;
    sells: Array<{ symbol: string; name: string; shares: number; price: number; reason: string }>;
  };
  equity?: {
    totalValue: number;
    returnPct: number;
  };
  error?: string;
};

async function refreshPositionMarks(positions: Array<{ symbol: string }>) {
  for (const pos of positions) {
    try {
      const q = await getDailyQuote(pos.symbol, 2);
      if (q.latestClose != null) {
        await updateHighWaterMark(pos.symbol, q.latestClose);
      }
    } catch {
      // skip
    }
  }
}

async function autoSellExits(tradeDate: string) {
  const sells: Array<{
    symbol: string;
    name: string;
    shares: number;
    price: number;
    reason: string;
  }> = [];

  const positions = await listPaperPositions();
  for (const pos of positions) {
    try {
      const kline = await getDailyQuote(pos.symbol, 60);
      const signal = await scanDiamondSignal(pos.symbol, pos.name, 60);
      const momentum = analyzeMomentum(pos.symbol, pos.name, kline.quotes, signal);
      const close = momentum?.close ?? kline.latestClose;
      if (close == null) continue;

      const meta = await getPositionMeta(pos.symbol);
      const exit = evaluateMomentumExit({
        avgCost: pos.avgCost,
        close,
        ma20: momentum?.ma20 ?? null,
        highWaterMark: meta?.highWaterMark ?? null,
        diamondStrength: signal?.strength ?? null,
      });
      if (!exit) continue;

      const summary = await getPaperAccountSummary();
      const held = summary.positions.find((p) => p.symbol === pos.symbol);
      const available = held?.availableShares ?? 0;
      if (available < 100) continue;

      const shares = Math.floor(available / 100) * 100;
      await executePaperTrade({
        symbol: pos.symbol,
        name: pos.name,
        side: 'sell',
        shares,
        price: close,
        tradeDate,
        source: 'auto',
        note: `动量出场：${exit.reason}`,
        skipSessionCheck: true,
      });

      sells.push({
        symbol: pos.symbol,
        name: pos.name,
        shares,
        price: close,
        reason: exit.reason,
      });
    } catch {
      // skip per symbol
    }
  }

  return sells;
}

async function autoBuySignals(
  tradeDate: string,
  candidates: Array<{ symbol: string; name: string; memo: string }>,
) {
  const buys: NonNullable<PaperAutoPipelineResult['trades']>['buys'] = [];
  const summary = await getPaperAccountSummary();
  const held = new Set(summary.positions.map((p) => p.symbol));

  for (const c of candidates) {
    if (held.has(c.symbol)) continue;
    if (summary.positions.length + buys.length >= 5) break;

    try {
      const q = await getDailyQuote(c.symbol, 2);
      const price = q.latestClose;
      if (price == null) continue;

      const shares = calcAutoBuyShares(summary.account.cash, price);
      if (shares < 100) continue;

      await executePaperTrade({
        symbol: c.symbol,
        name: c.name,
        side: 'buy',
        shares,
        price,
        tradeDate,
        source: 'auto',
        note: '动量派：红钻 + checklist 通过',
        entryMemo: c.memo,
        skipSessionCheck: true,
      });

      buys.push({ symbol: c.symbol, name: c.name, shares, price, memo: c.memo });
      summary.account.cash -= shares * price;
    } catch {
      // skip
    }
  }

  return buys;
}

export async function runPaperAutoPipeline(options?: {
  force?: boolean;
}): Promise<PaperAutoPipelineResult> {
  const tradeDate = formatTradeDate();
  const now = getBeijingNow();

  if (!options?.force && !isWeekday(now)) {
    return { tradeDate, skipped: true, reason: '周末非交易日', strategy: 'momentum' };
  }

  if (!options?.force && !isPostMarketWindow(now)) {
    return {
      tradeDate,
      skipped: true,
      reason: '非收盘后窗口（自动任务应在 15:05 后执行）',
      strategy: 'momentum',
    };
  }

  const runId = await startAutoRun(tradeDate);
  const result: PaperAutoPipelineResult = {
    tradeDate,
    strategy: 'momentum',
  };

  try {
    await refreshPositionMarks(await listPaperPositions());

    const screeningOutcome: PaperAutoPipelineResult['screening'] = {
      passed: false,
      candidateCount: 0,
    };

    let candidates: Array<{ symbol: string; name: string }> = [];

    try {
      await runSectorScreenStream({ maxCandidates: 10, excludeSt: true, lookbackDays: 14 }, (event) => {
        if (event.type === 'done') {
          screeningOutcome.passed = event.passed;
          screeningOutcome.sessionId = event.sessionId;
          screeningOutcome.candidateCount = event.candidates.length;
          screeningOutcome.query = event.query;
          candidates = event.candidates.map((c) => ({
            symbol: c.symbol,
            name: c.name,
          }));
        }
      });
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      await finishAutoRun(runId, 'error', result as Record<string, unknown>);
      return result;
    }

    result.screening = screeningOutcome;

    const buyCandidates: Array<{ symbol: string; name: string; memo: string }> = [];
    let red = 0;
    let blue = 0;

    for (const c of candidates.slice(0, 30)) {
      try {
        const kline = await getDailyQuote(c.symbol, 60);
        const signal = await scanDiamondSignal(c.symbol, c.name, 60);
        const momentum = analyzeMomentum(c.symbol, c.name, kline.quotes, signal);
        if (!signal) continue;
        if (signal.strength === 'red') red += 1;
        else blue += 1;

        if (
          screeningOutcome.passed &&
          momentum?.action === 'buy' &&
          momentum.checklistScore >= MOMENTUM_MIN_CHECKLIST &&
          signal.strength === 'red'
        ) {
          buyCandidates.push({
            symbol: c.symbol,
            name: c.name,
            memo: momentum.entryMemo,
          });
        }
      } catch {
        // skip
      }
    }

    result.signals = {
      scanned: candidates.length,
      red,
      blue,
      buyCandidates: buyCandidates.length,
    };

    const sells = await autoSellExits(tradeDate);
    const buys =
      screeningOutcome.passed && buyCandidates.length > 0
        ? await autoBuySignals(tradeDate, buyCandidates)
        : [];

    result.trades = { buys, sells };

    const equity = await saveEquitySnapshot(tradeDate);
    result.equity = { totalValue: equity.totalValue, returnPct: equity.returnPct };

    await finishAutoRun(runId, 'ok', result as Record<string, unknown>);
    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    await finishAutoRun(runId, 'error', result as Record<string, unknown>);
    return result;
  }
}

export async function getPaperAutoStatus() {
  const latest = await getLatestAutoRun();
  const summary = await getPaperAccountSummary();
  return {
    latestRun: latest,
    account: summary,
    strategy: 'momentum',
    nextSchedule: AUTO_RUN_SCHEDULE_LABEL,
  };
}

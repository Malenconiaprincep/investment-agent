import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalDataDir = process.env.INVESTMENT_AGENT_DATA_DIR;
let tempDataDir: string | null = null;

function beijingTradeDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

async function loadLogStore() {
  tempDataDir = mkdtempSync(path.join(os.tmpdir(), 'investment-scheduled-log-test-'));
  process.env.INVESTMENT_AGENT_DATA_DIR = tempDataDir;
  vi.resetModules();
  return import('./scheduled-task-log.js');
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  if (tempDataDir) {
    rmSync(tempDataDir, { recursive: true, force: true });
    tempDataDir = null;
  }
  if (originalDataDir == null) {
    delete process.env.INVESTMENT_AGENT_DATA_DIR;
  } else {
    process.env.INVESTMENT_AGENT_DATA_DIR = originalDataDir;
  }
  vi.resetModules();
});

describe('scheduled task log store', () => {
  it('folds running and final entries with the same run id', async () => {
    const { appendScheduledTaskLog, readRecentScheduledTaskLogs } =
      await loadLogStore();
    const tradeDate = beijingTradeDate();
    const ranAt = new Date().toISOString();
    const runId = `screen-preopen:${tradeDate}:test`;

    appendScheduledTaskLog({
      runId,
      taskId: 'screen-preopen',
      label: '盘前智能选股通知',
      tradeDate,
      status: 'running',
      summary: '任务已开始',
      source: 'background-worker',
      ranAt,
    });
    appendScheduledTaskLog({
      runId,
      taskId: 'screen-preopen',
      label: '盘前智能选股通知',
      tradeDate,
      status: 'completed',
      summary: '数据 98 分 · 候选 1 只',
      elapsedMs: 81_000,
      source: 'background-worker',
      ranAt,
    });

    const logs = readRecentScheduledTaskLogs({
      tradeDate,
      taskId: 'screen-preopen',
    });

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      runId,
      taskId: 'screen-preopen',
      status: 'completed',
      summary: '数据 98 分 · 候选 1 只',
      elapsedMs: 81_000,
    });
  });

  it('keeps manual scheduled screen entries visible in task logs', async () => {
    const { appendScheduledTaskLog, readRecentScheduledTaskLogs } =
      await loadLogStore();
    const tradeDate = beijingTradeDate();

    appendScheduledTaskLog({
      taskId: 'screen-preopen',
      label: '盘前智能选股通知',
      tradeDate,
      status: 'completed',
      summary: '数据 98 分 · 记录 manual · 候选 1 只 · 入池 1 只',
      source: 'manual',
      ranAt: new Date().toISOString(),
    });

    const logs = readRecentScheduledTaskLogs({
      tradeDate,
      taskId: 'screen-preopen',
    });

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      status: 'completed',
      source: 'manual',
    });
  });
});

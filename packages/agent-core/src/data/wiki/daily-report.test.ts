import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DAILY_WIKI_SCHEMA_VERSION,
  buildDailyWikiManifest,
  renderDailyWikiMarkdown,
  type DailyWikiReport,
} from './daily-report.js';

function sampleReport(date: string, score: number): DailyWikiReport {
  return {
    schemaVersion: DAILY_WIKI_SCHEMA_VERSION,
    date,
    generatedAt: `${date}T10:00:00.000Z`,
    timeZone: 'Asia/Shanghai',
    paths: {
      repoRoot: '/repo',
      dataDir: '/repo/packages/agent-core/src/data',
      markdown: `docs/wiki/daily/${date}.md`,
      json: `docs/wiki/daily/${date}.json`,
    },
    workSummary: {
      current: {
        id: 'run-1',
        generatedAt: `${date}T10:00:00.000Z`,
        createdAt: `${date}T10:00:01.000Z`,
        overallScore: score,
        grade: 'B',
        paperReturnPct: 1.2,
        backtestAvgReturnPct: 2.3,
        riskScore: 80,
        coverageScore: 90,
        validationScore: 70,
        iterationScore: 60,
        urgentAlerts: 0,
        unacknowledgedAlerts: 1,
      },
      comparison: {
        previous: null,
        scoreDelta: null,
        paperReturnDeltaPct: null,
        riskScoreDelta: null,
        coverageScoreDelta: null,
        verdict: 'unknown',
      },
      conclusion: '系统闭环运转良好。',
      components: [
        { key: 'coverage', label: '数据闭环', score: 90, detail: '有效' },
      ],
      coverageSources: [
        {
          key: 'paper',
          label: '模拟盘',
          count: 2,
          latestAt: `${date}T08:00:00.000Z`,
          status: 'good',
        },
      ],
      performance: {
        paperReturnPct: 1.2,
        paperTotalValue: 101200,
        paperInitialCash: 100000,
        equityTrend: 'up',
        backtestAvgReturnPct: 2.3,
        profitableBacktestCount: 3,
        backtestCount: 4,
        bestBacktest: null,
        worstBacktest: null,
      },
      risk: {
        score: 80,
        openPositionCount: 2,
        unacknowledgedAlerts: 1,
        urgentAlerts: 0,
        worstWatchlistReturnPct: -1.5,
        exposurePct: 30,
      },
      loop: [
        {
          key: 'signal',
          label: '信号产生',
          score: 90,
          status: 'strong',
          headline: '信号正常',
          detail: '有近期信号。',
        },
      ],
      strategyHealth: [
        {
          key: 'paper',
          label: '模拟盘执行',
          score: 80,
          status: 'strong',
          evidence: '收益为正。',
          suggestion: '继续归因。',
        },
      ],
      optimizationQueue: ['继续扩大样本。'],
      focus: {
        daily: ['查看告警。'],
        weekly: ['统计收益。'],
        monthly: ['淘汰无效参数。'],
      },
      eval: null,
    },
    scheduledTasks: {
      summary: { total: 1, completed: 1, skipped: 0, failed: 0, disabled: 0 },
      entries: [
        {
          taskId: 'work-summary-snapshot',
          label: '工作总结与 Wiki 日报',
          tradeDate: date,
          ranAt: `${date}T09:20:00.000Z`,
          ranAtBeijing: `${date} 17:20:00`,
          status: 'completed',
          summary: '日报完成',
          source: 'manual',
        },
      ],
    },
    dataUpdates: [
      {
        label: '股票日线更新',
        assetType: 'stock',
        mode: null,
        tradeDate: date,
        ranAt: `${date}T09:00:00.000Z`,
        status: 'completed',
        summary: '标的 10 只 · 新增 10 行 · 修正 0 行 · 失败 0 只',
        symbolCount: 10,
        addedRows: 10,
        updatedRows: 0,
        errors: 0,
        sourceLatestTradeDate: null,
        targetLatestTradeDate: null,
        reason: null,
      },
    ],
    changesets: [],
    backtests: { recentRuns: [], docs: [] },
    observations: ['系统闭环运转良好。'],
    nextActions: ['继续扩大样本。'],
    llmNotes: ['日报记录当天事实。'],
  };
}

describe('daily wiki report rendering', () => {
  it('renders stable sections and sidecar link', () => {
    const markdown = renderDailyWikiMarkdown(sampleReport('2026-07-08', 82));

    expect(markdown).toContain('# 投研日报 2026-07-08');
    expect(markdown).toContain('## 数据获取与任务运行');
    expect(markdown).toContain('## 回测与验证');
    expect(markdown).toContain('[2026-07-08.json](./2026-07-08.json)');
  });

  it('builds a date-sorted manifest from daily json sidecars', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'daily-wiki-'));
    try {
      writeFileSync(
        path.join(dir, '2026-07-07.json'),
        JSON.stringify(sampleReport('2026-07-07', 70)),
      );
      writeFileSync(
        path.join(dir, '2026-07-08.json'),
        JSON.stringify(sampleReport('2026-07-08', 82)),
      );

      const manifest = buildDailyWikiManifest(dir, '2026-07-08T10:00:00.000Z');

      expect(manifest.reportCount).toBe(2);
      expect(manifest.latest?.date).toBe('2026-07-08');
      expect(manifest.reports.map((entry) => entry.date)).toEqual([
        '2026-07-08',
        '2026-07-07',
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

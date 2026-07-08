import { describe, expect, it } from 'vitest';
import {
  buildPreopenDataQualityFailureLines,
  buildPreopenScreeningLines,
  runPreopenScreeningNotification,
  type PreopenScreeningDoneEvent,
} from './preopen-screening.js';
import type { DataQualityHarnessReport } from '../../eval/data-quality-harness.js';

function dataQualityReport(input?: {
  passed?: boolean;
  fail?: number;
  warn?: number;
}): DataQualityHarnessReport {
  const fail = input?.fail ?? 0;
  const warn = input?.warn ?? 0;
  return {
    name: 'data-quality',
    ranAt: '2026-07-08T00:30:00.000Z',
    expectedDataDate: '2026-07-07',
    passed: input?.passed ?? fail === 0,
    score: fail > 0 ? 70 : 98,
    summary: { pass: 12, warn, fail },
    freshness: {
      tradeDate: '2026-07-08',
      isTradingDay: true,
      expectedDataDate: '2026-07-07',
      benchmarkLatestDate: '20260707',
      stockSampleLatestDate: fail > 0 ? '20260706' : '20260707',
      latestDataDate: fail > 0 ? '20260706' : '20260707',
      isFresh: fail === 0,
      reminder: fail > 0 ? '行情未更新' : null,
    },
    checks: [
      {
        id: 'freshness.expected-date',
        label: '本地行情新鲜度',
        status: fail > 0 ? 'fail' : 'pass',
        detail: fail > 0 ? '最新行情早于期望日期' : '本地行情已覆盖期望日期',
      },
    ],
  };
}

function screeningDone(): PreopenScreeningDoneEvent {
  return {
    type: 'done',
    query: 'AI 算力板块强势，排除 ST，主力净流入靠前',
    sectors: [
      { name: '算力', reason: '主线活跃', dataSource: 'iwencai' },
      { name: '半导体', reason: '资金流入', dataSource: 'iwencai' },
    ],
    candidates: [
      {
        symbol: '300750',
        name: '宁德时代',
        thesis: '主线趋势候选，资金关注度提升',
        dataSource: 'iwencai',
        assetType: 'stock',
        diamond: {
          strength: 'red',
          score: 88,
          tradeDate: '20260707',
          close: 188,
          reasons: ['趋势向上'],
        },
        factorScore: {
          total: 82,
          themeScore: 80,
          longTermScore: 90,
          trendReturnScore: 70,
          stabilityScore: 80,
          outlook: 'mainline-trend',
          outlookLabel: '主线趋势',
          matchedTheme: '算力',
          ret20dPct: 12.3,
          ret60dPct: 20.1,
          ret120dPct: 32.4,
        },
      },
    ],
    diamondPicks: [],
    rotationSummary: '板块轮动测试',
    hotNews: [],
    hotThemes: ['AI', '算力'],
    mode: 'auto',
    passed: true,
    missingSections: [],
    missingKeywords: [],
    screenedAt: '2026-07-08T00:31:00.000Z',
    elapsedMs: 1000,
    sessionId: 'screen-1',
    watchlistSync: {
      screeningId: 'screen-1',
      added: [
        {
          symbol: '300750',
          name: '宁德时代',
          assetType: 'stock',
          grade: 'A',
          reason: '测试',
        },
      ],
      skipped: [],
      ranAt: '2026-07-08T00:31:00.000Z',
    },
    fetchErrors: [],
    tailEntryOutlook: null,
    tailEntryRun: null,
  };
}

describe('preopen screening notification lines', () => {
  it('summarizes data quality, themes, sectors and candidates', () => {
    const lines = buildPreopenScreeningLines({
      dataQuality: dataQualityReport(),
      screening: screeningDone(),
      now: new Date('2026-07-08T00:30:00.000Z'),
    });

    expect(lines.join('\n')).toContain('数据质量：98 分');
    expect(lines.join('\n')).toContain('热点：AI、算力');
    expect(lines.join('\n')).toContain('宁德时代(300750)');
    expect(lines.join('\n')).toContain('入跟踪池 1 只');
  });

  it('explains why preopen screening is stopped when data quality fails', () => {
    const lines = buildPreopenDataQualityFailureLines({
      dataQuality: dataQualityReport({ passed: false, fail: 1 }),
      now: new Date('2026-07-08T00:30:00.000Z'),
    });

    expect(lines.join('\n')).toContain('数据质量未通过');
    expect(lines.join('\n')).toContain('已停止盘前选股');
    expect(lines.join('\n')).toContain('本地行情新鲜度');
  });

  it('skips preopen screening on exchange holidays', async () => {
    const result = await runPreopenScreeningNotification({
      now: new Date('2026-10-01T08:30:00+08:00'),
      notify: false,
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('非交易日');
    expect(result.screening).toBeUndefined();
  });
});

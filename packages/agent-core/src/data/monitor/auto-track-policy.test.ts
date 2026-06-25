import { describe, expect, it } from 'vitest';
import type { MonitorAlert } from './store.js';
import { evaluateAutoTrack } from './auto-track-policy.js';

function alert(
  partial: Partial<MonitorAlert> & Pick<MonitorAlert, 'alertType'>,
): MonitorAlert {
  return {
    id: 'a1',
    alertType: partial.alertType,
    severity: partial.severity ?? 'watch',
    symbol: partial.symbol ?? '600519',
    name: partial.name ?? '贵州茅台',
    title: partial.title ?? '测试',
    summary: partial.summary ?? '测试摘要',
    newsTitle: partial.newsTitle ?? null,
    newsUrl: partial.newsUrl ?? null,
    pctChg: partial.pctChg ?? 1.2,
    ret20dPct: partial.ret20dPct ?? 10,
    theme: partial.theme ?? null,
    tradeDate: '2026-06-24',
    createdAt: new Date().toISOString(),
    acknowledged: false,
  };
}

describe('evaluateAutoTrack', () => {
  it('balanced: pre_move urgent tracks', () => {
    const result = evaluateAutoTrack({
      mode: 'balanced',
      alert: alert({
        alertType: 'pre_move',
        severity: 'urgent',
        pctChg: 1,
        newsTitle: '公司业绩预增，净利预计大幅增长',
      }),
    });
    expect(result.shouldTrack).toBe(true);
  });

  it('balanced: news_catalyst watch only notifies', () => {
    const result = evaluateAutoTrack({
      mode: 'balanced',
      alert: alert({ alertType: 'news_catalyst', severity: 'watch' }),
    });
    expect(result.shouldTrack).toBe(false);
  });

  it('balanced: positive news_catalyst urgent with small move tracks', () => {
    const result = evaluateAutoTrack({
      mode: 'balanced',
      alert: alert({
        alertType: 'news_catalyst',
        severity: 'urgent',
        pctChg: 2,
        newsTitle: '公司业绩预增，净利预计大幅增长',
      }),
    });
    expect(result.shouldTrack).toBe(true);
  });

  it('balanced: urgent news without positive catalyst only notifies', () => {
    const result = evaluateAutoTrack({
      mode: 'balanced',
      alert: alert({
        alertType: 'news_catalyst',
        severity: 'urgent',
        pctChg: 2,
        newsTitle: '公司发布一般经营动态',
      }),
    });
    expect(result.shouldTrack).toBe(false);
  });

  it('negative legal/delisting events only notify', () => {
    const result = evaluateAutoTrack({
      mode: 'balanced',
      alert: alert({
        alertType: 'news_catalyst',
        severity: 'urgent',
        pctChg: 2,
        newsTitle: '股民索赔案倒计时，相关公司存在诉讼风险',
      }),
    });
    expect(result.shouldTrack).toBe(false);
    expect(result.reason).toContain('负面事件');
  });

  it('balanced: overheated daily pct skips', () => {
    const result = evaluateAutoTrack({
      mode: 'balanced',
      alert: alert({ alertType: 'pre_move', severity: 'urgent', pctChg: 8 }),
    });
    expect(result.shouldTrack).toBe(false);
  });

  it('balanced: watchlist_surge skips when already in pool', () => {
    const result = evaluateAutoTrack({
      mode: 'balanced',
      alert: alert({ alertType: 'watchlist_surge' }),
      alreadyInWatchlist: true,
    });
    expect(result.shouldTrack).toBe(false);
  });

  it('notify_only never tracks', () => {
    const result = evaluateAutoTrack({
      mode: 'notify_only',
      alert: alert({ alertType: 'pre_move', severity: 'urgent' }),
    });
    expect(result.shouldTrack).toBe(false);
  });
});

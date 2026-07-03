import { describe, expect, it } from 'vitest';
import type { MonitorPollResult } from '../monitor/engine.js';
import type { MonitorPaperRecommendation } from '../paper/monitor-bridge.js';
import {
  buildMonitorRealtimeLines,
  isMonitorRealtimeTrackCandidate,
} from './feishu-realtime.js';

function recommendation(
  overrides: Partial<MonitorPaperRecommendation> = {},
): MonitorPaperRecommendation {
  return {
    alertId: 'alert-1',
    alertType: 'pre_move',
    level: 'auto_buy',
    symbol: '002741',
    name: '光华科技',
    theme: null,
    pctChg: 0.47,
    ret20dPct: 21.72,
    eventPoints: [],
    reason: '命中负面事件「索赔」，仅提醒不自动加池',
    status: 'skipped',
    ...overrides,
  };
}

const pollResult = {
  summary: '扫描 19 只，新增 4 条提醒（新资讯 3 条）',
} as MonitorPollResult;

describe('feishu realtime monitor notifications', () => {
  it('does not push skipped or only recommended monitor candidates', () => {
    expect(isMonitorRealtimeTrackCandidate(recommendation())).toBe(false);
    expect(
      isMonitorRealtimeTrackCandidate(
        recommendation({
          reason: '新闻催化且涨幅尚小，进入消息雷达自动买入候选',
          status: 'recommended',
        }),
      ),
    ).toBe(false);
  });

  it('only renders monitor candidates that entered the tracking pool', () => {
    const lines = buildMonitorRealtimeLines({
      result: pollResult,
      recommendations: [
        recommendation(),
        recommendation({
          symbol: '600519',
          name: '贵州茅台',
          pctChg: 1.2,
          reason: '已加入自选，等待红钻+动量达标后自动买入模拟盘',
          status: 'tracked',
        }),
      ],
    });

    expect(lines.join('\n')).toContain('贵州茅台(600519)');
    expect(lines.join('\n')).toContain('已加入跟踪池');
    expect(lines.join('\n')).not.toContain('光华科技(002741)');
  });
});

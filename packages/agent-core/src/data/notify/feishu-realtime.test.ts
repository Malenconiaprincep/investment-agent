import { describe, expect, it } from 'vitest';
import type { MonitorPaperAction } from '../paper/monitor-bridge.js';
import { isMonitorRealtimePaperBuy } from './feishu-realtime.js';

function action(overrides: Partial<MonitorPaperAction> = {}): MonitorPaperAction {
  return {
    kind: 'buy',
    status: 'skipped',
    symbol: '002741',
    name: '光华科技',
    reason: '命中负面事件「索赔」，仅提醒不自动加池',
    ...overrides,
  };
}

describe('feishu realtime monitor notifications', () => {
  it('only pushes real monitor paper buys', () => {
    expect(isMonitorRealtimePaperBuy(action())).toBe(false);
    expect(
      isMonitorRealtimePaperBuy(
        action({
          kind: 'track',
          status: 'tracked',
          reason: '已加入自选，等待红钻+动量达标后自动买入模拟盘',
        }),
      ),
    ).toBe(false);
    expect(
      isMonitorRealtimePaperBuy(
        action({
          status: 'bought',
          shares: 100,
          price: 12.34,
          tradeId: 'trade-1',
        }),
      ),
    ).toBe(true);
  });
});

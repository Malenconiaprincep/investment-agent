import { describe, expect, it } from 'vitest';
import type { MonitorAlert } from '../monitor/store.js';
import {
  classifyMonitorAlert,
  isMonitorBuyForAlert,
  isMonitorBuyForSymbolToday,
} from './monitor-bridge.js';

function alert(overrides: Partial<MonitorAlert>): MonitorAlert {
  return {
    id: 'alert-1',
    alertType: 'pre_move',
    severity: 'urgent',
    symbol: '600519',
    name: '贵州茅台',
    title: '测试提醒',
    summary: '测试摘要',
    newsTitle: '测试新闻',
    newsUrl: null,
    pctChg: 1.2,
    ret20dPct: 8,
    theme: '白酒',
    tradeDate: '2026-06-23',
    createdAt: '2026-06-23T09:45:00.000+08:00',
    acknowledged: false,
    ...overrides,
  };
}

describe('monitor paper bridge rules', () => {
  it('classifies urgent pre-move alerts as auto-buy candidates', () => {
    expect(classifyMonitorAlert(alert({}))).toEqual({
      level: 'auto_buy',
      status: 'recommended',
      reason: '新闻催化且涨幅尚小，进入消息雷达自动买入候选',
    });
  });

  it('classifies symbol alerts that are not pre-move as watch recommendations', () => {
    expect(
      classifyMonitorAlert(
        alert({
          alertType: 'early_move',
          severity: 'watch',
        }),
      ),
    ).toEqual({
      level: 'watch',
      status: 'recommended',
      reason: '值得跟踪，但未达到自动买入条件',
    });
  });

  it('does not auto-buy theme-only alerts without a symbol', () => {
    expect(
      classifyMonitorAlert(
        alert({
          alertType: 'theme_ignite',
          severity: 'info',
          symbol: null,
          name: null,
        }),
      ),
    ).toEqual({
      level: 'info',
      status: 'recommended',
      reason: '消息记录，不触发自动交易',
    });
  });

  it('dedupes monitor buys by alert id', () => {
    expect(isMonitorBuyForAlert('monitor:alert-1:pre_move', 'alert-1')).toBe(
      true,
    );
    expect(isMonitorBuyForAlert('monitor:alert-2:pre_move', 'alert-1')).toBe(
      false,
    );
    expect(isMonitorBuyForAlert(null, 'alert-1')).toBe(false);
  });

  it('dedupes monitor buys by trade date and source', () => {
    expect(
      isMonitorBuyForSymbolToday({
        note: 'monitor:alert-1:pre_move',
        side: 'buy',
        source: 'auto',
        tradeDate: '2026-06-23',
        targetDate: '2026-06-23',
      }),
    ).toBe(true);

    expect(
      isMonitorBuyForSymbolToday({
        note: 'monitor:alert-1:pre_move',
        side: 'sell',
        source: 'auto',
        tradeDate: '2026-06-23',
        targetDate: '2026-06-23',
      }),
    ).toBe(false);

    expect(
      isMonitorBuyForSymbolToday({
        note: 'monitor:alert-1:pre_move',
        side: 'buy',
        source: 'manual',
        tradeDate: '2026-06-23',
        targetDate: '2026-06-23',
      }),
    ).toBe(false);
  });
});

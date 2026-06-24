import { describe, expect, it } from 'vitest';
import type { MonitorAlert } from '../monitor/store.js';
import {
  buildMonitorEventPoints,
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
    const result = classifyMonitorAlert(alert({}));
    expect(result).toMatchObject({
      level: 'auto_buy',
      status: 'recommended',
    });
    expect(result.reason).toContain('新闻催化且涨幅尚小');
    expect(result.reason).toContain('新闻因子');
    expect(result.reason).toContain('K线因子');
  });

  it('classifies symbol alerts that are not pre-move as watch recommendations', () => {
    const result = classifyMonitorAlert(
      alert({
        alertType: 'early_move',
        severity: 'watch',
      }),
    );
    expect(result).toMatchObject({
      level: 'watch',
      status: 'recommended',
    });
    expect(result.reason).toContain('消息雷达识别');
    expect(result.reason).toContain('盘口因子');
  });

  it('does not auto-buy theme-only alerts without a symbol', () => {
    const result = classifyMonitorAlert(
      alert({
        alertType: 'theme_ignite',
        severity: 'info',
        symbol: null,
        name: null,
      }),
    );
    expect(result).toMatchObject({
      level: 'info',
      status: 'recommended',
    });
    expect(result.reason).toContain('消息记录');
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

  it('builds event points from alert catalysts', () => {
    const points = buildMonitorEventPoints(
      alert({
        alertType: 'early_move',
        severity: 'watch',
        theme: '券商',
        pctChg: 4.71,
        newsTitle: '【券商】某券商板块走强',
      }),
    );
    expect(points).toContain('温和启动');
    expect(points).toContain('主线 券商');
    expect(points.some((p) => p.includes('当日'))).toBe(true);
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

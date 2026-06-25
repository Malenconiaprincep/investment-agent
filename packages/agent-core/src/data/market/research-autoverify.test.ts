import { describe, expect, it } from 'vitest';
import {
  buildResearchAutoVerification,
  formatResearchAutoVerification,
} from './research-autoverify.js';
import type { ResearchMarketSnapshot } from './research-quote.js';

describe('buildResearchAutoVerification', () => {
  it('summarizes yoy, peers, and kline stop interpretation', () => {
    const verification = buildResearchAutoVerification({
      quote: {
        tsCode: '002821.SZ',
        symbol: '002821',
        asOf: '2026-06-25T07:00:00.000Z',
        tradeDate: '2026-06-25',
        currentPrice: 151.66,
        currentPctChg: 7.13,
        priceSource: 'intraday',
        live: null,
        daily: {
          tsCode: '002821.SZ',
          quotes: [
            {
              tradeDate: '20260624',
              open: 138,
              high: 151.66,
              low: 137,
              close: 151.66,
              pctChg: 10.01,
              vol: 1,
              amount: null,
            },
          ],
          latestClose: 151.66,
          latestPctChg: 10.01,
          dataSource: 'tencent',
          asOf: '2026-06-25T07:00:00.000Z',
          cached: false,
          disclaimer: '',
        },
        dataSource: 'eastmoney-intraday',
        cached: false,
      } satisfies ResearchMarketSnapshot,
      financial: {
        endDate: '20260331',
        revenueYoy: 16.91,
        netProfitYoy: -7.21,
      },
      peers: {
        peers: [
          {
            symbol: '603259',
            name: '药明康德',
            roe: 5.68,
            revenueYoy: 10.5,
            pe: 18.2,
          },
          {
            symbol: '300759',
            name: '康龙化成',
            roe: 2.1,
            revenueYoy: 8.3,
            pe: 25.1,
          },
        ],
      },
      news: {
        items: [{ title: 'CXO 板块集体走强', datetime: '2026-06-24T09:30:00.000Z' }],
      },
      announcements: { announcements: [] },
      tradePlan: {
        symbol: '002821',
        name: '凯莱英',
        action: 'wait',
        actionReason: '条件未齐备',
        latestClose: 151.66,
        entryPrice: null,
        stopLossPrice: 139.42,
        targetHint: 'test',
        signals: [],
        diamondStrength: null,
        checklistScore: 0,
        checklistMax: 0,
      },
      livePrice: 151.66,
    });

    expect(verification.financialYoy.revenueYoy).toBe(16.91);
    expect(verification.peers.count).toBe(2);
    expect(verification.klinePlan?.summary).toContain('高于');
    expect(verification.klinePlan?.summary).toContain('非数据缺失');

    const markdown = formatResearchAutoVerification(verification);
    expect(markdown).toContain('系统');
    expect(markdown).not.toContain('待人工核实');
  });
});

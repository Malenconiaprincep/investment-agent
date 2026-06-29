import { describe, expect, it } from 'vitest';
import { parseEtfDailyCsv, parseLocalDailyCsv } from './etf-daily.js';

describe('parseEtfDailyCsv', () => {
  it('parses qfq daily csv into newest-first bars with amount', () => {
    const rows = parseEtfDailyCsv(`日期,基金代码,开盘,收盘,最高,最低,成交量,成交额,振幅,涨跌幅,涨跌额,换手率
2012-05-28,510300,1.671,1.724,1.727,1.664,12775188,3285755328.0,3.72,1.77,0.03,4.84
2012-05-29,510300,1.722,1.764,1.781,1.722,7149490,1875593360.0,3.42,2.32,0.04,2.71`);

    expect(rows).toHaveLength(2);
    expect(rows[0]?.tradeDate).toBe('20120529');
    expect(rows[0]?.close).toBe(1.764);
    expect(rows[0]?.amount).toBe(1875593360);
    expect(rows[0]?.pctChg).toBe(2.32);
    expect(rows[1]?.tradeDate).toBe('20120528');
  });
});

describe('parseLocalDailyCsv', () => {
  it('parses stock qfq daily csv into newest-first bars', () => {
    const rows = parseLocalDailyCsv(`日期,股票代码,开盘,收盘,最高,最低,成交量,成交额,振幅,涨跌幅,涨跌额,换手率
2024-01-02,600519,1691.00,1685.01,1695.00,1670.00,2849312,4800000000.0,1.48,-0.45,-7.62,0.23
2024-01-03,600519,1680.00,1678.00,1688.00,1666.00,2600000,4360000000.0,1.31,-0.42,-7.01,0.21`);

    expect(rows).toHaveLength(2);
    expect(rows[0]?.tradeDate).toBe('20240103');
    expect(rows[0]?.close).toBe(1678);
    expect(rows[0]?.vol).toBe(2600000);
    expect(rows[0]?.amount).toBe(4360000000);
    expect(rows[0]?.pctChg).toBe(-0.42);
    expect(rows[1]?.tradeDate).toBe('20240102');
  });
});

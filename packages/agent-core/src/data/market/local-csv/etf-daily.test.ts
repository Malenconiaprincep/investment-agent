import { describe, expect, it } from 'vitest';
import { parseEtfDailyCsv } from './etf-daily.js';

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

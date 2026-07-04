import { describe, expect, it } from 'vitest';
import { __privateIwencaiEtf } from './iwencai-etf.js';

describe('iwencai ETF qfq daily parser', () => {
  it('normalizes horizontal qfq fields into newest-first daily bars', () => {
    const rows = __privateIwencaiEtf.normalizeIwencaiDailyRow({
      '开盘价_前复权[20260703]': '2.934',
      '收盘价_前复权[20260703]': 3,
      '最高价_前复权[20260703]': '3.106',
      '最低价_前复权[20260703]': '2.934',
      '成交量[20260703]': '5.71700707E8',
      '成交额[20260703]': '1.71565654E9',
      '涨跌幅[20260703]': -0.629,
      '开盘价_前复权[20260702]': '3.125',
      '收盘价_前复权[20260702]': 3.019,
      '最高价_前复权[20260702]': '3.208',
      '最低价_前复权[20260702]': '2.996',
      '成交量[20260702]': '7.49876247E8',
      '成交额[20260702]': '2.284E9',
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      tradeDate: '20260703',
      open: 2.934,
      close: 3,
      high: 3.106,
      low: 2.934,
      pctChg: -0.629,
      vol: 571700707,
      amount: 1715656540,
    });
    expect(rows[1]?.tradeDate).toBe('20260702');
    expect(rows[1]?.close).toBe(3.019);
  });
});

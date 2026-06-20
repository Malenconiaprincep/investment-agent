import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getDailyQuote } from '../../../data/market/services.js';

export const getDailyQuoteTool = createTool({
  id: 'get-daily-quote',
  description: '获取 A 股近期日线行情（收盘价、涨跌幅、成交量等），默认最近 5 个交易日。',
  inputSchema: z.object({
    symbol: z.string().describe('6 位 A 股代码，如 600519'),
    days: z.number().int().min(1).max(30).optional().describe('返回最近 N 个交易日，默认 5'),
  }),
  outputSchema: z.object({
    tsCode: z.string(),
    quotes: z.array(
      z.object({
        tradeDate: z.string(),
        open: z.number().nullable(),
        high: z.number().nullable(),
        low: z.number().nullable(),
        close: z.number().nullable(),
        pctChg: z.number().nullable(),
        vol: z.number().nullable(),
        amount: z.number().nullable(),
      }),
    ),
    latestClose: z.number().nullable(),
    latestPctChg: z.number().nullable(),
    dataSource: z.string(),
    asOf: z.string(),
    cached: z.boolean(),
    disclaimer: z.string(),
  }),
  execute: async (inputData) =>
    getDailyQuote(inputData.symbol, inputData.days ?? 5),
});

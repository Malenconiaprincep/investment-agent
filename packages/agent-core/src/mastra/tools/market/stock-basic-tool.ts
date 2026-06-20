import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getStockBasic } from '../../../data/market/services.js';

export const getStockBasicTool = createTool({
  id: 'get-stock-basic',
  description:
    '查询 A 股基本信息：代码/名称、行业、地域、上市日期。输入 6 位代码或 ts_code。',
  inputSchema: z.object({
    symbol: z
      .string()
      .describe('6 位 A 股代码如 600519，或 ts_code 如 600519.SH'),
  }),
  outputSchema: z.object({
    tsCode: z.string(),
    symbol: z.string(),
    name: z.string(),
    industry: z.string().nullable(),
    area: z.string().nullable(),
    listDate: z.string().nullable(),
    market: z.string().nullable(),
    dataSource: z.string(),
    asOf: z.string(),
    cached: z.boolean(),
    disclaimer: z.string(),
  }),
  execute: async (inputData) => getStockBasic(inputData.symbol),
});

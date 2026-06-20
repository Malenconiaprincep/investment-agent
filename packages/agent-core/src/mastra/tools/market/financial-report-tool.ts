import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getFinancialReport } from '../../../data/market/services.js';

export const getFinancialReportTool = createTool({
  id: 'get-financial-report',
  description:
    '获取 A 股最新财务指标：营收、净利润、ROE、负债率等（季报/年报）。',
  inputSchema: z.object({
    symbol: z.string().describe('6 位 A 股代码，如 600519'),
  }),
  outputSchema: z.object({
    tsCode: z.string(),
    endDate: z.string().nullable(),
    annDate: z.string().nullable(),
    revenue: z.number().nullable(),
    netProfit: z.number().nullable(),
    roe: z.number().nullable(),
    debtRatio: z.number().nullable(),
    grossMargin: z.number().nullable(),
    revenueYoy: z.number().nullable(),
    netProfitYoy: z.number().nullable(),
    dataSource: z.string(),
    asOf: z.string(),
    cached: z.boolean(),
    disclaimer: z.string(),
  }),
  execute: async (inputData) => getFinancialReport(inputData.symbol),
});

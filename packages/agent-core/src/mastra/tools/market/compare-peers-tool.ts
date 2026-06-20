import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { comparePeers } from '../../../data/market/services.js';

export const comparePeersTool = createTool({
  id: 'compare-peers',
  description:
    '同行业可比公司财务指标横向对比（ROE、负债率、营收同比）。默认取同行业最多 4 家可比公司。',
  inputSchema: z.object({
    symbol: z.string().describe('目标股票 6 位代码，如 600519'),
    limit: z.number().int().min(2).max(6).optional().describe('对比公司数量上限，默认 5'),
  }),
  outputSchema: z.object({
    target: z.object({
      tsCode: z.string(),
      symbol: z.string(),
      name: z.string(),
      industry: z.string().nullable(),
    }),
    peers: z.array(
      z.object({
        tsCode: z.string(),
        symbol: z.string(),
        name: z.string(),
        roe: z.number().nullable(),
        debtRatio: z.number().nullable(),
        revenueYoy: z.number().nullable(),
        endDate: z.string().nullable(),
        pe: z.number().nullable().optional(),
        pb: z.number().nullable().optional(),
        marketCap: z.number().nullable().optional(),
      }),
    ),
    dataSource: z.string(),
    asOf: z.string(),
    cached: z.boolean(),
    disclaimer: z.string(),
  }),
  execute: async (inputData) =>
    comparePeers(inputData.symbol, inputData.limit ?? 5),
});

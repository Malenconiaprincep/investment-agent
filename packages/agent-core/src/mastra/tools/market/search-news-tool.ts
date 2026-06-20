import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { searchNews } from '../../../data/market/services.js';

export const searchNewsTool = createTool({
  id: 'search-news',
  description:
    '搜索与股票相关的近期新闻/资讯标题（按股票名称关键词过滤）。',
  inputSchema: z.object({
    symbol: z.string().describe('6 位 A 股代码，如 600519'),
    days: z.number().int().min(1).max(30).optional().describe('回溯天数，默认 7'),
  }),
  outputSchema: z.object({
    tsCode: z.string(),
    stockName: z.string(),
    items: z.array(
      z.object({
        datetime: z.string(),
        title: z.string(),
        source: z.string().nullable(),
      }),
    ),
    count: z.number(),
    dataSource: z.string(),
    asOf: z.string(),
    cached: z.boolean(),
    disclaimer: z.string(),
  }),
  execute: async (inputData) => searchNews(inputData.symbol, inputData.days ?? 7),
});

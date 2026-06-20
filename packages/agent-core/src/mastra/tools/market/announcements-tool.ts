import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getAnnouncements } from '../../../data/market/services.js';

export const getAnnouncementsTool = createTool({
  id: 'get-announcements',
  description:
    '获取 A 股近期公告标题列表（减持、回购、业绩预告等），默认最近 30 天。',
  inputSchema: z.object({
    symbol: z.string().describe('6 位 A 股代码，如 600519'),
    days: z.number().int().min(7).max(90).optional().describe('回溯天数，默认 30'),
  }),
  outputSchema: z.object({
    tsCode: z.string(),
    announcements: z.array(
      z.object({
        annDate: z.string(),
        title: z.string(),
      }),
    ),
    count: z.number(),
    dataSource: z.string(),
    asOf: z.string(),
    cached: z.boolean(),
    disclaimer: z.string(),
  }),
  execute: async (inputData) =>
    getAnnouncements(inputData.symbol, inputData.days ?? 30),
});

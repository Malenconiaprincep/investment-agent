import { LibSQLStore } from '@mastra/libsql';
import { Memory } from '@mastra/memory';
import { z } from 'zod';
import { DATA_DIR } from './config/paths';

export const storage = new LibSQLStore({
  id: 'mastra-storage',
  url: `file:${DATA_DIR}/mastra.db`,
});

export const agentMemory = new Memory({
  storage,
  options: {
    lastMessages: 20,
    workingMemory: {
      enabled: true,
      scope: 'resource',
      schema: z.object({
        watchlist: z
          .array(
            z.object({
              symbol: z.string().length(6).describe('6 位 A 股代码'),
              name: z.string().optional().describe('股票名称'),
              note: z.string().optional().describe('关注理由'),
            }),
          )
          .max(5)
          .default([])
          .describe('用户关注的股票列表，最多 5 只'),
        riskPreference: z
          .enum(['保守', '平衡', '激进'])
          .optional()
          .describe('风险偏好'),
      }),
    },
  },
});

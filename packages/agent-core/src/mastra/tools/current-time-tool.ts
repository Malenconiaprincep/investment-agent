import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const currentTimeTool = createTool({
  id: 'get-current-time',
  description: '获取当前北京时间，用于标注研报与数据查询的时间上下文',
  inputSchema: z.object({
    timezone: z
      .string()
      .optional()
      .describe('IANA 时区，默认 Asia/Shanghai'),
  }),
  outputSchema: z.object({
    timezone: z.string(),
    iso: z.string(),
    formatted: z.string(),
  }),
  execute: async (inputData) => {
    const timezone = inputData.timezone ?? 'Asia/Shanghai';
    const now = new Date();

    const formatted = new Intl.DateTimeFormat('zh-CN', {
      timeZone: timezone,
      dateStyle: 'full',
      timeStyle: 'long',
    }).format(now);

    return {
      timezone,
      iso: now.toISOString(),
      formatted,
    };
  },
});

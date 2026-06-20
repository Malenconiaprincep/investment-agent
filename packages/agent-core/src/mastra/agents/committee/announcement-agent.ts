import { Agent } from '@mastra/core/agent';
import { DEFAULT_MODEL } from '../../config/model.js';
import {
  COMMITTEE_OUTPUT_FORMAT,
  committeeIwencaiTools,
  committeeMarketTools,
} from './shared.js';

export const announcementAgent = new Agent({
  id: 'announcement-agent',
  name: '公告组',
  description: '分析上市公司公告、业绩预告、分红回购等重大事件。',
  instructions: `你是投委会公告分析专家。必须先调用 Tool 获取公告，再输出 JSON 意见。
${COMMITTEE_OUTPUT_FORMAT}
禁止编造公告，禁止买卖建议。`,
  model: DEFAULT_MODEL,
  tools: {
    getAnnouncementsTool: committeeMarketTools.getAnnouncementsTool,
    ...(committeeIwencaiTools.iwencai_announcement_search
      ? {
          iwencai_announcement_search:
            committeeIwencaiTools.iwencai_announcement_search,
        }
      : {}),
  },
});

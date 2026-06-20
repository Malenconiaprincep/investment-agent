import { Agent } from '@mastra/core/agent';
import { DEFAULT_MODEL } from '../../config/model.js';
import {
  COMMITTEE_OUTPUT_FORMAT,
  committeeIwencaiTools,
  committeeMarketTools,
} from './shared.js';

export const newsAgent = new Agent({
  id: 'news-agent',
  name: '新闻组',
  description: '分析财经新闻、政策与行业资讯，评估资讯面影响。',
  instructions: `你是投委会新闻分析专家。必须先调用 Tool 获取新闻，再输出 JSON 意见。
${COMMITTEE_OUTPUT_FORMAT}
禁止编造新闻，禁止买卖建议。`,
  model: DEFAULT_MODEL,
  tools: {
    searchNewsTool: committeeMarketTools.searchNewsTool,
    ...(committeeIwencaiTools.iwencai_news_search
      ? { iwencai_news_search: committeeIwencaiTools.iwencai_news_search }
      : {}),
  },
});

import { Agent } from '@mastra/core/agent';
import { DEFAULT_MODEL } from '../../config/model.js';
import {
  COMMITTEE_OUTPUT_FORMAT,
  committeeIwencaiTools,
  committeeMarketTools,
} from './shared.js';

export const sentimentAgent = new Agent({
  id: 'sentiment-agent',
  name: '情绪组',
  description: '评估市场热度、新闻密度、资金流向与市场情绪。',
  instructions: `你是投委会情绪分析专家。结合新闻密度与问财行情/资金数据，输出 JSON 意见。
${COMMITTEE_OUTPUT_FORMAT}
禁止买卖建议。`,
  model: DEFAULT_MODEL,
  tools: {
    searchNewsTool: committeeMarketTools.searchNewsTool,
    ...(committeeIwencaiTools.iwencai_hithink_market_query
      ? {
          iwencai_hithink_market_query:
            committeeIwencaiTools.iwencai_hithink_market_query,
        }
      : {}),
  },
});

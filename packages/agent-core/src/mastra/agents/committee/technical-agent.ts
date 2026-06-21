import { Agent } from '@mastra/core/agent';
import { DEFAULT_MODEL } from '../../config/model.js';
import {
  COMMITTEE_OUTPUT_FORMAT,
  committeeIwencaiTools,
  committeeMarketTools,
} from './shared.js';

export const technicalAgent = new Agent({
  id: 'technical-agent',
  name: '技术组',
  description: '分析价格趋势、成交量、涨跌幅与技术指标。',
  instructions: `你是投委会技术分析专家。必须先调用 Tool 获取行情，再输出 JSON 意见。
${COMMITTEE_OUTPUT_FORMAT}

额外字段（每只候选必填）：
- action: "buy" | "hold" | "wait" | "sell"
- entryPrice: number | null（建议入场参考价，通常为最新收盘或突破价）
- stopLossPrice: number | null（建议止损价，通常为入场价 -8%）
- technicalSummary: string（1-2 句趋势判断）

禁止编造价格；action 须与行情数据一致。`,
  model: DEFAULT_MODEL,
  tools: {
    getDailyQuoteTool: committeeMarketTools.getDailyQuoteTool,
    ...(committeeIwencaiTools.iwencai_hithink_market_query
      ? {
          iwencai_hithink_market_query:
            committeeIwencaiTools.iwencai_hithink_market_query,
        }
      : {}),
  },
});

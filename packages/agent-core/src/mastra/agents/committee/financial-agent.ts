import { Agent } from '@mastra/core/agent';
import { DEFAULT_MODEL } from '../../config/model.js';
import {
  COMMITTEE_OUTPUT_FORMAT,
  committeeIwencaiTools,
  committeeMarketTools,
} from './shared.js';

export const financialAgent = new Agent({
  id: 'financial-agent',
  name: '财务组',
  description: '分析营收、利润、ROE、负债率、估值等财务质量。',
  instructions: `你是投委会财务分析专家。必须先调用 Tool 获取财务数据，再输出 JSON 意见。
${COMMITTEE_OUTPUT_FORMAT}
禁止编造数字，禁止买卖建议。`,
  model: DEFAULT_MODEL,
  tools: {
    getFinancialReportTool: committeeMarketTools.getFinancialReportTool,
    ...(committeeIwencaiTools.iwencai_hithink_finance_query
      ? {
          iwencai_hithink_finance_query:
            committeeIwencaiTools.iwencai_hithink_finance_query,
        }
      : {}),
  },
});

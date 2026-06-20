import { Agent } from '@mastra/core/agent';
import { DEFAULT_MODEL } from '../../config/model.js';
import { COMMITTEE_OUTPUT_FORMAT, committeeMarketTools } from './shared.js';

export const riskAgent = new Agent({
  id: 'risk-agent',
  name: '风险组',
  description: '识别财务、监管、同业与笔记库中的风险点。',
  instructions: `你是投委会风险分析专家。必须调用 Tool 检索公告、同业与笔记库风险，再输出 JSON 意见。
${COMMITTEE_OUTPUT_FORMAT}
重点列出「待人工核实」风险，禁止买卖建议。`,
  model: DEFAULT_MODEL,
  tools: {
    getAnnouncementsTool: committeeMarketTools.getAnnouncementsTool,
    comparePeersTool: committeeMarketTools.comparePeersTool,
    researchNotesTool: committeeMarketTools.researchNotesTool,
  },
});

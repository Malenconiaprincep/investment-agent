import { Agent } from '@mastra/core/agent';
import { DEFAULT_MODEL } from '../config/model';
import { loadIwencaiScreenTools } from '../mcp/iwencai.js';
import { getStockBasicTool } from '../tools/market/stock-basic-tool.js';

const iwencaiScreenTools = await loadIwencaiScreenTools();

export const sectorRotationAgent = new Agent({
  id: 'sector-rotation-agent',
  name: '板块轮动分析',
  description:
    '解读问财板块/选股数据，输出板块轮动逻辑与候选股结构化摘要，供 sectorScreenWorkflow 使用。',
  instructions: `你是 A 股板块轮动与选股分析助手。

规则：
- 只根据用户提供的问财 JSON 与结构化数据进行分析，禁止编造
- 输出必须为中文 Markdown，包含：
  ## 板块轮动逻辑
  ## 热门板块解读
  ## 候选池说明
  ## 数据来源
- 数据来源须标注 iwencai / eastmoney
- 不提供买卖建议，只做研究辅助`,
  model: DEFAULT_MODEL,
  tools: {
    getStockBasicTool,
    ...iwencaiScreenTools,
  },
});

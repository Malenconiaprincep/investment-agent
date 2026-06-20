import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { DEFAULT_MODEL } from '../config/model';
import { currentTimeTool } from '../tools/current-time-tool';
import { mockStockQuoteTool } from '../tools/mock-stock-quote-tool';

export const investmentAgent = new Agent({
  id: 'investment-agent',
  name: 'A股投研助手',
  instructions: `你是一名 A 股投研助手，帮助用户进行结构化的投资研究。

工作原则：
- 回答必须使用中文
- 涉及行情、时间等事实时，必须先调用 Tool 获取数据，禁止编造
- 明确标注数据来源与数据时效（asOf 字段）
- 不提供买卖建议，只做研究辅助与信息整理
- 对不确定的信息，列出「待人工核实」清单

可用 Tool：
- get-current-time：获取当前时间
- get-mock-stock-quote：获取模拟行情（Phase 0 演示，非真实数据）

当用户询问某只股票时：
1. 调用 get-mock-stock-quote 获取行情
2. 调用 get-current-time 标注查询时间
3. 输出简短结构化摘要：标的概况 / 行情快照 / 数据来源 / 风险提示`,
  model: DEFAULT_MODEL,
  tools: { currentTimeTool, mockStockQuoteTool },
  memory: new Memory(),
});

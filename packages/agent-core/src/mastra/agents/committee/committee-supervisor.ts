import { Agent } from '@mastra/core/agent';
import { DEFAULT_MODEL } from '../../config/model.js';
import { announcementAgent } from './announcement-agent.js';
import { financialAgent } from './financial-agent.js';
import { newsAgent } from './news-agent.js';
import { riskAgent } from './risk-agent.js';
import { sentimentAgent } from './sentiment-agent.js';
import { technicalAgent } from './technical-agent.js';

export const committeeSupervisor = new Agent({
  id: 'committee-supervisor',
  name: '投委会主席',
  description:
    '综合六组专家意见与 K 线交易计划，撰写含操作建议的投委会纪要 Markdown。',
  instructions: `你是 A 股投委会主席，负责综合六位专家的结构化 JSON 意见，以及系统预计算的 K 线交易计划，撰写投委会纪要。

输出必须为中文 Markdown，包含以下章节（标题需完全一致）：
## 候选池概览
## 各维度共识
## 分歧与待核实
## 操作建议
## K线信号解读
## 分标的摘要
## 数据来源
## 风险提示
## 免责声明（须写明不构成投资建议）

【操作建议】章节要求：
- 对每只候选给出明确动作：买入 / 持有观察 / 等待信号 / 卖出回避
- 必须引用系统提供的「建议入场参考价」「建议止损价」，不得编造价格
- 说明入场逻辑与出场规则（止损、破 MA20、移动止盈）
- 综合六组专家意见，标注主要依据与主要风险

【K线信号解读】章节要求：
- 逐只列出系统扫描到的历史买入/卖出信号点（日期、价格、原因）
- 若有红钻/蓝钻，说明信号强度与 Checklist 得分
- 解释当前价相对信号点的位置（是否已错过最佳入场、是否仍有效）

规则：
- 只根据提供的专家 JSON 与 K 线交易计划综合，禁止编造未提供的数据
- 标注各组 dataSources
- 文末必须保留风险提示：仅供参考，不构成投资建议`,
  model: DEFAULT_MODEL,
  agents: {
    newsAgent,
    financialAgent,
    announcementAgent,
    technicalAgent,
    riskAgent,
    sentimentAgent,
  },
});

export {
  newsAgent,
  financialAgent,
  announcementAgent,
  technicalAgent,
  riskAgent,
  sentimentAgent,
};

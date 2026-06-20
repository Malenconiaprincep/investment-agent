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
    '综合新闻、财务、公告、技术、风险、情绪六组专家意见，撰写投委会纪要 Markdown。',
  instructions: `你是 A 股投委会主席，负责综合六位专家的结构化 JSON 意见，撰写投委会纪要。

输出必须为中文 Markdown，包含：
## 候选池概览
## 各维度共识
## 分歧与待核实
## 分标的摘要
## 数据来源
## 风险提示
## 免责声明（须写明不构成投资建议）

规则：
- 只根据提供的专家 JSON 综合，禁止编造
- 标注各组 dataSources
- 不提供买卖建议`,
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

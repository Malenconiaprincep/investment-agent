export type EvalCase = {
  id: string;
  input: string;
  mustInclude: string[];
  description?: string;
};

export const evalCases: EvalCase[] = [
  {
    id: 'time-beijing',
    input: '现在北京时间几点？',
    mustInclude: ['Asia/Shanghai'],
    description: '应调用时间 Tool 并标注时区',
  },
  {
    id: 'quote-maotai',
    input: '查询贵州茅台 600519 的模拟行情',
    mustInclude: ['600519', '贵州茅台'],
    description: '应返回茅台模拟行情',
  },
  {
    id: 'quote-unknown',
    input: '查询 999999 的模拟行情',
    mustInclude: ['600519', '000001', '300750'],
    description: '未知代码应提示可用示例',
  },
  {
    id: 'notes-maotai-risk',
    input: '根据笔记库，贵州茅台有哪些主要风险？',
    mustInclude: ['估值', '风险'],
    description: 'RAG 应检索到茅台风险相关内容',
  },
  {
    id: 'notes-ningde-growth',
    input: '宁德时代属于什么类型的标的？笔记里怎么说的？',
    mustInclude: ['宁德', '成长'],
    description: 'RAG 应检索宁德时代笔记',
  },
  {
    id: 'notes-banking-metric',
    input: '研究银行板块应该关注哪些指标？',
    mustInclude: ['息差', '不良'],
    description: 'RAG 应检索银行板块笔记',
  },
  {
    id: 'compare-two-stocks',
    input: '对比 600519 和 300750 的模拟行情',
    mustInclude: ['600519', '300750'],
    description: '应查询两只股票行情',
  },
  {
    id: 'disclaimer-check',
    input: '根据模拟行情，我应该买入贵州茅台吗？',
    mustInclude: ['不构成', '模拟'],
    description: '应拒绝直接荐股并提示模拟数据',
  },
  {
    id: 'data-source-attribution',
    input: '请分析平安银行 000001，并说明数据来源',
    mustInclude: ['000001', '来源'],
    description: '应标注数据来源',
  },
  {
    id: 'watchlist-intent',
    input: '帮我把宁德时代 300750 加入关注列表，我是平衡型投资者',
    mustInclude: ['300750', '关注'],
    description: '应理解关注列表与风险偏好意图',
  },
];

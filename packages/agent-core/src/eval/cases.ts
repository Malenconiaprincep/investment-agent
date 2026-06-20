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
    mustInclude: ['北京'],
    description: '应调用时间 Tool 并标注时区',
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
    id: 'watchlist-intent',
    input: '帮我把宁德时代 300750 加入关注列表，我是平衡型投资者',
    mustInclude: ['300750', '关注'],
    description: '应理解关注列表与风险偏好意图',
  },
  {
    id: 'disclaimer-check',
    input: '根据行情数据，我应该买入贵州茅台吗？',
    mustInclude: ['不构成'],
    description: '应拒绝直接荐股',
  },
  {
    id: 'market-basic-maotai',
    input: '查询贵州茅台 600519 的基本信息，包括行业和上市日期',
    mustInclude: ['600519', '贵州茅台'],
    description: '应调用 get-stock-basic 返回基本信息',
  },
  {
    id: 'market-daily-maotai',
    input: '查询贵州茅台 600519 最近 5 个交易日行情',
    mustInclude: ['600519', '收盘'],
    description: '应调用 get-daily-quote 返回日线数据',
  },
  {
    id: 'market-research-report',
    input: '分析贵州茅台 600519',
    mustInclude: ['公司概况', '行情', '数据来源', '风险'],
    description: '应输出结构化研报并调用多个行情 Tool',
  },
  {
    id: 'market-data-attribution',
    input: '请分析平安银行 000001，并说明数据来源与时效',
    mustInclude: ['000001', '数据来源'],
    description: '应标注数据来源与 asOf',
  },
  {
    id: 'mock-fallback',
    input: '用模拟数据演示一下 600519 的行情格式',
    mustInclude: ['600519', '模拟'],
    description: 'mock Tool 仍可用，须标注模拟数据',
  },
];

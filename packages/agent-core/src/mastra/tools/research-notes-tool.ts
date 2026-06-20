import { createVectorQueryTool } from '@mastra/rag';
import { fastembed } from '@mastra/fastembed';

export const researchNotesTool = createVectorQueryTool({
  id: 'search-research-notes',
  description:
    '从个人投研笔记库中语义检索相关内容。用于回答公司基本面、行业逻辑、风险点等问题。回答必须引用检索到的原文片段。',
  vectorStoreName: 'researchVectors',
  indexName: 'investment_notes',
  model: fastembed.small,
  enableFilter: true,
});

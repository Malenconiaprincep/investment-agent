import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { searchResearchNotes } from '../../data/rag/search-notes.js';
import { researchVectors } from '../vectors.js';

export const researchNotesTool = createTool({
  id: 'search-research-notes',
  description:
    '从个人投研笔记库中语义检索相关内容。用于回答公司基本面、行业逻辑、风险点等问题。回答必须引用检索到的原文片段。',
  inputSchema: z.object({
    query: z.string().describe('检索问题或关键词，如「茅台 风险」「银行板块逻辑」'),
    topK: z.number().int().min(1).max(10).optional().describe('返回条数，默认 4'),
  }),
  outputSchema: z.object({
    hits: z.array(
      z.object({
        text: z.string(),
        file: z.string(),
        source: z.string(),
        score: z.number(),
      }),
    ),
    count: z.number(),
    indexed: z.boolean().describe('向量库是否已入库；false 时需提示用户运行 pnpm ingest'),
  }),
  execute: async (inputData) => {
    const { hits, indexReady } = await searchResearchNotes(
      researchVectors,
      inputData.query,
      inputData.topK ?? 4,
    );
    return {
      hits,
      count: hits.length,
      indexed: indexReady,
    };
  },
});

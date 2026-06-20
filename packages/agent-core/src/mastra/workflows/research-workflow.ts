import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { emitResearchStreamEvent } from '../../api/research-stream-context.js';
import { searchResearchNotes } from '../../data/rag/search-notes.js';
import { getStockBasic } from '../../data/market/services.js';
import {
  comparePeers,
  getAnnouncements,
  getDailyQuote,
  getFinancialReport,
  searchNews,
} from '../../data/market/services.js';
import { checkReportQuality, extractSymbol } from './research/quality.js';

const workflowInputSchema = z.object({
  symbol: z.string().optional().describe('6 位 A 股代码，如 600519'),
  query: z.string().optional().describe('自然语言问题，如「分析贵州茅台 600519」'),
});

const targetSchema = z.object({
  symbol: z.string(),
  tsCode: z.string(),
  name: z.string(),
  industry: z.string().nullable(),
  area: z.string().nullable(),
  listDate: z.string().nullable(),
  market: z.string().nullable(),
  dataSource: z.string(),
  asOf: z.string(),
});

const symbolInputSchema = z.object({
  symbol: z.string(),
});

const identifyTargetStep = createStep({
  id: 'identify-target',
  description: '解析股票代码并确认标的基本信息',
  inputSchema: workflowInputSchema,
  outputSchema: targetSchema,
  execute: async ({ inputData }) => {
    const symbol = extractSymbol(inputData);
    const basic = await getStockBasic(symbol);
    return {
      symbol: basic.symbol,
      tsCode: basic.tsCode,
      name: basic.name,
      industry: basic.industry,
      area: basic.area,
      listDate: basic.listDate,
      market: basic.market,
      dataSource: basic.dataSource,
      asOf: basic.asOf,
    };
  },
});

const pickSymbolStep = createStep({
  id: 'pick-symbol',
  description: '提取 6 位代码供并行采数',
  inputSchema: targetSchema,
  outputSchema: symbolInputSchema,
  execute: async ({ inputData }) => ({ symbol: inputData.symbol }),
});

const fetchMarketDataStep = createStep({
  id: 'fetch-market-data',
  description: '并行采集行情、财务、公告、新闻与同业数据',
  inputSchema: symbolInputSchema,
  outputSchema: z.object({
    target: targetSchema,
    quote: z.unknown(),
    financial: z.unknown(),
    announcements: z.unknown(),
    news: z.unknown(),
    peers: z.unknown(),
    fetchErrors: z.array(z.string()),
    fetchedAt: z.string(),
  }),
  execute: async ({ inputData, getStepResult }) => {
    const target = getStepResult(identifyTargetStep);
    const symbol = inputData.symbol;

    const tasks = [
      { key: 'quote', run: () => getDailyQuote(symbol, 5) },
      { key: 'financial', run: () => getFinancialReport(symbol) },
      { key: 'announcements', run: () => getAnnouncements(symbol, 30) },
      { key: 'news', run: () => searchNews(symbol, 7) },
      { key: 'peers', run: () => comparePeers(symbol, 5) },
    ] as const;

    const results = await Promise.allSettled(tasks.map((task) => task.run()));
    const fetchErrors: string[] = [];
    const data: Record<string, unknown> = {};

    results.forEach((result, index) => {
      const key = tasks[index].key;
      if (result.status === 'fulfilled') {
        data[key] = result.value;
      } else {
        const message =
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason);
        fetchErrors.push(`${key}: ${message}`);
        data[key] = null;
      }
    });

    return {
      target,
      quote: data.quote,
      financial: data.financial,
      announcements: data.announcements,
      news: data.news,
      peers: data.peers,
      fetchErrors,
      fetchedAt: new Date().toISOString(),
    };
  },
});

const searchNotesStep = createStep({
  id: 'search-notes',
  description: '从投研笔记库语义检索相关观点与风险',
  inputSchema: z.object({
    target: targetSchema,
    quote: z.unknown(),
    financial: z.unknown(),
    announcements: z.unknown(),
    news: z.unknown(),
    peers: z.unknown(),
    fetchErrors: z.array(z.string()),
    fetchedAt: z.string(),
  }),
  outputSchema: z.object({
    target: targetSchema,
    quote: z.unknown(),
    financial: z.unknown(),
    announcements: z.unknown(),
    news: z.unknown(),
    peers: z.unknown(),
    fetchErrors: z.array(z.string()),
    fetchedAt: z.string(),
    notes: z.array(
      z.object({
        text: z.string(),
        file: z.string(),
        source: z.string(),
        score: z.number(),
      }),
    ),
  }),
  execute: async ({ inputData, mastra }) => {
    const query = `${inputData.target.name} ${inputData.target.symbol} 风险 行业 投资逻辑`;
    const vectorStore = mastra.getVector('researchVectors');
    const notes = await searchResearchNotes(vectorStore, query);
    return { ...inputData, notes };
  },
});

const preparePromptStep = createStep({
  id: 'prepare-prompt',
  description: '将结构化数据组装为研报撰写 Prompt',
  inputSchema: z.object({
    target: targetSchema,
    quote: z.unknown(),
    financial: z.unknown(),
    announcements: z.unknown(),
    news: z.unknown(),
    peers: z.unknown(),
    fetchErrors: z.array(z.string()),
    fetchedAt: z.string(),
    notes: z.array(
      z.object({
        text: z.string(),
        file: z.string(),
        source: z.string(),
        score: z.number(),
      }),
    ),
  }),
  outputSchema: z.object({
    prompt: z.string(),
    bundle: z.unknown(),
  }),
  execute: async ({ inputData }) => {
    const prompt = `请根据以下结构化数据撰写 A 股投研 Markdown 研报。

标的：${inputData.target.name}（${inputData.target.symbol} / ${inputData.target.tsCode}）
行业：${inputData.target.industry ?? '未知'}
采集时间：${inputData.fetchedAt}

=== 行情数据 ===
${JSON.stringify(inputData.quote, null, 2)}

=== 财务数据 ===
${JSON.stringify(inputData.financial, null, 2)}

=== 公告 ===
${JSON.stringify(inputData.announcements, null, 2)}

=== 新闻 ===
${JSON.stringify(inputData.news, null, 2)}

=== 同业对比 ===
${JSON.stringify(inputData.peers, null, 2)}

=== 采数异常（如有） ===
${JSON.stringify(inputData.fetchErrors, null, 2)}

=== 笔记库检索 ===
${JSON.stringify(inputData.notes, null, 2)}

请严格按 instructions 中的章节模板输出，不要编造数据中不存在的数字。`;

    return { prompt, bundle: inputData };
  },
});

const writeReportStep = createStep({
  id: 'write-report',
  description: '调用研报撰写 Agent 生成 Markdown',
  inputSchema: z.object({
    prompt: z.string(),
    bundle: z.unknown(),
  }),
  outputSchema: z.object({
    text: z.string(),
    bundle: z.unknown(),
  }),
  execute: async ({ inputData, mastra }) => {
    const agent = mastra.getAgent('reportWriterAgent');
    const stream = await agent.stream(inputData.prompt);
    let text = '';

    for await (const chunk of stream.textStream) {
      text += chunk;
      emitResearchStreamEvent({ type: 'token', text: chunk });
    }

    return {
      text,
      bundle: inputData.bundle,
    };
  },
});

const qualityCheckStep = createStep({
  id: 'quality-check',
  description: '检查研报是否包含必备章节与免责声明',
  inputSchema: z.object({
    text: z.string(),
    bundle: z.unknown(),
  }),
  outputSchema: z.object({
    report: z.string(),
    passed: z.boolean(),
    missingSections: z.array(z.string()),
    missingKeywords: z.array(z.string()),
    symbol: z.string(),
    name: z.string(),
    workflowCompletedAt: z.string(),
  }),
  execute: async ({ inputData }) => {
    const bundle = inputData.bundle as {
      target: z.infer<typeof targetSchema>;
    };
    const quality = checkReportQuality(inputData.text);

    return {
      report: inputData.text,
      passed: quality.passed,
      missingSections: quality.missingSections,
      missingKeywords: quality.missingKeywords,
      symbol: bundle.target.symbol,
      name: bundle.target.name,
      workflowCompletedAt: new Date().toISOString(),
    };
  },
});

export const researchWorkflow = createWorkflow({
  id: 'research-workflow',
  description:
    'A 股五步投研工作流：标的确认 → 并行采数 → RAG → 研报生成 → 质量检查',
  inputSchema: workflowInputSchema,
  outputSchema: z.object({
    report: z.string(),
    passed: z.boolean(),
    missingSections: z.array(z.string()),
    missingKeywords: z.array(z.string()),
    symbol: z.string(),
    name: z.string(),
    workflowCompletedAt: z.string(),
  }),
})
  .then(identifyTargetStep)
  .then(pickSymbolStep)
  .then(fetchMarketDataStep)
  .then(searchNotesStep)
  .then(preparePromptStep)
  .then(writeReportStep)
  .then(qualityCheckStep)
  .commit();

import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import {
  fetchIwencaiCandidates,
  fetchIwencaiIndustryContext,
  fetchIwencaiSectors,
  type CandidateItem,
  type SectorItem,
} from '../../data/market/iwencai-screen.js';
import {
  discoverAutoScreenContext,
} from '../../data/market/hot-market-discovery.js';
import { getStockBasic } from '../../data/market/services.js';
import { emitScreenStreamEvent } from '../../api/screen-stream-context.js';
import { isIwencaiMcpConfigured } from '../mcp/iwencai.js';
import { checkSectorScreenQuality } from './sector-screen/quality.js';

const workflowInputSchema = z.object({
  /** 可选；留空则根据热门新闻 + 板块自动选股 */
  query: z.string().optional(),
  maxCandidates: z.number().int().min(1).max(20).optional().default(10),
  excludeSt: z.boolean().optional().default(true),
});

const hotNewsSchema = z.object({
  title: z.string(),
  datetime: z.string(),
  url: z.string().nullable(),
});

const parsedQuerySchema = z.object({
  query: z.string(),
  maxCandidates: z.number(),
  excludeSt: z.boolean(),
  sectorQuery: z.string(),
  stockQuery: z.string(),
  hotNews: z.array(hotNewsSchema),
  hotThemes: z.array(z.string()),
  mode: z.enum(['auto', 'manual']),
});

const sectorSchema = z.object({
  name: z.string(),
  reason: z.string(),
  dataSource: z.string(),
});

const candidateSchema = z.object({
  symbol: z.string(),
  name: z.string(),
  thesis: z.string(),
  dataSource: z.string(),
  industry: z.string().nullable().optional(),
});

const discoverHotMarketStep = createStep({
  id: 'discover-hot-market',
  description: '扫描热门新闻与板块，自动生成选股主题',
  inputSchema: workflowInputSchema,
  outputSchema: parsedQuerySchema,
  execute: async ({ inputData }) => {
    if (!isIwencaiMcpConfigured()) {
      throw new Error('问财未配置：请在 .env 设置 IWENCAI_API_KEY 后使用板块选股');
    }

    const userQuery = inputData.query?.trim();
    const ctx = await discoverAutoScreenContext({
      userQuery: userQuery || undefined,
      excludeSt: inputData.excludeSt ?? true,
    });

    return {
      query: ctx.query,
      maxCandidates: inputData.maxCandidates ?? 10,
      excludeSt: inputData.excludeSt ?? true,
      sectorQuery: ctx.sectorQuery,
      stockQuery: ctx.stockQuery,
      hotNews: ctx.hotNews,
      hotThemes: ctx.hotThemes,
      mode: ctx.mode,
    };
  },
});

const fetchSectorsStep = createStep({
  id: 'fetch-sectors',
  description: '问财板块筛选',
  inputSchema: parsedQuerySchema,
  outputSchema: z.object({
    parsed: parsedQuerySchema,
    sectors: z.array(sectorSchema),
    sectorRaw: z.unknown(),
    industrySummary: z.string().nullable(),
    fetchErrors: z.array(z.string()),
  }),
  execute: async ({ inputData }) => {
    const parsed = inputData;
    const fetchErrors: string[] = [];

    if (!isIwencaiMcpConfigured()) {
      throw new Error('问财未配置：请在 .env 设置 IWENCAI_API_KEY 后使用板块选股');
    }

    let sectors: SectorItem[] = [];
    let sectorRaw: unknown = null;
    let industrySummary: string | null = null;

    try {
      const result = await fetchIwencaiSectors(parsed.sectorQuery, 5);
      sectors = result.sectors;
      sectorRaw = result.raw;
    } catch (error) {
      fetchErrors.push(
        `sectors: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    try {
      const industry = await fetchIwencaiIndustryContext(parsed.sectorQuery);
      industrySummary = industry.summary;
    } catch (error) {
      fetchErrors.push(
        `industry: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return {
      parsed,
      sectors,
      sectorRaw,
      industrySummary,
      fetchErrors,
    };
  },
});

const fetchCandidatesStep = createStep({
  id: 'fetch-candidates',
  description: '问财 A 股筛选',
  inputSchema: z.object({
    parsed: parsedQuerySchema,
    sectors: z.array(sectorSchema),
    sectorRaw: z.unknown(),
    industrySummary: z.string().nullable(),
    fetchErrors: z.array(z.string()),
  }),
  outputSchema: z.object({
    parsed: parsedQuerySchema,
    sectors: z.array(sectorSchema),
    candidates: z.array(candidateSchema),
    industrySummary: z.string().nullable(),
    fetchErrors: z.array(z.string()),
    candidateRaw: z.unknown(),
  }),
  execute: async ({ inputData }) => {
    const sectorHint = inputData.sectors[0]?.name;
    const fetchErrors = [...inputData.fetchErrors];

    let candidates: CandidateItem[] = [];
    let candidateRaw: unknown = null;

    try {
      const result = await fetchIwencaiCandidates(
        inputData.parsed.stockQuery,
        sectorHint,
        inputData.parsed.maxCandidates,
      );
      candidates = result.candidates;
      candidateRaw = result.raw;
    } catch (error) {
      fetchErrors.push(
        `candidates: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return {
      parsed: inputData.parsed,
      sectors: inputData.sectors,
      candidates,
      industrySummary: inputData.industrySummary,
      fetchErrors,
      candidateRaw,
    };
  },
});

const enrichBasicsStep = createStep({
  id: 'enrich-basics',
  description: '东财补全候选股基本信息',
  inputSchema: z.object({
    parsed: parsedQuerySchema,
    sectors: z.array(sectorSchema),
    candidates: z.array(candidateSchema),
    industrySummary: z.string().nullable(),
    fetchErrors: z.array(z.string()),
    candidateRaw: z.unknown(),
  }),
  outputSchema: z.object({
    parsed: parsedQuerySchema,
    sectors: z.array(sectorSchema),
    candidates: z.array(candidateSchema),
    industrySummary: z.string().nullable(),
    fetchErrors: z.array(z.string()),
    bundle: z.unknown(),
  }),
  execute: async ({ inputData }) => {
    const enriched = await Promise.all(
      inputData.candidates.map(async (item) => {
        try {
          const basic = await getStockBasic(item.symbol);
          return {
            ...item,
            name: basic.name || item.name,
            industry: basic.industry,
            dataSource:
              item.dataSource === 'iwencai' ? 'iwencai+eastmoney' : item.dataSource,
          };
        } catch {
          return { ...item, industry: null };
        }
      }),
    );

    return {
      parsed: inputData.parsed,
      sectors: inputData.sectors,
      candidates: enriched,
      industrySummary: inputData.industrySummary,
      fetchErrors: inputData.fetchErrors,
      bundle: {
        sectorRaw: inputData,
        candidates: enriched,
      },
    };
  },
});

const summarizeStep = createStep({
  id: 'summarize',
  description: '板块轮动 Agent 生成摘要',
  inputSchema: z.object({
    parsed: parsedQuerySchema,
    sectors: z.array(sectorSchema),
    candidates: z.array(candidateSchema),
    industrySummary: z.string().nullable(),
    fetchErrors: z.array(z.string()),
    bundle: z.unknown(),
  }),
  outputSchema: z.object({
    query: z.string(),
    sectors: z.array(sectorSchema),
    candidates: z.array(candidateSchema),
    rotationSummary: z.string(),
    fetchErrors: z.array(z.string()),
    industrySummary: z.string().nullable(),
    hotNews: z.array(hotNewsSchema),
    hotThemes: z.array(z.string()),
    mode: z.enum(['auto', 'manual']),
  }),
  execute: async ({ inputData, mastra }) => {
    const agent = mastra.getAgent('sectorRotationAgent');
    const prompt = `请根据以下问财板块/选股结果撰写板块轮动 Markdown 摘要。

选股模式：${inputData.parsed.mode === 'auto' ? '热点自动扫描' : '用户指定主题'}
主题说明：${inputData.parsed.query}

=== 热点新闻（自动扫描） ===
${JSON.stringify(inputData.parsed.hotNews.slice(0, 8), null, 2)}

=== 板块 ===
${JSON.stringify(inputData.sectors, null, 2)}

=== 候选股 ===
${JSON.stringify(inputData.candidates, null, 2)}

=== 行业背景 ===
${inputData.industrySummary ?? '无'}

=== 采数异常 ===
${JSON.stringify(inputData.fetchErrors, null, 2)}

必须在文末包含「免责声明：本内容不构成投资建议」。`;

    const stream = await agent.stream(prompt);
    let rotationSummary = '';
    for await (const chunk of stream.textStream) {
      rotationSummary += chunk;
      emitScreenStreamEvent({ type: 'token', text: chunk });
    }

    return {
      query: inputData.parsed.query,
      sectors: inputData.sectors,
      candidates: inputData.candidates,
      rotationSummary,
      fetchErrors: inputData.fetchErrors,
      industrySummary: inputData.industrySummary,
      hotNews: inputData.parsed.hotNews,
      hotThemes: inputData.parsed.hotThemes,
      mode: inputData.parsed.mode,
    };
  },
});

const qualityCheckStep = createStep({
  id: 'quality-check',
  description: '检查板块选股输出质量',
  inputSchema: z.object({
    query: z.string(),
    sectors: z.array(sectorSchema),
    candidates: z.array(candidateSchema),
    rotationSummary: z.string(),
    fetchErrors: z.array(z.string()),
    industrySummary: z.string().nullable(),
    hotNews: z.array(hotNewsSchema),
    hotThemes: z.array(z.string()),
    mode: z.enum(['auto', 'manual']),
  }),
  outputSchema: z.object({
    query: z.string(),
    sectors: z.array(sectorSchema),
    candidates: z.array(candidateSchema),
    rotationSummary: z.string(),
    fetchErrors: z.array(z.string()),
    hotNews: z.array(hotNewsSchema),
    hotThemes: z.array(z.string()),
    mode: z.enum(['auto', 'manual']),
    passed: z.boolean(),
    missingSections: z.array(z.string()),
    missingKeywords: z.array(z.string()),
    screenedAt: z.string(),
  }),
  execute: async ({ inputData }) => {
    const quality = checkSectorScreenQuality(inputData);
    return {
      ...inputData,
      passed: quality.passed,
      missingSections: quality.missingSections,
      missingKeywords: quality.missingKeywords,
      screenedAt: new Date().toISOString(),
    };
  },
});

export const sectorScreenWorkflow = createWorkflow({
  id: 'sector-screen-workflow',
  description: '板块轮动选股：问财选板块 → 选股 → 补全 → 摘要',
  inputSchema: workflowInputSchema,
  outputSchema: z.object({
    query: z.string(),
    sectors: z.array(sectorSchema),
    candidates: z.array(candidateSchema),
    rotationSummary: z.string(),
    fetchErrors: z.array(z.string()),
    hotNews: z.array(hotNewsSchema),
    hotThemes: z.array(z.string()),
    mode: z.enum(['auto', 'manual']),
    passed: z.boolean(),
    missingSections: z.array(z.string()),
    missingKeywords: z.array(z.string()),
    screenedAt: z.string(),
  }),
})
  .then(discoverHotMarketStep)
  .then(fetchSectorsStep)
  .then(fetchCandidatesStep)
  .then(enrichBasicsStep)
  .then(summarizeStep)
  .then(qualityCheckStep)
  .commit();

export type SectorScreenWorkflowInput = z.infer<typeof workflowInputSchema>;
export type SectorScreenWorkflowOutput = {
  query: string;
  sectors: Array<{ name: string; reason: string; dataSource: string }>;
  candidates: Array<{
    symbol: string;
    name: string;
    thesis: string;
    dataSource: string;
  }>;
  rotationSummary: string;
  fetchErrors: string[];
  hotNews: Array<{ title: string; datetime: string; url: string | null }>;
  hotThemes: string[];
  mode: 'auto' | 'manual';
  passed: boolean;
  missingSections: string[];
  missingKeywords: string[];
  screenedAt: string;
};

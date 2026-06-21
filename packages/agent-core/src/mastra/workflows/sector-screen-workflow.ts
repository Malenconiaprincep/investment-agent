import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import {
  fetchIwencaiCandidatesMerged,
  fetchIwencaiIndustryContext,
  fetchIwencaiSectorsWithFallback,
  parseCandidatesFromIwencai,
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
import {
  scanScreeningCandidatesDiamonds,
  type ScreeningCandidateWithDiamond,
} from '../../data/screening/diamond-scan.js';
import {
  formatFactorThesis,
  scoreAndRankCandidates,
} from '../../data/screening/factor-score.js';

const workflowInputSchema = z.object({
  /** 可选；留空则根据热门新闻 + 板块自动选股 */
  query: z.string().optional(),
  maxCandidates: z.number().int().min(1).max(20).optional().default(10),
  excludeSt: z.boolean().optional().default(true),
  lookbackDays: z.number().int().min(1).max(30).optional().default(14),
  /** YYYY-MM-DD；历史回放模式 */
  asOfDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

const hotNewsSchema = z.object({
  title: z.string(),
  datetime: z.string(),
  url: z.string().nullable(),
});

const newsSymbolSchema = z.object({
  symbol: z.string(),
  name: z.string(),
  source: z.string(),
});

const parsedQuerySchema = z.object({
  query: z.string(),
  maxCandidates: z.number(),
  excludeSt: z.boolean(),
  sectorQuery: z.string(),
  stockQuery: z.string(),
  stockQueries: z.array(z.string()),
  hotNews: z.array(hotNewsSchema),
  hotThemes: z.array(z.string()),
  newsSymbols: z.array(newsSymbolSchema),
  mode: z.enum(['auto', 'manual']),
  lookbackDays: z.number(),
  asOfDate: z.string().optional(),
});

const sectorSchema = z.object({
  name: z.string(),
  reason: z.string(),
  dataSource: z.string(),
});

const candidateDiamondSchema = z
  .object({
    strength: z.enum(['red', 'blue']),
    score: z.number(),
    tradeDate: z.string(),
    close: z.number(),
    reasons: z.array(z.string()),
  })
  .nullable()
  .optional();

const factorScoreSchema = z
  .object({
    total: z.number(),
    shortTermScore: z.number(),
    trendScore: z.number(),
    outlook: z.enum(['short-bullish', 'trend-bullish', 'neutral', 'weak']),
    outlookLabel: z.string(),
    factors: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        passed: z.boolean(),
        points: z.number(),
        detail: z.string().optional(),
      }),
    ),
    ret1dPct: z.number().nullable(),
    ret5dPct: z.number().nullable(),
    ret20dPct: z.number().nullable(),
  })
  .optional();

const candidateSchema = z.object({
  symbol: z.string(),
  name: z.string(),
  thesis: z.string(),
  dataSource: z.string(),
  industry: z.string().nullable().optional(),
  diamond: candidateDiamondSchema,
  factorScore: factorScoreSchema,
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
      lookbackDays: inputData.lookbackDays ?? 14,
      asOfDate: inputData.asOfDate,
    });

    return {
      query: ctx.query,
      maxCandidates: inputData.maxCandidates ?? 10,
      excludeSt: inputData.excludeSt ?? true,
      sectorQuery: ctx.sectorQuery,
      stockQuery: ctx.stockQuery,
      stockQueries: ctx.stockQueries,
      hotNews: ctx.hotNews,
      hotThemes: ctx.hotThemes,
      newsSymbols: ctx.newsSymbols,
      mode: ctx.mode,
      lookbackDays: ctx.lookbackDays,
      asOfDate: ctx.asOfDate,
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
      const result = await fetchIwencaiSectorsWithFallback(parsed.sectorQuery, 5, {
        allowFallback: !parsed.asOfDate,
      });
      sectors = result.sectors;
      sectorRaw = result.raw;
      if (result.usedFallback) {
        fetchErrors.push('sectors: 主 query 无结果，已使用强势板块 fallback');
      }
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
      const queries =
        inputData.parsed.stockQueries.length > 0
          ? inputData.parsed.stockQueries
          : [inputData.parsed.stockQuery];
      const fetchLimit = Math.min(
        Math.max(inputData.parsed.maxCandidates * 2, 16),
        24,
      );
      const result = await fetchIwencaiCandidatesMerged(
        queries,
        sectorHint,
        fetchLimit,
        { allowFallback: !inputData.parsed.asOfDate },
      );
      candidates = result.candidates;
      candidateRaw = result.raw;
      if (result.queriesUsed.length > 0) {
        const preview = result.queriesUsed.slice(0, 3).join('；');
        fetchErrors.push(
          `candidates: 问财 ${result.queriesUsed.length} 路 query — ${preview}${result.queriesUsed.length > 3 ? '…' : ''}`,
        );
      }
      if (result.usedFallback) {
        fetchErrors.push('candidates: 全部主题 query 无结果，已使用主力净流入 fallback');
      }

      for (const item of inputData.parsed.newsSymbols) {
        if (candidates.some((c) => c.symbol === item.symbol)) continue;
        if (candidates.length >= fetchLimit) break;
        candidates.push({
          symbol: item.symbol,
          name: item.name,
          thesis: `新闻提及（${item.source.slice(0, 24)}）`,
          dataSource: 'iwencai',
        });
      }
    } catch (error) {
      fetchErrors.push(
        `candidates: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (candidates.length === 0 && !inputData.parsed.asOfDate && inputData.sectorRaw) {
      const fromSectorRaw = parseCandidatesFromIwencai(
        inputData.sectorRaw,
        inputData.parsed.maxCandidates,
      );
      if (fromSectorRaw.length > 0) {
        candidates = fromSectorRaw;
        fetchErrors.push('candidates: 板块接口返回个股，已转为候选池');
      }
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

const scanDiamondsStep = createStep({
  id: 'scan-diamonds',
  description: '候选池钻石信号检测',
  inputSchema: z.object({
    parsed: parsedQuerySchema,
    sectors: z.array(sectorSchema),
    candidates: z.array(candidateSchema),
    industrySummary: z.string().nullable(),
    fetchErrors: z.array(z.string()),
    bundle: z.unknown(),
  }),
  outputSchema: z.object({
    parsed: parsedQuerySchema,
    sectors: z.array(sectorSchema),
    candidates: z.array(candidateSchema),
    diamondPicks: z.array(candidateSchema),
    industrySummary: z.string().nullable(),
    fetchErrors: z.array(z.string()),
    bundle: z.unknown(),
  }),
  execute: async ({ inputData }) => {
    const fetchErrors = [...inputData.fetchErrors];
    const { candidates, diamondPicks } = await scanScreeningCandidatesDiamonds({
      candidates: inputData.candidates as ScreeningCandidateWithDiamond[],
      asOfDate: inputData.parsed.asOfDate,
    });

    if (diamondPicks.length > 0) {
      fetchErrors.push(
        `diamond: ${diamondPicks.length} 只候选触发钻石信号（${inputData.parsed.asOfDate ? '历史回放日' : '最新'}）`,
      );
    }

    return {
      parsed: inputData.parsed,
      sectors: inputData.sectors,
      candidates,
      diamondPicks,
      industrySummary: inputData.industrySummary,
      fetchErrors,
      bundle: inputData.bundle,
    };
  },
});

const scoreFactorsStep = createStep({
  id: 'score-factors',
  description: '因子打分：隔日动量 + 趋势',
  inputSchema: z.object({
    parsed: parsedQuerySchema,
    sectors: z.array(sectorSchema),
    candidates: z.array(candidateSchema),
    diamondPicks: z.array(candidateSchema),
    industrySummary: z.string().nullable(),
    fetchErrors: z.array(z.string()),
    bundle: z.unknown(),
  }),
  outputSchema: z.object({
    parsed: parsedQuerySchema,
    sectors: z.array(sectorSchema),
    candidates: z.array(candidateSchema),
    diamondPicks: z.array(candidateSchema),
    industrySummary: z.string().nullable(),
    fetchErrors: z.array(z.string()),
    bundle: z.unknown(),
  }),
  execute: async ({ inputData }) => {
    const fetchErrors = [...inputData.fetchErrors];

    if (inputData.parsed.asOfDate) {
      return { ...inputData };
    }

    const { candidates, dropped } = await scoreAndRankCandidates({
      candidates: inputData.candidates as ScreeningCandidateWithDiamond[],
      limit: inputData.parsed.maxCandidates,
      minTotal: 42,
    });

    const enriched = candidates.map((item) => ({
      ...item,
      thesis: item.factorScore
        ? `${formatFactorThesis(item.factorScore)}；${item.thesis}`.slice(0, 280)
        : item.thesis,
    }));

    const diamondSymbols = new Set(
      enriched.filter((c) => c.diamond).map((c) => c.symbol),
    );
    const diamondPicks = enriched.filter((c) => diamondSymbols.has(c.symbol));

    if (enriched.length > 0) {
      const top = enriched[0].factorScore!;
      fetchErrors.push(
        `factor: ${enriched.length} 只通过因子筛选（隔日${top.shortTermScore}/趋势${top.trendScore}，${dropped} 只淘汰）`,
      );
    } else {
      fetchErrors.push('factor: 因子打分无结果，保留原候选顺序');
      return { ...inputData };
    }

    return {
      ...inputData,
      candidates: enriched,
      diamondPicks:
        diamondPicks.length > 0 ? diamondPicks : inputData.diamondPicks,
      fetchErrors,
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
    diamondPicks: z.array(candidateSchema),
    industrySummary: z.string().nullable(),
    fetchErrors: z.array(z.string()),
    bundle: z.unknown(),
  }),
  outputSchema: z.object({
    query: z.string(),
    sectors: z.array(sectorSchema),
    candidates: z.array(candidateSchema),
    diamondPicks: z.array(candidateSchema),
    rotationSummary: z.string(),
    fetchErrors: z.array(z.string()),
    industrySummary: z.string().nullable(),
    hotNews: z.array(hotNewsSchema),
    hotThemes: z.array(z.string()),
    mode: z.enum(['auto', 'manual']),
    lookbackDays: z.number(),
    asOfDate: z.string().optional(),
  }),
  execute: async ({ inputData, mastra }) => {
    const agent = mastra.getAgent('sectorRotationAgent');
    const prompt = `请根据以下问财板块/选股结果撰写板块轮动 Markdown 摘要。

选股模式：${inputData.parsed.mode === 'auto' ? '热点因子选股（隔日动量+趋势）' : '用户指定主题'}
主题说明：${inputData.parsed.query}
${inputData.parsed.asOfDate ? `历史回放日：${inputData.parsed.asOfDate}` : ''}

=== 热点新闻（自动扫描） ===
${JSON.stringify(inputData.parsed.hotNews.slice(0, 8), null, 2)}

=== 板块 ===
${JSON.stringify(inputData.sectors, null, 2)}

=== 候选股（含因子得分：隔日动量/趋势） ===
${JSON.stringify(inputData.candidates, null, 2)}

=== 钻石信号推荐 ===
${JSON.stringify(inputData.diamondPicks, null, 2)}

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

    if (!rotationSummary.trim()) {
      rotationSummary = `## 板块轮动逻辑

问财已返回板块/个股数据，但摘要生成未产出内容。请查看下方结构化候选池与采数异常说明。

## 热门板块解读

${JSON.stringify(inputData.sectors, null, 2)}

## 候选池说明

${JSON.stringify(inputData.candidates, null, 2)}

## 数据来源

iwencai / eastmoney

免责声明：本内容不构成投资建议。`;
    }

    return {
      query: inputData.parsed.query,
      sectors: inputData.sectors,
      candidates: inputData.candidates,
      diamondPicks: inputData.diamondPicks,
      rotationSummary,
      fetchErrors: inputData.fetchErrors,
      industrySummary: inputData.industrySummary,
      hotNews: inputData.parsed.hotNews,
      hotThemes: inputData.parsed.hotThemes,
      mode: inputData.parsed.mode,
      lookbackDays: inputData.parsed.lookbackDays,
      asOfDate: inputData.parsed.asOfDate,
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
    diamondPicks: z.array(candidateSchema),
    rotationSummary: z.string(),
    fetchErrors: z.array(z.string()),
    industrySummary: z.string().nullable(),
    hotNews: z.array(hotNewsSchema),
    hotThemes: z.array(z.string()),
    mode: z.enum(['auto', 'manual']),
    lookbackDays: z.number(),
    asOfDate: z.string().optional(),
  }),
  outputSchema: z.object({
    query: z.string(),
    sectors: z.array(sectorSchema),
    candidates: z.array(candidateSchema),
    diamondPicks: z.array(candidateSchema),
    rotationSummary: z.string(),
    fetchErrors: z.array(z.string()),
    hotNews: z.array(hotNewsSchema),
    hotThemes: z.array(z.string()),
    mode: z.enum(['auto', 'manual']),
    passed: z.boolean(),
    missingSections: z.array(z.string()),
    missingKeywords: z.array(z.string()),
    screenedAt: z.string(),
    lookbackDays: z.number(),
    asOfDate: z.string().optional(),
  }),
  execute: async ({ inputData }) => {
    const quality = checkSectorScreenQuality(inputData);
    const screenedAt = inputData.asOfDate
      ? `${inputData.asOfDate}T15:00:00.000+08:00`
      : new Date().toISOString();
    return {
      ...inputData,
      passed: quality.passed,
      missingSections: quality.missingSections,
      missingKeywords: quality.missingKeywords,
      screenedAt,
    };
  },
});

export const sectorScreenWorkflow = createWorkflow({
  id: 'sector-screen-workflow',
  description: '板块轮动选股：问财选板块 → 选股 → 补全 → 钻石 → 因子打分 → 摘要',
  inputSchema: workflowInputSchema,
  outputSchema: z.object({
    query: z.string(),
    sectors: z.array(sectorSchema),
    candidates: z.array(candidateSchema),
    diamondPicks: z.array(candidateSchema),
    rotationSummary: z.string(),
    fetchErrors: z.array(z.string()),
    hotNews: z.array(hotNewsSchema),
    hotThemes: z.array(z.string()),
    mode: z.enum(['auto', 'manual']),
    passed: z.boolean(),
    missingSections: z.array(z.string()),
    missingKeywords: z.array(z.string()),
    screenedAt: z.string(),
    asOfDate: z.string().optional(),
  }),
})
  .then(discoverHotMarketStep)
  .then(fetchSectorsStep)
  .then(fetchCandidatesStep)
  .then(enrichBasicsStep)
  .then(scanDiamondsStep)
  .then(scoreFactorsStep)
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
    diamond?: {
      strength: 'red' | 'blue';
      score: number;
      tradeDate: string;
      close: number;
      reasons: string[];
    } | null;
  }>;
  diamondPicks: Array<{
    symbol: string;
    name: string;
    thesis: string;
    dataSource: string;
    diamond?: {
      strength: 'red' | 'blue';
      score: number;
      tradeDate: string;
      close: number;
      reasons: string[];
    } | null;
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

import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { emitCommitteeStreamEvent } from '../../api/committee-stream-context.js';
import {
  buildCommitteeTradePlans,
  formatTradePlansForPrompt,
  type CommitteeTradePlan,
} from '../../data/screening/committee-trading-plan.js';

const candidateInputSchema = z.object({
  symbol: z.string().regex(/^\d{6}$/),
  name: z.string(),
});

const tradeSignalSchema = z.object({
  kind: z.enum(['buy', 'sell']),
  tradeDate: z.string(),
  price: z.number(),
  reason: z.string(),
  strength: z.enum(['red', 'blue']).optional(),
});

const tradePlanSchema = z.object({
  symbol: z.string(),
  name: z.string(),
  action: z.enum(['buy', 'hold', 'wait', 'sell']),
  actionReason: z.string(),
  latestClose: z.number(),
  entryPrice: z.number().nullable(),
  stopLossPrice: z.number(),
  targetHint: z.string(),
  signals: z.array(tradeSignalSchema),
  diamondStrength: z.enum(['red', 'blue']).nullable(),
  checklistScore: z.number(),
  checklistMax: z.number(),
});

const workflowInputSchema = z.object({
  candidates: z.array(candidateInputSchema).min(1).max(5),
  screeningSessionId: z.string().optional(),
  maxAnalyze: z.number().int().min(1).max(5).optional().default(3),
});

const parsedInputSchema = z.object({
  candidates: z.array(candidateInputSchema),
  screeningSessionId: z.string().optional(),
});

const SPECIALISTS = [
  { agentKey: 'newsAgent', role: '新闻组', focus: '资讯与政策' },
  { agentKey: 'financialAgent', role: '财务组', focus: '财务与估值' },
  { agentKey: 'announcementAgent', role: '公告组', focus: '公告与事件' },
  { agentKey: 'technicalAgent', role: '技术组', focus: '行情与趋势' },
  { agentKey: 'riskAgent', role: '风险组', focus: '风险与笔记库' },
  { agentKey: 'sentimentAgent', role: '情绪组', focus: '热度与情绪' },
] as const;

const parseCandidatesStep = createStep({
  id: 'parse-candidates',
  description: '规范化候选池',
  inputSchema: workflowInputSchema,
  outputSchema: parsedInputSchema,
  execute: async ({ inputData }) => ({
    candidates: inputData.candidates.slice(0, inputData.maxAnalyze ?? 3),
    screeningSessionId: inputData.screeningSessionId,
  }),
});

const buildTradingPlansStep = createStep({
  id: 'build-trading-plans',
  description: 'K 线信号与交易计划',
  inputSchema: parsedInputSchema,
  outputSchema: z.object({
    parsed: parsedInputSchema,
    tradePlans: z.array(tradePlanSchema),
  }),
  execute: async ({ inputData }) => {
    const tradePlans = await buildCommitteeTradePlans(inputData.candidates);
    emitCommitteeStreamEvent({ type: 'tradePlans', tradePlans });
    return { parsed: inputData, tradePlans };
  },
});

const parallelAnalyzeStep = createStep({
  id: 'parallel-analyze',
  description: '六组专家并行分析',
  inputSchema: z.object({
    parsed: parsedInputSchema,
    tradePlans: z.array(tradePlanSchema),
  }),
  outputSchema: z.object({
    parsed: parsedInputSchema,
    tradePlans: z.array(tradePlanSchema),
    opinions: z.array(
      z.object({
        role: z.string(),
        agentKey: z.string(),
        content: z.string(),
      }),
    ),
  }),
  execute: async ({ inputData, mastra }) => {
    const candidateList = inputData.parsed.candidates
      .map((c) => `${c.name}(${c.symbol})`)
      .join('、');
    const planHint = formatTradePlansForPrompt(
      inputData.tradePlans as CommitteeTradePlan[],
    );

    const tasks = SPECIALISTS.map(async (spec) => {
      emitCommitteeStreamEvent({
        type: 'specialist',
        role: spec.role,
        status: 'start',
      });

      const agent = mastra.getAgent(spec.agentKey);
      const prompt = `请分析以下 A 股候选池，从【${spec.focus}】角度给出意见。
候选：${candidateList}

=== 系统 K 线交易计划（技术组须重点对照） ===
${planHint}

对每只候选分别给出 JSON 数组元素，或合并为一份含 symbol 字段的多条 JSON。
必须先调用 Tool 获取数据。`;

      try {
        const result = await agent.generate(prompt, { maxSteps: 8 });
        emitCommitteeStreamEvent({
          type: 'specialist',
          role: spec.role,
          status: 'done',
        });
        return {
          role: spec.role,
          agentKey: spec.agentKey,
          content: result.text,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        emitCommitteeStreamEvent({
          type: 'specialist',
          role: spec.role,
          status: 'error',
          message,
        });
        return {
          role: spec.role,
          agentKey: spec.agentKey,
          content: JSON.stringify({ error: message }),
        };
      }
    });

    const opinions = await Promise.all(tasks);
    return {
      parsed: inputData.parsed,
      tradePlans: inputData.tradePlans,
      opinions,
    };
  },
});

const synthesizeStep = createStep({
  id: 'synthesize',
  description: '投委会主席综合纪要',
  inputSchema: z.object({
    parsed: parsedInputSchema,
    tradePlans: z.array(tradePlanSchema),
    opinions: z.array(
      z.object({
        role: z.string(),
        agentKey: z.string(),
        content: z.string(),
      }),
    ),
  }),
  outputSchema: z.object({
    parsed: parsedInputSchema,
    tradePlans: z.array(tradePlanSchema),
    opinions: z.array(
      z.object({
        role: z.string(),
        agentKey: z.string(),
        content: z.string(),
      }),
    ),
    memo: z.string(),
  }),
  execute: async ({ inputData, mastra }) => {
    const supervisor = mastra.getAgent('committeeSupervisor');
    const planBlock = formatTradePlansForPrompt(
      inputData.tradePlans as CommitteeTradePlan[],
    );
    const prompt = `请综合以下六组专家意见与 K 线交易计划，撰写投委会 Markdown 纪要。
必须包含「操作建议」与「K线信号解读」章节，并给出明确的买入/持有/等待/卖出建议及价位。

候选池：${JSON.stringify(inputData.parsed.candidates, null, 2)}

=== K 线交易计划（系统预计算，价格以此为准） ===
${planBlock}

=== 六组专家意见 ===
${inputData.opinions
  .map((o) => `=== ${o.role} ===\n${o.content}`)
  .join('\n\n')}`;

    const stream = await supervisor.stream(prompt, { maxSteps: 5 });
    let memo = '';

    for await (const chunk of stream.textStream) {
      memo += chunk;
      emitCommitteeStreamEvent({ type: 'token', text: chunk });
    }

    return { ...inputData, memo };
  },
});

const qualityCheckStep = createStep({
  id: 'quality-check',
  description: '检查投委会纪要质量',
  inputSchema: z.object({
    parsed: parsedInputSchema,
    tradePlans: z.array(tradePlanSchema),
    opinions: z.array(
      z.object({
        role: z.string(),
        agentKey: z.string(),
        content: z.string(),
      }),
    ),
    memo: z.string(),
  }),
  outputSchema: z.object({
    candidates: z.array(candidateInputSchema),
    screeningSessionId: z.string().optional(),
    tradePlans: z.array(tradePlanSchema),
    memo: z.string(),
    opinions: z.array(
      z.object({
        role: z.string(),
        agentKey: z.string(),
        content: z.string(),
      }),
    ),
    passed: z.boolean(),
    missingSections: z.array(z.string()),
    missingKeywords: z.array(z.string()),
    completedAt: z.string(),
  }),
  execute: async ({ inputData }) => {
    const { checkCommitteeQuality } = await import('./committee/quality.js');
    const quality = checkCommitteeQuality(inputData.memo);

    return {
      candidates: inputData.parsed.candidates,
      screeningSessionId: inputData.parsed.screeningSessionId,
      tradePlans: inputData.tradePlans,
      memo: inputData.memo,
      opinions: inputData.opinions,
      passed: quality.passed,
      missingSections: quality.missingSections,
      missingKeywords: quality.missingKeywords,
      completedAt: new Date().toISOString(),
    };
  },
});

export const committeeWorkflow = createWorkflow({
  id: 'committee-workflow',
  description: '多 Agent 投委会：K 线交易计划 + 六组并行分析 + 主席综合',
  inputSchema: workflowInputSchema,
  outputSchema: z.object({
    candidates: z.array(candidateInputSchema),
    screeningSessionId: z.string().optional(),
    tradePlans: z.array(tradePlanSchema),
    memo: z.string(),
    opinions: z.array(
      z.object({
        role: z.string(),
        agentKey: z.string(),
        content: z.string(),
      }),
    ),
    passed: z.boolean(),
    missingSections: z.array(z.string()),
    missingKeywords: z.array(z.string()),
    completedAt: z.string(),
  }),
})
  .then(parseCandidatesStep)
  .then(buildTradingPlansStep)
  .then(parallelAnalyzeStep)
  .then(synthesizeStep)
  .then(qualityCheckStep)
  .commit();

export type CommitteeWorkflowInput = z.infer<typeof workflowInputSchema>;

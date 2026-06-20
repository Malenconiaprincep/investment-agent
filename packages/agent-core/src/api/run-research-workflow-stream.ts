import 'dotenv/config';

import type { WorkflowStreamEvent } from '@mastra/core/stream';
import { saveResearchReport } from '../data/reports/store.js';
import { mastra } from '../mastra/index.js';
import { disconnectIwencaiMcp } from '../mastra/mcp/iwencai.js';
import {
  emitResearchStreamEvent,
  withResearchStreamEmitter,
} from './research-stream-context.js';
import type {
  ResearchWorkflowInput,
  ResearchWorkflowOutput,
} from './run-research-workflow.js';

export type ResearchStreamEvent =
  | { type: 'step'; step: string; label: string }
  | { type: 'meta'; symbol: string; name: string }
  | { type: 'token'; text: string }
  | {
      type: 'done';
      report: string;
      passed: boolean;
      missingSections: string[];
      missingKeywords: string[];
      symbol: string;
      name: string;
      workflowCompletedAt: string;
      elapsedMs: number;
      reportId: string;
    }
  | { type: 'error'; message: string };

const STEP_LABELS: Record<string, string> = {
  'identify-target': '确认标的',
  'pick-symbol': '提取代码',
  'fetch-market-data': '并行采数',
  'search-notes': '笔记检索',
  'prepare-prompt': '组装 Prompt',
  'write-report': '撰写研报',
  'quality-check': '质量检查',
};

function mapWorkflowChunk(chunk: WorkflowStreamEvent): ResearchStreamEvent[] {
  const events: ResearchStreamEvent[] = [];

  if (chunk.type === 'workflow-step-start') {
    events.push({
      type: 'step',
      step: chunk.payload.id,
      label: STEP_LABELS[chunk.payload.id] ?? chunk.payload.id,
    });
  }

  if (chunk.type === 'workflow-step-result') {
    if (chunk.payload.id === 'identify-target' && chunk.payload.output) {
      const output = chunk.payload.output as { symbol?: string; name?: string };
      if (output.symbol && output.name) {
        events.push({
          type: 'meta',
          symbol: output.symbol,
          name: output.name,
        });
      }
    }
  }

  return events;
}

export async function runResearchWorkflowStream(
  input: ResearchWorkflowInput,
  onEvent: (event: ResearchStreamEvent) => void,
): Promise<ResearchWorkflowOutput> {
  return withResearchStreamEmitter(onEvent, async () => {
    const startedAt = Date.now();
    const workflow = mastra.getWorkflow('researchWorkflow');
    const run = await workflow.createRun();

    const unwatch = run.watch((chunk) => {
      for (const event of mapWorkflowChunk(chunk)) {
        onEvent(event);
      }
    });

    try {
      const result = await run.start({ inputData: input });

      if (result.status !== 'success') {
        const message =
          result.status === 'failed'
            ? (result.error?.message ?? 'Workflow 执行失败')
            : `Workflow 状态: ${result.status}`;
        throw new Error(message);
      }

      const output = result.result;
      const elapsedMs = Date.now() - startedAt;
      const saved = await saveResearchReport({ ...output, elapsedMs });

      onEvent({
        type: 'done',
        report: output.report,
        passed: output.passed,
        missingSections: output.missingSections,
        missingKeywords: output.missingKeywords,
        symbol: output.symbol,
        name: output.name,
        workflowCompletedAt: output.workflowCompletedAt,
        elapsedMs,
        reportId: saved.id,
      });

      return {
        ...output,
        reportId: saved.id,
      };
    } finally {
      unwatch();
      await disconnectIwencaiMcp().catch(() => {});
    }
  });
}

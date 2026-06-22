import 'dotenv/config';

import type { WorkflowStreamEvent } from '@mastra/core/stream';
import { saveScreeningSession } from '../data/screening/store.js';
import { mastra } from '../mastra/index.js';
import { disconnectIwencaiMcp } from '../mastra/mcp/iwencai.js';
import type { SectorScreenWorkflowInput } from '../mastra/workflows/sector-screen-workflow.js';
import {
  emitScreenStreamEvent,
  withScreenStreamEmitter,
} from './screen-stream-context.js';
import type {
  ScreenStreamEvent,
  ScreeningStreamCandidate,
  TailEntryOutlookView,
  TailEntryRunView,
} from './screen-stream-types.js';

export type { ScreenStreamEvent } from './screen-stream-types.js';

const STEP_LABELS: Record<string, string> = {
  'discover-hot-market': '扫描热点',
  'fetch-sectors': '筛选板块',
  'fetch-candidates': '筛选候选股',
  'enrich-basics': '补充信息',
  'scan-diamonds': '钻石信号检测',
  'score-factors': '因子打分',
  'build-tail-entry-outlook': '明日预判',
  summarize: '生成摘要',
  'quality-check': '核对结果',
};

function mapWorkflowChunk(chunk: WorkflowStreamEvent): ScreenStreamEvent[] {
  const events: ScreenStreamEvent[] = [];

  if (chunk.type === 'workflow-step-start') {
    events.push({
      type: 'step',
      step: chunk.payload.id,
      label: STEP_LABELS[chunk.payload.id] ?? chunk.payload.id,
    });
  }

  if (chunk.type === 'workflow-step-result') {
    const output = chunk.payload.output as Record<string, unknown> | undefined;
    if (chunk.payload.id === 'discover-hot-market' && output) {
      events.push({
        type: 'hotNews',
        query: String(output.query ?? ''),
        mode: (output.mode as 'auto' | 'manual') ?? 'auto',
        hotThemes: (output.hotThemes as string[]) ?? [],
        hotNews: (output.hotNews as Array<{
          title: string;
          datetime: string;
          url: string | null;
        }>) ?? [],
      });
    }
    if (chunk.payload.id === 'fetch-sectors' && output?.sectors) {
      events.push({
        type: 'sectors',
        sectors: output.sectors as Array<{
          name: string;
          reason: string;
          dataSource: string;
        }>,
      });
    }
    if (
      (chunk.payload.id === 'scan-diamonds' ||
        chunk.payload.id === 'score-factors') &&
      output?.candidates
    ) {
      const candidates = output.candidates as ScreeningStreamCandidate[];
      events.push({
        type: 'candidates',
        candidates,
        diamondPicks: (output.diamondPicks as ScreeningStreamCandidate[]) ?? [],
      });
    }
    if (
      chunk.payload.id === 'build-tail-entry-outlook' &&
      output?.tailEntryRun
    ) {
      events.push({
        type: 'tailEntryRun',
        run: output.tailEntryRun as TailEntryRunView,
      });
    }
    if (
      chunk.payload.id === 'build-tail-entry-outlook' &&
      output?.tailEntryOutlook
    ) {
      events.push({
        type: 'tailEntryOutlook',
        outlook: output.tailEntryOutlook as TailEntryOutlookView,
      });
    }
  }

  return events;
}

export async function runSectorScreenStream(
  input: SectorScreenWorkflowInput,
  onEvent: (event: ScreenStreamEvent) => void,
) {
  return withScreenStreamEmitter(onEvent, async () => {
    const startedAt = Date.now();
    const workflow = mastra.getWorkflow('sectorScreenWorkflow');
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
      const saved = await saveScreeningSession({ ...output, elapsedMs });

      onEvent({
        type: 'done',
        query: output.query,
        sectors: output.sectors,
        candidates: output.candidates,
        diamondPicks: output.diamondPicks ?? [],
        rotationSummary: output.rotationSummary,
        hotNews: output.hotNews ?? [],
        hotThemes: output.hotThemes ?? [],
        mode: output.mode ?? 'auto',
        passed: output.passed,
        missingSections: output.missingSections,
        missingKeywords: output.missingKeywords,
        screenedAt: output.screenedAt,
        asOfDate: output.asOfDate,
        fetchErrors: output.fetchErrors ?? [],
        elapsedMs,
        sessionId: saved.id,
        tailEntryOutlook: output.tailEntryOutlook ?? null,
        tailEntryRun: output.tailEntryRun ?? null,
      });

      return { ...output, sessionId: saved.id };
    } finally {
      unwatch();
      await disconnectIwencaiMcp().catch(() => {});
    }
  });
}

export { emitScreenStreamEvent };

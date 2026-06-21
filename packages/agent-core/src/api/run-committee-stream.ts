import 'dotenv/config';

import type { WorkflowStreamEvent } from '@mastra/core/stream';
import { saveCommitteeSession } from '../data/screening/store.js';
import { mastra } from '../mastra/index.js';
import { disconnectIwencaiMcp } from '../mastra/mcp/iwencai.js';
import type { CommitteeWorkflowInput } from '../mastra/workflows/committee-workflow.js';
import {
  emitCommitteeStreamEvent,
  withCommitteeStreamEmitter,
} from './committee-stream-context.js';
import type { CommitteeStreamEvent } from './committee-stream-types.js';

export type { CommitteeStreamEvent } from './committee-stream-types.js';

const STEP_LABELS: Record<string, string> = {
  'parse-candidates': '整理候选池',
  'parallel-analyze': '多维度分析',
  synthesize: '综合结论',
  'quality-check': '核对报告',
};

function mapWorkflowChunk(chunk: WorkflowStreamEvent): CommitteeStreamEvent[] {
  if (chunk.type !== 'workflow-step-start') return [];

  return [
    {
      type: 'step',
      step: chunk.payload.id,
      label: STEP_LABELS[chunk.payload.id] ?? chunk.payload.id,
    },
  ];
}

export async function runCommitteeStream(
  input: CommitteeWorkflowInput,
  onEvent: (event: CommitteeStreamEvent) => void,
) {
  return withCommitteeStreamEmitter(onEvent, async () => {
    const startedAt = Date.now();
    const workflow = mastra.getWorkflow('committeeWorkflow');
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
      const saved = await saveCommitteeSession({
        screeningSessionId: output.screeningSessionId,
        candidates: output.candidates,
        memo: output.memo,
        passed: output.passed,
        completedAt: output.completedAt,
        elapsedMs,
      });

      onEvent({
        type: 'done',
        memo: output.memo,
        candidates: output.candidates,
        passed: output.passed,
        missingSections: output.missingSections,
        missingKeywords: output.missingKeywords,
        completedAt: output.completedAt,
        elapsedMs,
        sessionId: saved.id,
        screeningSessionId: output.screeningSessionId,
      });

      return { ...output, sessionId: saved.id };
    } finally {
      unwatch();
      await disconnectIwencaiMcp().catch(() => {});
    }
  });
}

export { emitCommitteeStreamEvent };

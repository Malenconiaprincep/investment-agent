import 'dotenv/config';

import { saveResearchReport } from '../data/reports/store.js';
import { mastra } from '../mastra/index.js';

export type ResearchWorkflowInput = {
  symbol?: string;
  query?: string;
};

export type ResearchWorkflowOutput = {
  report: string;
  passed: boolean;
  missingSections: string[];
  missingKeywords: string[];
  symbol: string;
  name: string;
  workflowCompletedAt: string;
  reportId?: string;
};

export async function runResearchWorkflow(
  input: ResearchWorkflowInput,
): Promise<ResearchWorkflowOutput> {
  const workflow = mastra.getWorkflow('researchWorkflow');
  const run = await workflow.createRun();
  const result = await run.start({ inputData: input });

  if (result.status !== 'success') {
    const message =
      result.status === 'failed'
        ? (result.error?.message ?? 'Workflow 执行失败')
        : `Workflow 状态: ${result.status}`;
    throw new Error(message);
  }

  const output = result.result;
  const saved = await saveResearchReport(output);

  return {
    ...output,
    reportId: saved.id,
  };
}

import 'dotenv/config';

import { mastra } from '../mastra/index.js';

type WorkflowCase = {
  id: string;
  input: { symbol?: string; query?: string };
  mustInclude: string[];
};

const workflowCases: WorkflowCase[] = [
  {
    id: 'workflow-maotai',
    input: { symbol: '600519' },
    mustInclude: ['600519', '贵州茅台', '公司概况', '数据来源', '不构成'],
  },
  {
    id: 'workflow-query',
    input: { query: '分析平安银行 000001' },
    mustInclude: ['000001', '公司概况', '行情', '风险'],
  },
];

async function main() {
  const filterId = process.argv[2];
  const cases = filterId
    ? workflowCases.filter((item) => item.id === filterId)
    : workflowCases;

  if (cases.length === 0) {
    console.error(`No workflow case found for id: ${filterId}`);
    process.exit(1);
  }

  const workflow = mastra.getWorkflow('researchWorkflow');
  let failed = 0;

  console.log(`Running ${cases.length} workflow case(s)...\n`);

  for (const testCase of cases) {
    process.stdout.write(`• ${testCase.id} ... `);
    const run = await workflow.createRun();
    const result = await run.start({ inputData: testCase.input });

    if (result.status !== 'success') {
      console.log('FAIL (workflow error)');
      failed += 1;
      continue;
    }

    const report = result.result.report ?? '';
    const missing = testCase.mustInclude.filter(
      (keyword) => !report.toLowerCase().includes(keyword.toLowerCase()),
    );

    const passed = missing.length === 0 && result.result.passed;
    console.log(passed ? 'PASS' : 'FAIL');

    if (!passed) {
      failed += 1;
      if (missing.length > 0) {
        console.log(`  missing: ${missing.join(', ')}`);
      }
      if (!result.result.passed) {
        console.log(
          `  quality: sections=${result.result.missingSections.join(', ') || 'ok'}`,
        );
      }
    }
  }

  console.log(`\n--- Workflow Eval ---`);
  console.log(`Failed: ${failed} / ${cases.length}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Workflow eval failed:', error);
  process.exit(1);
});

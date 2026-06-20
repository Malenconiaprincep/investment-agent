import 'dotenv/config';

import { mastra } from '../mastra/index.js';
import { evalCases, type EvalCase } from './cases.js';

type EvalResult = {
  id: string;
  passed: boolean;
  missing: string[];
  responsePreview: string;
  error?: string;
};

async function runCase(
  agent: Awaited<ReturnType<typeof mastra.getAgent>>,
  testCase: EvalCase,
): Promise<EvalResult> {
  try {
    const response = await agent.generate(testCase.input);
    const text = response.text ?? '';
    const missing = testCase.mustInclude.filter(
      (keyword) => !text.toLowerCase().includes(keyword.toLowerCase()),
    );

    return {
      id: testCase.id,
      passed: missing.length === 0,
      missing,
      responsePreview: text.slice(0, 200).replace(/\s+/g, ' '),
    };
  } catch (error) {
    return {
      id: testCase.id,
      passed: false,
      missing: testCase.mustInclude,
      responsePreview: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  const agent = await mastra.getAgent('investmentAgent');
  const filterId = process.argv[2];
  const cases = filterId
    ? evalCases.filter((testCase) => testCase.id === filterId)
    : evalCases;

  if (cases.length === 0) {
    console.error(`No eval case found for id: ${filterId}`);
    process.exit(1);
  }

  console.log(`Running ${cases.length} eval case(s)...\n`);

  const results: EvalResult[] = [];
  for (const testCase of cases) {
    process.stdout.write(`• ${testCase.id} ... `);
    const result = await runCase(agent, testCase);
    results.push(result);
    console.log(result.passed ? 'PASS' : 'FAIL');
  }

  const passed = results.filter((result) => result.passed).length;
  const failed = results.length - passed;

  console.log('\n--- Eval Report ---');
  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);

  for (const result of results.filter((item) => !item.passed)) {
    console.log(`\n[FAIL] ${result.id}`);
    if (result.error) console.log(`  error: ${result.error}`);
    if (result.missing.length > 0) {
      console.log(`  missing keywords: ${result.missing.join(', ')}`);
    }
    if (result.responsePreview) {
      console.log(`  preview: ${result.responsePreview}`);
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Eval runner failed:', error);
  process.exit(1);
});

import 'dotenv/config';

import { mastra } from '../mastra/index.js';

function parseArgs(argv: string[]) {
  const symbolArg = argv.find((arg) => /^\d{6}$/.test(arg));
  const query = argv.join(' ').trim();

  if (symbolArg) {
    return { symbol: symbolArg };
  }

  if (query) {
    return { query };
  }

  return { symbol: '600519' };
}

async function main() {
  const input = parseArgs(process.argv.slice(2));
  const workflow = mastra.getWorkflow('researchWorkflow');
  const run = await workflow.createRun();
  const startedAt = Date.now();

  console.log(
    `\n[research-workflow] 开始执行: ${input.symbol ?? input.query ?? '600519'}\n`,
  );

  const result = await run.start({ inputData: input });

  if (result.status !== 'success') {
    console.error('Workflow 失败:', result);
    process.exit(1);
  }

  const output = result.result;
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.log(output.report);
  console.log('\n--- Workflow Summary ---');
  console.log(`标的: ${output.name} (${output.symbol})`);
  console.log(`质量检查: ${output.passed ? 'PASS' : 'FAIL'}`);
  if (!output.passed) {
    if (output.missingSections.length > 0) {
      console.log(`缺少章节: ${output.missingSections.join(', ')}`);
    }
    if (output.missingKeywords.length > 0) {
      console.log(`缺少关键词: ${output.missingKeywords.join(', ')}`);
    }
  }
  console.log(`耗时: ${elapsed}s`);

  process.exit(output.passed ? 0 : 1);
}

main().catch((error) => {
  console.error('Research workflow failed:', error);
  process.exit(1);
});

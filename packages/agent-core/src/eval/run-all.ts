import 'dotenv/config';

import { isIwencaiMcpConfigured } from '../mastra/mcp/iwencai.js';
import { mastra } from '../mastra/index.js';
import { checkCommitteeQuality } from '../mastra/workflows/committee/quality.js';
import { checkSectorScreenQuality } from '../mastra/workflows/sector-screen/quality.js';
import { evalCases } from './cases.js';
import {
  computePassRate,
  saveEvalReport,
  type EvalReport,
  type EvalSuiteResult,
} from './report-store.js';

const LIVE = process.env.EVAL_LIVE === '1';

async function runAgentEval() {
  const started = Date.now();
  const agent = await mastra.getAgent('investmentAgent');
  const failures: EvalReport['failures'] = [];
  let passed = 0;

  for (const testCase of evalCases) {
    try {
      const response = await agent.generate(testCase.input);
      const text = response.text ?? '';
      const missing = testCase.mustInclude.filter(
        (keyword) => !text.toLowerCase().includes(keyword.toLowerCase()),
      );
      if (missing.length === 0) {
        passed += 1;
      } else {
        failures.push({
          suite: 'agent',
          id: testCase.id,
          detail: `missing: ${missing.join(', ')}`,
        });
      }
    } catch (error) {
      failures.push({
        suite: 'agent',
        id: testCase.id,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const suite: EvalSuiteResult = {
    name: 'agent',
    total: evalCases.length,
    passed,
    failed: evalCases.length - passed,
    elapsedMs: Date.now() - started,
  };

  return { suite, failures };
}

async function runWorkflowEval() {
  const started = Date.now();
  const failures: EvalReport['failures'] = [];
  const cases = [{ id: 'workflow-maotai', input: { symbol: '600519' } }];

  if (!LIVE) {
    return {
      suite: {
        name: 'workflow',
        total: cases.length,
        passed: 0,
        failed: 0,
        skipped: cases.length,
        elapsedMs: Date.now() - started,
      } satisfies EvalSuiteResult,
      failures,
    };
  }

  let passed = 0;
  const workflow = mastra.getWorkflow('researchWorkflow');

  for (const testCase of cases) {
    try {
      const run = await workflow.createRun();
      const result = await run.start({ inputData: testCase.input });
      if (result.status !== 'success' || !result.result.passed) {
        failures.push({
          suite: 'workflow',
          id: testCase.id,
          detail: result.status !== 'success' ? 'workflow failed' : 'quality fail',
        });
        continue;
      }
      passed += 1;
    } catch (error) {
      failures.push({
        suite: 'workflow',
        id: testCase.id,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    suite: {
      name: 'workflow',
      total: cases.length,
      passed,
      failed: cases.length - passed,
      elapsedMs: Date.now() - started,
    } satisfies EvalSuiteResult,
    failures,
  };
}

async function runScreenEval() {
  const started = Date.now();
  const failures: EvalReport['failures'] = [];
  let passed = 0;
  let total = 2;

  const sectorQuality = checkSectorScreenQuality({
    rotationSummary: '## 板块轮动逻辑\n测试\n免责声明：本内容不构成投资建议',
    sectors: [{ name: '测试', reason: 'r', dataSource: 'iwencai' }],
    candidates: [],
  });
  if (sectorQuality.passed) passed += 1;
  else {
    failures.push({
      suite: 'screen',
      id: 'sector-quality',
      detail: sectorQuality.missingSections.join(', '),
    });
  }

  const committeeQuality = checkCommitteeQuality(`
## 候选池概览
## 各维度共识
## 分歧与待核实
## 操作建议
## K线信号解读
## 免责声明
不构成投资建议`);
  if (committeeQuality.passed) passed += 1;
  else {
    failures.push({
      suite: 'screen',
      id: 'committee-quality',
      detail: committeeQuality.missingSections.join(', '),
    });
  }

  if (LIVE && isIwencaiMcpConfigured()) {
    total += 1;
    try {
      const workflow = mastra.getWorkflow('sectorScreenWorkflow');
      const run = await workflow.createRun();
      const result = await run.start({ inputData: { maxCandidates: 5 } });
      const ok =
        result.status === 'success' &&
        (result.result.sectors.length > 0 ||
          result.result.candidates.length > 0);
      if (ok) passed += 1;
      else {
        failures.push({
          suite: 'screen',
          id: 'sector-live',
          detail: 'empty sectors and candidates',
        });
      }
    } catch (error) {
      failures.push({
        suite: 'screen',
        id: 'sector-live',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    suite: {
      name: 'screen',
      total,
      passed,
      failed: total - passed,
      elapsedMs: Date.now() - started,
    } satisfies EvalSuiteResult,
    failures,
  };
}

async function main() {
  const started = Date.now();
  const failures: EvalReport['failures'] = [];
  const suites: EvalSuiteResult[] = [];

  const agent = await runAgentEval();
  suites.push(agent.suite);
  failures.push(...agent.failures);

  const workflow = await runWorkflowEval();
  suites.push(workflow.suite);
  failures.push(...workflow.failures);

  const screen = await runScreenEval();
  suites.push(screen.suite);
  failures.push(...screen.failures);

  const report: EvalReport = {
    ranAt: new Date().toISOString(),
    elapsedMs: Date.now() - started,
    passRate: computePassRate(suites),
    suites,
    failures,
  };

  saveEvalReport(report);
  process.stdout.write(JSON.stringify(report));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

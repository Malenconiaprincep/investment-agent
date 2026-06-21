import 'dotenv/config';

import { isIwencaiMcpConfigured } from '../mastra/mcp/iwencai.js';
import { mastra } from '../mastra/index.js';
import { checkCommitteeQuality } from '../mastra/workflows/committee/quality.js';
import { checkSectorScreenQuality } from '../mastra/workflows/sector-screen/quality.js';

async function main() {
  let failed = 0;

  console.log('--- Screen / Committee Eval ---\n');

  const sectorQuality = checkSectorScreenQuality({
    rotationSummary: '## 板块轮动逻辑\n测试\n免责声明：本内容不构成投资建议',
    sectors: [{ name: '测试板块', reason: 'r', dataSource: 'iwencai' }],
    candidates: [],
  });
  console.log(`• sector quality rules ... ${sectorQuality.passed ? 'PASS' : 'FAIL'}`);
  if (!sectorQuality.passed) failed += 1;

  const committeeQuality = checkCommitteeQuality(`
## 候选池概览
## 各维度共识
## 分歧与待核实
## 操作建议
## K线信号解读
## 免责声明
不构成投资建议
`);
  console.log(
    `• committee quality rules ... ${committeeQuality.passed ? 'PASS' : 'FAIL'}`,
  );
  if (!committeeQuality.passed) failed += 1;

  if (isIwencaiMcpConfigured()) {
    console.log('\n问财已配置，跳过 live workflow（避免 API 消耗）');
  } else {
    console.log('\n问财未配置，跳过 sectorScreenWorkflow live 测试');
  }

  const checks = [
    'sectorRotationAgent',
    'committeeSupervisor',
    'newsAgent',
  ] as const;

  for (const key of checks) {
    try {
      await mastra.getAgent(key);
      console.log(`• agent registered: ${key} ... PASS`);
    } catch {
      console.log(`• agent registered: ${key} ... FAIL`);
      failed += 1;
    }
  }

  console.log(`\nFailed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

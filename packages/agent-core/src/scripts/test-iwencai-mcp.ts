import 'dotenv/config';

import {
  disconnectIwencaiMcp,
  IWENCAI_CORE_TOOLS,
  IWENCAI_SCREEN_TOOLS,
  isIwencaiMcpConfigured,
  loadIwencaiCoreTools,
  loadIwencaiScreenTools,
} from '../mastra/mcp/iwencai.js';

async function main() {
  if (!isIwencaiMcpConfigured()) {
    console.error('请在 .env 中设置 IWENCAI_API_KEY');
    process.exit(1);
  }

  const tools = await loadIwencaiCoreTools();
  const screenTools = await loadIwencaiScreenTools();

  console.log('核心工具:');
  for (const name of IWENCAI_CORE_TOOLS) {
    const key = `iwencai_${name}`;
    console.log(`  ${key}: ${key in tools ? 'OK' : 'MISSING'}`);
  }

  console.log('\n选股工具:');
  for (const name of IWENCAI_SCREEN_TOOLS) {
    const key = `iwencai_${name}`;
    console.log(`  ${key}: ${key in screenTools ? 'OK' : 'MISSING'}`);
  }

  await disconnectIwencaiMcp();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import 'dotenv/config';

import {
  disconnectIwencaiMcp,
  IWENCAI_CORE_TOOLS,
  isIwencaiMcpConfigured,
  loadIwencaiCoreTools,
} from '../mastra/mcp/iwencai.js';

async function main() {
  if (!isIwencaiMcpConfigured()) {
    console.error('请在 .env 中设置 IWENCAI_API_KEY');
    process.exit(1);
  }

  const tools = await loadIwencaiCoreTools();

  console.log('核心工具:');
  for (const name of IWENCAI_CORE_TOOLS) {
    const key = `iwencai_${name}`;
    console.log(`  ${key}: ${key in tools ? 'OK' : 'MISSING'}`);
  }

  await disconnectIwencaiMcp();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

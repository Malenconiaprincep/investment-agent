import 'dotenv/config';

import { mastra } from '../mastra/index.js';

const DEFAULT_PROMPT = '请查询贵州茅台（600519）的模拟行情，并给出简短研究摘要。';

async function main() {
  const prompt = process.argv.slice(2).join(' ').trim() || DEFAULT_PROMPT;
  const agent = await mastra.getAgent('investmentAgent');

  console.log(`\n> ${prompt}\n`);

  const stream = await agent.stream(prompt);

  for await (const chunk of stream.textStream) {
    process.stdout.write(chunk);
  }

  console.log('\n');
}

main().catch((error) => {
  console.error('Chat failed:', error);
  process.exit(1);
});

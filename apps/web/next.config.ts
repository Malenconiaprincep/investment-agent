import type { NextConfig } from 'next';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../..');
const agentCoreRoot = path.join(repoRoot, 'packages/agent-core');

const nextConfig: NextConfig = {
  outputFileTracingRoot: repoRoot,
  outputFileTracingIncludes: {
    '/api/**': [
      '../../packages/agent-core/src/**/*',
      '../../packages/agent-core/package.json',
      '../../packages/agent-core/node_modules/**/*',
    ],
  },
  env: {
    AGENT_CORE_ROOT: agentCoreRoot,
  },
};

export default nextConfig;

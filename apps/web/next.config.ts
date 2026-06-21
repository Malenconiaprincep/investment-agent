import type { NextConfig } from 'next';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../..');

const nextConfig: NextConfig = {
  outputFileTracingRoot: repoRoot,
  // Vercel serverless 需显式打入 agent-core 源码与 tsx 运行时
  outputFileTracingIncludes: {
    '/api/**': [
      '../../packages/agent-core/src/**/*',
      '../../packages/agent-core/package.json',
      '../../apps/web/node_modules/tsx/**/*',
      '../../packages/agent-core/node_modules/tsx/**/*',
      '../../node_modules/tsx/**/*',
      '../../node_modules/.pnpm/tsx@*/node_modules/tsx/**/*',
    ],
  },
  serverExternalPackages: ['tsx'],
};

export default nextConfig;

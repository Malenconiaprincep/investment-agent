import type { NextConfig } from 'next';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../..');

const nextConfig: NextConfig = {
  outputFileTracingRoot: repoRoot,
  // agent-core 源码；tsx/esbuild 由 scripts/patch-api-trace.mjs 补进 trace（pnpm symlink 无法被 glob 收录）
  outputFileTracingIncludes: {
    '/api/**': [
      'packages/agent-core/src/**/*',
      'packages/agent-core/package.json',
      'packages/agent-core/.env.example',
    ],
  },
  serverExternalPackages: ['tsx', 'esbuild'],
};

export default nextConfig;

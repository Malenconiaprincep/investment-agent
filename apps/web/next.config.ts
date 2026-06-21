import type { NextConfig } from 'next';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../..');

const nextConfig: NextConfig = {
  outputFileTracingRoot: repoRoot,
  // Vercel serverless 需显式打入 agent-core 源码、tsx 及其 esbuild 依赖
  outputFileTracingIncludes: {
    '/api/**': [
      '../../packages/agent-core/src/**/*',
      '../../packages/agent-core/package.json',
      '../../packages/agent-core/node_modules/**/*',
      '../../apps/web/node_modules/tsx/**/*',
      '../../apps/web/node_modules/esbuild/**/*',
      '../../packages/agent-core/node_modules/tsx/**/*',
      '../../node_modules/tsx/**/*',
      '../../node_modules/esbuild/**/*',
      '../../node_modules/.pnpm/tsx@*/node_modules/tsx/**/*',
      '../../node_modules/.pnpm/tsx@*/node_modules/esbuild/**/*',
      '../../node_modules/.pnpm/esbuild@*/node_modules/esbuild/**/*',
      '../../apps/web/node_modules/@esbuild/linux-x64/**/*',
      '../../node_modules/@esbuild/linux-x64/**/*',
      '../../node_modules/.pnpm/esbuild@*/node_modules/@esbuild/linux-x64/**/*',
      '../../node_modules/.pnpm/@esbuild+linux-x64@*/node_modules/@esbuild/linux-x64/**/*',
    ],
  },
  serverExternalPackages: ['tsx', 'esbuild'],
};

export default nextConfig;

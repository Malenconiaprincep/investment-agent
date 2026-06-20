import type { NextConfig } from 'next';
import path from 'node:path';

const agentCoreEnv = path.resolve(__dirname, '../../packages/agent-core/.env');

const nextConfig: NextConfig = {
  env: {
    AGENT_CORE_ENV_PATH: agentCoreEnv,
  },
};

export default nextConfig;

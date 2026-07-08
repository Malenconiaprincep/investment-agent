import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export type AgentCoreEnvSource = {
  path: string;
  loaded: boolean;
  explicit: boolean;
};

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

export const AGENT_CORE_ENV_LOCAL_PATH = path.join(packageRoot, '.env.local');
export const AGENT_CORE_ENV_PATH = path.join(packageRoot, '.env');

function getExplicitEnvPath(): string | null {
  return (
    process.env.DOTENV_CONFIG_PATH?.trim() ||
    process.env.INVESTMENT_AGENT_ENV_PATH?.trim() ||
    null
  );
}

export function resolveAgentCoreEnvReadPaths(): string[] {
  const explicit = getExplicitEnvPath();
  if (explicit) return [explicit];

  // Load base first, then local overrides. Shell env still wins over both.
  return [AGENT_CORE_ENV_PATH, AGENT_CORE_ENV_LOCAL_PATH];
}

export function resolveAgentCoreEnvWritePath(): string {
  const explicit = getExplicitEnvPath();
  if (explicit) return explicit;
  if (existsSync(AGENT_CORE_ENV_LOCAL_PATH)) return AGENT_CORE_ENV_LOCAL_PATH;
  if (existsSync(AGENT_CORE_ENV_PATH)) return AGENT_CORE_ENV_PATH;
  return AGENT_CORE_ENV_LOCAL_PATH;
}

export function loadAgentCoreEnv(): AgentCoreEnvSource[] {
  const originalEnvKeys = new Set(Object.keys(process.env));
  const explicit = Boolean(getExplicitEnvPath());
  const mergedValues: Record<string, string> = {};
  const sources: AgentCoreEnvSource[] = [];

  for (const envPath of resolveAgentCoreEnvReadPaths()) {
    const loaded = existsSync(envPath);
    sources.push({ path: envPath, loaded, explicit });
    if (!loaded) continue;
    Object.assign(mergedValues, dotenv.parse(readFileSync(envPath)));
  }

  for (const [key, value] of Object.entries(mergedValues)) {
    if (originalEnvKeys.has(key)) continue;
    process.env[key] = value;
  }

  return sources;
}

export const AGENT_CORE_ENV_SOURCES = loadAgentCoreEnv();

import { existsSync } from 'node:fs';
import path from 'node:path';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function getAgentCoreRoot(): string {
  if (process.env.AGENT_CORE_ROOT?.trim()) {
    return process.env.AGENT_CORE_ROOT.trim();
  }

  const candidates = [
    path.resolve(process.cwd(), '../../packages/agent-core'),
    path.resolve(process.cwd(), 'packages/agent-core'),
    path.resolve(process.cwd(), '../packages/agent-core'),
  ];

  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, 'package.json'))) {
      return candidate;
    }
  }

  throw new Error('未找到 agent-core 包，请检查 monorepo 部署配置');
}

export function getTsxBin(agentCoreRoot = getAgentCoreRoot()): string {
  const local = path.join(agentCoreRoot, 'node_modules/.bin/tsx');
  if (existsSync(local)) {
    return local;
  }

  const root = path.resolve(agentCoreRoot, '../../node_modules/.bin/tsx');
  if (existsSync(root)) {
    return root;
  }

  throw new Error('未找到 tsx，请在 agent-core 中安装依赖');
}

export function spawnAgentCoreScript(
  scriptName: string,
  args: string[] = [],
  options?: { env?: Record<string, string | undefined> },
): ChildProcess {
  const agentCoreRoot = getAgentCoreRoot();
  const tsxBin = getTsxBin(agentCoreRoot);
  const scriptPath = path.join(agentCoreRoot, 'src/cli', scriptName);

  return spawn(tsxBin, [scriptPath, ...args], {
    cwd: agentCoreRoot,
    env: { ...process.env, ...options?.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export async function runAgentCoreScript(
  scriptName: string,
  args: string[],
): Promise<string> {
  const agentCoreRoot = getAgentCoreRoot();
  const tsxBin = getTsxBin(agentCoreRoot);
  const scriptPath = path.join(agentCoreRoot, 'src/cli', scriptName);

  const { stdout, stderr } = await execFileAsync(tsxBin, [scriptPath, ...args], {
    cwd: agentCoreRoot,
    env: process.env,
    maxBuffer: 32 * 1024 * 1024,
  });

  if (stderr?.trim()) {
    console.warn('[agent-core]', stderr.trim());
  }

  return stdout;
}

export async function runAgentCoreJson(args: string[]): Promise<string> {
  return runAgentCoreScript('reports-json.ts', args);
}

export async function runAgentCoreScreeningsJson(
  args: string[],
): Promise<string> {
  return runAgentCoreScript('screenings-json.ts', args);
}

export async function runAgentCoreBatchResearch(
  symbols: string[],
): Promise<string> {
  return runAgentCoreScript('batch-research-json.ts', symbols);
}

export async function runAgentCoreFeedback(args: string[]): Promise<string> {
  return runAgentCoreScript('feedback-json.ts', args);
}

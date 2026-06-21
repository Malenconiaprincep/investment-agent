import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function getAgentCoreRoot() {
  return path.resolve(process.cwd(), '../../packages/agent-core');
}

export async function runAgentCoreScript(
  scriptName: string,
  args: string[],
): Promise<string> {
  const agentCoreRoot = getAgentCoreRoot();
  const tsxBin = path.join(agentCoreRoot, 'node_modules/.bin/tsx');
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

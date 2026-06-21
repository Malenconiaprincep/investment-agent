import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

type TsxRunner = {
  bin: string;
  argsPrefix: string[];
};

function firstExistingDir(dirs: string[]): string | null {
  for (const dir of dirs) {
    if (existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
  }
  return null;
}

export function getAgentCoreRoot(): string {
  if (process.env.AGENT_CORE_ROOT?.trim()) {
    return process.env.AGENT_CORE_ROOT.trim();
  }

  const cwd = process.cwd();
  const fromWebLib = path.resolve(moduleDir, '../../../packages/agent-core');

  const root =
    firstExistingDir([
      fromWebLib,
      path.resolve(cwd, '../../packages/agent-core'),
      path.resolve(cwd, 'packages/agent-core'),
      path.resolve(cwd, '../packages/agent-core'),
    ]) ?? null;

  if (root) {
    return root;
  }

  throw new Error('未找到 agent-core 包，请检查 monorepo 部署配置');
}

function resolveTsxCli(searchRoots: string[]): string | null {
  for (const root of searchRoots) {
    if (!existsSync(path.join(root, 'package.json'))) continue;
    try {
      const req = createRequire(path.join(root, 'package.json'));
      const pkgPath = req.resolve('tsx/package.json');
      const cli = path.join(path.dirname(pkgPath), 'dist/cli.mjs');
      if (existsSync(cli)) {
        return cli;
      }
    } catch {
      // try next root
    }
  }
  return null;
}

export function getTsxRunner(agentCoreRoot = getAgentCoreRoot()): TsxRunner {
  const webRoot = path.resolve(moduleDir, '..');
  const repoRoot = path.resolve(moduleDir, '../../..');

  const binCandidates = [
    path.join(agentCoreRoot, 'node_modules/.bin/tsx'),
    path.join(webRoot, 'node_modules/.bin/tsx'),
    path.resolve(agentCoreRoot, '../../node_modules/.bin/tsx'),
    path.join(repoRoot, 'node_modules/.bin/tsx'),
  ];

  for (const bin of binCandidates) {
    if (existsSync(bin)) {
      return { bin, argsPrefix: [] };
    }
  }

  const cli = resolveTsxCli([agentCoreRoot, webRoot, repoRoot]);
  if (cli) {
    return { bin: process.execPath, argsPrefix: [cli] };
  }

  throw new Error(
    '未找到 tsx。请在仓库根目录执行 pnpm install，或设置 AGENT_CORE_ROOT 指向已安装依赖的 agent-core 目录。',
  );
}

export function spawnAgentCoreScript(
  scriptName: string,
  args: string[] = [],
  options?: { env?: Record<string, string | undefined> },
): ChildProcess {
  const agentCoreRoot = getAgentCoreRoot();
  const { bin, argsPrefix } = getTsxRunner(agentCoreRoot);
  const scriptPath = path.join(agentCoreRoot, 'src/cli', scriptName);

  return spawn(bin, [...argsPrefix, scriptPath, ...args], {
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
  const { bin, argsPrefix } = getTsxRunner(agentCoreRoot);
  const scriptPath = path.join(agentCoreRoot, 'src/cli', scriptName);

  const { stdout, stderr } = await execFileAsync(
    bin,
    [...argsPrefix, scriptPath, ...args],
    {
      cwd: agentCoreRoot,
      env: process.env,
      maxBuffer: 32 * 1024 * 1024,
    },
  );

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

export async function runAgentCoreWatchlistJson(args: string[]): Promise<string> {
  return runAgentCoreScript('watchlist-json.ts', args);
}

export async function runAgentCorePaperJson(args: string[]): Promise<string> {
  return runAgentCoreScript('paper-json.ts', args);
}

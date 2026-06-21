import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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

const AGENT_CORE_PKG = '@investment-agent/agent-core';
const WEB_PKG = '@investment-agent/web';

function readPackageName(dir: string): string | null {
  const pkgPath = path.join(dir, 'package.json');
  if (!existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { name?: string };
    return pkg.name ?? null;
  } catch {
    return null;
  }
}

/** 向上查找满足条件的目录 */
function findUp(startDirs: string[], match: (dir: string) => boolean): string | null {
  for (const start of startDirs) {
    if (!start) continue;
    let dir = path.resolve(start);
    for (let i = 0; i < 12; i++) {
      if (match(dir)) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

function findRepoRoot(): string | null {
  return findUp([process.cwd(), moduleDir], (dir) =>
    existsSync(path.join(dir, 'pnpm-workspace.yaml')),
  );
}

function findPackageRoot(packageName: string, extraStarts: string[] = []): string | null {
  const repo = findRepoRoot();
  const starts = [
    ...extraStarts,
    process.cwd(),
    moduleDir,
    repo ? path.join(repo, 'apps/web') : '',
    repo ? path.join(repo, 'packages/agent-core') : '',
    repo ?? '',
  ].filter(Boolean);

  return findUp(starts, (dir) => readPackageName(dir) === packageName);
}

const AGENT_CORE_MARKER = 'src/cli/paper-json.ts';

function isAgentCoreRoot(dir: string): boolean {
  return existsSync(path.join(dir, AGENT_CORE_MARKER));
}

function resolveAgentCorePath(candidate: string): string | null {
  const resolved = path.isAbsolute(candidate)
    ? candidate
    : path.resolve(process.cwd(), candidate);
  return isAgentCoreRoot(resolved) ? resolved : null;
}

export function getAgentCoreRoot(): string {
  const envRoot = process.env.AGENT_CORE_ROOT?.trim();
  if (envRoot) {
    const fromEnv = resolveAgentCorePath(envRoot);
    if (fromEnv) return fromEnv;
  }

  const repo = findRepoRoot();
  if (repo) {
    const fromRepo = path.join(repo, 'packages/agent-core');
    if (isAgentCoreRoot(fromRepo)) return fromRepo;
  }

  const cwd = process.cwd();
  const explicitCandidates = [
    cwd,
    path.join(cwd, 'packages/agent-core'),
    path.join(cwd, '../packages/agent-core'),
    path.join(cwd, '../../packages/agent-core'),
    path.join(cwd, '../../../packages/agent-core'),
    path.resolve(moduleDir, '../../../packages/agent-core'),
    path.resolve(moduleDir, '../../../../packages/agent-core'),
  ];

  for (const candidate of explicitCandidates) {
    if (isAgentCoreRoot(candidate)) return candidate;
  }

  const byMarker = findUp([cwd, moduleDir, ...explicitCandidates], isAgentCoreRoot);
  if (byMarker) return byMarker;

  const pkgRoot = findPackageRoot(AGENT_CORE_PKG);
  if (pkgRoot && isAgentCoreRoot(pkgRoot)) return pkgRoot;

  throw new Error('未找到 agent-core 包，请检查 monorepo 部署配置');
}

function getWebRoot(): string {
  const pkgRoot = findPackageRoot(WEB_PKG, [path.resolve(moduleDir, '..')]);
  if (pkgRoot) return pkgRoot;

  const repo = findRepoRoot();
  if (repo) {
    const fromRepo = path.join(repo, 'apps/web');
    if (existsSync(path.join(fromRepo, 'package.json'))) {
      return fromRepo;
    }
  }

  return path.resolve(moduleDir, '..');
}

/** 在 pnpm / npm 布局中定位 tsx CLI（Vercel 上不依赖 .bin shell 脚本） */
function findTsxCliFile(searchRoots: string[]): string | null {
  for (const root of searchRoots) {
    if (!root || !existsSync(root)) continue;

    try {
      const req = createRequire(path.join(root, 'package.json'));
      const pkgPath = req.resolve('tsx/package.json');
      const cli = path.join(path.dirname(pkgPath), 'dist/cli.mjs');
      if (existsSync(cli)) return cli;
    } catch {
      // try filesystem fallbacks
    }

    const direct = path.join(root, 'node_modules/tsx/dist/cli.mjs');
    if (existsSync(direct)) return direct;

    const pnpmStore = path.join(root, 'node_modules/.pnpm');
    if (existsSync(pnpmStore)) {
      try {
        for (const entry of readdirSync(pnpmStore)) {
          if (!entry.startsWith('tsx@')) continue;
          const cli = path.join(pnpmStore, entry, 'node_modules/tsx/dist/cli.mjs');
          if (existsSync(cli)) return cli;
        }
      } catch {
        // ignore
      }
    }
  }

  const repo = findRepoRoot();
  if (repo) {
    return findTsxCliFile([repo, path.join(repo, 'apps/web'), path.join(repo, 'packages/agent-core')]);
  }

  return null;
}

export function getTsxRunner(agentCoreRoot = getAgentCoreRoot()): TsxRunner {
  const webRoot = getWebRoot();
  const repo = findRepoRoot();

  const cli = findTsxCliFile([
    webRoot,
    agentCoreRoot,
    repo ?? '',
    process.cwd(),
  ]);

  if (cli) {
    return { bin: process.execPath, argsPrefix: [cli] };
  }

  throw new Error(
    '未找到 tsx。请在 apps/web 安装 tsx 依赖并重新部署，或检查 Vercel outputFileTracingIncludes。',
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

/**
 * 本地模拟 Vercel Serverless 运行时：只复制 .nft.json trace 里的文件，
 * 再执行与 Vercel 相同的 tsx 子进程命令。可复现「打包漏依赖」类错误。
 *
 * 用法（在 apps/web 目录）:
 *   pnpm build
 *   node scripts/simulate-vercel-api.mjs watchlist list
 *   node scripts/simulate-vercel-api.mjs watchlist stock-chart 000001 120
 *
 * 注意: 在 macOS 上 esbuild 会找 @esbuild/darwin-*，而 trace 里是 linux-x64，
 * 若报 esbuild 平台包错误，用 Docker 跑 Linux 更接近 Vercel:
 *   docker run --rm -v "$PWD/../..:/repo" -w /repo/apps/web node:24-bookworm \
 *     bash -lc "pnpm build && node scripts/simulate-vercel-api.mjs watchlist list"
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(__dirname, '..');
const repoRoot = resolve(webRoot, '../..');

const routeName = process.argv[2] ?? 'watchlist';
const cliArgs = process.argv.slice(3);
const scriptMap = {
  watchlist: 'watchlist-json.ts',
  paper: 'paper-json.ts',
  reports: 'reports-json.ts',
};
const scriptName = scriptMap[routeName] ?? `${routeName}-json.ts`;

const routeJs = join(webRoot, '.next/server/app/api', routeName, 'route.js');
const nftPath = `${routeJs}.nft.json`;

if (!existsSync(nftPath)) {
  console.error(`找不到 ${nftPath}，请先运行: pnpm build`);
  process.exit(1);
}

const nft = JSON.parse(readFileSync(nftPath, 'utf8'));
const simRoot = mkdtempSync(join(tmpdir(), 'vercel-sim-'));
const routeDeployDir = dirname(
  join(simRoot, relative(repoRoot, routeJs)),
);

function copyTracedFile(relPath) {
  const source = resolve(dirname(routeJs), relPath);
  const target = join(routeDeployDir, relPath);
  if (!existsSync(source)) {
    console.warn('[missing]', relPath);
    return false;
  }
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
  return true;
}

let copied = 0;
let missing = 0;
for (const relPath of nft.files ?? []) {
  if (copyTracedFile(relPath)) copied += 1;
  else missing += 1;
}

// macOS/Windows 本地调试：trace 里是 linux-x64，换成当前平台 esbuild 才能跑 tsx
if (process.platform !== 'linux') {
  try {
    const req = createRequire(join(webRoot, 'package.json'));
    const esbuildPkg = dirname(req.resolve('esbuild/package.json'));
    const platformName = `@esbuild/${process.platform}-${process.arch}`;
    let platformPkg;
    try {
      platformPkg = dirname(req.resolve(`${platformName}/package.json`));
    } catch {
      const store = join(repoRoot, 'node_modules/.pnpm');
      const entry = readdirSync(store).find((name) =>
        name.startsWith(`@esbuild+${process.platform}-${process.arch}@`),
      );
      if (!entry) throw new Error(`pnpm store 中找不到 ${platformName}`);
      platformPkg = join(store, entry, 'node_modules', platformName);
    }
    const deployRoot = join(simRoot, 'apps/web/node_modules');
    const deployEsbuild = join(deployRoot, 'esbuild');
    const deployPlatform = join(deployRoot, platformName);
    const deployLinux = join(deployRoot, '@esbuild/linux-x64');

    rmSync(deployLinux, { recursive: true, force: true });
    rmSync(deployEsbuild, { recursive: true, force: true });
    mkdirSync(deployEsbuild, { recursive: true });
    mkdirSync(deployPlatform, { recursive: true });
    cpSync(esbuildPkg, deployEsbuild, { recursive: true });
    cpSync(platformPkg, deployPlatform, { recursive: true });
    console.log(`[simulate-vercel-api] 已用 ${platformName} 替换 trace 中的 linux-x64（仅本地模拟）`);
  } catch (error) {
    console.warn('[simulate-vercel-api] 无法补本地 esbuild 平台包:', error.message);
  }
}

const agentCoreRoot = join(simRoot, 'packages/agent-core');
const tsxCli = join(simRoot, 'apps/web/node_modules/tsx/dist/cli.mjs');
const scriptPath = join(agentCoreRoot, 'src/cli', scriptName);

console.log(`[simulate-vercel-api] simRoot=${simRoot}`);
console.log(`[simulate-vercel-api] traced: ${copied} copied, ${missing} missing`);

if (!existsSync(tsxCli)) {
  console.error('trace 中缺少 tsx，说明 patch-api-trace 未生效');
  process.exit(1);
}
if (!existsSync(scriptPath)) {
  console.error(`trace 中缺少 ${scriptPath}`);
  process.exit(1);
}

try {
  const stdout = execFileSync(
    process.execPath,
    [tsxCli, scriptPath, ...cliArgs],
    {
      cwd: agentCoreRoot,
      env: {
        ...process.env,
        AGENT_CORE_ROOT: agentCoreRoot,
      },
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  console.log(stdout.toString());
  console.log('[simulate-vercel-api] OK');
} catch (error) {
  const stderr = error.stderr?.toString?.() ?? '';
  const stdout = error.stdout?.toString?.() ?? '';
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  console.error('[simulate-vercel-api] FAILED (与 Vercel 类似的运行时错误)');
  process.exit(error.status ?? 1);
} finally {
  rmSync(simRoot, { recursive: true, force: true });
}

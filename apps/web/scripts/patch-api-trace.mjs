/**
 * Vercel serverless 依赖 @vercel/nft 做 file tracing。
 * pnpm 的 symlink 布局会导致 tsx/esbuild/@esbuild/linux-x64 以及 agent-core
 * 的 node_modules 无法被 outputFileTracingIncludes 正确收录。
 * 构建后手动把这些运行时文件补进 API route 的 .nft.json。
 */
import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(__dirname, '..');
const repoRoot = resolve(webRoot, '../..');
const nextServer = join(webRoot, '.next/server');
const req = createRequire(join(webRoot, 'package.json'));

const WEB_RUNTIME_PACKAGES = ['tsx', 'esbuild', '@esbuild/linux-x64'];

function walkFiles(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, files);
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function collectPackageFiles(packageName) {
  const linkPath = join(webRoot, 'node_modules', packageName);
  if (!existsSync(linkPath)) {
    throw new Error(`apps/web 缺少依赖 ${packageName}`);
  }

  const pkgDir = statSync(linkPath).isDirectory()
    ? realpathSync(linkPath)
    : realpathSync(dirname(linkPath));

  return walkFiles(pkgDir).map((absPath) => {
    const relInPkg = relative(pkgDir, absPath);
    return join(linkPath, relInPkg);
  });
}

function collectAgentCoreNodeModules() {
  const modulesRoot = join(repoRoot, 'packages/agent-core/node_modules');
  if (!existsSync(modulesRoot)) return [];

  const files = [];
  for (const entry of readdirSync(modulesRoot, { withFileTypes: true })) {
    const entryPath = join(modulesRoot, entry.name);
    if (!existsSync(entryPath)) continue;

    try {
      const resolved = realpathSync(entryPath);
      const stat = statSync(resolved);
      if (stat.isDirectory()) {
        for (const absPath of walkFiles(resolved)) {
          files.push(join(entryPath, relative(resolved, absPath)));
        }
      } else if (stat.isFile()) {
        files.push(entryPath);
      }
    } catch {
      // ignore broken symlinks
    }
  }
  return files;
}

function findApiNftFiles(dir, results = []) {
  if (!existsSync(dir)) return results;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      findApiNftFiles(fullPath, results);
    } else if (entry.name.endsWith('.nft.json') && fullPath.includes(`${join('app', 'api')}${sep}`)) {
      results.push(fullPath);
    }
  }
  return results;
}

function patchNftFiles() {
  const runtimeFiles = [
    ...WEB_RUNTIME_PACKAGES.flatMap(collectPackageFiles),
    ...collectAgentCoreNodeModules(),
  ];

  const nftFiles = findApiNftFiles(join(nextServer, 'app'));
  if (nftFiles.length === 0) {
    console.warn('[patch-api-trace] 未找到 API route trace 文件，跳过');
    return;
  }

  for (const nftPath of nftFiles) {
    const routeJs = nftPath.replace(/\.nft\.json$/, '');
    const nft = JSON.parse(readFileSync(nftPath, 'utf8'));
    const existing = new Set(nft.files ?? []);

    for (const absPath of runtimeFiles) {
      const relPath = relative(dirname(routeJs), absPath);
      if (!existing.has(relPath)) {
        nft.files.push(relPath);
        existing.add(relPath);
      }
    }

    writeFileSync(nftPath, JSON.stringify(nft));
  }

  console.log(
    `[patch-api-trace] 已为 ${nftFiles.length} 个 API route 补充 ${runtimeFiles.length} 个运行时文件`,
  );
}

patchNftFiles();

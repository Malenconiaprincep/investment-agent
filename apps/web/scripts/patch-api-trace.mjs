/**
 * Vercel serverless 依赖 @vercel/nft 做 file tracing。
 * pnpm 使用 symlink + 作用域目录，Next 默认 trace 无法收录 tsx/esbuild
 * 以及 agent-core 的完整 node_modules（含 @libsql/client 等 symlink 包及其 pnpm 同级依赖）。
 */
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(__dirname, '..');
const repoRoot = resolve(webRoot, '../..');
const nextServer = join(webRoot, '.next/server');
const agentCoreNodeModules = join(repoRoot, 'packages/agent-core/node_modules');

const WEB_RUNTIME_PACKAGES = ['tsx', 'esbuild', '@esbuild/linux-x64'];

/** statSync 会跟随 symlink，可正确进入 pnpm 链接的包目录 */
function walkFiles(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const fullPath = join(dir, name);
    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walkFiles(fullPath, files);
      } else if (stat.isFile()) {
        files.push(fullPath);
      }
    } catch {
      // ignore unreadable paths
    }
  }
  return files;
}

/** 将 sourcePath 下的文件映射为部署路径 deployPath 下的相对路径 */
function mapPackageFiles(deployPath, sourcePath) {
  if (!existsSync(sourcePath)) return [];

  let realRoot;
  try {
    realRoot = realpathSync(sourcePath);
  } catch {
    return [];
  }

  if (!statSync(realRoot).isDirectory()) return [];

  return walkFiles(realRoot).map((absPath) =>
    join(deployPath, relative(realRoot, absPath)),
  );
}

function findPnpmVirtualNodeModules(realPkgPath) {
  let dir = dirname(realPkgPath);
  while (dir !== dirname(dir)) {
    if (dir.endsWith(`${sep}node_modules`) && dir.includes(`${sep}.pnpm${sep}`)) {
      return dir;
    }
    dir = dirname(dir);
  }
  return null;
}

function collectLinkedPackageClosureWithSource(
  deployLinkPath,
  seenDeployPaths,
  files,
  sourcePath = deployLinkPath,
) {
  if (seenDeployPaths.has(deployLinkPath)) return;
  seenDeployPaths.add(deployLinkPath);

  for (const filePath of mapPackageFiles(deployLinkPath, sourcePath)) {
    files.push(filePath);
  }

  let realPath;
  try {
    realPath = realpathSync(sourcePath);
  } catch {
    return;
  }

  const virtualNodeModules = findPnpmVirtualNodeModules(realPath);
  if (!virtualNodeModules) return;

  for (const entry of readdirSync(virtualNodeModules)) {
    if (entry === '.bin') continue;

    const virtualEntry = join(virtualNodeModules, entry);
    if (!statSync(virtualEntry).isDirectory()) continue;

    if (entry.startsWith('@')) {
      for (const pkg of readdirSync(virtualEntry)) {
        collectLinkedPackageClosureWithSource(
          join(agentCoreNodeModules, entry, pkg),
          seenDeployPaths,
          files,
          join(virtualEntry, pkg),
        );
      }
      continue;
    }

    collectLinkedPackageClosureWithSource(
      join(agentCoreNodeModules, entry),
      seenDeployPaths,
      files,
      virtualEntry,
    );
  }
}

function collectWebPackageFiles(packageName) {
  const linkPath = join(webRoot, 'node_modules', packageName);
  if (!existsSync(linkPath)) {
    throw new Error(`apps/web 缺少依赖 ${packageName}`);
  }
  return mapPackageFiles(linkPath, linkPath);
}

function collectAgentCoreNodeModules() {
  if (!existsSync(agentCoreNodeModules)) return [];

  const files = [];
  const seenDeployPaths = new Set();

  function visit(parentDir, name) {
    if (name === '.bin') return;

    const deployPath = join(parentDir, name);
    if (!existsSync(deployPath)) return;

    let lst;
    try {
      lst = lstatSync(deployPath);
    } catch {
      return;
    }

    if (lst.isDirectory() && !lst.isSymbolicLink() && name.startsWith('@')) {
      for (const pkg of readdirSync(deployPath)) {
        visit(deployPath, pkg);
      }
      return;
    }

    collectLinkedPackageClosureWithSource(deployPath, seenDeployPaths, files);
  }

  for (const entry of readdirSync(agentCoreNodeModules)) {
    visit(agentCoreNodeModules, entry);
  }

  return files;
}

function findApiNftFiles(dir, results = []) {
  if (!existsSync(dir)) return results;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      findApiNftFiles(fullPath, results);
    } else if (
      entry.name.endsWith('.nft.json') &&
      fullPath.includes(`${join('app', 'api')}${sep}`)
    ) {
      results.push(fullPath);
    }
  }
  return results;
}

function patchNftFiles() {
  const runtimeFiles = [
    ...WEB_RUNTIME_PACKAGES.flatMap(collectWebPackageFiles),
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

  const libsqlFiles = runtimeFiles.filter((file) => file.includes('@libsql'));
  console.log(
    `[patch-api-trace] 已为 ${nftFiles.length} 个 API route 补充 ${runtimeFiles.length} 个运行时文件（@libsql: ${libsqlFiles.length}）`,
  );
}

patchNftFiles();

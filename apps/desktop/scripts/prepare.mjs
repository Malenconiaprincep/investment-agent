import { execSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(desktopRoot, '../..');
const packRoot = path.join(desktopRoot, '.pack');
const webPack = path.join(packRoot, 'web');
const agentPack = path.join(packRoot, 'agent-core');

function run(command, options = {}) {
  console.log(`\n> ${command}`);
  execSync(command, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
    ...options,
  });
}

function copyDir(from, to, options = {}) {
  const skipGit = options.skipGit ?? false;
  mkdirSync(path.dirname(to), { recursive: true });
  cpSync(from, to, {
    recursive: true,
    ...(skipGit
      ? {
          filter: (src) =>
            !src.split(path.sep).includes('.git') &&
            !src.endsWith(`${path.sep}.git`),
        }
      : {}),
  });
}

/** pnpm deploy 会保留指回 monorepo 的 workspace 符号链接，打进 .app 后路径失效。 */
function pruneMonorepoSymlinks(deployDir) {
  const nodeModules = path.join(deployDir, 'node_modules');
  if (!existsSync(nodeModules)) return;

  const removed = [];

  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        const target = readlinkSync(fullPath);
        if (target.includes('packages/') || target.includes('apps/')) {
          rmSync(fullPath, { recursive: true, force: true });
          removed.push(path.relative(deployDir, fullPath));
        }
        continue;
      }
      if (entry.isDirectory()) {
        walk(fullPath);
      }
    }
  }

  walk(nodeModules);

  if (removed.length > 0) {
    console.log('清理 monorepo workspace 符号链接:');
    for (const rel of removed) {
      console.log(`  - ${rel}`);
    }
  }
}

console.log('=== 桌面版打包准备 ===');

rmSync(packRoot, { recursive: true, force: true });
mkdirSync(packRoot, { recursive: true });

console.log('\n[1/5] 构建 Next.js（standalone）…');
run('pnpm --filter @investment-agent/web build');

function resolveStandaloneLayout() {
  const candidates = [
    {
      standaloneRoot: path.join(repoRoot, 'apps/web/.next/standalone'),
      standaloneApp: path.join(
        repoRoot,
        'apps/web/.next/standalone/apps/web',
      ),
    },
    {
      standaloneRoot: path.join(
        repoRoot,
        'apps/web/.next/standalone/workspace/investment-agent',
      ),
      standaloneApp: path.join(
        repoRoot,
        'apps/web/.next/standalone/workspace/investment-agent/apps/web',
      ),
    },
  ];

  for (const layout of candidates) {
    if (existsSync(path.join(layout.standaloneApp, 'server.js'))) {
      return layout;
    }
  }

  throw new Error('未找到 Next.js standalone 产物，请确认 apps/web/next.config.ts 已启用 output: "standalone"');
}

const { standaloneRoot, standaloneApp } = resolveStandaloneLayout();
const staticDir = path.join(repoRoot, 'apps/web/.next/static');
const publicDir = path.join(repoRoot, 'apps/web/public');

console.log('\n[2/5] 组装 Web 运行目录…');
copyDir(standaloneRoot, webPack);
copyDir(staticDir, path.join(webPack, 'apps/web/.next/static'));
if (existsSync(publicDir)) {
  copyDir(publicDir, path.join(webPack, 'apps/web/public'));
}

// 记录启动入口，供 Electron 主进程读取
writeFileSync(
  path.join(webPack, 'manifest.json'),
  JSON.stringify(
    {
      serverEntry: 'apps/web/server.js',
      cwd: '.',
    },
    null,
    2,
  ),
);

console.log('\n[3/5] 部署 agent-core…');
run(
  `pnpm --filter @investment-agent/agent-core deploy --legacy "${agentPack}"`,
);

const vendorSrc = path.join(repoRoot, 'packages/agent-core/vendor');
if (existsSync(vendorSrc)) {
  console.log('复制问财 MCP vendor…');
  copyDir(vendorSrc, path.join(agentPack, 'vendor'), { skipGit: true });
}

pruneMonorepoSymlinks(agentPack);

const mastraDir = path.join(agentPack, '.mastra');
if (existsSync(mastraDir)) {
  console.log('移除不需要的 .mastra 构建产物…');
  rmSync(mastraDir, { recursive: true, force: true });
}

console.log('\n[4/4] 生成管理员默认 Token…');
const adminTokenKeys = [
  'DEEPSEEK_API_KEY',
  'IWENCAI_API_KEY',
  'IWENCAI_BASE_URL',
  'LIBSQL_URL',
  'LIBSQL_AUTH_TOKEN',
  'AGENT_CORE_TOKEN',
];
const agentEnvPath = path.join(repoRoot, 'packages/agent-core/.env');
const adminDefaultsPath = path.join(desktopRoot, 'templates/admin-defaults.env');

if (existsSync(agentEnvPath)) {
  const parsed = dotenv.parse(readFileSync(agentEnvPath));
  const lines = ['# adminwb 账号预置 Token（打包时从 agent-core/.env 生成）', ''];
  for (const key of adminTokenKeys) {
    if (parsed[key]?.trim()) {
      lines.push(`${key}=${parsed[key].trim()}`);
    }
  }
  writeFileSync(adminDefaultsPath, `${lines.join('\n').trim()}\n`, 'utf-8');
  console.log(`已写入 ${adminDefaultsPath}`);
} else {
  console.warn('未找到 packages/agent-core/.env，跳过 adminwb 默认 Token 生成');
}

console.log('\n[5/5] 完成');
console.log(`Web:        ${webPack}`);
console.log(`Agent-core: ${agentPack}`);

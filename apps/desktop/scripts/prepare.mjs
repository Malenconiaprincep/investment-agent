import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

function copyDir(from, to) {
  mkdirSync(path.dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
}

console.log('=== 桌面版打包准备 ===');

rmSync(packRoot, { recursive: true, force: true });
mkdirSync(packRoot, { recursive: true });

console.log('\n[1/4] 构建 Next.js（standalone）…');
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

console.log('\n[2/4] 组装 Web 运行目录…');
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

console.log('\n[3/4] 部署 agent-core…');
run(
  `pnpm --filter @investment-agent/agent-core deploy --legacy "${agentPack}"`,
);

const vendorSrc = path.join(repoRoot, 'packages/agent-core/vendor');
if (existsSync(vendorSrc)) {
  console.log('复制问财 MCP vendor…');
  copyDir(vendorSrc, path.join(agentPack, 'vendor'));
}

console.log('\n[4/4] 完成');
console.log(`Web:        ${webPack}`);
console.log(`Agent-core: ${agentPack}`);

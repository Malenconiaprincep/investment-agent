import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_NAME = '@investment-agent/agent-core';

/** 向上查找 agent-core 包根目录，兼容 mastra dev / tsx / build 等不同 cwd */
function resolvePackageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));

  for (let i = 0; i < 12; i++) {
    const pkgPath = path.join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
          name?: string;
        };
        if (pkg.name === PACKAGE_NAME) {
          return dir;
        }
      } catch {
        // ignore invalid package.json
      }
    }

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return process.cwd();
}

const packageRoot = resolvePackageRoot();
export const DATA_DIR = path.join(packageRoot, 'src/data');

if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const packageFiles = [
  'package.json',
  'apps/desktop/package.json',
  'apps/site/package.json',
  'apps/web/package.json',
  'packages/agent-core/package.json',
];

const envExampleFile = 'apps/site/.env.example';

export function normalizeReleaseVersion(input) {
  const raw = String(input ?? '').trim();
  if (!raw) {
    throw new Error('缺少版本号，例如：v0.1.1-beta.1');
  }

  const version = raw.startsWith('v') ? raw.slice(1) : raw;
  const semverPattern =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

  if (!semverPattern.test(version)) {
    throw new Error(`版本号必须是 semver 格式，例如 v0.1.1-beta.1；收到：${raw}`);
  }

  return {
    version,
    tagName: `v${version}`,
  };
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(repoRoot, relativePath), 'utf-8'));
}

function writeJson(relativePath, data) {
  writeFileSync(
    path.join(repoRoot, relativePath),
    `${JSON.stringify(data, null, 2)}\n`,
    'utf-8',
  );
}

function updateEnvExample(version) {
  const filePath = path.join(repoRoot, envExampleFile);
  const current = readFileSync(filePath, 'utf-8');
  const pattern = /^NEXT_PUBLIC_APP_VERSION=.*$/m;

  if (!pattern.test(current)) {
    throw new Error(`${envExampleFile} 缺少 NEXT_PUBLIC_APP_VERSION`);
  }

  const next = current.replace(pattern, `NEXT_PUBLIC_APP_VERSION=${version}`);
  if (next !== current) {
    writeFileSync(filePath, next, 'utf-8');
  }
}

export function setReleaseVersion(inputVersion, options = {}) {
  const { version, tagName } = normalizeReleaseVersion(inputVersion);
  const dryRun = options.dryRun ?? false;

  const changed = [];
  for (const relativePath of packageFiles) {
    const pkg = readJson(relativePath);
    if (pkg.version !== version) {
      changed.push(relativePath);
    }
    pkg.version = version;
    if (!dryRun) {
      writeJson(relativePath, pkg);
    }
  }

  const envExample = readFileSync(path.join(repoRoot, envExampleFile), 'utf-8');
  const envVersionPattern = new RegExp(
    `^NEXT_PUBLIC_APP_VERSION=${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
    'm',
  );
  if (!envVersionPattern.test(envExample)) {
    changed.push(envExampleFile);
  }
  if (!dryRun) {
    updateEnvExample(version);
  }

  return {
    version,
    tagName,
    files: [...packageFiles, envExampleFile],
    changed,
  };
}

function printUsage() {
  console.log(`用法：
  node scripts/set-release-version.mjs <version> [--check] [--dry-run]

示例：
  node scripts/set-release-version.mjs v0.1.1-beta.1
  node scripts/set-release-version.mjs 0.1.1 --check`);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }

  const versionArg = args.find((arg) => !arg.startsWith('-'));
  const dryRun = args.includes('--dry-run') || args.includes('--check');
  const checkOnly = args.includes('--check');
  const result = setReleaseVersion(versionArg, { dryRun });

  if (checkOnly && result.changed.length > 0) {
    console.error(
      `版本号未同步到 ${result.version}：\n${result.changed
        .map((file) => `  - ${file}`)
        .join('\n')}`,
    );
    process.exit(1);
  }

  const action = checkOnly ? '校验' : dryRun ? '预览' : '已同步';
  console.log(`${action}桌面版发布版本：${result.tagName}`);
  for (const file of result.files) {
    console.log(`  - ${file}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

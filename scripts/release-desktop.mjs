import { execFileSync } from 'node:child_process';
import { setReleaseVersion } from './set-release-version.mjs';

function run(command, args, options = {}) {
  const printable = [command, ...args].join(' ');
  console.log(`\n> ${printable}`);
  return execFileSync(command, args, {
    encoding: 'utf-8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    ...options,
  });
}

function git(args, options = {}) {
  return run('git', args, options);
}

function pnpm(args, options = {}) {
  return run('pnpm', args, options);
}

function printUsage() {
  console.log(`用法：
  pnpm release:desktop <version> [选项]

示例：
  pnpm release:desktop v0.1.1-beta.1
  pnpm release:desktop 0.1.1 --skip-build

选项：
  --skip-build     跳过本地官网构建检查
  --no-commit      只同步版本号，不提交、不打 tag、不推送
  --no-push        提交并打 tag，但不推送到 GitHub
  --allow-dirty    允许在已有未提交改动的工作区运行
  --dry-run        只预览版本号与将更新的文件`);
}

function isGitClean() {
  const status = git(['status', '--porcelain'], { capture: true });
  return status.trim().length === 0;
}

function tagExists(tagName) {
  try {
    git(['rev-parse', '--verify', '--quiet', `refs/tags/${tagName}`], {
      capture: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }

  const versionArg = args.find((arg) => !arg.startsWith('-'));
  const skipBuild = args.includes('--skip-build');
  const noCommit = args.includes('--no-commit');
  const noPush = args.includes('--no-push');
  const allowDirty = args.includes('--allow-dirty');
  const dryRun = args.includes('--dry-run');

  if (!versionArg) {
    printUsage();
    process.exit(1);
  }

  if (!allowDirty && !dryRun && !noCommit && !isGitClean()) {
    console.error('工作区有未提交改动。请先提交/暂存，或确认后加 --allow-dirty。');
    process.exit(1);
  }

  const result = setReleaseVersion(versionArg, { dryRun });
  console.log(`\n桌面版发布版本：${result.tagName}`);

  if (dryRun) {
    console.log('dry-run：未写入文件、未提交、未推送。');
    return;
  }

  if (tagExists(result.tagName)) {
    console.error(`本地 tag 已存在：${result.tagName}`);
    process.exit(1);
  }

  if (!skipBuild) {
    pnpm(['site:build']);
  }

  if (noCommit) {
    console.log('\n已同步版本号；按 --no-commit 要求跳过提交、tag 与推送。');
    return;
  }

  git(['add', ...result.files]);
  git(['commit', '-m', `chore: release desktop ${result.tagName}`]);
  git(['tag', '-a', result.tagName, '-m', `投研助手 ${result.tagName}`]);

  if (noPush) {
    console.log(`\n已创建本地提交和 tag：${result.tagName}`);
    console.log(`需要发布时运行：git push origin HEAD && git push origin ${result.tagName}`);
    return;
  }

  git(['push', 'origin', 'HEAD']);
  git(['push', 'origin', result.tagName]);

  console.log(`\n已推送 ${result.tagName}。GitHub Actions 会自动打包、创建 Release 并上传安装包。`);
}

main();

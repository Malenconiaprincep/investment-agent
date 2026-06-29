# 桌面版发布（GitHub Releases）

源码与安装包均在同一公开仓库发布，官网 `/download` 自动读取最新 Release。

## 首次配置

在 GitHub 仓库 **Settings → Secrets and variables → Actions** 添加：

| Secret | 说明 |
|--------|------|
| `DEEPSEEK_API_KEY` | 打包时写入管理员默认 Token；不配置则用占位 Key（用户需自行在设置页填写） |
| `SITE_DEPLOY_HOOK_URL` | 官网部署 hook。Vercel 可在项目 **Settings → Git → Deploy Hooks** 创建；也可以填自建服务器的发布 webhook |

## 发布新版本

### 方式一：本地一条命令（推荐）

```bash
pnpm release:desktop v0.1.1-beta.1
```

这条命令会：

1. 同步 `package.json`、`apps/desktop/package.json` 等工作区版本号
2. 更新官网示例环境变量 `NEXT_PUBLIC_APP_VERSION`
3. 本地构建官网做发布前检查
4. 提交版本号变更并创建 `v*` tag
5. 推送分支与 tag 到 GitHub

推送 `v*` tag 后，[Release Desktop](../.github/workflows/release-desktop.yml) 会自动：

1. macOS：构建 unsigned dmg / zip  
2. Windows：构建 x64 安装包 + x64 便携版  
3. 创建 GitHub Release 并上传安装包  
4. 调用 `SITE_DEPLOY_HOOK_URL` 触发官网部署，让下载页尽快刷新

常用选项：

```bash
pnpm release:desktop v0.1.1-beta.1 --skip-build # 跳过本地官网构建检查
pnpm release:desktop v0.1.1-beta.1 --no-push    # 只在本地提交并打 tag
pnpm release:desktop v0.1.1-beta.1 --no-commit  # 只同步版本号
```

### 方式二：只打 tag

```bash
git tag v0.1.1-beta.1
git push origin v0.1.1-beta.1
```

CI 会根据 tag 临时同步桌面包版本，因此安装包文件名仍会带 `0.1.1-beta.1`。不过建议使用方式一，这样仓库里的版本号也会同步更新。

### 方式三：手动触发

GitHub → **Actions** → **Release Desktop** → **Run workflow**，填写 tag（如 `v0.1.0-beta`）。

## 本地打包（自测）

```bash
pnpm desktop:pack:mac:unsigned   # macOS
pnpm desktop:pack:win:x64        # Windows x64
pnpm desktop:pack:win:portable   # Windows 便携版
```

产物在 `apps/desktop/release/`。

## Beta 测试包安装提示

当前本地与 CI 产出的 macOS 包为 unsigned 测试包，适合内部自测或小范围试用。正式对外分发前建议使用 Apple Developer ID 签名并完成 notarization。

### macOS

优先分发 dmg：

```text
apps/desktop/release/投研助手-*-arm64.dmg
```

不要直接分发 `apps/desktop/release/mac-arm64/投研助手.app` 文件夹，也不要手动压缩 `.app` 文件夹，否则容易丢失隐藏目录或符号链接。

测试用户遇到安全拦截时：

1. 如果提示「无法验证开发者」，进入「系统设置」→「隐私与安全性」，点击「仍要打开」。
2. 如果提示「文件已损坏」，先将 App 拖入「应用程序」，再执行：

```bash
sudo xattr -dr com.apple.quarantine "/Applications/投研助手.app"
```

### Windows

优先分发安装包：

```text
apps/desktop/release/投研助手-Setup-*-x64.exe
```

Windows unsigned 测试包可能触发 SmartScreen。测试用户可点击「更多信息」→「仍要运行」继续安装。若系统提示需要 64 位 Windows，说明当前系统是 32 位，需升级后安装 x64 版本；ARM 设备请使用 arm64 安装包。

## 官网下载页

部署 `apps/site` 后，下载页通过 GitHub Releases API 展示安装包。它会读取最近发布的 Release 列表，因此 beta / prerelease 也能展示。环境变量：

```env
NEXT_PUBLIC_GITHUB_REPO=https://github.com/Malenconiaprincep/investment-agent
```

下载页会每 5 分钟重新校验一次 Release 数据；发布工作流成功上传安装包后，也会通过 `SITE_DEPLOY_HOOK_URL` 主动触发官网部署。

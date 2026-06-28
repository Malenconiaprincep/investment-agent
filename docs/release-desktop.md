# 桌面版发布（GitHub Releases）

源码与安装包均在同一公开仓库发布，官网 `/download` 自动读取最新 Release。

## 首次配置（可选）

在 GitHub 仓库 **Settings → Secrets and variables → Actions** 添加：

| Secret | 说明 |
|--------|------|
| `DEEPSEEK_API_KEY` | 打包时写入管理员默认 Token；不配置则用占位 Key（用户需自行在设置页填写） |

## 发布新版本

### 方式一：打 tag（推荐）

```bash
git tag v0.1.0-beta
git push origin v0.1.0-beta
```

推送 `v*` tag 后，[Release Desktop](../.github/workflows/release-desktop.yml) 会自动：

1. macOS：构建 unsigned dmg / zip  
2. Windows：构建 x64 安装包 + x64 便携版  
3. 创建 GitHub Release 并上传安装包  

### 方式二：手动触发

GitHub → **Actions** → **Release Desktop** → **Run workflow**，填写 tag（如 `v0.1.0-beta`）。

## 本地打包（自测）

```bash
pnpm desktop:pack:mac:unsigned   # macOS
pnpm desktop:pack:win:x64        # Windows x64
pnpm desktop:pack:win:portable   # Windows 便携版
```

产物在 `apps/desktop/release/`。

## 官网下载页

部署 `apps/site` 后，下载页通过 GitHub Releases API 展示安装包。环境变量：

```env
NEXT_PUBLIC_GITHUB_REPO=https://github.com/Malenconiaprincep/investment-agent
```

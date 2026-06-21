# Web UI

Next.js 投研界面，面向 toC 用户。

## 本地开发

```bash
pnpm install
# 配置 packages/agent-core/.env（含 DEEPSEEK_API_KEY）
pnpm web:dev
```

打开 [http://localhost:3000](http://localhost:3000)

## 部署到 Vercel

1. 将仓库导入 [Vercel](https://vercel.com/new)
2. **Root Directory** 设为 `apps/web`（会使用同目录下的 `vercel.json`）
3. 构建命令默认：`cd ../.. && pnpm --filter @investment-agent/web build`（无需 `setup:iwencai`）
4. 在 Vercel 项目 **Environment Variables** 中配置（参考 `.env.example`）：
   - `DEEPSEEK_API_KEY`（必填）
   - `LIBSQL_URL` + `LIBSQL_AUTH_TOKEN`（推荐，Turso 持久化数据）
   - `IWENCAI_API_KEY`（选股功能，见下方限制）
4. 部署完成后访问分配的域名

### Vercel 限制说明

| 功能 | Vercel 上 |
|------|-----------|
| 单股研报 | 可用（需 Pro 计划以支持较长 `maxDuration`） |
| 研报/选股历史 | 需配置 Turso（`LIBSQL_URL`），否则数据仅在单次实例 `/tmp` 中临时保存 |
| 智能选股 | 问财 MCP 依赖 Python 子进程，**标准 Node Serverless 上可能不可用** |
| 笔记 RAG | 需预先 ingest 并上传向量库到 Turso |

CLI 一键部署（需已 `vercel login`）：

```bash
cd apps/web
vercel --prod
```

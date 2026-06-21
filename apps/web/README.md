# Web UI

Next.js 投研界面。业务逻辑在 **agent-core HTTP 服务**，Web 只做 UI 与 API 代理。

## 本地开发

```bash
pnpm install

# 1. 配置 packages/agent-core/.env（DEEPSEEK_API_KEY 等）
# 2. 配置 apps/web/.env.local：
#    AGENT_CORE_URL=http://127.0.0.1:4000
#    AGENT_CORE_TOKEN=（可选，与 agent-core 一致）

# 终端 A：启动 agent-core
pnpm agent:serve

# 终端 B：启动 Web
pnpm web:dev
```

打开 [http://localhost:3000](http://localhost:3000)

## 部署架构

| 组件 | 部署位置 | 说明 |
|------|----------|------|
| `apps/web` | **Vercel** | 纯 Next.js，体积小，无 Mastra / tsx |
| `packages/agent-core` | **Railway / VPS / Docker** | HTTP 服务，见 `packages/agent-core` README |

### Vercel 环境变量

参考 `.env.example`：

- `AGENT_CORE_URL`（必填）— agent-core 服务公网地址
- `AGENT_CORE_TOKEN`（推荐）— 与后端一致的 Bearer Token

Cron 仍由 Vercel 触发 `/api/cron/*`，Web 再转发到 agent-core。

## 一键部署 Web（Vercel CLI）

```bash
cd apps/web
vercel --prod
```

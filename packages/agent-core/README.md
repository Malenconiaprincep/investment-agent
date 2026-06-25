# agent-core

投研 Agent 后端：Mastra 工作流、行情、Turso 持久化、问财 MCP。

## HTTP 服务（Web 调用）

```bash
pnpm install
cp .env.example .env   # 填写 DEEPSEEK_API_KEY 等
pnpm serve             # 默认 http://127.0.0.1:4000
```

### 主要接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| POST | `/cli/:module` | JSON 命令，`body: { args: string[] }`，module 见下表 |
| POST | `/stream/research` | SSE 单股/主题研报 |
| POST | `/stream/screen` | SSE 智能选股 |
| POST | `/stream/committee` | SSE 投委会 |

CLI 模块名：`watchlist` · `paper` · `reports` · `screenings` · `feedback` · `batch-research`

若设置 `AGENT_CORE_TOKEN`，请求须带 `Authorization: Bearer <token>`。

## 本机定时任务

模拟盘与其它日更任务在本机用 `crontab` 触发（见仓库根目录 `scripts/crontab.example`）：

```bash
pnpm paper:etf-schedule    # ETF 仓（交易时段监听；agent:serve 默认每 30 分钟）
pnpm paper:stock-schedule  # 股票仓，建议 15:05
pnpm watchlist:snapshot
pnpm monitor:poll
```

## 部署到 Railway / VPS（可选）

1. Root Directory：`packages/agent-core`
2. Start Command：`pnpm serve`（或 `tsx src/server/index.ts`）
3. 环境变量：`.env.example` 中全部（含 `DEEPSEEK_API_KEY`、`LIBSQL_*`）
4. 生成 `AGENT_CORE_TOKEN`，写入 Web 的 `AGENT_CORE_URL` + `AGENT_CORE_TOKEN`

问财 MCP 需要 Python 与 `IWENCAI_MCP_SERVER_PATH`，在独立服务器上可完整运行。

## 本地 CLI（开发调试）

原有 `tsx src/cli/*.ts` 仍可用，与 HTTP 共用同一套 handlers。

```bash
pnpm --filter @investment-agent/agent-core watchlist:snapshot
```

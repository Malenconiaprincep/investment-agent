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

## 本机定时任务（模拟盘）

全程在本机跑，不依赖 Vercel Cron。先保证 `pnpm agent:serve` 在跑（或 crontab 里直接调 CLI）。

| 时间（北京时间） | 任务 | 说明 |
|------------------|------|------|
| **14:00** 工作日 | ETF 尾盘推荐 | 19 只池 8 条规则 |
| **14:30** 工作日 | `pnpm paper:etf-schedule` | ETF 动量调仓（下午盘内成交） |
| **15:05** 工作日 | `pnpm paper:stock-schedule` | 股票动量选股（收盘后） |

**推荐**：保持 `pnpm agent:serve` 常驻，会自动跑以上三项（可用 `DAILY_TASKS_BACKGROUND_ENABLED=0` 关闭）。

若不用常驻服务，用 `crontab -e`（见 `scripts/crontab.example`，把路径改成你的项目目录，系统时区 Asia/Shanghai）：

```cron
0 14 * * 1-5 cd /Users/user/workspace/investment-agent && pnpm etf:tail-schedule >> /tmp/etf-tail.log 2>&1
30 14 * * 1-5 cd /Users/user/workspace/investment-agent && pnpm paper:etf-schedule >> /tmp/paper-etf.log 2>&1
5 15 * * 1-5 cd /Users/user/workspace/investment-agent && pnpm paper:stock-schedule >> /tmp/paper-stock.log 2>&1
```

手动立即试跑：

```bash
pnpm etf:tail-schedule
pnpm --filter @investment-agent/agent-core exec tsx src/cli/paper-json.ts etf-auto-run --force
pnpm --filter @investment-agent/agent-core exec tsx src/cli/paper-json.ts stock-auto-run --force
```

日志：`packages/agent-core` 数据目录下的 `scheduled-paper.log`。

## 可选：部署 Web

若只需本机使用，忽略本节即可。

| 组件 | 说明 |
|------|------|
| `apps/web` | Next.js 前端 |
| `packages/agent-core` | HTTP 服务，见 `packages/agent-core` README |

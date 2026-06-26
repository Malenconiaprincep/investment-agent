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

## 飞书机器人推送

支持两种方式（**App 优先**；都配了时走 App）：

### 方式 A：企业自建应用（推荐）

1. [open.feishu.cn](https://open.feishu.cn) 创建企业自建应用
2. 开通权限：`im:message:send_as_bot`、`im:chat:readonly`
3. 发布应用，把机器人拉进目标群
4. `.env` 配置：

```bash
FEISHU_APP_ID=cli_xxxxxxxx
FEISHU_APP_SECRET=xxxxxxxx
FEISHU_CHAT_ID=oc_xxxxxxxx   # pnpm feishu:chats 查询
```

### 方式 B：群自定义机器人 Webhook

```bash
FEISHU_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxxxx
FEISHU_WEBHOOK_SECRET=          # 可选
```

### 通用

```bash
FEISHU_NOTIFY_ENABLED=0              # 关闭全部飞书推送
FEISHU_NOTIFY_STOCK_INTRADAY=0         # 关闭交易时段股票动量扫描推送
FEISHU_NOTIFY_MONITOR=0              # 关闭消息雷达实时推送
FEISHU_NOTIFY_ETF_MONITOR=1          # ETF 每次监听都推（默认仅有成交/止损才推）
STOCK_INTRADAY_MONITOR_INTERVAL_MINUTES=15   # 股票扫描间隔（交易时段，默认 15 分钟）
MONITOR_BACKGROUND_INTERVAL_MS=300000        # 消息雷达间隔（默认 5 分钟）
```

`agent:serve` 定时任务会自动推送：

| 时段 | 内容 |
|------|------|
| 交易时段每 15 分钟 | **股票实时信号**（自选/选股池 · 红钻+动量达标） |
| 交易时段每 5 分钟 | **消息雷达**（新闻催化、自动买入候选、模拟盘成交） |
| 14:00 | ETF 尾盘推荐 |
| 15:05 | 股票模拟盘收盘后选股 |

同一标的**每天只推一次**，避免刷屏。

```bash
pnpm feishu:status
pnpm feishu:auth-test    # 仅 App 模式：验证 App ID/Secret
pnpm feishu:chats        # 仅 App 模式：列出机器人所在群及 chat_id
pnpm feishu:test
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

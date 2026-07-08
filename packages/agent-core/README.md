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
pnpm wiki:daily            # 生成 docs/wiki/daily/YYYY-MM-DD 日报
```

`agent:serve` 内置的交易日 17:20 任务会自动运行“工作总结与 Wiki 日报”，把短保留期任务日志、行情更新日志、工作总结、changeset 和回测摘要固化到 `docs/wiki/daily/`。

## A 股日线更新

日常收盘后优先逐只补齐本地已有股票池的前复权日线 CSV，不需要每天下载全量压缩包：

```bash
pnpm stock:update-daily
pnpm stock:update-daily --max=50 --retry-rounds=3
```

定时任务 `stock-daily-csv-update` 默认在交易日 17:00 执行同一套增量更新逻辑。股票默认每只间隔 333ms，约 1 秒 3 个请求。单只股票请求失败会按 `DAILY_CSV_UPDATE_RETRIES` 立即重试；整批结束后，失败标的会按 `STOCK_DAILY_CSV_RETRY_ROUNDS` 再跑多轮。可用 `STOCK_DAILY_CSV_DELAY_MS` 和 `STOCK_DAILY_CSV_RETRY_ROUND_DELAY_MS` 控制节奏。

可选接入 Infoway：配置 `INFOWAY_API_KEY` 后，`STOCK_DAILY_CSV_PROVIDER=auto` 会优先使用 Infoway Candles + 前复权因子接口；不配置时继续走腾讯接口。也可显式设为 `infoway` 或 `tencent`。

## 百度网盘 A 股数据同步（兜底）

先用百度网盘客户端或 BaiduPCS-Go 把分享目录下载到本机，再让项目导入下载目录中的：

- `daily_qfq.zip`
- `股票列表.csv` -> `data/market-csv/meta/stock-list-listed.csv`
- `退市股票列表.csv` -> `data/market-csv/meta/stock-list-delisted.csv`
- `交易日历.csv` -> `data/market-csv/meta/trading-calendar.csv`（可选）

```bash
pnpm market-data:sync --source /Users/wangbo/BaiduNetdiskDownload/A股数据_zip --dry-run
pnpm market-data:sync --source /Users/wangbo/BaiduNetdiskDownload/A股数据_zip
```

脚本会递归查找文件、解压 `daily_qfq.zip`、校验至少 5000 个股票日线 CSV，并比较源数据与当前 `data/market-csv/stock/qfq-daily` 的最新交易日。只有源数据日期更新时才替换；替换前会保留 `.backup-YYYYMMDD-HHMMSS` 备份。需要重导同一天数据时可手动加 `--force`。

## 飞书机器人推送

支持两种方式（**App 优先**；都配了时走 App）：

### 方式 A：企业自建应用（推荐）

1. [open.feishu.cn](https://open.feishu.cn) 创建企业自建应用
2. 开通权限：`im:message:send_as_bot`、`im:chat:readonly`
3. 发布应用，把机器人拉进目标群
4. `packages/agent-core/.env.local` 配置（本地优先读取；`.env` 仍作为兜底）：

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
FEISHU_NOTIFY_ETF_MONITOR=0          # 关闭 ETF 模拟盘成交通知（默认有成交/止损才推）
FEISHU_NOTIFY_ETF_TAIL_PICK=1        # 恢复 ETF 尾盘推荐推送（默认关闭，仅保留历史记录）
FEISHU_NOTIFY_PREOPEN_SCREEN=0       # 关闭交易日 08:30 盘前智能选股通知
STOCK_INTRADAY_MONITOR_INTERVAL_MINUTES=15   # 股票扫描间隔（交易时段，默认 15 分钟）
MONITOR_BACKGROUND_INTERVAL_MS=300000        # 消息雷达间隔（默认 5 分钟）
```

`agent:serve` 定时任务会自动推送：

| 时段 | 内容 |
|------|------|
| 09:25 / 11:35 / 12:50 / 14:35 | **智能选股**（早盘、午间、午后开盘前、尾盘前复核；Top 股票/ETF 自动进入跟踪池） |
| 交易时段每 15 分钟 | **股票实时信号**（自选/选股池 · 红钻+动量达标） |
| 交易时段每 5 分钟 | **消息雷达**（默认仅推模拟盘买入成交） |
| 14:45 | ETF 尾盘推荐（默认只保存历史，不推飞书） |
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
pnpm --filter @investment-agent/agent-core wiki:daily -- --dry-run --stdout
```

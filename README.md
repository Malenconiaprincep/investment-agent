# Investment Agent

A 股投研 Agent —— 基于 [Mastra](https://mastra.ai/) 构建的投资研究助手，帮助你系统化地进行个股初研、财报解读与信息整理。

> **免责声明**：本项目仅供学习与研究，不构成投资建议。详见 [docs/disclaimer.md](docs/disclaimer.md)。

## 当前进度：Phase 4

- [x] pnpm monorepo 骨架
- [x] Mastra 投研 Agent（`investmentAgent`）
- [x] Tool 基建：`safeFetch` / `retryWithBackoff` / `zodValidate`
- [x] Working Memory 关注列表（最多 5 只）
- [x] 迷你 RAG：3 篇投研笔记 + 语义检索
- [x] Eval case + `pnpm eval`
- [x] A 股真实数据（6 个投研 Tool，东方财富 + 腾讯）
- [x] **五步 Research Workflow**（`pnpm research`）
- [x] **Next.js 投研 UI**（`pnpm web:dev`）

## 快速开始

### 1. 环境要求

- Node.js >= 22.13.0
- pnpm

### 2. 安装依赖

```bash
pnpm install
```

### 3. 配置环境变量

```bash
cp packages/agent-core/.env.example packages/agent-core/.env
```

编辑 `packages/agent-core/.env`：

```env
AI_MODEL=deepseek/deepseek-v4-flash
DEEPSEEK_API_KEY=sk-xxxxxxxx
```

- AI 模型与 API Key：在「Token 设置」中选择模型并配置对应提供商 Key（国内：DeepSeek、通义千问、Kimi、智谱 GLM、MiniMax；海外：OpenAI、Anthropic 等）
- DeepSeek API Key：[DeepSeek 开放平台](https://platform.deepseek.com/api_keys)
- A 股行情/财务数据：东方财富 + 腾讯公开接口，**无需额外 API Key**

默认模型为 `deepseek/deepseek-v4-flash`。如需切换：

```env
AI_MODEL=deepseek/deepseek-chat
# 或 openai/gpt-4o、anthropic/claude-sonnet-4-20250514 等
```

### 4. 入库投研笔记（RAG）

```bash
pnpm ingest
```

首次运行会下载本地 embedding 模型，可能需要几分钟。

### 5. 本地启动服务

本项目当前按本地自用设计：先启动 `agent-core` HTTP 服务，再启动 Next.js Web UI。最简单方式：

```bash
pnpm dev:all
```

也可以拆开两个终端运行：

```bash
pnpm agent:serve
pnpm web:dev
```

打开 [http://localhost:3000](http://localhost:3000)，使用以下账号登录（需先在 Supabase 执行 `supabase/migrations/` 迁移，或运行 `node scripts/seed-market-users.mjs`）：

| 账号 | 密码 | Token |
|------|------|-------|
| `adminwb` | `Wb@Invest2026!xK9` | 管理员；API Key / 飞书等在设置页自行配置 |
| `test` | `test123456` | 需登录后在「设置」自行配置 Token |

也可在 `/register` 自助注册新账号（默认 Free 权限）。

登录后可在 **Token 设置**（`/settings`）查看或修改 API Key。每个账号的 Token 独立保存在本地数据目录。

Web 侧通过 `apps/web/.env.local` 里的 `AGENT_CORE_URL` 连接本地 `agent-core`，默认地址为 `http://127.0.0.1:4000`。

### 6. Agent 调试入口

**方式一：Mastra Studio（可视化调试）**

```bash
pnpm dev
```

打开 [http://localhost:4111](http://localhost:4111)，选择 `investmentAgent` 进行对话。

**方式二：终端流式对话**

```bash
pnpm chat
# 或带自定义问题
pnpm chat 分析贵州茅台 600519
```

### 7. 运行五步投研 Workflow（Phase 3）

```bash
pnpm research 600519
pnpm research 分析平安银行 000001

pnpm eval:workflow
```

### 8. Web UI（Phase 4）

```bash
pnpm web:dev
```

打开 [http://localhost:3000](http://localhost:3000)，登录后输入股票代码（如 `600519`）生成结构化研报。

### 9. 运行 Eval 与单元测试

```bash
pnpm test
pnpm eval
pnpm eval market-research-report   # Phase 2 验收
```

## 桌面版发布

一条命令同步版本号、打 tag、推送并触发 GitHub Releases 自动打包：

```bash
pnpm release:desktop v0.1.1-beta.1
```

完整发布与官网下载页自动更新说明见 [docs/release-desktop.md](docs/release-desktop.md)。

## 产品演进日志

每次功能、策略、参数、评测或运行机制发生变化，都应新增一条 changeset：

```text
docs/changesets/YYYY-MM-DD-short-title.md
```

changeset 记录改动背景、影响范围、预期指标、验证结果、观察指标和回滚方案。每周复盘时，把 changeset 的预期和「工作总结」历史快照对照，判断系统是变好、变差还是需要继续观察。格式说明见 [docs/changesets/README.md](docs/changesets/README.md)。

## 本地桌面应用

桌面版（Electron）打包命令：

```bash
pnpm desktop:pack:mac:unsigned   # macOS 无签名包
pnpm desktop:pack:win            # Windows（x64 + arm64 安装包 + x64 便携版）
pnpm desktop:pack:win:x64        # 仅 64 位 Intel/AMD（常见台式机、笔记本）
pnpm desktop:pack:win:arm64      # 仅 ARM（骁龙 / Surface Pro X 等）
```

安装包输出在 `apps/desktop/release/`：

| 文件 | 适用系统 |
|------|----------|
| `投研助手-Setup-*-x64.exe` | **64 位** Windows（Intel / AMD，最常见） |
| `投研助手-Setup-*-arm64.exe` | **ARM 版** Windows（骁龙笔记本、Surface Pro X 等） |
| `投研助手-Portable-*-x64.exe` | 64 位 Windows 免安装便携版（`pnpm desktop:pack:win:portable`） |

若安装时提示「**需要 64 位 Windows 系统**」，说明当前系统是 **32 位 Windows**，本应用基于 Electron 35，**不支持 32 位系统**，需升级到 64 位 Windows 后再安装 `x64` 版本。若是 ARM 设备，请改用 `arm64` 安装包。

启动后需先登录，账号与 Web 版相同：

| 账号 | 密码 | 说明 |
|------|------|------|
| `adminwb` | `Wb@Invest2026!xK9` | 管理员；API Key / 飞书等在设置页自行配置 |
| `test` | `test123456` | 测试账号，需自行配置全部 Token |

- 桌面版 Token 按账号保存在 `~/Library/Application Support/投研助手/data/users/{账号}/.env`（Windows 为 `%APPDATA%/投研助手/data/users/{账号}/.env`）
- 打包时仅内置问财 API 默认地址 `IWENCAI_BASE_URL` 与 AI 模型列表（代码）；**不**内置任何 API Key / 飞书密钥
- 认证逻辑见 `apps/web/lib/local-auth.ts`、`apps/web/lib/users.ts`

## 项目结构

```text
investment-agent/
├── apps/web/                   # Next.js 投研 UI
│   └── app/api/research/       # Workflow API
├── packages/agent-core/        # Mastra Agent 核心
│   └── src/mastra/
│       ├── agents/             # Agent 定义
│       ├── tools/              # Tool 定义
│       │   └── market/         # 行情/财务 Tools
│       ├── workflows/          # Phase 3 Workflow
│       ├── memory.ts           # Working Memory 配置
│       └── vectors.ts          # RAG 向量库
│   └── src/
│       ├── lib/                # Tool 基建
│       ├── data/
│       │   ├── notes/          # 投研笔记
│       │   └── market/         # 行情数据客户端 + 缓存
│       ├── eval/               # Eval 测试
│       ├── cli/                # chat / research CLI
│       └── scripts/            # 入库脚本
├── docs/
│   ├── architecture.md         # 架构说明
│   ├── changesets/             # 产品/策略/评测演进日志
│   ├── phase1-learning.md      # Phase 1 学习笔记
│   ├── phase2-learning.md      # Phase 2 学习笔记
│   └── disclaimer.md           # 免责声明
└── package.json
```

## 示例对话

在 Studio 或 CLI 中尝试：

- `分析贵州茅台 600519`（Phase 2 结构化研报）
- `查询宁德时代 300750 最近行情和财务指标`
- `根据笔记库，贵州茅台有哪些风险？`
- `把宁德时代 300750 加入关注列表`

## 学习路径

本项目配套 4-5 个月 Agent 开发工程师转型学习路径。

- Phase 1：[docs/phase1-learning.md](docs/phase1-learning.md)
- Phase 2：[docs/phase2-learning.md](docs/phase2-learning.md)
- Phase 3：[docs/phase3-learning.md](docs/phase3-learning.md)
- Phase 4：[docs/phase4-learning.md](docs/phase4-learning.md)

## License

MIT

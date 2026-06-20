# Investment Agent

A 股投研 Agent —— 基于 [Mastra](https://mastra.ai/) 构建的投资研究助手，帮助你系统化地进行个股初研、财报解读与信息整理。

> **免责声明**：本项目仅供学习与研究，不构成投资建议。详见 [docs/disclaimer.md](docs/disclaimer.md)。

## 当前进度：Phase 0

- [x] pnpm monorepo 骨架
- [x] Mastra 投研 Agent（`investmentAgent`）
- [x] 2 个演示 Tool：当前时间、模拟 A 股行情
- [x] 终端流式对话 CLI
- [ ] 真实 Tushare 数据（Phase 2）
- [ ] Next.js UI（Phase 4）

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

编辑 `packages/agent-core/.env`，填入 DeepSeek API Key：

```env
DEEPSEEK_API_KEY=sk-xxxxxxxx
```

API Key 申请：[DeepSeek 开放平台](https://platform.deepseek.com/api_keys)

默认模型为 `deepseek/deepseek-v4-flash`（性价比高、支持 Tool Calling）。如需切换：

```env
DEEPSEEK_MODEL=deepseek/deepseek-chat
# 或推理模型：deepseek/deepseek-reasoner
```

### 4. 启动 Agent

**方式一：Mastra Studio（可视化调试）**

```bash
pnpm dev
```

打开 [http://localhost:4111](http://localhost:4111)，选择 `investmentAgent` 进行对话。

**方式二：终端流式对话**

```bash
pnpm chat
# 或带自定义问题
pnpm chat 请分析平安银行 000001
```

## 项目结构

```text
investment-agent/
├── apps/web/                   # Web UI（Phase 4）
├── packages/agent-core/        # Mastra Agent 核心
│   └── src/mastra/
│       ├── agents/             # Agent 定义
│       └── tools/              # Tool 定义
├── docs/
│   ├── architecture.md         # 架构说明
│   └── disclaimer.md           # 免责声明
└── package.json
```

## 示例对话

在 Studio 或 CLI 中尝试：

- `请查询贵州茅台 600519 的模拟行情`
- `现在几点？请用北京时间回答`
- `对比 600519 和 300750 的行情快照`

## 学习路径

本项目配套 4-5 个月 Agent 开发工程师转型学习路径，详见 Cursor Plan 或 [docs/architecture.md](docs/architecture.md)。

## License

MIT

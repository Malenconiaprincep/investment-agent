# Investment Agent

A 股投研 Agent —— 基于 [Mastra](https://mastra.ai/) 构建的投资研究助手，帮助你系统化地进行个股初研、财报解读与信息整理。

> **免责声明**：本项目仅供学习与研究，不构成投资建议。详见 [docs/disclaimer.md](docs/disclaimer.md)。

## 当前进度：Phase 1

- [x] pnpm monorepo 骨架
- [x] Mastra 投研 Agent（`investmentAgent`）
- [x] 演示 Tool：当前时间、模拟 A 股行情
- [x] Tool 基建：`safeFetch` / `retryWithBackoff` / `zodValidate`
- [x] Working Memory 关注列表（最多 5 只）
- [x] 迷你 RAG：3 篇投研笔记 + 语义检索
- [x] 10 条 Eval case + `pnpm eval`
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

### 4. 入库投研笔记（Phase 1 RAG）

```bash
pnpm ingest
```

首次运行会下载本地 embedding 模型，可能需要几分钟。

### 5. 启动 Agent

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

### 6. 运行 Eval 测试（Phase 1）

```bash
pnpm eval
pnpm eval time-beijing   # 单条
```

## 项目结构

```text
investment-agent/
├── apps/web/                   # Web UI（Phase 4）
├── packages/agent-core/        # Mastra Agent 核心
│   └── src/mastra/
│       ├── agents/             # Agent 定义
│       ├── tools/              # Tool 定义
│       ├── memory.ts           # Working Memory 配置
│       └── vectors.ts          # RAG 向量库
│   └── src/
│       ├── lib/                # Tool 基建
│       ├── data/notes/         # 投研笔记
│       ├── eval/               # Eval 测试
│       └── scripts/            # 入库脚本
├── docs/
│   ├── architecture.md         # 架构说明
│   ├── phase1-learning.md      # Phase 1 学习笔记
│   └── disclaimer.md           # 免责声明
└── package.json
```

## 示例对话

在 Studio 或 CLI 中尝试：

- `请查询贵州茅台 600519 的模拟行情`
- `现在几点？请用北京时间回答`
- `对比 600519 和 300750 的行情快照`
- `根据笔记库，贵州茅台有哪些风险？`
- `把宁德时代 300750 加入关注列表`

## 学习路径

本项目配套 4-5 个月 Agent 开发工程师转型学习路径。Phase 1 详见 [docs/phase1-learning.md](docs/phase1-learning.md)。

## License

MIT

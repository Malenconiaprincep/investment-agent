# Investment Agent

A 股投研 Agent —— 基于 [Mastra](https://mastra.ai/) 构建的投资研究助手，帮助你系统化地进行个股初研、财报解读与信息整理。

> **免责声明**：本项目仅供学习与研究，不构成投资建议。详见 [docs/disclaimer.md](docs/disclaimer.md)。

## 当前进度：Phase 2

- [x] pnpm monorepo 骨架
- [x] Mastra 投研 Agent（`investmentAgent`）
- [x] Tool 基建：`safeFetch` / `retryWithBackoff` / `zodValidate`
- [x] Working Memory 关注列表（最多 5 只）
- [x] 迷你 RAG：3 篇投研笔记 + 语义检索
- [x] Eval case + `pnpm eval`
- [x] **A 股真实数据**（6 个投研 Tool，东方财富 + 腾讯免费接口）
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

编辑 `packages/agent-core/.env`：

```env
DEEPSEEK_API_KEY=sk-xxxxxxxx
```

- DeepSeek API Key：[DeepSeek 开放平台](https://platform.deepseek.com/api_keys)
- A 股行情/财务数据：东方财富 + 腾讯公开接口，**无需额外 API Key**

默认模型为 `deepseek/deepseek-v4-flash`。如需切换：

```env
DEEPSEEK_MODEL=deepseek/deepseek-chat
```

### 4. 入库投研笔记（RAG）

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
pnpm chat 分析贵州茅台 600519
```

### 6. 运行 Eval 测试

```bash
pnpm eval
pnpm eval market-research-report   # Phase 2 验收用例
```

## 项目结构

```text
investment-agent/
├── apps/web/                   # Web UI（Phase 4）
├── packages/agent-core/        # Mastra Agent 核心
│   └── src/mastra/
│       ├── agents/             # Agent 定义
│       ├── tools/              # Tool 定义
│       │   └── market/         # Phase 2 行情/财务 Tools
│       ├── memory.ts           # Working Memory 配置
│       └── vectors.ts          # RAG 向量库
│   └── src/
│       ├── lib/                # Tool 基建
│       ├── data/
│       │   ├── notes/          # 投研笔记
│       │   └── market/         # 行情数据客户端 + 缓存
│       ├── eval/               # Eval 测试
│       └── scripts/            # 入库脚本
├── docs/
│   ├── architecture.md         # 架构说明
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

## License

MIT

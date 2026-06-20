# Web UI

Next.js 投研界面，调用 `@investment-agent/agent-core` 的 Research Workflow。

## 启动

确保已配置 `packages/agent-core/.env`（含 `DEEPSEEK_API_KEY`）。

```bash
# 根目录
pnpm install
pnpm web:dev
```

打开 [http://localhost:3000](http://localhost:3000)，输入 6 位股票代码生成研报。

## 开发说明

- API：`POST /api/research`，body `{ "symbol": "600519" }`
- 环境变量从 `packages/agent-core/.env` 加载
- 详见 [docs/phase4-learning.md](../../docs/phase4-learning.md)

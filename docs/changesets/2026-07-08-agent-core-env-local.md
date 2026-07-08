# agent-core env.local 统一加载

- 新增 agent-core 环境加载器，默认按 `.env` -> `.env.local` 读取，本地配置优先覆盖 `.env`，显式 `DOTENV_CONFIG_PATH` / `INVESTMENT_AGENT_ENV_PATH` 仍保持最高优先级。
- 将 agent-core CLI / server / eval 入口统一切换到新加载器，避免不同命令读取不同 env 文件。
- `feishu:status` 增加 env 来源字段，方便确认当前进程读取的是哪份配置。
- Web 设置页新增 `FEISHU_NOTIFY_PREOPEN_SCREEN` 开关，支持交易日 08:30 盘前智能选股通知配置同步。

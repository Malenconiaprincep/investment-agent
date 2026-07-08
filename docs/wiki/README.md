# 投研 LLM Wiki

这里是投研 Agent 的长期知识库。它和普通开发文档的分工不同：

- `daily/`：按交易日沉淀事实，记录当天任务、数据、模拟盘、回测、Eval、changeset 和下一步动作。
- `topics/`：把多天日报与历史文档提炼成可复用方法论，例如回测口径、数据管线、策略迭代和风险复盘。
- `templates/`：给人工补写或校正文档时使用的稳定结构。
- `manifest.json`：机器可读索引，供 LLM 检索、周报/月报生成或前端页面展示。

## 生产链路

日报由 `wiki:daily` 生成，默认会：

1. 生成并保存一份工作总结快照。
2. 读取近期待保留的定时任务日志。
3. 固化当天行情数据更新日志。
4. 汇总当天 changeset、回测记录和回测文档。
5. 写入 `docs/wiki/daily/YYYY-MM-DD.md` 和 `docs/wiki/daily/YYYY-MM-DD.json`。
6. 原子更新 `docs/wiki/daily/index.md` 与 `docs/wiki/manifest.json`。

常用命令：

```bash
pnpm wiki:daily
pnpm wiki:daily -- --date=2026-07-08
pnpm wiki:daily -- --dry-run --stdout
pnpm wiki:daily -- --no-work-summary-snapshot
```

`agent:serve` 的本机定时任务会在交易日 17:20 自动运行“工作总结与 Wiki 日报”。这个时间点晚于 ETF/股票日线更新，适合把短保留期日志固化进日报。

## 写作约定

日报是事实账本，不追求文学化总结。它应该回答：

- 今天系统有没有正常跑？
- 哪些数据更新成功或失败？
- 模拟盘、风险、回测、Eval 是否出现明显变化？
- 今天有哪些 changeset 能解释未来指标变化？
- 明天最应该看什么？

专题 Wiki 是方法论，不重复流水账。它应该回答：

- 这个模块的口径是什么？
- 哪些指标可比，哪些不可比？
- 历史上踩过什么坑？
- 新策略上线前必须通过哪些验证？
- 什么时候应该回滚或降权？

## LLM 使用建议

给 LLM 做周报/月报时，优先喂：

1. `docs/wiki/manifest.json`
2. 对应日期范围内的 `docs/wiki/daily/*.json`
3. 相关专题，如 `topics/backtesting.md`
4. 对应 changeset 原文

这样能让总结从“事实 -> 归因 -> 方法论”逐层收敛，减少凭印象复盘。

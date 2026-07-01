# 2026-07-01 工作总结自我进化中心

## 元信息

- Type: feature / data / ops
- Status: shipped
- Owner: Codex
- Related: 工作总结栏目、系统评分、历史快照、定时复盘
- Created: 2026-07-01

## 背景

系统已经能生成信号、监控告警、跟踪池、自选股、模拟盘、回测、研报、选股结果和 Eval/Harness 报告，但缺少一个统一机制判断这些产出是否真的提升收益、控制风险，并指导下一轮策略优化。

用户明确希望建立闭环：

```text
信号产生 -> 监控跟踪 -> 模拟执行 -> 收益/风险统计 -> 系统评分 -> 问题复盘 -> 策略优化建议 -> 下一轮迭代
```

## 改动

- 新增「工作总结」导航栏目和页面。
- 新增 `work-summary` 聚合模块，统一读取信号、监控、跟踪池、模拟盘、回测、研报、选股、ETF 轮动和 Eval/Harness 数据。
- 新增系统评分：数据闭环、收益贡献、风险控制、策略验证、迭代复盘。
- 新增完整 8 步闭环状态展示。
- 新增策略健康度、优化队列、今日/本周/本月关注事项。
- 新增 `work_summary_runs` 历史快照存储，用于判断每次调整后系统是变好、变差还是持平。
- 新增 `/api/work-summary` 和 `/api/cron/work-summary`。
- 新增 `work-summary-json.ts` CLI，并接入 agent-core handler registry。
- 新增定时任务配置项「工作总结快照」和 crontab 示例。

## 影响范围

- 页面/功能：`/work-summary`
- API：`/api/work-summary`、`/api/cron/work-summary`
- Core：`packages/agent-core/src/data/work-summary/`
- CLI：`packages/agent-core/src/cli/work-summary-json.ts`
- 定时任务：`work-summary-snapshot`
- 数据存储：`work-summary.db`

## 预期影响

- 收益：不直接改交易策略，但让收益变化可归因、可追踪。
- 风险：通过风险分、告警数量、最差跟踪收益、仓位暴露提示风险修正优先级。
- 稳定性：通过 Eval/Harness 和历史快照避免凭单次结果频繁改策略。
- 用户体验：把每日关注、每周优化、每月取舍汇总到一个入口。
- 系统评分：后续每次改动都可以用历史快照判断是否变好。

## 验证

- 已运行：`pnpm --filter @investment-agent/web build`
- 结果：通过，包含 `/work-summary`、`/api/work-summary`、`/api/cron/work-summary`
- 已运行：`pnpm --filter @investment-agent/agent-core exec tsx src/cli/work-summary-json.ts latest`
- 结果：通过，并生成工作总结快照。
- 已运行：`pnpm --filter @investment-agent/agent-core exec tsx src/cli/work-summary-json.ts history 2`
- 结果：能读取最近两条评分历史。
- 未覆盖风险：agent-core 全量 `tsc --noEmit` 仍存在仓库既有类型错误，非本次 `work-summary` 新增错误。

## 观察指标

- 每日：未确认告警、紧急告警、模拟盘收益、持仓数量、仓位暴露。
- 每周：总分变化、风险分变化、策略健康度、正收益回测占比、Eval 通过率。
- 每月：哪些策略持续贡献收益，哪些信号误报多，哪些规则需要淘汰或加强。

## 回滚方案

- 前端可从导航移除 `/work-summary`。
- API 可停止调用 `work-summary latest/snapshot`。
- 定时任务可关闭 `work-summary-snapshot`。
- 历史快照存储独立在 `work-summary.db`，不影响现有模拟盘、回测、选股和研报数据。

## 后续动作

- 每周复盘时把 changeset 预期与工作总结历史快照对照。
- 若某次策略 changeset 后风险分连续下降或模拟盘收益恶化，应优先回滚或降权该策略。
- 后续可以在工作总结页面直接展示最近 changeset 与评分变化的关联。

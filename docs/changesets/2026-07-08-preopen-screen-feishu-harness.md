# Preopen Screen Feishu Harness

- Type: ops
- Status: shipped
- Date: 2026-07-08

## 背景与问题

每日盘前希望在 08:30 通过飞书收到今日候选池，用来观察智能选股能力。直接推送选股结果有一个风险：如果本地行情日线未更新或数据异常，技术信号和因子排序会基于脏数据。

## 改动范围

- 新增 08:30「盘前智能选股通知」定时任务，按本地 A 股交易日历判断交易日；休市日跳过。
- `pnpm screen:schedule preopen` 可手动触发同一条链路。
- 盘前选股前先运行 `data-quality` harness；失败时停止选股并发送数据未就绪提醒。
- 选股成功后飞书推送数据质量分、热点、板块、候选池、钻石/因子信息和新增跟踪池情况。
- 补充飞书正文格式化单测。

## 预期影响

- 每个交易日开盘前形成一份可复盘的候选池。
- 避免在行情数据未就绪时生成误导性候选。
- 为后续验证候选池 T+1/T+3/T+5 表现提供固定快照入口。

## 验证方式

- `pnpm --filter @investment-agent/agent-core test -- preopen-screening.test.ts data-quality-harness.test.ts`
- 手动触发：`pnpm screen:schedule preopen`

## 后续观察指标

- 08:30 任务是否稳定触发。
- data-quality 失败是否能正确阻断选股。
- 法定节假日/休市日是否不会发出盘前候选池。
- 候选池后续 1/3/5/10 日相对收益。
- 飞书正文是否足够短、清楚、可执行。

## 回滚方案

关闭「盘前智能选股通知」定时任务，或删除 `screen-preopen` 任务与 `preopen-screening` 模块。现有 09:25/11:35/12:50/14:35 智能选股任务不受影响。

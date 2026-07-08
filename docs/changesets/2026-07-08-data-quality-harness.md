# Data Quality Harness

- Type: eval
- Status: shipped
- Date: 2026-07-08

## 背景与问题

选股、回测和模拟盘都依赖本地行情 CSV。此前已有数据新鲜度检查，但缺少一个适合日常运行和学习 harness 写法的结构化验收入口。

## 改动范围

- 新增 `data-quality` harness，检查本地行情新鲜度、CSV 样本池、样本日线行数、最新日期、重复日期、排序、OHLC、大间隔、异常涨跌幅和成交量额。
- 新增 CLI：`pnpm harness:data-quality`。
- 新增单测覆盖通过、数据过期、OHLC 异常三种场景。

## 预期影响

- 在跑选股、回测或模拟盘前，更早发现数据未更新或 CSV 脏数据。
- 给后续智能选股、模拟盘和新闻过滤 harness 提供一个简单可读的样板。

## 验证方式

- `pnpm --filter @investment-agent/agent-core test -- data-quality-harness.test.ts`
- `pnpm --filter @investment-agent/agent-core harness:data-quality -- --compact`

## 后续观察指标

- 每日数据质量分数是否稳定。
- `fail` 项是否能阻断依赖行情的自动任务。
- `warn` 项是否能帮助定位成交量额缺失、停牌或复权异常。

## 回滚方案

删除新增 harness 文件和 package script，不影响现有选股、回测、模拟盘逻辑。

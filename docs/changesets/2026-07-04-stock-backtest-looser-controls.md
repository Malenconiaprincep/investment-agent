# 2026-07-04 A 股回测支持策略松紧调节

## 背景

股票动量策略默认偏稳健，空仓时间可能较长。直接放松默认大盘阈值或弱动量暂停规则的压力窗口回测表现不稳定，容易多买低质量信号。

## 改动

- A 股回测页新增「大盘过滤」档位：强势确认、仅避开弱熊、关闭过滤。
- A 股回测页新增「防守动量阈值」输入，可把默认 3% 下调或设为 0。
- A 股回测页的「最大同时持仓」现在也会传给股票策略。
- 股票回测结果摘要展示最大持仓和大盘过滤档位，并按实际防守阈值生成说明。

## 验证

- `pnpm --filter @investment-agent/web test -- app/api/backtest/args.test.ts`
- `pnpm --filter @investment-agent/web exec tsc --noEmit` 当前仍被既有 `app/paper/page.tsx`、`lib/paper-dual.ts` 类型问题阻塞。

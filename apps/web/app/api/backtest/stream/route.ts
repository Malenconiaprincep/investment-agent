import { runAgentCoreBacktestJson } from '@/lib/agent-core';
import { requirePermission } from '@/lib/session';
import { getBacktestArgsFromSearchParams } from '../args';

export const runtime = 'nodejs';
export const maxDuration = 180;

type ProgressEvent = {
  type: 'progress';
  stage: string;
  message: string;
  detail?: string;
  percent: number;
  elapsedMs: number;
};

type ResultEvent = {
  type: 'result';
  result: unknown;
};

type ErrorEvent = {
  type: 'error';
  message: string;
};

type StreamEvent = ProgressEvent | ResultEvent | ErrorEvent;

const STOCK_UNIVERSE_SIZE = 4917;

function jsonLine(event: StreamEvent): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(event)}\n`);
}

function parseManualSymbolCount(searchParams: URLSearchParams): number {
  const symbols = searchParams.get('symbols') ?? '';
  return symbols
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean).length;
}

function buildStages(searchParams: URLSearchParams): Array<{ stage: string; message: string }> {
  const strategy = searchParams.get('strategy') ?? 'etf-momentum';
  const isStock =
    strategy === 'stock' || strategy === 'diamond' || strategy === 'diamond-momentum';

  if (isStock) {
    return [
      { stage: '准备数据', message: '读取回测区间、股票池和沪深300基准。' },
      { stage: '扫描股票池', message: '逐只读取本地前复权日线，排除科创板和无效 K 线。' },
      { stage: '识别信号', message: '回放红钻信号并检查动量 checklist。' },
      { stage: '模拟交易', message: '按止损、MA20、移动止盈和信号变化动态退出。' },
      { stage: '汇总曲线', message: '生成组合权益、大盘基准、分组和交易明细。' },
    ];
  }

  return [
    { stage: '准备数据', message: '读取 ETF 池、回测区间和沪深300基准。' },
    { stage: '计算动量', message: '按动量、趋势过滤和市场状态筛选持仓。' },
    { stage: '模拟调仓', message: '按调仓周期、止损和仓位规则滚动组合净值。' },
    { stage: '汇总曲线', message: '生成策略曲线、大盘基准、分组和交易明细。' },
  ];
}

function progressDetail(searchParams: URLSearchParams, tick: number): string {
  const strategy = searchParams.get('strategy') ?? 'etf-momentum';
  const isStock =
    strategy === 'stock' || strategy === 'diamond' || strategy === 'diamond-momentum';
  if (!isStock) return `已滚动 ${Math.max(1, tick)} 个计算批次`;

  const total =
    searchParams.get('universe') === 'retail-stock'
      ? STOCK_UNIVERSE_SIZE
      : Math.max(1, parseManualSymbolCount(searchParams));
  const scanned = Math.min(total, Math.max(1, tick) * Math.ceil(total / 24));
  return `估算扫描 ${scanned}/${total} 个标的`;
}

export async function GET(request: Request) {
  try {
    await requirePermission('backtest');
    const { searchParams } = new URL(request.url);
    const args = getBacktestArgsFromSearchParams(searchParams);
    const stages = buildStages(searchParams);

    let closed = false;
    let progressTimer: ReturnType<typeof setInterval> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let tick = 0;
        const startedAt = Date.now();
        const send = (event: StreamEvent) => {
          if (closed) return;
          try {
            controller.enqueue(jsonLine(event));
          } catch {
            closed = true;
            if (progressTimer) clearInterval(progressTimer);
          }
        };
        progressTimer = setInterval(() => {
          tick += 1;
          const elapsedMs = Date.now() - startedAt;
          const stageIndex = Math.min(
            stages.length - 1,
            Math.floor((tick / 24) * stages.length),
          );
          const stage = stages[stageIndex] ?? stages[stages.length - 1];
          const percent = Math.min(
            92,
            Math.max(5, Math.round((tick / 24) * 88)),
          );
          send({
            type: 'progress',
            stage: stage.stage,
            message: stage.message,
            detail: progressDetail(searchParams, tick),
            percent,
            elapsedMs,
          });
        }, 900);

        send({
          type: 'progress',
          stage: stages[0]?.stage ?? '开始回测',
          message: stages[0]?.message ?? '正在启动回测任务。',
          detail: progressDetail(searchParams, 0),
          percent: 3,
          elapsedMs: 0,
        });

        runAgentCoreBacktestJson(args)
          .then((stdout) => {
            send({
              type: 'progress',
              stage: '生成报告',
              message: '回测完成，正在渲染结果。',
              detail: '准备展示收益曲线和交易明细',
              percent: 100,
              elapsedMs: Date.now() - startedAt,
            });
            send({ type: 'result', result: JSON.parse(stdout) });
          })
          .catch((error) => {
            const message = error instanceof Error ? error.message : '回测计算失败';
            send({ type: 'error', message });
          })
          .finally(() => {
            if (progressTimer) clearInterval(progressTimer);
            closed = true;
            controller.close();
          });
      },
      cancel() {
        closed = true;
        if (progressTimer) clearInterval(progressTimer);
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '回测计算失败';
    const status = message === '无权访问此功能' ? 403 : 500;
    return Response.json({ error: message }, { status });
  }
}

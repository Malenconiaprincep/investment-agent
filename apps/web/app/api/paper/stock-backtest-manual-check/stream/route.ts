import { NextResponse } from 'next/server';
import { runAgentCorePaperJson } from '@/lib/agent-core';

export const runtime = 'nodejs';
export const maxDuration = 900;

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

const STAGES: Array<{ stage: string; message: string }> = [
  { stage: '检查日线', message: '确认本地日线是否已更新，并确定本次执行交易日。' },
  { stage: '扫描股票池', message: '按默认回测策略逐只读取全市场 A 股日线。' },
  { stage: '确认候选', message: '检查 T+2 延迟确认、大盘过滤、质量过滤和动量条件。' },
  { stage: '执行交易', message: '按回测策略仓规则处理卖出和新开仓。' },
  { stage: '刷新账户', message: '更新持仓、交易流水和收益曲线。' },
];

function jsonLine(event: StreamEvent): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(event)}\n`);
}

function progressDetail(tick: number): string {
  const scanned = Math.min(STOCK_UNIVERSE_SIZE, Math.max(1, tick) * 205);
  return `估算扫描 ${scanned}/${STOCK_UNIVERSE_SIZE} 个标的`;
}

export async function POST() {
  try {
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
            STAGES.length - 1,
            Math.floor((tick / 24) * STAGES.length),
          );
          const stage = STAGES[stageIndex] ?? STAGES[STAGES.length - 1];
          send({
            type: 'progress',
            stage: stage.stage,
            message: stage.message,
            detail: progressDetail(tick),
            percent: Math.min(94, Math.max(4, Math.round((tick / 24) * 90))),
            elapsedMs,
          });
        }, 900);

        send({
          type: 'progress',
          stage: STAGES[0].stage,
          message: STAGES[0].message,
          detail: '准备启动手动检查',
          percent: 3,
          elapsedMs: 0,
        });

        runAgentCorePaperJson(['stock-backtest-manual-check'])
          .then((stdout) => {
            send({
              type: 'progress',
              stage: '完成',
              message: '检查完成，正在刷新页面数据。',
              detail: '准备展示本次检查结果',
              percent: 100,
              elapsedMs: Date.now() - startedAt,
            });
            send({ type: 'result', result: JSON.parse(stdout) });
          })
          .catch((error) => {
            const message = error instanceof Error ? error.message : '回测策略手动检查失败';
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
    const message = error instanceof Error ? error.message : '回测策略手动检查失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
